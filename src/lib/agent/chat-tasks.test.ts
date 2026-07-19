import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    agentTask: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    agentTaskTrigger: {
      findUnique: vi.fn(),
      create: vi.fn()
    },
    aIGenerationLog: {
      updateMany: vi.fn()
    },
    conversation: {
      findFirst: vi.fn(),
      update: vi.fn()
    },
    message: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn()
    },
    messageHiddenFor: {
      upsert: vi.fn()
    }
  };
  return {
    prisma,
    getEffectiveChatPolicy: vi.fn(),
    scheduledRunAt: vi.fn()
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/agent/chat-policy", () => ({
  getEffectiveChatPolicy: mocks.getEffectiveChatPolicy
}));
vi.mock("@/lib/agent/schedule", () => ({
  scheduledRunAt: mocks.scheduledRunAt
}));

import {
  activeChatTaskKey,
  enqueueIncomingHumanMessage,
  hardDeleteAgentMessage,
  hideMessageForUser,
  retryTask,
  sendAssistedDraft,
  sendHumanMessage,
  takeOverTask
} from "@/lib/agent/chat-tasks";

const now = new Date("2026-07-19T04:00:00.000Z");
const nextRunAt = new Date("2026-07-19T04:01:00.000Z");
const basePolicy = {
  allowed: true,
  mode: "PROXY",
  delayMode: "SHORT",
  customDelaySeconds: 60,
  sendBufferSeconds: 15,
  timezone: "Asia/Shanghai",
  activeWindows: [{ day: 0, start: "00:00", end: "00:00" }],
  assistAutoDraft: false,
  policyRevision: 3,
  knowledgeRevision: 7,
  recipientAllowsAi: true,
  blockReason: null,
  avatarActive: true,
  globalEnabled: true,
  workerOnline: true,
  conversationType: "HUMAN",
  memberCount: 2,
  contactId: "contact"
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma)
  );
  mocks.getEffectiveChatPolicy.mockResolvedValue({ ...basePolicy });
  mocks.scheduledRunAt.mockReturnValue(nextRunAt);
  mocks.prisma.aIGenerationLog.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.agentTaskTrigger.create.mockResolvedValue({});
  mocks.prisma.conversation.update.mockResolvedValue({});
});

