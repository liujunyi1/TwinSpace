import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    socialAgentPolicy: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn()
    },
    socialAgentTask: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    post: {
      findFirst: vi.fn(),
      findMany: vi.fn()
    },
    comment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn()
    }
  };
  return { prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import {
  approveSocialDraft,
  createAutoSocialComment,
  deleteSocialComment,
  deterministicDailyTarget,
  editSocialComment,
  enqueueSocialRunNow,
  socialScopeWhere
} from "@/lib/agent/social-agent";

const policy = {
  id: "policy",
  userId: "owner",
  enabled: true,
  mode: "SUGGEST",
  scope: "FOLLOWING",
  timezone: "Asia/Shanghai",
  activeWindowsJson: "[]",
  dailyBatchMin: 2,
  dailyBatchMax: 4,
  dailyCommentLimit: 3,
  authorCooldownHours: 24,
  nextRunAt: null,
  policyRevision: 5,
  user: { avatarProfile: { status: "ACTIVE" } }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma)
  );
  mocks.prisma.socialAgentPolicy.findUnique.mockResolvedValue(policy);
  mocks.prisma.socialAgentPolicy.findFirst.mockResolvedValue(policy);
  mocks.prisma.socialAgentPolicy.update.mockResolvedValue(policy);
  mocks.prisma.socialAgentTask.count.mockResolvedValue(0);
  mocks.prisma.socialAgentTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.comment.count.mockResolvedValue(0);
  mocks.prisma.comment.findFirst.mockResolvedValue(null);
  mocks.prisma.comment.findUnique.mockResolvedValue(null);
  mocks.prisma.comment.delete.mockResolvedValue({});
  mocks.prisma.comment.update.mockResolvedValue({});
});

describe("social scope", () => {
  it("requires both follow directions for MUTUAL", () => {
    expect(socialScopeWhere("owner", "MUTUAL")).toEqual({
      author: {
        followers: { some: { followerId: "owner" } },
        following: { some: { followingId: "owner" } }
      }
    });
  });

  it("requires the owner to follow the author for FOLLOWING", () => {
    expect(socialScopeWhere("owner", "FOLLOWING")).toEqual({
      author: {
        followers: { some: { followerId: "owner" } }
      }
    });
  });

  it("limits PUBLIC scope to public posts", () => {
    expect(socialScopeWhere("owner", "PUBLIC")).toEqual({
      visibility: "PUBLIC"
    });
  });

  it("derives a stable daily batch target inside the configured range", () => {
    const first = deterministicDailyTarget("owner", "2026-07-19", 2, 4);
    const second = deterministicDailyTarget("owner", "2026-07-19", 2, 4);
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(2);
    expect(first).toBeLessThanOrEqual(4);
  });
});

describe("candidate selection", () => {
  it("queries only still-visible, commentable, non-owner posts and records no candidate", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([]);

    const result = await enqueueSocialRunNow("owner");

    expect(result).toEqual({ ok: true, reason: "NO_CANDIDATE" });
    const query = mocks.prisma.post.findMany.mock.calls[0][0];
    expect(query.where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ OR: expect.any(Array) }),
        expect.objectContaining({
          authorId: { not: "owner" },
          allowComments: true
        })
      ])
    );
    expect(mocks.prisma.socialAgentTask.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.socialAgentPolicy.update).toHaveBeenCalled();
  });

  it("stops candidate selection at the daily comment limit", async () => {
    mocks.prisma.comment.count.mockResolvedValue(policy.dailyCommentLimit);

    const result = await enqueueSocialRunNow("owner");

    expect(result).toEqual({ ok: true, reason: "NO_CANDIDATE" });
    expect(mocks.prisma.post.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.socialAgentTask.upsert).not.toHaveBeenCalled();
  });

  it("skips an author who is still inside the cooldown", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: "post", authorId: "author", createdAt: new Date() }
    ]);
    mocks.prisma.comment.findFirst.mockResolvedValue({ id: "recent-comment" });

    const result = await enqueueSocialRunNow("owner");

    expect(result).toEqual({ ok: true, reason: "NO_CANDIDATE" });
    expect(mocks.prisma.comment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          generatedByAvatar: true,
          post: { authorId: "author" }
        })
      })
    );
    expect(mocks.prisma.socialAgentTask.upsert).not.toHaveBeenCalled();
  });

  it("uses owner, post, and policy revision as the idempotency key", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      { id: "post", authorId: "author", createdAt: new Date() }
    ]);
    mocks.prisma.socialAgentTask.upsert.mockResolvedValue({ id: "social-task" });

    const result = await enqueueSocialRunNow("owner");

    expect(result).toEqual({ ok: true, taskId: "social-task" });
    expect(mocks.prisma.socialAgentTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: "social:owner:post:5" },
        create: expect.objectContaining({
          idempotencyKey: "social:owner:post:5",
          postId: "post",
          ownerId: "owner"
        })
      })
    );
  });
});

