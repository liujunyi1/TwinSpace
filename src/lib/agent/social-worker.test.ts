import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    socialAgentTask: {
      findFirst: vi.fn(),
      updateMany: vi.fn()
    },
    socialAgentPolicy: {
      findFirst: vi.fn()
    },
    avatarKnowledgePage: {
      findMany: vi.fn()
    },
    follow: {
      findUnique: vi.fn()
    }
  },
  decide: vi.fn(),
  scheduleDue: vi.fn(),
  redactExpired: vi.fn(),
  createAuto: vi.fn(),
  cancel: vi.fn(),
  leaseToken: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/agent/social-ai", () => ({
  decideAndGenerateSocialComment: mocks.decide
}));
vi.mock("@/lib/agent/social-agent", () => ({
  scheduleDueSocialPolicies: mocks.scheduleDue,
  redactExpiredSocialContent: mocks.redactExpired,
  createAutoSocialComment: mocks.createAuto,
  markSocialTaskCancelled: mocks.cancel,
  socialLeaseToken: mocks.leaseToken
}));

import { runSocialAgentWorkerOnce } from "@/lib/agent/social-worker";

const task = {
  id: "task",
  ownerId: "owner",
  policyId: "policy",
  postId: "post",
  targetAuthorId: "author",
  status: "RUNNING",
  mode: "SUGGEST",
  policyRevision: 2,
  owner: {
    nickname: "Owner",
    personalityProfile: { summary: "清晰简洁" }
  },
  post: {
    id: "post",
    content: "动态正文",
    imageUrlsJson: "[]",
    author: { nickname: "Author" }
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scheduleDue.mockResolvedValue([]);
  mocks.redactExpired.mockResolvedValue({ count: 0 });
  mocks.leaseToken.mockReturnValue("lease");
  mocks.prisma.socialAgentTask.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.socialAgentTask.findFirst
    .mockResolvedValueOnce({ id: "task" })
    .mockResolvedValueOnce(task);
  mocks.prisma.socialAgentPolicy.findFirst.mockResolvedValue({
    id: "policy",
    user: { avatarProfile: { status: "ACTIVE" } }
  });
  mocks.prisma.avatarKnowledgePage.findMany.mockResolvedValue([
    { id: "knowledge", title: "表达风格", content: "回复简洁" }
  ]);
  mocks.prisma.follow.findUnique.mockResolvedValue(null);
  mocks.createAuto.mockResolvedValue({ ok: true, commentId: "comment" });
  mocks.cancel.mockResolvedValue({ count: 1 });
});

describe("social worker decisions", () => {
  it("stores SUGGEST output as a READY draft", async () => {
    mocks.decide.mockResolvedValue({
      decision: "COMMENT",
      text: "建议评论",
      model: "model",
      capabilityStatus: "TEXT_ONLY"
    });

    const worked = await runSocialAgentWorkerOnce();

    expect(worked).toBe(true);
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({
          knowledge: [
            { id: "knowledge", title: "表达风格", content: "回复简洁" }
          ]
        }),
        post: expect.objectContaining({ id: "post" })
      }),
      undefined
    );
    expect(mocks.prisma.socialAgentTask.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "READY",
          draftContent: "建议评论",
          capabilityStatus: "TEXT_ONLY"
        })
      })
    );
    expect(mocks.createAuto).not.toHaveBeenCalled();
  });

  it("completes SKIP without retaining generated text", async () => {
    mocks.decide.mockResolvedValue({
      decision: "SKIP",
      model: "model",
      capabilityStatus: "PURE_IMAGE_SKIPPED",
      reason: "模型不支持纯图片"
    });

    await runSocialAgentWorkerOnce();

    expect(mocks.prisma.socialAgentTask.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUCCEEDED",
          draftContent: null,
          decisionReason: "模型不支持纯图片",
          capabilityStatus: "PURE_IMAGE_SKIPPED"
        })
      })
    );
    expect(mocks.createAuto).not.toHaveBeenCalled();
  });

  it("routes AUTO output through the send-time revalidation helper", async () => {
    mocks.prisma.socialAgentTask.findFirst
      .mockReset()
      .mockResolvedValueOnce({ id: "task" })
      .mockResolvedValueOnce({ ...task, mode: "AUTO" });
    mocks.decide.mockResolvedValue({
      decision: "COMMENT",
      text: "自动评论",
      model: "model",
      capabilityStatus: "IMAGE_USED"
    });

    await runSocialAgentWorkerOnce();

    expect(mocks.createAuto).toHaveBeenCalledWith(
      "owner",
      "task",
      "自动评论"
    );
  });

  it("cancels AUTO when the final permission recheck rejects sending", async () => {
    mocks.prisma.socialAgentTask.findFirst
      .mockReset()
      .mockResolvedValueOnce({ id: "task" })
      .mockResolvedValueOnce({ ...task, mode: "AUTO" });
    mocks.decide.mockResolvedValue({
      decision: "COMMENT",
      text: "自动评论",
      model: "model",
      capabilityStatus: "TEXT_ONLY"
    });
    mocks.createAuto.mockResolvedValue({
      ok: false,
      error: "动态已不可见或已关闭评论"
    });

    await runSocialAgentWorkerOnce();

    expect(mocks.cancel).toHaveBeenCalledWith(
      "task",
      "动态已不可见或已关闭评论"
    );
  });
});
