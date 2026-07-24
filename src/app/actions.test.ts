import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(),
    avatarProfile: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    avatarKnowledgePage: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn()
    },
    avatarKnowledgeSource: {
      findMany: vi.fn(),
      deleteMany: vi.fn()
    },
    comment: {
      findUnique: vi.fn(),
      delete: vi.fn()
    },
    post: {
      findUnique: vi.fn(),
      delete: vi.fn()
    }
  };

  return {
    prisma,
    revalidatePath: vi.fn(),
    redirect: vi.fn((target: string) => {
      throw new Error(`redirect:${target}`);
    }),
    requireUser: vi.fn()
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth", () => ({
  clearSessionCookie: vi.fn(),
  hashPassword: vi.fn(),
  requireUser: mocks.requireUser,
  setSessionCookie: vi.fn(),
  verifyPassword: vi.fn()
}));
vi.mock("@/lib/upload", () => ({
  saveAvatarFile: vi.fn(),
  savePostImageFiles: vi.fn()
}));
vi.mock("@/lib/ai", () => ({
  compileAvatarKnowledge: vi.fn(),
  generateAvatarReply: vi.fn(),
  generateCalibrationReply: vi.fn()
}));
vi.mock("@/app/agent-actions", () => ({
  sendHumanChatMessageAction: vi.fn()
}));

import { deleteCommentAction, deletePostAction } from "@/app/actions";

function formData(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    form.set(key, value);
  }
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "owner", avatarUrl: null });
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma)
  );
  mocks.prisma.avatarProfile.findUnique.mockResolvedValue(null);
  mocks.prisma.avatarKnowledgeSource.findMany.mockResolvedValue([]);
  mocks.prisma.comment.delete.mockResolvedValue({});
  mocks.prisma.post.delete.mockResolvedValue({});
});

describe("deleteCommentAction", () => {
  it("deletes only the current user's own comment and revalidates comment surfaces", async () => {
    mocks.prisma.comment.findUnique.mockResolvedValue({
      authorId: "owner",
      postId: "post-1"
    });

    await deleteCommentAction(formData({ commentId: "comment-1" }));

    expect(mocks.prisma.comment.findUnique).toHaveBeenCalledWith({
      where: { id: "comment-1" },
      select: { authorId: true, postId: true }
    });
    expect(mocks.prisma.comment.delete).toHaveBeenCalledWith({
      where: { id: "comment-1" }
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/feed");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profile");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profile/comments");
  });

  it("does not delete another user's comment", async () => {
    mocks.prisma.comment.findUnique.mockResolvedValue({
      authorId: "other",
      postId: "post-1"
    });

    await deleteCommentAction(formData({ commentId: "comment-1" }));

    expect(mocks.prisma.comment.delete).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deletePostAction", () => {
  it("deletes only the current user's own post inside a transaction", async () => {
    mocks.prisma.post.findUnique.mockResolvedValue({ authorId: "owner" });

    await deletePostAction(formData({ postId: "post-1" }));

    expect(mocks.prisma.post.findUnique).toHaveBeenCalledWith({
      where: { id: "post-1" },
      select: { authorId: true }
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.post.delete).toHaveBeenCalledWith({
      where: { id: "post-1" }
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/feed");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profile");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profile/comments");
  });

  it("does not delete another user's post or touch cascaded data", async () => {
    mocks.prisma.post.findUnique.mockResolvedValue({ authorId: "other" });

    await deletePostAction(formData({ postId: "post-1" }));

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.post.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.avatarKnowledgeSource.findMany).not.toHaveBeenCalled();
  });
});
