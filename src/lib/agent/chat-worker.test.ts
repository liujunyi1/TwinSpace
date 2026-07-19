import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const prisma = {
    agentWorkerHeartbeat: {
      upsert: vi.fn(),
      updateMany: vi.fn()
    },
    aIGenerationLog: {
      updateMany: vi.fn(),
      create: vi.fn()
    },
    agentTask: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn()
    },
    avatarKnowledgePage: {
      findMany: vi.fn()
    },
    message: {
      findMany: vi.fn(),
      create: vi.fn()
    },
    conversation: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn()
  };
  return {
    prisma,
    getEffectiveChatPolicy: vi.fn(),
    generateProxyReply: vi.fn(),
    isWithinActiveWindows: vi.fn(),
    nextAllowedTime: vi.fn(),
    enqueueIncomingHumanMessage: vi.fn()
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/agent/chat-policy", () => ({
  getEffectiveChatPolicy: mocks.getEffectiveChatPolicy
}));
vi.mock("@/lib/agent/proxy-reply", () => ({
  generateProxyReply: mocks.generateProxyReply
}));
vi.mock("@/lib/agent/schedule", () => ({
  isWithinActiveWindows: mocks.isWithinActiveWindows,
  nextAllowedTime: mocks.nextAllowedTime
}));
vi.mock("@/lib/agent/chat-tasks", () => ({
  enqueueIncomingHumanMessage: mocks.enqueueIncomingHumanMessage
}));

import {
  chatWorkerTestApi,
  isRelationshipKnowledgeCategory,
  retryBackoffSeconds
} from "@/lib/agent/chat-worker";

const NOW = new Date("2026-07-19T10:00:00.000Z");
const CONTACT_ID = "contact-1";

function leaseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    ownerId: "owner-1",
    conversationId: "conversation-1",
    kind: "PROXY",
    status: "RUNNING",
    runAt: NOW,
    readyAt: null,
    leaseToken: "lease-1",
    leaseUntil: new Date(NOW.getTime() + 300_000),
    attempts: 0,
    maxAttempts: 3,
    draftContent: null,
    policyRevision: 3,
    knowledgeRevision: 7,
    ...overrides
  };
}

function validPolicy(overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    mode: "PROXY",
    delayMode: "SHORT",
    customDelaySeconds: 60,
    sendBufferSeconds: 15,
    timezone: "Asia/Shanghai",
    activeWindows: [{ day: 0, start: "00:00", end: "24:00" }],
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
    contactId: CONTACT_ID,
    ...overrides
  };
}

function directMembership() {
  return {
    type: "HUMAN",
    members: [{ userId: "owner-1" }, { userId: CONTACT_ID }]
  };
}

function loadedGenerationTask(mode: "ASSIST" | "PROXY") {
  return {
    ...leaseTask({ kind: mode }),
    owner: {
      id: "owner-1",
      nickname: "林澈",
      personalityProfile: {
        summary: "表达温和、简短",
        traitsJson: JSON.stringify({ expressionRules: "先回应感受" }),
        communicationStyle: "先回应感受"
      },
      avatarProfile: {
        knowledgeRevision: 7
      }
    },
    conversation: {
      type: "HUMAN",
      title: "林澈与青络",
      members: [
        { userId: "owner-1", user: { id: "owner-1", nickname: "林澈" } },
        { userId: CONTACT_ID, user: { id: CONTACT_ID, nickname: "青络" } }
      ],
      messages: [
        {
          id: "trigger-1",
          senderId: CONTACT_ID,
          senderMode: "HUMAN",
          content: "今天有点累",
          createdAt: NOW,
          sender: { nickname: "青络" }
        }
      ]
    },
    triggers: [
      {
        createdAt: NOW,
        message: {
          id: "trigger-1",
          senderId: CONTACT_ID,
          senderMode: "HUMAN",
          content: "今天有点累",
          createdAt: NOW,
          sender: { nickname: "青络" }
        }
      }
    ]
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (input: unknown) =>
      typeof input === "function"
        ? (input as (tx: typeof mocks.prisma) => Promise<unknown>)(mocks.prisma)
        : Promise.all(input as Promise<unknown>[])
  );
  mocks.prisma.agentWorkerHeartbeat.upsert.mockResolvedValue({});
  mocks.prisma.aIGenerationLog.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.aIGenerationLog.create.mockResolvedValue({});
  mocks.prisma.agentTask.findMany.mockResolvedValue([]);
  mocks.prisma.agentTask.findFirst.mockResolvedValue(null);
  mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.agentTask.create.mockResolvedValue({});
  mocks.prisma.avatarKnowledgePage.findMany.mockResolvedValue([]);
  mocks.prisma.message.findMany.mockResolvedValue([]);
  mocks.prisma.message.create.mockResolvedValue({
    id: "message-output",
    content: "回复正文"
  });
  mocks.prisma.conversation.findUnique.mockResolvedValue(directMembership());
  mocks.prisma.conversation.update.mockResolvedValue({});
  mocks.getEffectiveChatPolicy.mockResolvedValue(validPolicy());
  mocks.generateProxyReply.mockResolvedValue({ text: "先休息一下，晚点再聊也可以。", model: "mock" });
  mocks.isWithinActiveWindows.mockReturnValue(true);
  mocks.nextAllowedTime.mockReturnValue(new Date(NOW.getTime() + 60_000));
});