describe("chat task triggering and merging", () => {
  it("requires the trigger query to match a HUMAN message", async () => {
    mocks.prisma.message.findFirst.mockResolvedValue(null);

    const result = await enqueueIncomingHumanMessage(
      "owner",
      "conversation",
      "not-human"
    );

    expect(result).toEqual({ ok: false, error: "触发消息无效或无权访问" });
    expect(mocks.prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ senderMode: "HUMAN" })
      })
    );
    expect(mocks.prisma.agentTask.create).not.toHaveBeenCalled();
  });

  it.each(["AI", "AI_PROXY", "AI_ASSISTED"])(
    "does not enqueue a %s message because only HUMAN is queried",
    async () => {
      mocks.prisma.message.findFirst.mockResolvedValue(null);

      await enqueueIncomingHumanMessage("owner", "conversation", "ai-message");

      expect(mocks.prisma.message.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ senderMode: "HUMAN" })
        })
      );
      expect(mocks.prisma.agentTask.create).not.toHaveBeenCalled();
      expect(mocks.prisma.agentTaskTrigger.create).not.toHaveBeenCalled();
    }
  );

  it("merges a consecutive HUMAN message into the active key and resets runAt", async () => {
    mocks.prisma.message.findFirst.mockResolvedValue({ id: "m2", createdAt: now });
    mocks.prisma.agentTaskTrigger.findUnique.mockResolvedValue(null);
    mocks.prisma.agentTask.findUnique.mockResolvedValue({
      id: "task",
      status: "PENDING"
    });
    mocks.prisma.agentTask.update.mockResolvedValue({ id: "task" });

    const result = await enqueueIncomingHumanMessage(
      "owner",
      "conversation",
      "m2"
    );

    expect(result).toEqual({ ok: true, taskId: "task" });
    expect(mocks.prisma.agentTask.findUnique).toHaveBeenCalledWith({
      where: { activeKey: "chat:owner:conversation" },
      select: { id: true, status: true }
    });
    expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "task" },
        data: expect.objectContaining({
          status: "PENDING",
          runAt: nextRunAt,
          readyAt: null,
          draftContent: null
        })
      })
    );
    expect(mocks.prisma.agentTaskTrigger.create).toHaveBeenCalledWith({
      data: { taskId: "task", messageId: "m2", createdAt: now }
    });
  });

  it("invalidates a READY draft and log before rescheduling the new HUMAN message", async () => {
    mocks.prisma.message.findFirst.mockResolvedValue({ id: "m3", createdAt: now });
    mocks.prisma.agentTaskTrigger.findUnique.mockResolvedValue(null);
    mocks.prisma.agentTask.findUnique.mockResolvedValue({
      id: "ready-task",
      status: "READY"
    });
    mocks.prisma.agentTask.update.mockResolvedValue({ id: "ready-task" });

    await enqueueIncomingHumanMessage("owner", "conversation", "m3");

    expect(mocks.prisma.aIGenerationLog.updateMany).toHaveBeenCalledWith({
      where: { agentTaskId: "ready-task" },
      data: expect.objectContaining({
        inputSummary: null,
        output: null,
        finalEditedContent: null,
        status: "INVALIDATED"
      })
    });
    expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          draftContent: null,
          runAt: nextRunAt
        })
      })
    );
  });

  it("cancels the sender's PENDING and READY work when the sender replies as HUMAN", async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue({
      id: "conversation",
      members: [{ userId: "owner" }, { userId: "contact" }]
    });
    mocks.prisma.agentTask.findMany.mockResolvedValue([
      { id: "pending" },
      { id: "ready" }
    ]);
    mocks.prisma.message.create.mockResolvedValue({
      id: "human-message",
      createdAt: now
    });
    mocks.getEffectiveChatPolicy.mockResolvedValue({
      ...basePolicy,
      allowed: false,
      mode: "MANUAL",
      blockReason: "disabled"
    });

    const result = await sendHumanMessage("owner", {
      conversationId: "conversation",
      content: "我自己来回复"
    });

    expect(result).toEqual({
      ok: true,
      messageId: "human-message",
      taskId: undefined
    });
    expect(mocks.prisma.agentTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["pending", "ready"] } },
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelReason: "USER_TOOK_OVER",
          draftContent: null,
          activeKey: null
        })
      })
    );
    expect(mocks.prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: "conversation",
        senderId: "owner",
        senderMode: "HUMAN",
        content: "我自己来回复"
      }
    });
  });
});

describe("ASSIST lifecycle", () => {
  it("sends an unchanged READY draft as AI_ASSISTED without creating a trigger", async () => {
    const readyTask = {
      id: "assist-task",
      conversationId: "conversation",
      draftContent: "原始草稿"
    };
    mocks.prisma.agentTask.findFirst.mockResolvedValue(readyTask);
    mocks.getEffectiveChatPolicy.mockResolvedValue({
      ...basePolicy,
      mode: "ASSIST"
    });
    mocks.prisma.message.findUnique.mockResolvedValue(null);
    mocks.prisma.message.create.mockResolvedValue({ id: "assisted-message" });
    mocks.prisma.agentTask.update.mockResolvedValue({});

    const result = await sendAssistedDraft("owner", {
      taskId: "assist-task",
      content: "原始草稿"
    });

    expect(result).toEqual({
      ok: true,
      taskId: "assist-task",
      messageId: "assisted-message"
    });
    expect(mocks.prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: "conversation",
        senderId: "owner",
        content: "原始草稿",
        senderMode: "AI_ASSISTED",
        agentTaskId: "assist-task"
      }
    });
    expect(mocks.prisma.agentTaskTrigger.create).not.toHaveBeenCalled();
    expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUCCEEDED",
          activeKey: null,
          draftContent: null
        })
      })
    );
  });

  it("rejects an edited draft and requires explicit takeover", async () => {
    mocks.prisma.agentTask.findFirst.mockResolvedValue({
      id: "assist-task",
      conversationId: "conversation",
      draftContent: "原始草稿"
    });

    const result = await sendAssistedDraft("owner", {
      taskId: "assist-task",
      content: "用户修改后的内容"
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("接管");
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.message.create).not.toHaveBeenCalled();
  });

  it("takeover cancels the task as USER_TOOK_OVER and clears all generated text", async () => {
    mocks.prisma.agentTask.findFirst.mockResolvedValue({
      id: "assist-task",
      status: "READY"
    });
    mocks.prisma.agentTask.findMany.mockResolvedValue([{ id: "assist-task" }]);

    const result = await takeOverTask("owner", "assist-task");

    expect(result).toEqual({ ok: true, taskId: "assist-task" });
    expect(mocks.prisma.agentTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelReason: "USER_TOOK_OVER",
          draftContent: null
        })
      })
    );
    expect(mocks.prisma.aIGenerationLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inputSummary: null,
          output: null,
          finalEditedContent: null,
          status: "CANCELLED"
        })
      })
    );
  });
});

