import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  getEffectiveChatPolicy,
  type EffectiveChatPolicy
} from "@/lib/agent/chat-policy";
import { generateProxyReply } from "@/lib/agent/proxy-reply";
import {
  isWithinActiveWindows,
  nextAllowedTime
} from "@/lib/agent/schedule";
import { prisma } from "@/lib/prisma";

const WORKER_ID = "chat-worker";
const LEASE_MS = 5 * 60 * 1000;
const LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const RETRY_DELAYS_SECONDS = [30, 120, 600] as const;
const TERMINAL_TASK_STATUSES = ["SUCCEEDED", "CANCELLED", "FAILED", "DELETED"];

const leaseTaskSelect = {
  id: true,
  ownerId: true,
  conversationId: true,
  kind: true,
  status: true,
  runAt: true,
  readyAt: true,
  leaseToken: true,
  leaseUntil: true,
  attempts: true,
  maxAttempts: true,
  draftContent: true,
  policyRevision: true,
  knowledgeRevision: true
} satisfies Prisma.AgentTaskSelect;

type LeaseTask = Prisma.AgentTaskGetPayload<{ select: typeof leaseTaskSelect }>;
type TaskStage = "generate" | "send";

export type AgentWorkerRunResult = {
  processed: boolean;
  taskId?: string;
  action?: "generated" | "sent" | "rescheduled" | "cancelled" | "failed";
};

export type AgentWorkerOnceOptions = {
  now?: Date;
};

export type AgentWorkerLoopOptions = {
  signal?: AbortSignal;
  pollIntervalMs?: number;
};

export function retryBackoffSeconds(failureCount: number) {
  const index = Math.min(
    RETRY_DELAYS_SECONDS.length - 1,
    Math.max(0, failureCount - 1)
  );
  return RETRY_DELAYS_SECONDS[index];
}

export function isRelationshipKnowledgeCategory(category: string) {
  const normalized = category.trim().toUpperCase();
  return (
    normalized === "RELATIONSHIP" ||
    normalized === "RELATION" ||
    normalized.includes("关系") ||
    normalized.includes("人际")
  );
}

function taskMode(kind: string): "ASSIST" | "PROXY" {
  return kind.toUpperCase().includes("ASSIST") ? "ASSIST" : "PROXY";
}

function expiresAt(now: Date) {
  return new Date(now.getTime() + LOG_RETENTION_MS);
}

function readableError(error: unknown) {
  return (error instanceof Error ? error.message : "Worker task failed").slice(0, 2000);
}

async function touchHeartbeat(now: Date, status = "ONLINE") {
  await prisma.agentWorkerHeartbeat.upsert({
    where: { id: WORKER_ID },
    create: {
      id: WORKER_ID,
      status,
      startedAt: now,
      lastSeenAt: now
    },
    update: {
      status,
      lastSeenAt: now
    }
  });
}

async function redactExpiredContent(now: Date) {
  await prisma.$transaction([
    prisma.aIGenerationLog.updateMany({
      where: {
        expiresAt: { lte: now },
        redactedAt: null
      },
      data: {
        inputSummary: null,
        output: null,
        finalEditedContent: null,
        redactedAt: now
      }
    }),
    prisma.agentTask.updateMany({
      where: {
        contentExpiresAt: { lte: now },
        redactedAt: null,
        status: { in: TERMINAL_TASK_STATUSES }
      },
      data: {
        draftContent: null,
        error: null,
        redactedAt: now
      }
    })
  ]);
}

