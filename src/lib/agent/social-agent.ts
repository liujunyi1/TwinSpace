import { createHash, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import {
  nextAllowedTime,
  normalizeTimezone,
  parseActiveWindowsJson,
  type ActiveWindow
} from "@/lib/agent/schedule";
import { visiblePostWhere } from "@/lib/post-visibility";
import { prisma } from "@/lib/prisma";

export const SOCIAL_MODES = ["OFF", "SUGGEST", "AUTO"] as const;
export const SOCIAL_SCOPES = ["MUTUAL", "FOLLOWING", "PUBLIC"] as const;
export type SocialMode = (typeof SOCIAL_MODES)[number];
export type SocialScope = (typeof SOCIAL_SCOPES)[number];

const ACTIVE_TASK_STATUSES = ["PENDING", "RUNNING", "READY"] as const;
const CONTENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type SocialPolicyInput = {
  enabled?: boolean;
  mode?: SocialMode;
  scope?: SocialScope;
  timezone?: string;
  activeWindows?: ActiveWindow[];
  activeWindowsJson?: string;
  dailyBatchMin?: number;
  dailyBatchMax?: number;
  dailyCommentLimit?: number;
  authorCooldownHours?: number;
};

export type SocialResult = {
  ok: boolean;
  error?: string;
  taskId?: string;
  commentId?: string;
  reason?: string;
};

const defaults = {
  enabled: false,
  mode: "OFF" as SocialMode,
  scope: "FOLLOWING" as SocialScope,
  timezone: "Asia/Shanghai",
  activeWindowsJson: "[]",
  dailyBatchMin: 2,
  dailyBatchMax: 4,
  dailyCommentLimit: 3,
  authorCooldownHours: 24,
  nextRunAt: null as Date | null,
  policyRevision: 1
};

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function localDateKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function localDayStart(date: Date, timezone: string) {
  const key = localDateKey(date, timezone);
  let cursor = new Date(Math.floor(date.getTime() / 60_000) * 60_000);
  while (localDateKey(cursor, timezone) === key) {
    cursor = new Date(cursor.getTime() - 15 * 60_000);
  }
  while (localDateKey(cursor, timezone) !== key) {
    cursor = new Date(cursor.getTime() + 60_000);
  }
  return cursor;
}

function nextLocalDayStart(date: Date, timezone: string) {
  const key = localDateKey(date, timezone);
  let cursor = new Date(Math.ceil(date.getTime() / 60_000) * 60_000);
  while (localDateKey(cursor, timezone) === key) {
    cursor = new Date(cursor.getTime() + 15 * 60_000);
  }
  while (localDateKey(new Date(cursor.getTime() - 60_000), timezone) !== key) {
    cursor = new Date(cursor.getTime() - 60_000);
  }
  return cursor;
}

export function deterministicDailyTarget(
  ownerId: string,
  dateKey: string,
  minimum: number,
  maximum: number
) {
  const min = clampInteger(minimum, 1, 24, 2);
  const max = Math.max(min, clampInteger(maximum, 1, 24, 4));
  const hash = createHash("sha256").update(`${ownerId}:${dateKey}`).digest();
  return min + (hash.readUInt32BE(0) % (max - min + 1));
}

export function socialScopeWhere(userId: string, scope: SocialScope): Prisma.PostWhereInput {
  if (scope === "PUBLIC") return { visibility: "PUBLIC" };
  if (scope === "MUTUAL") {
    return {
      author: {
        followers: { some: { followerId: userId } },
        following: { some: { followingId: userId } }
      }
    };
  }
  return {
    author: {
      followers: { some: { followerId: userId } }
    }
  };
}

function nextPolicyRunAt(input: {
  now: Date;
  timezone: string;
  activeWindows: ActiveWindow[];
  dailyTarget: number;
  completedRuns: number;
}) {
  if (input.completedRuns >= input.dailyTarget) {
    return nextAllowedTime(
      nextLocalDayStart(input.now, input.timezone),
      input.activeWindows,
      input.timezone
    );
  }
  const interval = Math.max(60 * 60_000, Math.floor(24 * 60 * 60_000 / input.dailyTarget));
  return nextAllowedTime(
    new Date(input.now.getTime() + interval),
    input.activeWindows,
    input.timezone
  );
}

export async function getSocialAgentSettingsView(userId: string) {
  const policy = await prisma.socialAgentPolicy.findUnique({ where: { userId } });
  const value = policy || defaults;
  return {
    enabled: value.enabled,
    mode: value.mode as SocialMode,
    scope: value.scope as SocialScope,
    timezone: value.timezone,
    activeWindows: parseActiveWindowsJson(value.activeWindowsJson),
    activeWindowsJson: value.activeWindowsJson,
    dailyBatchMin: value.dailyBatchMin,
    dailyBatchMax: value.dailyBatchMax,
    dailyCommentLimit: value.dailyCommentLimit,
    authorCooldownHours: value.authorCooldownHours,
    nextRunAt: value.nextRunAt?.toISOString() || null,
    policyRevision: value.policyRevision
  };
}

export async function getSocialActivities(userId: string) {
  const tasks = await prisma.socialAgentTask.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      post: {
        select: {
          id: true,
          content: true,
          author: { select: { id: true, nickname: true } }
        }
      },
      comment: { select: { id: true, content: true, createdAt: true } }
    }
  });
  return tasks.map((task) => ({
    id: task.id,
    taskId: task.id,
    type: "SOCIAL_COMMENT",
    status: task.status,
    mode: task.mode,
    postId: task.postId,
    postExcerpt: task.post.content.slice(0, 160),
    targetAuthorId: task.targetAuthorId,
    targetAuthorName: task.post.author.nickname,
    draft: task.redactedAt ? null : task.draftContent,
    draftContent: task.redactedAt ? null : task.draftContent,
    decisionReason: task.decisionReason,
    capabilityStatus: task.capabilityStatus,
    error: task.error,
    model: task.model,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    commentId: task.comment?.id || null,
    commentContent: task.redactedAt ? null : task.comment?.content || null,
    runAt: task.runAt.toISOString(),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() || null,
    redacted: Boolean(task.redactedAt)
  }));
}