describe("send-time revalidation", () => {
  const task = {
    id: "social-task",
    ownerId: "owner",
    policyId: "policy",
    postId: "post",
    targetAuthorId: "author",
    policyRevision: 5
  };

  it("rejects a post that became invisible or closed comments before send", async () => {
    mocks.prisma.socialAgentTask.findFirst.mockResolvedValue(task);
    mocks.prisma.post.findFirst.mockResolvedValue(null);

    const result = await createAutoSocialComment(
      "owner",
      "social-task",
      "自动评论"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("不可见");
    expect(mocks.prisma.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { authorId: { not: "owner" }, allowComments: true }
          ])
        })
      })
    );
    expect(mocks.prisma.comment.create).not.toHaveBeenCalled();
  });

  it("keeps an edited approved draft AI-marked and does not enqueue another social task", async () => {
    mocks.prisma.socialAgentTask.findFirst.mockResolvedValue(task);
    mocks.prisma.post.findFirst.mockResolvedValue({
      id: "post",
      authorId: "author"
    });
    mocks.prisma.comment.create.mockResolvedValue({ id: "comment" });
    mocks.prisma.socialAgentTask.update.mockResolvedValue({});

    const result = await approveSocialDraft(
      "owner",
      "social-task",
      "用户编辑后的建议评论"
    );

    expect(result).toEqual({
      ok: true,
      taskId: "social-task",
      commentId: "comment"
    });
    expect(mocks.prisma.comment.create).toHaveBeenCalledWith({
      data: {
        postId: "post",
        authorId: "owner",
        content: "用户编辑后的建议评论",
        generatedByAvatar: true,
        socialAgentTaskId: "social-task"
      }
    });
    expect(mocks.prisma.socialAgentTask.upsert).not.toHaveBeenCalled();
  });

  it("rechecks the daily limit and author cooldown before creating a comment", async () => {
    mocks.prisma.socialAgentTask.findFirst.mockResolvedValue(task);
    mocks.prisma.post.findFirst.mockResolvedValue({
      id: "post",
      authorId: "author"
    });
    mocks.prisma.comment.count.mockResolvedValue(policy.dailyCommentLimit);

    const limited = await approveSocialDraft(
      "owner",
      "social-task",
      "达到限额"
    );
    expect(limited.error).toContain("上限");

    mocks.prisma.comment.count.mockResolvedValue(0);
    mocks.prisma.comment.findFirst.mockResolvedValue({ id: "recent" });
    const cooling = await approveSocialDraft(
      "owner",
      "social-task",
      "仍在冷却"
    );
    expect(cooling.error).toContain("冷却");
    expect(mocks.prisma.comment.create).not.toHaveBeenCalled();
  });
});

describe("social avatar comment owner edits and deletes", () => {
  it("edits an unedited avatar comment once and redacts its task draft", async () => {
    mocks.prisma.comment.findFirst.mockResolvedValue({
      id: "comment-1",
      socialAgentTaskId: "task-1"
    });

    const result = await editSocialComment("owner", "comment-1", "  自己改过的评论  ");

    expect(result).toEqual({
      ok: true,
      taskId: "task-1",
      commentId: "comment-1"
    });
    expect(mocks.prisma.comment.findFirst).toHaveBeenCalledWith({
      where: {
        id: "comment-1",
        authorId: "owner",
        generatedByAvatar: true,
        ownerEditedAt: null
      },
      select: { id: true, socialAgentTaskId: true }
    });
    expect(mocks.prisma.comment.update).toHaveBeenCalledWith({
      where: { id: "comment-1" },
      data: {
        content: "自己改过的评论",
        ownerEditedAt: expect.any(Date)
      }
    });
    expect(mocks.prisma.socialAgentTask.updateMany).toHaveBeenCalledWith({
      where: { id: "task-1", ownerId: "owner" },
      data: {
        draftContent: null,
        decisionReason: "OWNER_EDITED",
        redactedAt: expect.any(Date)
      }
    });
  });

  it("rejects a second edit because edited comments no longer match ownerEditedAt null", async () => {
    mocks.prisma.comment.findFirst.mockResolvedValue(null);

    const result = await editSocialComment("owner", "comment-1", "再次修改");

    expect(result.ok).toBe(false);
    expect(mocks.prisma.comment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerEditedAt: null })
      })
    );
    expect(mocks.prisma.comment.update).not.toHaveBeenCalled();
    expect(mocks.prisma.socialAgentTask.updateMany).not.toHaveBeenCalled();
  });

  it("deletes only the owner's avatar-generated comment and redacts its task", async () => {
    mocks.prisma.comment.findFirst.mockResolvedValue({
      id: "comment-1",
      socialAgentTaskId: "task-1"
    });

    const result = await deleteSocialComment("owner", "comment-1");

    expect(result).toEqual({
      ok: true,
      taskId: "task-1",
      commentId: "comment-1"
    });
    expect(mocks.prisma.comment.findFirst).toHaveBeenCalledWith({
      where: {
        id: "comment-1",
        authorId: "owner",
        generatedByAvatar: true
      },
      select: { id: true, socialAgentTaskId: true }
    });
    expect(mocks.prisma.socialAgentTask.updateMany).toHaveBeenCalledWith({
      where: { id: "task-1", ownerId: "owner" },
      data: {
        status: "DELETED",
        draftContent: null,
        decisionReason: "OWNER_DELETED",
        error: null,
        redactedAt: expect.any(Date),
        completedAt: expect.any(Date)
      }
    });
    expect(mocks.prisma.comment.delete).toHaveBeenCalledWith({
      where: { id: "comment-1" }
    });
  });
});