async function recordTaskFailure(
  task: LeaseTask,
  leaseToken: string,
  stage: TaskStage,
  error: unknown,
  now: Date
): Promise<"rescheduled" | "failed"> {
  const nextAttempts = task.attempts + 1;
  const failed = nextAttempts >= task.maxAttempts;
  const retryAt = new Date(now.getTime() + retryBackoffSeconds(nextAttempts) * 1000);
  const message = readableError(error);
  const data: Prisma.AgentTaskUpdateManyMutationInput = {
    attempts: nextAttempts,
    error: message,
    leaseToken: null,
    leaseUntil: null,
    completedAt: failed ? now : null,
    activeKey: failed ? null : undefined,
    status: failed ? "FAILED" : stage === "send" ? "READY" : "PENDING",
    runAt: !failed && stage === "generate" ? retryAt : undefined,
    readyAt: !failed && stage === "send" ? retryAt : stage === "generate" ? null : undefined
  };

  await prisma.$transaction(async (tx) => {
    const updated = await tx.agentTask.updateMany({
      where: {
        id: task.id,
        status: "RUNNING",
        leaseToken
      },
      data
    });
    if (updated.count === 0) return;
    await tx.aIGenerationLog.create({
      data: {
        userId: task.ownerId,
        taskType: `CHAT_${taskMode(task.kind)}`,
        sourceId: task.id,
        agentTaskId: task.id,
        conversationId: task.conversationId,
        status: "FAILED",
        policyRevision: task.policyRevision,
        knowledgeRevision: task.knowledgeRevision,
        error: message,
        expiresAt: expiresAt(now)
      }
    });
  });
  return failed ? "failed" : "rescheduled";
}

async function cancelClaimedTask(
  task: LeaseTask,
  leaseToken: string,
  reason: string,
  now: Date
) {
  await prisma.agentTask.updateMany({
    where: {
      id: task.id,
      status: "RUNNING",
      leaseToken
    },
    data: {
      status: "CANCELLED",
      activeKey: null,
      cancelReason: reason.slice(0, 1000),
      leaseToken: null,
      leaseUntil: null,
      completedAt: now
    }
  });
}

async function releaseClaimForWindow(
  task: LeaseTask,
  leaseToken: string,
  stage: TaskStage,
  nextRunAt: Date
) {
  await prisma.agentTask.updateMany({
    where: {
      id: task.id,
      status: "RUNNING",
      leaseToken
    },
    data: {
      status: stage === "send" ? "READY" : "PENDING",
      runAt: stage === "generate" ? nextRunAt : undefined,
      readyAt: stage === "send" ? nextRunAt : undefined,
      leaseToken: null,
      leaseUntil: null
    }
  });
}

async function recoverExpiredLeases(now: Date) {
  const expired = await prisma.agentTask.findMany({
    where: {
      status: "RUNNING",
      leaseUntil: { lt: now }
    },
    select: leaseTaskSelect
  });
  for (const task of expired) {
    if (!task.leaseToken) continue;
    await recordTaskFailure(
      task,
      task.leaseToken,
      task.draftContent && taskMode(task.kind) === "PROXY" ? "send" : "generate",
      new Error("Worker lease expired"),
      now
    );
  }
}

async function claimPendingTask(now: Date): Promise<LeaseTask | null> {
  const candidate = await prisma.agentTask.findFirst({
    where: {
      status: "PENDING",
      runAt: { lte: now }
    },
    orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
    select: leaseTaskSelect
  });
  if (!candidate) return null;

  const leaseToken = randomUUID();
  const claimed = await prisma.agentTask.updateMany({
    where: {
      id: candidate.id,
      status: "PENDING",
      runAt: { lte: now }
    },
    data: {
      status: "RUNNING",
      leaseToken,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      error: null
    }
  });
  return claimed.count
    ? {
        ...candidate,
        status: "RUNNING",
        leaseToken,
        leaseUntil: new Date(now.getTime() + LEASE_MS)
      }
    : null;
}

