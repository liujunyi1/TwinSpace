import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { getEffectiveChatPolicy } from "@/lib/agent/chat-policy";
import { scheduledRunAt } from "@/lib/agent/schedule";
import { prisma } from "@/lib/prisma";

const ACTIVE_STATUSES = ["PENDING", "RUNNING", "READY"] as const;
const AGENT_MESSAGE_MODES = ["AI_PROXY", "AI_ASSISTED"] as const;
const CONTENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

type Transaction = Prisma.TransactionClient;

export type ChatTaskResult = {
  ok: boolean;
  error?: string;
  taskId?: string;
  messageId?: string;
  draft?: string;
};

export function activeChatTaskKey(ownerId: string, conversationId: string) {
  return `chat:${ownerId}:${conversationId}`;
}

function taskKind(mode: "ASSIST" | "PROXY") {
  return mode === "ASSIST" ? "CHAT_ASSIST" : "CHAT_PROXY";
}

function isAgentMessageMode(value: string) {
  return (AGENT_MESSAGE_MODES as readonly string[]).includes(value);
}

async function redactTaskContent(tx: Transaction, taskId: string, status = "REDACTED") {
  const now = new Date();
  await tx.agentTask.updateMany({
    where: { id: taskId },
    data: {
      draftContent: null,
      redactedAt: now
    }
  });
  await tx.aIGenerationLog.updateMany({
    where: { agentTaskId: taskId },
    data: {
      inputSummary: null,
      output: null,
      finalEditedContent: null,
      error: null,
      status,
      redactedAt: now
    }
  });
}

async function cancelTaskRows(
  tx: Transaction,
  where: Prisma.AgentTaskWhereInput,
  reason: string
) {
  const tasks = await tx.agentTask.findMany({
    where: {
      ...where,
      status: { in: [...ACTIVE_STATUSES] }
    },
    select: { id: true }
  });
  if (tasks.length === 0) return 0;

  const now = new Date();
  await tx.agentTask.updateMany({
    where: { id: { in: tasks.map((task) => task.id) } },
    data: {
      status: "CANCELLED",
      activeKey: null,
      draftContent: null,
      cancelReason: reason,
      leaseToken: null,
      leaseUntil: null,
      readyAt: null,
      completedAt: now,
      redactedAt: now
    }
  });
  await tx.aIGenerationLog.updateMany({
    where: { agentTaskId: { in: tasks.map((task) => task.id) } },
    data: {
      inputSummary: null,
      output: null,
      finalEditedContent: null,
      error: null,
      status: "CANCELLED",
      redactedAt: now
    }
  });
  return tasks.length;
}

export async function cancelOwnerConversationTasks(
  ownerId: string,
  conversationId: string,
  reason = "POLICY_CHANGED"
) {
  return prisma.$transaction((tx) =>
    cancelTaskRows(tx, { ownerId, conversationId }, reason)
  );
}

export async function cancelAllOwnerTasks(userId: string, reason: string) {
  return prisma.$transaction((tx) => cancelTaskRows(tx, { ownerId: userId }, reason));
}