export async function updateSocialPolicy(
  userId: string,
  input: SocialPolicyInput
): Promise<SocialResult & { settings?: Awaited<ReturnType<typeof getSocialAgentSettingsView>> }> {
  const existing = await prisma.socialAgentPolicy.findUnique({ where: { userId } });
  const current = existing || defaults;
  const mode = SOCIAL_MODES.includes(input.mode as SocialMode)
    ? (input.mode as SocialMode)
    : (current.mode as SocialMode);
  const scope = SOCIAL_SCOPES.includes(input.scope as SocialScope)
    ? (input.scope as SocialScope)
    : (current.scope as SocialScope);
  const enabled = input.enabled ?? current.enabled;
  const dailyBatchMin = clampInteger(input.dailyBatchMin, 1, 24, current.dailyBatchMin);
  const dailyBatchMax = Math.max(
    dailyBatchMin,
    clampInteger(input.dailyBatchMax, 1, 24, current.dailyBatchMax)
  );
  const activeWindowsJson =
    input.activeWindowsJson ??
    (input.activeWindows ? JSON.stringify(input.activeWindows) : current.activeWindowsJson);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.socialAgentPolicy.upsert({
      where: { userId },
      create: {
        userId,
        enabled,
        mode,
        scope,
        timezone: normalizeTimezone(input.timezone || current.timezone),
        activeWindowsJson,
        dailyBatchMin,
        dailyBatchMax,
        dailyCommentLimit: clampInteger(
          input.dailyCommentLimit,
          1,
          10,
          current.dailyCommentLimit
        ),
        authorCooldownHours: clampInteger(
          input.authorCooldownHours,
          1,
          168,
          current.authorCooldownHours
        ),
        nextRunAt: enabled && mode !== "OFF" ? now : null,
        policyRevision: 1
      },
      update: {
        enabled,
        mode,
        scope,
        timezone: normalizeTimezone(input.timezone || current.timezone),
        activeWindowsJson,
        dailyBatchMin,
        dailyBatchMax,
        dailyCommentLimit: clampInteger(
          input.dailyCommentLimit,
          1,
          10,
          current.dailyCommentLimit
        ),
        authorCooldownHours: clampInteger(
          input.authorCooldownHours,
          1,
          168,
          current.authorCooldownHours
        ),
        nextRunAt: enabled && mode !== "OFF" ? now : null,
        policyRevision: { increment: 1 }
      }
    });
    await tx.socialAgentTask.updateMany({
      where: {
        ownerId: userId,
        status: { in: [...ACTIVE_TASK_STATUSES] }
      },
      data: {
        status: "CANCELLED",
        draftContent: null,
        decisionReason: "POLICY_CHANGED",
        leaseToken: null,
        leaseUntil: null,
        redactedAt: now,
        completedAt: now
      }
    });
  });
  return { ok: true, settings: await getSocialAgentSettingsView(userId) };
}