async function claimReadyProxyTask(
  now: Date,
  taskId?: string
): Promise<LeaseTask | null> {
  const candidate = await prisma.agentTask.findFirst({
    where: {
      id: taskId,
      status: "READY",
      readyAt: { lte: now },
      kind: { contains: "PROXY" }
    },
    orderBy: [{ readyAt: "asc" }, { createdAt: "asc" }],
    select: leaseTaskSelect
  });
  if (!candidate) return null;

  const leaseToken = randomUUID();
  const claimed = await prisma.agentTask.updateMany({
    where: {
      id: candidate.id,
      status: "READY",
      readyAt: { lte: now }
    },
    data: {
      status: "RUNNING",
      leaseToken,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      error: null
    }
  });
  return claimed.count
    ? {
        ...candidate,
        status: "RUNNING",
        leaseToken,
        leaseUntil: new Date(now.getTime() + LEASE_MS)
      }
    : null;
}

async function isolatedKnowledge(ownerId: string, conversationId: string) {
  const pages = await prisma.avatarKnowledgePage.findMany({
    where: {
      userId: ownerId,
      enabled: true,
      confirmationStatus: { in: ["AUTO", "CONFIRMED"] }
    },
    orderBy: { updatedAt: "desc" },
    take: 80,
    include: {
      citations: {
        include: {
          source: true
        }
      }
    }
  });
  const relationshipMessageIds = [
    ...new Set(
      pages
        .filter((page) => isRelationshipKnowledgeCategory(page.category))
        .flatMap((page) =>
          page.citations
            .filter((citation) => citation.source.kind === "MESSAGE")
            .map((citation) => citation.source.sourceKey)
        )
    )
  ];
  const sourceMessages = relationshipMessageIds.length
    ? await prisma.message.findMany({
        where: { id: { in: relationshipMessageIds } },
        select: { id: true, conversationId: true }
      })
    : [];
  const conversationByMessage = new Map(
    sourceMessages.map((message) => [message.id, message.conversationId])
  );

  return pages
    .filter((page) => {
      if (!isRelationshipKnowledgeCategory(page.category)) return true;
      const messageSources = page.citations
        .map((citation) => citation.source)
        .filter((source) => source.kind === "MESSAGE");
      return (
        messageSources.length > 0 &&
        messageSources.every(
          (source) => conversationByMessage.get(source.sourceKey) === conversationId
        )
      );
    })
    .slice(0, 40)
    .map((page) => ({
      id: page.id,
      title: page.title.slice(0, 200),
      content: page.content.slice(0, 4000)
    }));
}

function expressionRules(traitsJson: string | undefined, fallback: string) {
  if (!traitsJson) return fallback.slice(0, 1000);
  try {
    const traits = JSON.parse(traitsJson) as Record<string, unknown>;
    const rules = traits.expressionRules;
    if (typeof rules === "string" && rules.trim()) return rules.slice(0, 1000);
    if (Array.isArray(rules)) {
      const items = rules
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.slice(0, 200))
        .slice(0, 20);
      if (items.length) return items;
    }
  } catch {
    // Fall back to the normalized communication style.
  }
  return fallback.slice(0, 1000);
}