export async function enqueueIncomingHumanMessage(
  ownerId: string,
  conversationId: string,
  messageId: string,
  options: { forceAssist?: boolean } = {}
): Promise<ChatTaskResult> {
  const policy = await getEffectiveChatPolicy(ownerId, conversationId);
  if (!policy.allowed) return { ok: false, error: policy.blockReason || "当前不允许代理回复" };

  const mode = options.forceAssist ? "ASSIST" : policy.mode;
  if (mode !== "ASSIST" && mode !== "PROXY") {
    return { ok: false, error: "当前会话为手动模式" };
  }
  if (mode === "ASSIST" && !options.forceAssist && !policy.assistAutoDraft) {
    return { ok: true };
  }

  const now = new Date();
  const runAt = options.forceAssist
    ? now
    : scheduledRunAt({
        now,
        delayMode: policy.delayMode,
        customDelaySeconds: policy.customDelaySeconds,
        activeWindows: policy.activeWindows,
        timezone: policy.timezone
      });
  const activeKey = activeChatTaskKey(ownerId, conversationId);

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.findFirst({
      where: {
        id: messageId,
        conversationId,
        senderMode: "HUMAN",
        senderId: { not: ownerId },
        conversation: {
          type: "HUMAN",
          members: { some: { userId: ownerId } }
        }
      },
      select: { id: true, createdAt: true }
    });
    if (!message) return { ok: false, error: "触发消息无效或无权访问" };

    const previousTrigger = await tx.agentTaskTrigger.findUnique({
      where: { messageId },
      select: { taskId: true }
    });
    if (previousTrigger) {
      return { ok: true, taskId: previousTrigger.taskId };
    }

    let active = await tx.agentTask.findUnique({
      where: { activeKey },
      select: { id: true, status: true }
    });
    if (active?.status === "RUNNING") {
      await cancelTaskRows(tx, { id: active.id }, "STALE_DURING_GENERATION");
      active = null;
    }

    if (active && (active.status === "PENDING" || active.status === "READY")) {
      if (active.status === "READY") await redactTaskContent(tx, active.id, "INVALIDATED");
      const task = await tx.agentTask.update({
        where: { id: active.id },
        data: {
          kind: taskKind(mode),
          status: "PENDING",
          runAt,
          readyAt: null,
          leaseToken: null,
          leaseUntil: null,
          draftContent: null,
          cancelReason: null,
          error: null,
          model: null,
          policyRevision: policy.policyRevision,
          knowledgeRevision: policy.knowledgeRevision,
          contentExpiresAt: null,
          redactedAt: null,
          completedAt: null
        }
      });
      await tx.agentTaskTrigger.create({
        data: { taskId: task.id, messageId, createdAt: message.createdAt }
      });
      return { ok: true, taskId: task.id };
    }

    const task = await tx.agentTask.create({
      data: {
        ownerId,
        conversationId,
        kind: taskKind(mode),
        status: "PENDING",
        activeKey,
        idempotencyKey: randomUUID(),
        runAt,
        attempts: 0,
        maxAttempts: 3,
        policyRevision: policy.policyRevision,
        knowledgeRevision: policy.knowledgeRevision,
        triggers: {
          create: { messageId, createdAt: message.createdAt }
        }
      }
    });
    return { ok: true, taskId: task.id };
  });
}

export async function sendHumanMessage(
  userId: string,
  input: { conversationId: string; content: string }
): Promise<ChatTaskResult> {
  const content = input.content.trim();
  if (!content || content.length > 1000) {
    return { ok: false, error: "消息内容应为 1 至 1000 个字符" };
  }

  const created = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: {
        id: input.conversationId,
        type: "HUMAN",
        members: { some: { userId } }
      },
      include: { members: { select: { userId: true } } }
    });
    if (!conversation || conversation.members.length !== 2) {
      return { ok: false as const, error: "仅支持两人真人会话" };
    }
    const contact = conversation.members.find((member) => member.userId !== userId);
    if (!contact) return { ok: false as const, error: "会话成员无效" };

    await cancelTaskRows(
      tx,
      { ownerId: userId, conversationId: conversation.id },
      "USER_TOOK_OVER"
    );
    const message = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderId: userId,
        senderMode: "HUMAN",
        content
      }
    });
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: message.createdAt }
    });
    return {
      ok: true as const,
      messageId: message.id,
      conversationId: conversation.id,
      contactId: contact.userId
    };
  });

  if (!created.ok) return created;
  const queued = await enqueueIncomingHumanMessage(
    created.contactId,
    created.conversationId,
    created.messageId
  );
  return {
    ok: true,
    messageId: created.messageId,
    taskId: queued.ok ? queued.taskId : undefined
  };
}