async function advancePolicy(
  policy: {
    id: string;
    userId: string;
    timezone: string;
    activeWindowsJson: string;
    dailyBatchMin: number;
    dailyBatchMax: number;
  },
  now: Date,
  completedRuns: number
) {
  const dateKey = localDateKey(now, policy.timezone);
  const target = deterministicDailyTarget(
    policy.userId,
    dateKey,
    policy.dailyBatchMin,
    policy.dailyBatchMax
  );
  const nextRunAt = nextPolicyRunAt({
    now,
    timezone: policy.timezone,
    activeWindows: parseActiveWindowsJson(policy.activeWindowsJson),
    dailyTarget: target,
    completedRuns
  });
  await prisma.socialAgentPolicy.update({
    where: { id: policy.id },
    data: { nextRunAt }
  });
  return nextRunAt;
}

async function findCandidate(policy: {
  userId: string;
  scope: string;
  timezone: string;
  dailyCommentLimit: number;
  authorCooldownHours: number;
}) {
  const now = new Date();
  const dayStart = localDayStart(now, policy.timezone);
  const commentCount = await prisma.comment.count({
    where: {
      authorId: policy.userId,
      generatedByAvatar: true,
      createdAt: { gte: dayStart }
    }
  });
  if (commentCount >= policy.dailyCommentLimit) return null;

  const posts = await prisma.post.findMany({
    where: {
      AND: [
        visiblePostWhere(policy.userId),
        socialScopeWhere(policy.userId, policy.scope as SocialScope),
        {
          authorId: { not: policy.userId },
          allowComments: true,
          socialAgentTasks: { none: { ownerId: policy.userId } }
        }
      ]
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      authorId: true,
      createdAt: true
    }
  });
  if (posts.length === 0) return null;

  const cooldownSince = new Date(
    now.getTime() - policy.authorCooldownHours * 60 * 60_000
  );
  const eligible = [];
  for (const post of posts) {
    const recentComment = await prisma.comment.findFirst({
      where: {
        authorId: policy.userId,
        generatedByAvatar: true,
        createdAt: { gte: cooldownSince },
        post: { authorId: post.authorId }
      },
      select: { id: true }
    });
    if (!recentComment) eligible.push(post);
  }
  if (eligible.length === 0) return null;
  const seed = createHash("sha256")
    .update(`${policy.userId}:${localDateKey(now, policy.timezone)}`)
    .digest()
    .readUInt32BE(0);
  return eligible[seed % eligible.length];
}

async function scheduleOneSocialTask(userId: string, force: boolean): Promise<SocialResult> {
  const now = new Date();
  const policy = await prisma.socialAgentPolicy.findUnique({
    where: { userId },
    include: { user: { select: { avatarProfile: { select: { status: true } } } } }
  });
  if (!policy || !policy.enabled || policy.mode === "OFF") {
    return { ok: false, error: "动态代理未开启" };
  }
  if (policy.user.avatarProfile?.status !== "ACTIVE") {
    return { ok: false, error: "分身尚未完成校准" };
  }
  if (!force && policy.nextRunAt && policy.nextRunAt > now) {
    return { ok: true, reason: "NOT_DUE" };
  }

  const dayStart = localDayStart(now, policy.timezone);
  const runsToday = await prisma.socialAgentTask.count({
    where: { ownerId: userId, createdAt: { gte: dayStart } }
  });
  const dailyTarget = deterministicDailyTarget(
    userId,
    localDateKey(now, policy.timezone),
    policy.dailyBatchMin,
    policy.dailyBatchMax
  );
  if (!force && runsToday >= dailyTarget) {
    await advancePolicy(policy, now, runsToday);
    return { ok: true, reason: "DAILY_BATCH_TARGET_REACHED" };
  }

  const candidate = await findCandidate(policy);
  if (!candidate) {
    await advancePolicy(policy, now, runsToday + 1);
    return { ok: true, reason: "NO_CANDIDATE" };
  }

  const idempotencyKey = `social:${userId}:${candidate.id}:${policy.policyRevision}`;
  const task = await prisma.$transaction(async (tx) => {
    const currentPolicy = await tx.socialAgentPolicy.findFirst({
      where: {
        id: policy.id,
        enabled: true,
        mode: { in: ["SUGGEST", "AUTO"] },
        policyRevision: policy.policyRevision
      }
    });
    if (!currentPolicy) return null;
    const created = await tx.socialAgentTask.upsert({
      where: { idempotencyKey },
      create: {
        ownerId: userId,
        policyId: policy.id,
        postId: candidate.id,
        targetAuthorId: candidate.authorId,
        status: "PENDING",
        mode: policy.mode,
        idempotencyKey,
        runAt: now,
        attempts: 0,
        maxAttempts: 3,
        policyRevision: policy.policyRevision
      },
      update: {}
    });
    return created;
  });
  await advancePolicy(policy, now, runsToday + 1);
  return task
    ? { ok: true, taskId: task.id }
    : { ok: false, error: "策略已变化" };
}