async function loadGenerationInput(task: LeaseTask, leaseToken: string) {
  const loaded = await prisma.agentTask.findFirst({
    where: {
      id: task.id,
      ownerId: task.ownerId,
      status: "RUNNING",
      leaseToken
    },
    include: {
      owner: {
        include: {
          personalityProfile: true,
          avatarProfile: true
        }
      },
      conversation: {
        include: {
          members: { include: { user: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 40,
            include: { sender: true }
          }
        }
      },
      triggers: {
        orderBy: { createdAt: "asc" },
        include: {
          message: { include: { sender: true } }
        }
      }
    }
  });
  if (!loaded) throw new Error("Task lease is no longer owned by this worker");
  if (loaded.conversation.type !== "HUMAN" || loaded.conversation.members.length !== 2) {
    throw new Error("Only direct human conversations can run proxy tasks");
  }
  const contact = loaded.conversation.members.find(
    (member) => member.userId !== task.ownerId
  );
  if (!contact) throw new Error("Conversation contact is missing");

  const incomingMessages = loaded.triggers
    .map((trigger) => trigger.message)
    .filter(
      (message) =>
        message.senderId === contact.userId && message.senderMode === "HUMAN"
    )
    .slice(-20)
    .map((message) => ({
      id: message.id,
      content: message.content.slice(0, 4000),
      createdAt: message.createdAt.toISOString(),
      senderName: message.sender?.nickname || contact.user.nickname
    }));
  if (!incomingMessages.length) {
    throw new Error("Task has no valid HUMAN trigger messages from the current contact");
  }

  const knowledge = await isolatedKnowledge(task.ownerId, task.conversationId);
  const recentMessages = loaded.conversation.messages
    .reverse()
    .filter(
      (message) =>
        message.senderId === task.ownerId || message.senderId === contact.userId
    )
    .map((message) => ({
      role: message.senderId === task.ownerId ? ("assistant" as const) : ("user" as const),
      content: message.content.slice(0, 4000)
    }));
  const personality = loaded.owner.personalityProfile;

  return {
    input: {
      owner: {
        nickname: loaded.owner.nickname.slice(0, 120),
        profileSummary: (personality?.summary || "暂无画像").slice(0, 1200)
      },
      conversationTitle: (
        loaded.conversation.title ||
        `${loaded.owner.nickname}与${contact.user.nickname}`
      ).slice(0, 200),
      incomingMessages,
      recentMessages,
      knowledge,
      mode: taskMode(task.kind),
      expressionRules: expressionRules(
        personality?.traitsJson,
        personality?.communicationStyle || "自然、准确地回复"
      )
    },
    inputSummary: JSON.stringify({
      triggerMessageIds: incomingMessages.map((message) => message.id),
      knowledgeIds: knowledge.map((item) => item.id),
      contactId: contact.userId
    })
  };
}

async function validPolicy(
  task: LeaseTask,
  expectedMode: "ASSIST" | "PROXY"
): Promise<{ policy: EffectiveChatPolicy | null; reason: string | null }> {
  const policy = await getEffectiveChatPolicy(task.ownerId, task.conversationId);
  let reason: string | null = null;
  if (!policy.allowed) reason = policy.blockReason || "POLICY_BLOCKED";
  else if (policy.mode !== expectedMode) reason = "MODE_CHANGED";
  else if (!policy.recipientAllowsAi) reason = "RECIPIENT_BLOCKED_AI";
  else if (policy.policyRevision !== task.policyRevision) reason = "POLICY_REVISION_CHANGED";
  else if (policy.knowledgeRevision !== task.knowledgeRevision) {
    reason = "KNOWLEDGE_REVISION_CHANGED";
  } else if (
    policy.conversationType !== "HUMAN" ||
    policy.memberCount !== 2 ||
    !policy.contactId
  ) {
    reason = "MEMBERSHIP_CHANGED";
  }
  return { policy: reason ? null : policy, reason };
}

async function generateClaimedTask(
  task: LeaseTask,
  now: Date
): Promise<{ result: AgentWorkerRunResult; sendNow: boolean }> {
  const leaseToken = task.leaseToken;
  if (!leaseToken) {
    return { result: { processed: false }, sendNow: false };
  }
  const mode = taskMode(task.kind);
  const checked = await validPolicy(task, mode);
  if (!checked.policy) {
    await cancelClaimedTask(task, leaseToken, checked.reason || "POLICY_BLOCKED", now);
    return {
      result: { processed: true, taskId: task.id, action: "cancelled" },
      sendNow: false
    };
  }
  if (
    !isWithinActiveWindows(now, checked.policy.activeWindows, checked.policy.timezone)
  ) {
    const next = nextAllowedTime(
      now,
      checked.policy.activeWindows,
      checked.policy.timezone
    );
    await releaseClaimForWindow(task, leaseToken, "generate", next);
    return {
      result: { processed: true, taskId: task.id, action: "rescheduled" },
      sendNow: false
    };
  }

  try {
    const context = await loadGenerationInput(task, leaseToken);
    const generated = await generateProxyReply(context.input);
    const generatedAt = new Date();
    const readyAt =
      mode === "PROXY"
        ? new Date(generatedAt.getTime() + checked.policy.sendBufferSeconds * 1000)
        : null;
    const retention = expiresAt(generatedAt);

    const stored = await prisma.$transaction(async (tx) => {
      const updated = await tx.agentTask.updateMany({
        where: {
          id: task.id,
          status: "RUNNING",
          leaseToken
        },
        data: {
          status: "READY",
          draftContent: generated.text,
          readyAt,
          leaseToken: null,
          leaseUntil: null,
          model: generated.model,
          error: null,
          contentExpiresAt: retention
        }
      });
      if (updated.count === 0) return false;
      await tx.aIGenerationLog.create({
        data: {
          userId: task.ownerId,
          taskType: `CHAT_${mode}`,
          sourceId: task.id,
          agentTaskId: task.id,
          conversationId: task.conversationId,
          inputSummary: context.inputSummary,
          output: generated.text,
          model: generated.model,
          status: "SUCCEEDED",
          policyRevision: task.policyRevision,
          knowledgeRevision: task.knowledgeRevision,
          expiresAt: retention
        }
      });
      return true;
    });
    if (!stored) return { result: { processed: false }, sendNow: false };
    return {
      result: { processed: true, taskId: task.id, action: "generated" },
      sendNow: mode === "PROXY" && Boolean(readyAt && readyAt <= generatedAt)
    };
  } catch (error) {
    const outcome = await recordTaskFailure(task, leaseToken, "generate", error, new Date());
    return {
      result: {
        processed: true,
        taskId: task.id,
        action: outcome === "failed" ? "failed" : "rescheduled"
      },
      sendNow: false
    };
  }
}

async function sendClaimedProxyTask(
  task: LeaseTask,
  now: Date
): Promise<AgentWorkerRunResult> {
  const leaseToken = task.leaseToken;
  if (!leaseToken) return { processed: false };
  const checked = await validPolicy(task, "PROXY");
  if (!checked.policy) {
    await cancelClaimedTask(task, leaseToken, checked.reason || "POLICY_BLOCKED", now);
    return { processed: true, taskId: task.id, action: "cancelled" };
  }
  if (
    !isWithinActiveWindows(now, checked.policy.activeWindows, checked.policy.timezone)
  ) {
    const next = nextAllowedTime(
      now,
      checked.policy.activeWindows,
      checked.policy.timezone
    );
    await releaseClaimForWindow(task, leaseToken, "send", next);
    return { processed: true, taskId: task.id, action: "rescheduled" };
  }
  if (!task.draftContent) {
    const outcome = await recordTaskFailure(
      task,
      leaseToken,
      "send",
      new Error("READY proxy task has no draft"),
      now
    );
    return {
      processed: true,
      taskId: task.id,
      action: outcome === "failed" ? "failed" : "rescheduled"
    };
  }

  const membership = await prisma.conversation.findUnique({
    where: { id: task.conversationId },
    select: {
      type: true,
      members: { select: { userId: true } }
    }
  });
  if (
    !membership ||
    membership.type !== "HUMAN" ||
    membership.members.length !== 2 ||
    !membership.members.some((member) => member.userId === task.ownerId) ||
    !membership.members.some((member) => member.userId === checked.policy?.contactId)
  ) {
    await cancelClaimedTask(task, leaseToken, "MEMBERSHIP_CHANGED", now);
    return { processed: true, taskId: task.id, action: "cancelled" };
  }

  try {
    const message = await prisma.$transaction(async (tx) => {
      const current = await tx.agentTask.findFirst({
        where: {
          id: task.id,
          ownerId: task.ownerId,
          status: "RUNNING",
          leaseToken
        },
        select: { id: true, draftContent: true }
      });
      if (!current?.draftContent) throw new Error("Task changed before send");
      const currentConversation = await tx.conversation.findUnique({
        where: { id: task.conversationId },
        select: {
          type: true,
          members: { select: { userId: true } }
        }
      });
      if (
        !currentConversation ||
        currentConversation.type !== "HUMAN" ||
        currentConversation.members.length !== 2 ||
        !currentConversation.members.some((member) => member.userId === task.ownerId) ||
        !currentConversation.members.some(
          (member) => member.userId === checked.policy?.contactId
        )
      ) {
        throw new Error("Membership changed before send");
      }

      const created = await tx.message.create({
        data: {
          conversationId: task.conversationId,
          senderId: task.ownerId,
          senderMode: "AI_PROXY",
          agentTaskId: task.id,
          content: current.draftContent
        }
      });
      const completed = await tx.agentTask.updateMany({
        where: {
          id: task.id,
          status: "RUNNING",
          leaseToken
        },
        data: {
          status: "SUCCEEDED",
          activeKey: null,
          leaseToken: null,
          leaseUntil: null,
          completedAt: now,
          error: null
        }
      });
      if (completed.count !== 1) throw new Error("Task lost before completion");
      await tx.conversation.update({
        where: { id: task.conversationId },
        data: { updatedAt: now }
      });
      const linkedLogs = await tx.aIGenerationLog.updateMany({
        where: {
          agentTaskId: task.id,
          redactedAt: null
        },
        data: {
          messageId: created.id,
          accepted: true,
          finalEditedContent: current.draftContent,
          expiresAt: expiresAt(now)
        }
      });
      if (linkedLogs.count === 0) {
        await tx.aIGenerationLog.create({
          data: {
            userId: task.ownerId,
            taskType: "CHAT_PROXY",
            sourceId: task.id,
            agentTaskId: task.id,
            conversationId: task.conversationId,
            messageId: created.id,
            output: current.draftContent,
            finalEditedContent: current.draftContent,
            accepted: true,
            status: "SUCCEEDED",
            policyRevision: task.policyRevision,
            knowledgeRevision: task.knowledgeRevision,
            expiresAt: expiresAt(now)
          }
        });
      }
      return created;
    });
    return { processed: Boolean(message), taskId: task.id, action: "sent" };
  } catch (error) {
    const outcome = await recordTaskFailure(task, leaseToken, "send", error, new Date());
    return {
      processed: true,
      taskId: task.id,
      action: outcome === "failed" ? "failed" : "rescheduled"
    };
  }
}

async function processOneReadyProxy(now: Date, taskId?: string) {
  const task = await claimReadyProxyTask(now, taskId);
  return task ? sendClaimedProxyTask(task, now) : null;
}

export async function runAgentWorkerOnce(
  options: AgentWorkerOnceOptions = {}
): Promise<AgentWorkerRunResult> {
  const now = options.now || new Date();
  await touchHeartbeat(now);
  await redactExpiredContent(now);
  await recoverExpiredLeases(now);

  const ready = await processOneReadyProxy(now);
  if (ready) return ready;

  const task = await claimPendingTask(now);
  if (!task) return { processed: false };
  const generated = await generateClaimedTask(task, now);
  if (generated.sendNow) {
    const sent = await processOneReadyProxy(new Date(), task.id);
    if (sent) return sent;
  }
  return generated.result;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function runAgentWorkerLoop(
  options: AgentWorkerLoopOptions = {}
) {
  const pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 2000);
  try {
    while (!options.signal?.aborted) {
      try {
        await runAgentWorkerOnce();
      } catch (error) {
        console.error("[chat-worker]", readableError(error));
      }
      await sleep(pollIntervalMs, options.signal);
    }
  } finally {
    await touchHeartbeat(new Date(), "OFFLINE").catch(() => undefined);
  }
}

export const chatWorkerTestApi = {
  redactExpiredContent,
  recordTaskFailure,
  recoverExpiredLeases,
  claimPendingTask,
  claimReadyProxyTask,
  generateClaimedTask,
  sendClaimedProxyTask,
  processOneReadyProxy
};
