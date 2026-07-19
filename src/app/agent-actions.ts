"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { generateFriendReplyDraft } from "@/lib/ai";
import {
  cancelAllOwnerTasks,
  cancelTask,
  generateOnDemandAssistTask,
  hardDeleteAgentMessage,
  hideMessageForUser,
  retryTask,
  sendAssistedDraft,
  sendHumanMessage,
  takeOverTask
} from "@/lib/agent/chat-tasks";
import { prisma } from "@/lib/prisma";
import {
  agentEntityIdSchema,
  agentToggleSchema,
  assistDraftSendSchema,
  conversationAgentSettingsSchema,
  globalAgentSettingsSchema,
  humanChatMessageSchema
} from "@/lib/schemas";

type GlobalAgentSettingsInput = z.infer<typeof globalAgentSettingsSchema>;
type ConversationAgentSettingsInput = z.infer<typeof conversationAgentSettingsSchema>;
type HumanChatMessageInput = z.infer<typeof humanChatMessageSchema>;
type AssistDraftSendInput = z.infer<typeof assistDraftSendSchema>;

const ACTIVE_TASK_STATUSES = ["PENDING", "RUNNING", "READY"];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试";
}

function firstValidationError(result: { error: z.ZodError }) {
  return result.error.issues[0]?.message || "输入格式不正确";
}

function revalidateAgentPages(conversationId?: string | null) {
  revalidatePath("/avatar");
  revalidatePath("/avatar/settings");
  revalidatePath("/avatar/activity");
  revalidatePath("/messages");
  if (conversationId) revalidatePath(`/messages/${conversationId}`);
}

async function requireDirectHumanConversation(userId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      type: "HUMAN",
      members: { some: { userId } }
    },
    select: {
      id: true,
      members: { select: { userId: true } }
    }
  });
  if (!conversation || conversation.members.length !== 2) {
    throw new Error("当前会话不支持 AI 分身代理设置");
  }
  return conversation;
}

async function cancelConversationOwnerTasks(userId: string, conversationId: string) {
  const tasks = await prisma.agentTask.findMany({
    where: {
      ownerId: userId,
      conversationId,
      status: { in: ACTIVE_TASK_STATUSES }
    },
    select: { id: true }
  });
  await Promise.all(tasks.map((task) => cancelTask(userId, task.id)));
}

async function cancelInboundTasks(
  recipientId: string,
  conversationId: string | null,
  reason: string
) {
  await prisma.agentTask.updateMany({
    where: {
      ownerId: { not: recipientId },
      status: { in: ACTIVE_TASK_STATUSES },
      conversationId: conversationId || undefined,
      conversation: { members: { some: { userId: recipientId } } }
    },
    data: {
      status: "CANCELLED",
      activeKey: null,
      cancelReason: reason,
      leaseToken: null,
      leaseUntil: null,
      completedAt: new Date()
    }
  });
}

async function generateAiContactReply(
  userId: string,
  conversationId: string,
  latestUserMessage: string
) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      type: "AI_CONTACT",
      members: { some: { userId } }
    },
    include: {
      members: { select: { userId: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { content: true }
      }
    }
  });
  if (!conversation) return;

  const botMember = conversation.members.find((member) => member.userId !== userId);
  if (!botMember) {
    throw new Error("AI 联系人缺少固定机器人身份");
  }
  const profile = await prisma.personalityProfile.findUnique({
    where: { userId },
    select: { summary: true }
  });
  const text = await generateFriendReplyDraft({
    profileSummary: profile?.summary || "暂无画像",
    conversationTitle: conversation.title,
    recentMessages: conversation.messages.map((message) => message.content).reverse(),
    latestUserMessage
  });
  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        senderId: botMember.userId,
        content: text,
        senderMode: "AI"
      }
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    })
  ]);
}

