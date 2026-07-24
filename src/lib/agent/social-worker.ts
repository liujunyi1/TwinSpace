import { decideAndGenerateSocialComment } from "@/lib/agent/social-ai";
import {
  createAutoSocialComment,
  markSocialTaskCancelled,
  redactExpiredSocialContent,
  scheduleDueSocialPolicies,
  socialLeaseToken
} from "@/lib/agent/social-agent";
import { prisma } from "@/lib/prisma";
import { safeJsonParse } from "@/lib/utils";

const RETRY_DELAYS_SECONDS = [30, 120, 600] as const;
const LEASE_MS = 2 * 60_000;

async function recoverExpiredSocialLeases(now: Date) {
  await prisma.socialAgentTask.updateMany({
    where: {
      status: "RUNNING",
      leaseUntil: { lt: now }
    },
    data: {
      status: "PENDING",
      leaseToken: null,
      leaseUntil: null,
      runAt: now,
      error: "Worker lease expired"
    }
  });
}

async function claimOneSocialTask(now: Date) {
  const candidate = await prisma.socialAgentTask.findFirst({
    where: { status: "PENDING", runAt: { lte: now } },
    orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
    select: { id: true }
  });
  if (!candidate) return null;

  const leaseToken = socialLeaseToken();
  const claimed = await prisma.socialAgentTask.updateMany({
    where: { id: candidate.id, status: "PENDING", runAt: { lte: now } },
    data: {
      status: "RUNNING",
      leaseToken,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      error: null
    }
  });
  return claimed.count === 1 ? { id: candidate.id, leaseToken } : null;
}

async function failSocialTask(taskId: string, leaseToken: string, error: unknown) {
  const task = await prisma.socialAgentTask.findFirst({
    where: { id: taskId, status: "RUNNING", leaseToken },
    select: { attempts: true, maxAttempts: true }
  });
  if (!task) return;

  const message = error instanceof Error ? error.message.slice(0, 1000) : "生成失败";
  if (task.attempts < task.maxAttempts) {
    const attempts = task.attempts + 1;
    const delay =
      RETRY_DELAYS_SECONDS[Math.min(task.attempts, RETRY_DELAYS_SECONDS.length - 1)];
    await prisma.socialAgentTask.updateMany({
      where: { id: taskId, status: "RUNNING", leaseToken },
      data: {
        status: "PENDING",
        attempts,
        runAt: new Date(Date.now() + delay * 1000),
        leaseToken: null,
        leaseUntil: null,
        error: message
      }
    });
    return;
  }
  await prisma.socialAgentTask.updateMany({
    where: { id: taskId, status: "RUNNING", leaseToken },
    data: {
      status: "FAILED",
      leaseToken: null,
      leaseUntil: null,
      error: message,
      completedAt: new Date()
    }
  });
}

async function processSocialTask(
  taskId: string,
  leaseToken: string,
  signal?: AbortSignal
) {
  const task = await prisma.socialAgentTask.findFirst({
    where: { id: taskId, status: "RUNNING", leaseToken },
    include: {
      owner: {
        select: {
          nickname: true,
          personalityProfile: { select: { summary: true } }
        }
      },
      post: {
        select: {
          id: true,
          content: true,
          imageUrlsJson: true,
          author: { select: { nickname: true } },
          comments: {
            orderBy: { createdAt: "asc" },
            take: 30,
            select: {
              content: true,
              generatedByAvatar: true,
              author: { select: { nickname: true } }
            }
          }
        }
      }
    }
  });
  if (!task) return false;

  const currentPolicy = await prisma.socialAgentPolicy.findFirst({
    where: {
      id: task.policyId,
      userId: task.ownerId,
      enabled: true,
      mode: task.mode,
      policyRevision: task.policyRevision
    },
    include: { user: { select: { avatarProfile: { select: { status: true } } } } }
  });
  if (!currentPolicy || currentPolicy.user.avatarProfile?.status !== "ACTIVE") {
    await markSocialTaskCancelled(task.id, "POLICY_CHANGED");
    return true;
  }

  const knowledge = await prisma.avatarKnowledgePage.findMany({
    where: {
      userId: task.ownerId,
      enabled: true,
      confirmationStatus: { in: ["AUTO", "CONFIRMED"] }
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, title: true, content: true }
  });
  const [ownerFollowsAuthor, authorFollowsOwner] = await Promise.all([
    prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: task.ownerId,
          followingId: task.targetAuthorId
        }
      },
      select: { id: true }
    }),
    prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: task.targetAuthorId,
          followingId: task.ownerId
        }
      },
      select: { id: true }
    })
  ]);
  const relationshipSummary =
    ownerFollowsAuthor && authorFollowsOwner
      ? "双方互相关注"
      : ownerFollowsAuthor
        ? "用户关注了动态作者"
        : "公开动态作者";

  try {
    const decision = await decideAndGenerateSocialComment(
      {
        owner: {
          nickname: task.owner.nickname,
          profileSummary: task.owner.personalityProfile?.summary || "暂无画像",
          knowledge
        },
        post: {
          id: task.post.id,
          content: task.post.content,
          imageUrls: safeJsonParse<string[]>(task.post.imageUrlsJson, []),
          authorName: task.post.author.nickname,
          existingComments: task.post.comments.map((comment) => ({
            authorName: comment.author.nickname,
            content: comment.content,
            generatedByAvatar: comment.generatedByAvatar
          }))
        },
        relationshipSummary
      },
      signal
    );
    const stillRunning = {
      id: task.id,
      status: "RUNNING",
      leaseToken
    };
    const now = new Date();

    if (decision.decision === "SKIP" || !decision.text?.trim()) {
      await prisma.socialAgentTask.updateMany({
        where: stillRunning,
        data: {
          status: "SUCCEEDED",
          draftContent: null,
          decisionReason: decision.reason || "AI_SKIP",
          capabilityStatus: decision.capabilityStatus,
          model: decision.model,
          leaseToken: null,
          leaseUntil: null,
          completedAt: now
        }
      });
      return true;
    }

    if (task.mode === "SUGGEST") {
      await prisma.socialAgentTask.updateMany({
        where: stillRunning,
        data: {
          status: "READY",
          draftContent: decision.text.trim(),
          decisionReason: decision.reason || null,
          capabilityStatus: decision.capabilityStatus,
          model: decision.model,
          leaseToken: null,
          leaseUntil: null,
          contentExpiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60_000)
        }
      });
      return true;
    }

    await prisma.socialAgentTask.updateMany({
      where: stillRunning,
      data: {
        draftContent: decision.text.trim(),
        decisionReason: decision.reason || null,
        capabilityStatus: decision.capabilityStatus,
        model: decision.model
      }
    });
    const sent = await createAutoSocialComment(
      task.ownerId,
      task.id,
      decision.text.trim()
    );
    if (!sent.ok) await markSocialTaskCancelled(task.id, sent.error || "SEND_RECHECK_FAILED");
    return true;
  } catch (error) {
    await failSocialTask(task.id, leaseToken, error);
    return true;
  }
}

export async function runSocialAgentWorkerOnce(input: { signal?: AbortSignal } = {}) {
  const now = new Date();
  await recoverExpiredSocialLeases(now);
  await redactExpiredSocialContent(now);
  await scheduleDueSocialPolicies(now);
  const claimed = await claimOneSocialTask(now);
  if (!claimed) return false;
  return processSocialTask(claimed.id, claimed.leaseToken, input.signal);
}