export function enqueueSocialRunNow(userId: string) {
  return scheduleOneSocialTask(userId, true);
}

export async function scheduleDueSocialPolicies(now = new Date()) {
  const policies = await prisma.socialAgentPolicy.findMany({
    where: {
      enabled: true,
      mode: { in: ["SUGGEST", "AUTO"] },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }]
    },
    orderBy: { nextRunAt: "asc" },
    take: 20,
    select: { userId: true }
  });
  const results = [];
  for (const policy of policies) {
    results.push(await scheduleOneSocialTask(policy.userId, false));
  }
  return results;
}

async function validateAndCreateComment(
  userId: string,
  taskId: string,
  content: string,
  expectedStatus: "READY" | "RUNNING"
): Promise<SocialResult> {
  const normalized = content.trim();
  if (!normalized || normalized.length > 500) {
    return { ok: false, error: "评论内容应为 1 至 500 个字符" };
  }

  return prisma.$transaction(async (tx) => {
    const task = await tx.socialAgentTask.findFirst({
      where: { id: taskId, ownerId: userId, status: expectedStatus },
      select: {
        id: true,
        ownerId: true,
        policyId: true,
        postId: true,
        targetAuthorId: true,
        policyRevision: true
      }
    });
    if (!task) return { ok: false, error: "任务不存在或状态已变化" };

    const policy = await tx.socialAgentPolicy.findFirst({
      where: {
        id: task.policyId,
        userId,
        enabled: true,
        mode: expectedStatus === "RUNNING" ? "AUTO" : { in: ["SUGGEST", "AUTO"] },
        policyRevision: task.policyRevision
      },
      include: { user: { select: { avatarProfile: { select: { status: true } } } } }
    });
    if (!policy || policy.user.avatarProfile?.status !== "ACTIVE") {
      return { ok: false, error: "策略已经变化" };
    }

    const post = await tx.post.findFirst({
      where: {
        AND: [
          { id: task.postId },
          visiblePostWhere(userId),
          socialScopeWhere(userId, policy.scope as SocialScope),
          { authorId: { not: userId }, allowComments: true }
        ]
      },
      select: { id: true, authorId: true }
    });
    if (!post || post.authorId !== task.targetAuthorId) {
      return { ok: false, error: "动态已不可见或已关闭评论" };
    }

    const dayStart = localDayStart(new Date(), policy.timezone);
    const dailyCount = await tx.comment.count({
      where: {
        authorId: userId,
        generatedByAvatar: true,
        createdAt: { gte: dayStart }
      }
    });
    if (dailyCount >= policy.dailyCommentLimit) {
      return { ok: false, error: "已达到今日自动评论上限" };
    }
    const cooldownSince = new Date(
      Date.now() - policy.authorCooldownHours * 60 * 60_000
    );
    const recent = await tx.comment.findFirst({
      where: {
        authorId: userId,
        generatedByAvatar: true,
        createdAt: { gte: cooldownSince },
        post: { authorId: task.targetAuthorId }
      },
      select: { id: true }
    });
    if (recent) return { ok: false, error: "该作者仍在评论冷却期" };

    const existing = await tx.comment.findUnique({
      where: { socialAgentTaskId: task.id },
      select: { id: true }
    });
    if (existing) return { ok: true, taskId: task.id, commentId: existing.id };

    const now = new Date();
    const comment = await tx.comment.create({
      data: {
        postId: task.postId,
        authorId: userId,
        content: normalized,
        generatedByAvatar: true,
        socialAgentTaskId: task.id
      }
    });
    await tx.socialAgentTask.update({
      where: { id: task.id },
      data: {
        status: "SUCCEEDED",
        draftContent: normalized,
        leaseToken: null,
        leaseUntil: null,
        contentExpiresAt: new Date(now.getTime() + CONTENT_RETENTION_MS),
        completedAt: now
      }
    });
    return { ok: true, taskId: task.id, commentId: comment.id };
  });
}