describe("chat worker leasing and retries", () => {
  it("recovers an expired generation lease into PENDING", async () => {
    mocks.prisma.agentTask.findMany.mockResolvedValue([
      leaseTask({
        leaseUntil: new Date(NOW.getTime() - 1),
        draftContent: null
      })
    ]);

    await chatWorkerTestApi.recoverExpiredLeases(NOW);

    expect(mocks.prisma.agentTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "RUNNING", leaseToken: "lease-1" }),
        data: expect.objectContaining({
          status: "PENDING",
          attempts: 1,
          leaseToken: null,
          leaseUntil: null
        })
      })
    );
  });

  it("uses CAS so two workers cannot claim the same PENDING task", async () => {
    const pending = leaseTask({
      status: "PENDING",
      leaseToken: null,
      leaseUntil: null
    });
    mocks.prisma.agentTask.findFirst.mockResolvedValue(pending);
    mocks.prisma.agentTask.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await chatWorkerTestApi.claimPendingTask(NOW);
    const second = await chatWorkerTestApi.claimPendingTask(NOW);

    expect(first?.status).toBe("RUNNING");
    expect(second).toBeNull();
    expect(mocks.prisma.agentTask.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: "task-1", status: "PENDING" })
      })
    );
  });

  it.each([
    { attempts: 0, maxAttempts: 5, delay: 30, status: "PENDING" },
    { attempts: 1, maxAttempts: 5, delay: 120, status: "PENDING" },
    { attempts: 2, maxAttempts: 5, delay: 600, status: "PENDING" },
    { attempts: 2, maxAttempts: 3, delay: null, status: "FAILED" }
  ])(
    "reschedules failure attempt $attempts with the bounded backoff",
    async ({ attempts, maxAttempts, delay, status }) => {
      await chatWorkerTestApi.recordTaskFailure(
        leaseTask({ attempts, maxAttempts }),
        "lease-1",
        "generate",
        new Error("provider unavailable"),
        NOW
      );

      const update = mocks.prisma.agentTask.updateMany.mock.calls.at(-1)?.[0];
      expect(update.data.status).toBe(status);
      expect(update.data.attempts).toBe(attempts + 1);
      if (delay === null) {
        expect(update.data.activeKey).toBeNull();
      } else {
        expect(update.data.runAt.toISOString()).toBe(
          new Date(NOW.getTime() + delay * 1000).toISOString()
        );
      }
    }
  );

  it("exposes the exact 30/120/600 retry schedule", () => {
    expect(retryBackoffSeconds(1)).toBe(30);
    expect(retryBackoffSeconds(2)).toBe(120);
    expect(retryBackoffSeconds(3)).toBe(600);
    expect(retryBackoffSeconds(20)).toBe(600);
  });
});