export async function generateOnDemandAssistTask(
  userId: string,
  conversationId: string
): Promise<ChatTaskResult> {
  const policy = await getEffectiveChatPolicy(userId, conversationId);
  if (!policy.allowed || policy.mode !== "ASSIST") {
    return { ok: false, error: policy.blockReason || "当前会话未开启 AI 辅助" };
  }

  const lastOwnMessage = await prisma.message.findFirst({
    where: { conversationId, senderId: userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true }
  });
  const incoming = await prisma.message.findMany({
    where: {
      conversationId,
      senderId: policy.contactId,
      senderMode: "HUMAN",
      ...(lastOwnMessage ? { createdAt: { gt: lastOwnMessage.createdAt } } : {})
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true }
  });
  if (incoming.length === 0) return { ok: false, error: "没有待回复的真人消息" };

  let taskId: string | undefined;
  for (const message of incoming) {
    const result = await enqueueIncomingHumanMessage(userId, conversationId, message.id, {
      forceAssist: true
    });
    if (!result.ok) return result;
    taskId = result.taskId || taskId;
  }
  return { ok: true, taskId };
}

export async function sendAssistedDraft(
  userId: string,
  input: { taskId: string; content: string }
): Promise<ChatTaskResult> {
  const task = await prisma.agentTask.findFirst({
    where: {
      id: input.taskId,
      ownerId: userId,
      kind: "CHAT_ASSIST",
      status: "READY"
    },
    select: { id: true, conversationId: true, draftContent: true }
  });
  if (!task?.draftContent) return { ok: false, error: "辅助草稿不存在或已经失效" };
  if (input.content !== task.draftContent) {
    return { ok: false, error: "草稿已被编辑，请先接管任务并作为真人消息发送" };
  }

  const policy = await getEffectiveChatPolicy(userId, task.conversationId);
  if (!policy.allowed || policy.mode !== "ASSIST") {
    return { ok: false, error: policy.blockReason || "当前不允许发送 AI 辅助消息" };
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.agentTask.findFirst({
      where: {
        id: task.id,
        ownerId: userId,
        kind: "CHAT_ASSIST",
        status: "READY"
      },
      select: { id: true, conversationId: true, draftContent: true }
    });
    if (!current?.draftContent || current.draftContent !== input.content) {
      return { ok: false, error: "草稿已经失效" };
    }

    const existing = await tx.message.findUnique({
      where: { agentTaskId: current.id },
      select: { id: true }
    });
    if (existing) return { ok: true, taskId: current.id, messageId: existing.id };

    const message = await tx.message.create({
      data: {
        conversationId: current.conversationId,
        senderId: userId,
        content: current.draftContent,
        senderMode: "AI_ASSISTED",
        agentTaskId: current.id
      }
    });
    const now = new Date();
    await tx.conversation.update({
      where: { id: current.conversationId },
      data: { updatedAt: now }
    });
    await tx.agentTask.update({
      where: { id: current.id },
      data: {
        status: "SUCCEEDED",
        activeKey: null,
        draftContent: null,
        completedAt: now,
        contentExpiresAt: new Date(now.getTime() + CONTENT_RETENTION_MS)
      }
    });
    await tx.aIGenerationLog.updateMany({
      where: { agentTaskId: current.id },
      data: {
        accepted: true,
        finalEditedContent: current.draftContent,
        messageId: message.id,
        status: "SUCCEEDED",
        expiresAt: new Date(now.getTime() + CONTENT_RETENTION_MS)
      }
    });
    return { ok: true, taskId: current.id, messageId: message.id };
  });
}

async function cancelOwnedTask(userId: string, taskId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.agentTask.findFirst({
      where: { id: taskId, ownerId: userId },
      select: { id: true, status: true }
    });
    if (!task) return { ok: false, error: "任务不存在" };
    if (!(ACTIVE_STATUSES as readonly string[]).includes(task.status)) {
      return { ok: false, error: "任务已经结束" };
    }
    await cancelTaskRows(tx, { id: task.id, ownerId: userId }, reason);
    return { ok: true, taskId: task.id };
  });
}

export function takeOverTask(userId: string, taskId: string) {
  return cancelOwnedTask(userId, taskId, "USER_TOOK_OVER");
}

export function cancelTask(userId: string, taskId: string) {
  return cancelOwnedTask(userId, taskId, "USER_CANCELLED");
}