export function approveSocialDraft(userId: string, taskId: string, content: string) {
  return validateAndCreateComment(userId, taskId, content, "READY");
}

export function createAutoSocialComment(userId: string, taskId: string, content: string) {
  return validateAndCreateComment(userId, taskId, content, "RUNNING");
}

export async function cancelSocialTask(
  userId: string,
  taskId: string
): Promise<SocialResult> {
  const now = new Date();
  const updated = await prisma.socialAgentTask.updateMany({
    where: {
      id: taskId,
      ownerId: userId,
      status: { in: [...ACTIVE_TASK_STATUSES] }
    },
    data: {
      status: "CANCELLED",
      draftContent: null,
      decisionReason: "USER_CANCELLED",
      leaseToken: null,
      leaseUntil: null,
      redactedAt: now,
      completedAt: now
    }
  });
  return updated.count === 1
    ? { ok: true, taskId }
    : { ok: false, error: "任务不存在或已经结束" };
}

export async function deleteSocialComment(
  userId: string,
  commentId: string
): Promise<SocialResult> {
  return prisma.$transaction(async (tx) => {
    const comment = await tx.comment.findFirst({
      where: {
        id: commentId,
        authorId: userId,
        generatedByAvatar: true
      },
      select: { id: true, socialAgentTaskId: true }
    });
    if (!comment) return { ok: false, error: "只能删除本人分身生成的评论" };

    const now = new Date();
    if (comment.socialAgentTaskId) {
      await tx.socialAgentTask.updateMany({
        where: { id: comment.socialAgentTaskId, ownerId: userId },
        data: {
          status: "DELETED",
          draftContent: null,
          decisionReason: "OWNER_DELETED",
          error: null,
          redactedAt: now,
          completedAt: now
        }
      });
    }
    await tx.comment.delete({ where: { id: comment.id } });
    return {
      ok: true,
      taskId: comment.socialAgentTaskId || undefined,
      commentId: comment.id
    };
  });
}

export async function editSocialComment(
  userId: string,
  commentId: string,
  content: string
): Promise<SocialResult> {
  const normalizedContent = content.trim();
  if (!normalizedContent) return { ok: false, error: "评论不能为空" };
  if (normalizedContent.length > 500) return { ok: false, error: "评论不能超过 500 字" };

  return prisma.$transaction(async (tx) => {
    const comment = await tx.comment.findFirst({
      where: {
        id: commentId,
        authorId: userId,
        generatedByAvatar: true,
        ownerEditedAt: null
      },
      select: { id: true, socialAgentTaskId: true }
    });
    if (!comment) return { ok: false, error: "只能修改本人尚未编辑过的分身评论" };

    const now = new Date();
    await tx.comment.update({
      where: { id: comment.id },
      data: {
        content: normalizedContent,
        ownerEditedAt: now
      }
    });

    if (comment.socialAgentTaskId) {
      await tx.socialAgentTask.updateMany({
        where: { id: comment.socialAgentTaskId, ownerId: userId },
        data: {
          draftContent: null,
          decisionReason: "OWNER_EDITED",
          redactedAt: now
        }
      });
    }

    return {
      ok: true,
      taskId: comment.socialAgentTaskId || undefined,
      commentId: comment.id
    };
  });
}

export async function redactExpiredSocialContent(now = new Date()) {
  return prisma.socialAgentTask.updateMany({
    where: {
      contentExpiresAt: { lte: now },
      redactedAt: null
    },
    data: {
      draftContent: null,
      redactedAt: now
    }
  });
}

export async function markSocialTaskCancelled(taskId: string, reason: string) {
  const now = new Date();
  return prisma.socialAgentTask.updateMany({
    where: { id: taskId, status: { in: [...ACTIVE_TASK_STATUSES] } },
    data: {
      status: "CANCELLED",
      draftContent: null,
      decisionReason: reason,
      leaseToken: null,
      leaseUntil: null,
      redactedAt: now,
      completedAt: now
    }
  });
}

export function socialLeaseToken() {
  return randomUUID();
}