export async function toggleGlobalAgentAction(enabled: boolean) {
  const user = await requireUser();
  const parsed = agentToggleSchema.safeParse(enabled);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.avatarAgentSetting.upsert({
        where: { userId: user.id },
        create: { userId: user.id, enabled: parsed.data },
        update: {
          enabled: parsed.data,
          policyRevision: { increment: 1 }
        }
      });
      await tx.avatarProfile.updateMany({
        where: { userId: user.id },
        data: { policyRevision: { increment: 1 } }
      });
    });
    if (!parsed.data) {
      await cancelAllOwnerTasks(user.id, "全局代理已暂停");
    }
    revalidateAgentPages();
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function updateGlobalAgentSettingsAction(input: GlobalAgentSettingsInput) {
  const user = await requireUser();
  const parsed = globalAgentSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    const data = parsed.data;
    await prisma.$transaction(async (tx) => {
      await tx.avatarAgentSetting.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          defaultMode: data.defaultMode,
          assistAutoDraft: data.assistAutoDraft,
          delayMode: data.delayMode,
          customDelaySeconds: data.customDelaySeconds,
          sendBufferSeconds: data.sendBufferSeconds,
          timezone: data.timezone,
          activeWindowsJson: JSON.stringify(data.activeWindows),
          receiveAi: data.receiveAi
        },
        update: {
          defaultMode: data.defaultMode,
          assistAutoDraft: data.assistAutoDraft,
          delayMode: data.delayMode,
          customDelaySeconds: data.customDelaySeconds,
          sendBufferSeconds: data.sendBufferSeconds,
          timezone: data.timezone,
          activeWindowsJson: JSON.stringify(data.activeWindows),
          receiveAi: data.receiveAi,
          policyRevision: { increment: 1 }
        }
      });
      await tx.avatarProfile.updateMany({
        where: { userId: user.id },
        data: { policyRevision: { increment: 1 } }
      });
    });
    await cancelAllOwnerTasks(user.id, "全局代理策略已更新");
    if (!data.receiveAi) {
      await cancelInboundTasks(user.id, null, "接收方已拒绝 AI 代理消息");
    }
    revalidateAgentPages();
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function updateConversationAgentSettingsAction(
  input: ConversationAgentSettingsInput
) {
  const user = await requireUser();
  const parsed = conversationAgentSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    const data = parsed.data;
    await requireDirectHumanConversation(user.id, data.conversationId);
    await prisma.conversationAgentSetting.upsert({
      where: {
        conversationId_userId: {
          conversationId: data.conversationId,
          userId: user.id
        }
      },
      create: {
        conversationId: data.conversationId,
        userId: user.id,
        modeOverride: data.modeOverride === "INHERIT" ? null : data.modeOverride,
        delayOverride: data.delayOverride === "INHERIT" ? null : data.delayOverride,
        customDelaySeconds:
          data.delayOverride === "CUSTOM" ? data.customDelaySeconds : null,
        activeWindowMode: data.activeWindowMode,
        activeWindowsJson:
          data.activeWindowMode === "CUSTOM"
            ? JSON.stringify(data.activeWindows)
            : null,
        receiveAiFromContact: data.receiveAiFromContact ? "ALLOW" : "BLOCK"
      },
      update: {
        modeOverride: data.modeOverride === "INHERIT" ? null : data.modeOverride,
        delayOverride: data.delayOverride === "INHERIT" ? null : data.delayOverride,
        customDelaySeconds:
          data.delayOverride === "CUSTOM" ? data.customDelaySeconds : null,
        activeWindowMode: data.activeWindowMode,
        activeWindowsJson:
          data.activeWindowMode === "CUSTOM"
            ? JSON.stringify(data.activeWindows)
            : null,
        receiveAiFromContact: data.receiveAiFromContact ? "ALLOW" : "BLOCK",
        revision: { increment: 1 }
      }
    });
    await cancelConversationOwnerTasks(user.id, data.conversationId);
    if (!data.receiveAiFromContact) {
      await cancelInboundTasks(
        user.id,
        data.conversationId,
        "接收方已拒绝此联系人的 AI 代理消息"
      );
    }
    revalidateAgentPages(data.conversationId);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function sendHumanChatMessageAction(input: HumanChatMessageInput) {
  const user = await requireUser();
  const parsed = humanChatMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: parsed.data.conversationId,
        members: { some: { userId: user.id } }
      },
      select: { type: true }
    });
    if (!conversation) throw new Error("你没有权限在这个会话中发送消息");

    await sendHumanMessage(user.id, parsed.data);
    if (conversation.type === "AI_CONTACT") {
      await generateAiContactReply(
        user.id,
        parsed.data.conversationId,
        parsed.data.content
      );
    }
    revalidateAgentPages(parsed.data.conversationId);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function generateAssistDraftAction(conversationId: string) {
  const user = await requireUser();
  const parsed = agentEntityIdSchema.safeParse(conversationId);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    await requireDirectHumanConversation(user.id, parsed.data);
    const result = await generateOnDemandAssistTask(user.id, parsed.data);
    const task = await prisma.agentTask.findFirst({
      where: { id: result.taskId, ownerId: user.id },
      select: { draftContent: true }
    });
    revalidateAgentPages(parsed.data);
    return {
      ok: true as const,
      taskId: result.taskId,
      draft: task?.draftContent || undefined
    };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function sendAssistDraftAction(input: AssistDraftSendInput) {
  const user = await requireUser();
  const parsed = assistDraftSendSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    const task = await prisma.agentTask.findFirst({
      where: { id: parsed.data.taskId, ownerId: user.id },
      select: { conversationId: true }
    });
    if (!task) throw new Error("草稿任务不存在或不属于你");
    await sendAssistedDraft(user.id, parsed.data);
    revalidateAgentPages(task.conversationId);
    return { ok: true as const, taskId: parsed.data.taskId };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function takeOverAgentTaskAction(taskId: string) {
  const user = await requireUser();
  const parsed = agentEntityIdSchema.safeParse(taskId);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    const task = await prisma.agentTask.findFirst({
      where: { id: parsed.data, ownerId: user.id },
      select: { conversationId: true }
    });
    if (!task) throw new Error("代理任务不存在或不属于你");
    await takeOverTask(user.id, parsed.data);
    revalidateAgentPages(task.conversationId);
    return { ok: true as const, taskId: parsed.data };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function cancelAgentTaskAction(taskId: string) {
  const user = await requireUser();
  const parsed = agentEntityIdSchema.safeParse(taskId);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    const task = await prisma.agentTask.findFirst({
      where: { id: parsed.data, ownerId: user.id },
      select: { conversationId: true }
    });
    if (!task) throw new Error("代理任务不存在或不属于你");
    await cancelTask(user.id, parsed.data);
    revalidateAgentPages(task.conversationId);
    return { ok: true as const, taskId: parsed.data };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function retryAgentTaskAction(taskId: string) {
  const user = await requireUser();
  const parsed = agentEntityIdSchema.safeParse(taskId);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    const task = await prisma.agentTask.findFirst({
      where: { id: parsed.data, ownerId: user.id },
      select: { conversationId: true }
    });
    if (!task) throw new Error("代理任务不存在或不属于你");
    const result = await retryTask(user.id, parsed.data);
    revalidateAgentPages(task.conversationId);
    return { ok: true as const, taskId: result.taskId };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function deleteAgentMessageAction(messageId: string) {
  const user = await requireUser();
  const parsed = agentEntityIdSchema.safeParse(messageId);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    const message = await prisma.message.findUnique({
      where: { id: parsed.data },
      select: { conversationId: true }
    });
    await hardDeleteAgentMessage(user.id, parsed.data);
    revalidateAgentPages(message?.conversationId);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function hideAgentMessageAction(messageId: string) {
  const user = await requireUser();
  const parsed = agentEntityIdSchema.safeParse(messageId);
  if (!parsed.success) return { ok: false as const, error: firstValidationError(parsed) };

  try {
    const message = await prisma.message.findUnique({
      where: { id: parsed.data },
      select: { conversationId: true }
    });
    await hideMessageForUser(user.id, parsed.data);
    revalidateAgentPages(message?.conversationId);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}