export async function retryTask(userId: string, taskId: string): Promise<ChatTaskResult> {
  const task = await prisma.agentTask.findFirst({
    where: { id: taskId, ownerId: userId, status: "FAILED" },
    select: { id: true, conversationId: true }
  });
  if (!task) return { ok: false, error: "只有失败的本人任务可以重试" };

  const policy = await getEffectiveChatPolicy(userId, task.conversationId);
  if (!policy.allowed) return { ok: false, error: policy.blockReason || "当前不能重试" };

  return prisma.$transaction(async (tx) => {
    const activeKey = activeChatTaskKey(userId, task.conversationId);
    const conflict = await tx.agentTask.findUnique({
      where: { activeKey },
      select: { id: true }
    });
    if (conflict && conflict.id !== task.id) {
      return { ok: false, error: "该会话已有等待中的代理任务" };
    }
    await redactTaskContent(tx, task.id, "RETRYING");
    const updated = await tx.agentTask.updateMany({
      where: { id: task.id, ownerId: userId, status: "FAILED" },
      data: {
        status: "PENDING",
        activeKey,
        runAt: new Date(),
        readyAt: null,
        leaseToken: null,
        leaseUntil: null,
        attempts: 0,
        cancelReason: null,
        error: null,
        model: null,
        policyRevision: policy.policyRevision,
        knowledgeRevision: policy.knowledgeRevision,
        contentExpiresAt: null,
        redactedAt: null,
        completedAt: null
      }
    });
    return updated.count === 1
      ? { ok: true, taskId: task.id }
      : { ok: false, error: "任务状态已经变化" };
  });
}

export async function hardDeleteAgentMessage(
  userId: string,
  messageId: string
): Promise<ChatTaskResult> {
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.findFirst({
      where: {
        id: messageId,
        senderId: userId,
        senderMode: { in: [...AGENT_MESSAGE_MODES] },
        conversation: { members: { some: { userId } } }
      },
      select: { id: true, agentTaskId: true }
    });
    if (!message) return { ok: false, error: "只能删除由本人分身发送的消息" };

    const now = new Date();
    if (message.agentTaskId) {
      await tx.aIGenerationLog.updateMany({
        where: { agentTaskId: message.agentTaskId },
        data: {
          inputSummary: null,
          output: null,
          finalEditedContent: null,
          messageId: null,
          error: null,
          status: "DELETED",
          redactedAt: now
        }
      });
      await tx.agentTask.updateMany({
        where: { id: message.agentTaskId, ownerId: userId },
        data: {
          status: "DELETED",
          activeKey: null,
          draftContent: null,
          cancelReason: "OWNER_DELETED",
          error: null,
          redactedAt: now,
          completedAt: now
        }
      });
    }
    await tx.message.delete({ where: { id: message.id } });
    return { ok: true, taskId: message.agentTaskId || undefined, messageId };
  });
}

export async function hideMessageForUser(
  userId: string,
  messageId: string
): Promise<ChatTaskResult> {
  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      senderId: { not: userId },
      senderMode: { in: [...AGENT_MESSAGE_MODES] },
      conversation: { members: { some: { userId } } }
    },
    select: { id: true }
  });
  if (!message) return { ok: false, error: "只能隐藏收到的 AI 代理消息" };

  await prisma.messageHiddenFor.upsert({
    where: { messageId_userId: { messageId, userId } },
    create: { messageId, userId },
    update: {}
  });
  return { ok: true, messageId };
}

export async function getAgentActivities(userId: string) {
  const tasks = await prisma.agentTask.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      conversation: { select: { title: true } },
      triggers: {
        select: {
          createdAt: true,
          message: { select: { id: true } }
        }
      },
      outputMessage: { select: { id: true, senderMode: true, createdAt: true } }
    }
  });

  return tasks.map((task) => ({
    id: task.id,
    taskId: task.id,
    kind: task.kind,
    status: task.status,
    conversationId: task.conversationId,
    conversationTitle: task.conversation.title,
    draft: task.draftContent,
    draftContent: task.draftContent,
    runAt: task.runAt.toISOString(),
    readyAt: task.readyAt?.toISOString() || null,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    cancelReason: task.cancelReason,
    error: task.error,
    model: task.model,
    triggerCount: task.triggers.length,
    triggerMessageIds: task.triggers.map((trigger) => trigger.message.id),
    messageId: task.outputMessage?.id || null,
    messageMode: task.outputMessage?.senderMode || null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() || null,
    redacted: Boolean(task.redactedAt)
  }));
}