describe("chat worker generation states", () => {
  it("stores an ASSIST generation as READY without an automatic send time", async () => {
    const task = leaseTask({ kind: "ASSIST" });
    mocks.getEffectiveChatPolicy.mockResolvedValue(validPolicy({ mode: "ASSIST" }));
    mocks.prisma.agentTask.findFirst.mockResolvedValue(loadedGenerationTask("ASSIST"));

    const result = await chatWorkerTestApi.generateClaimedTask(task, NOW);

    const readyUpdate = mocks.prisma.agentTask.updateMany.mock.calls.find(
      ([call]) => call.data?.status === "READY"
    )?.[0];
    expect(result.result.action).toBe("generated");
    expect(result.sendNow).toBe(false);
    expect(readyUpdate.data.readyAt).toBeNull();
    expect(mocks.prisma.message.create).not.toHaveBeenCalled();
  });

  it("stores a PROXY generation as READY until its send buffer expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const task = leaseTask({ kind: "PROXY" });
    mocks.prisma.agentTask.findFirst.mockResolvedValue(loadedGenerationTask("PROXY"));

    const result = await chatWorkerTestApi.generateClaimedTask(task, NOW);

    const readyUpdate = mocks.prisma.agentTask.updateMany.mock.calls.find(
      ([call]) => call.data?.status === "READY"
    )?.[0];
    expect(result.sendNow).toBe(false);
    expect(readyUpdate.data.readyAt.toISOString()).toBe(
      new Date(NOW.getTime() + 15_000).toISOString()
    );
    expect(mocks.prisma.message.create).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("chat worker send safety", () => {
  it("cancels a READY reply when policy changes before send", async () => {
    mocks.getEffectiveChatPolicy.mockResolvedValue(
      validPolicy({
        allowed: false,
        mode: "MANUAL",
        blockReason: "GLOBAL_DISABLED"
      })
    );

    const result = await chatWorkerTestApi.sendClaimedProxyTask(
      leaseTask({ draftContent: "待发送正文", readyAt: NOW }),
      NOW
    );

    expect(result.action).toBe("cancelled");
    expect(mocks.prisma.agentTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELLED",
          activeKey: null,
          cancelReason: "GLOBAL_DISABLED"
        })
      })
    );
    expect(mocks.prisma.message.create).not.toHaveBeenCalled();
  });

  it("cancels a READY reply when direct membership changes before send", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({
      type: "HUMAN",
      members: [{ userId: "owner-1" }]
    });

    const result = await chatWorkerTestApi.sendClaimedProxyTask(
      leaseTask({ draftContent: "待发送正文", readyAt: NOW }),
      NOW
    );

    expect(result.action).toBe("cancelled");
    expect(mocks.prisma.agentTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelReason: "MEMBERSHIP_CHANGED"
        })
      })
    );
    expect(mocks.prisma.message.create).not.toHaveBeenCalled();
  });

  it("atomically writes AI_PROXY, touches the conversation, and completes the task", async () => {
    const task = leaseTask({ draftContent: "待发送正文", readyAt: NOW });
    mocks.prisma.agentTask.findFirst.mockResolvedValue({
      id: task.id,
      draftContent: task.draftContent
    });

    const result = await chatWorkerTestApi.sendClaimedProxyTask(task, NOW);

    expect(result).toMatchObject({ action: "sent", taskId: "task-1" });
    expect(mocks.prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderId: "owner-1",
        senderMode: "AI_PROXY",
        agentTaskId: "task-1",
        content: "待发送正文"
      })
    });
    expect(mocks.prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: "conversation-1" },
      data: { updatedAt: NOW }
    });
    expect(mocks.prisma.agentTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUCCEEDED",
          activeKey: null,
          completedAt: NOW
        })
      })
    );
    expect(mocks.enqueueIncomingHumanMessage).not.toHaveBeenCalled();
    expect(mocks.prisma.agentTask.create).not.toHaveBeenCalled();
  });

  it("uses READY CAS plus agentTaskId to avoid duplicate output messages", async () => {
    const ready = leaseTask({
      status: "READY",
      readyAt: NOW,
      draftContent: "只发送一次",
      leaseToken: null,
      leaseUntil: null
    });
    mocks.prisma.agentTask.findFirst
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ id: ready.id, draftContent: ready.draftContent })
      .mockResolvedValueOnce(ready);
    mocks.prisma.agentTask.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await chatWorkerTestApi.processOneReadyProxy(NOW);
    const second = await chatWorkerTestApi.processOneReadyProxy(NOW);

    expect(first?.action).toBe("sent");
    expect(second).toBeNull();
    expect(mocks.prisma.message.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ agentTaskId: "task-1" })
    });
  });
});

describe("chat worker retention and isolation helpers", () => {
  it("redacts expired 90-day logs and terminal task content", async () => {
    await chatWorkerTestApi.redactExpiredContent(NOW);

    expect(mocks.prisma.aIGenerationLog.updateMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: NOW },
        redactedAt: null
      },
      data: {
        inputSummary: null,
        output: null,
        finalEditedContent: null,
        redactedAt: NOW
      }
    });
    expect(mocks.prisma.agentTask.updateMany).toHaveBeenCalledWith({
      where: {
        contentExpiresAt: { lte: NOW },
        redactedAt: null,
        status: {
          in: ["SUCCEEDED", "CANCELLED", "FAILED", "DELETED"]
        }
      },
      data: {
        draftContent: null,
        error: null,
        redactedAt: NOW
      }
    });
  });

  it("recognizes relationship knowledge that requires contact isolation", () => {
    expect(isRelationshipKnowledgeCategory("RELATIONSHIP")).toBe(true);
    expect(isRelationshipKnowledgeCategory("人际关系")).toBe(true);
    expect(isRelationshipKnowledgeCategory("PERSONALITY")).toBe(false);
    expect(isRelationshipKnowledgeCategory("表达风格")).toBe(false);
  });
});