describe("deletion, hiding, and retry", () => {
  it("hard-deletes the owner's agent message and redacts its task and logs", async () => {
    mocks.prisma.message.findFirst.mockResolvedValue({
      id: "agent-message",
      agentTaskId: "task"
    });
    mocks.prisma.message.delete.mockResolvedValue({});

    const result = await hardDeleteAgentMessage("owner", "agent-message");

    expect(result).toEqual({
      ok: true,
      taskId: "task",
      messageId: "agent-message"
    });
    expect(mocks.prisma.aIGenerationLog.updateMany).toHaveBeenCalledWith({
      where: { agentTaskId: "task" },
      data: expect.objectContaining({
        inputSummary: null,
        output: null,
        finalEditedContent: null,
        messageId: null,
        status: "DELETED"
      })
    });
    expect(mocks.prisma.agentTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DELETED",
          draftContent: null,
          activeKey: null
        })
      })
    );
    expect(mocks.prisma.message.delete).toHaveBeenCalledWith({
      where: { id: "agent-message" }
    });
  });

  it("lets a recipient hide an agent message only for that recipient", async () => {
    mocks.prisma.message.findFirst.mockResolvedValue({ id: "received-agent-message" });
    mocks.prisma.messageHiddenFor.upsert.mockResolvedValue({});

    const result = await hideMessageForUser("recipient", "received-agent-message");

    expect(result).toEqual({ ok: true, messageId: "received-agent-message" });
    expect(mocks.prisma.messageHiddenFor.upsert).toHaveBeenCalledWith({
      where: {
        messageId_userId: {
          messageId: "received-agent-message",
          userId: "recipient"
        }
      },
      create: {
        messageId: "received-agent-message",
        userId: "recipient"
      },
      update: {}
    });
    expect(mocks.prisma.message.delete).not.toHaveBeenCalled();
  });

  it("restores only the owner's FAILED task to PENDING", async () => {
    mocks.prisma.agentTask.findFirst.mockResolvedValue({
      id: "failed-task",
      conversationId: "conversation"
    });
    mocks.prisma.agentTask.findUnique.mockResolvedValue(null);
    mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });

    const result = await retryTask("owner", "failed-task");

    expect(result).toEqual({ ok: true, taskId: "failed-task" });
    expect(mocks.prisma.agentTask.findFirst).toHaveBeenCalledWith({
      where: { id: "failed-task", ownerId: "owner", status: "FAILED" },
      select: { id: true, conversationId: true }
    });
    expect(mocks.prisma.agentTask.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: "failed-task",
          ownerId: "owner",
          status: "FAILED"
        },
        data: expect.objectContaining({
          status: "PENDING",
          activeKey: activeChatTaskKey("owner", "conversation"),
          attempts: 0,
          error: null
        })
      })
    );
  });
});
