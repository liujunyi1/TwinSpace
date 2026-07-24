import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    user: {
      findMany: vi.fn()
    },
    post: {
      findMany: vi.fn()
    },
    comment: {
      create: vi.fn()
    },
    conversation: {
      findMany: vi.fn(),
      update: vi.fn()
    },
    message: {
      create: vi.fn()
    },
    aIGenerationLog: {
      create: vi.fn()
    }
  },
  decideAndGenerateSocialComment: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/agent/social-ai", () => ({
  decideAndGenerateSocialComment: mocks.decideAndGenerateSocialComment
}));

import { runSimulationWorkerOnce } from "@/lib/simulation/worker";

const NOW = new Date("2026-07-23T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SIMULATION_ENABLED = "true";
  mocks.prisma.user.findMany.mockResolvedValue([
    { id: "sim-1", username: "sim_chenxi", nickname: "Chenxi" },
    { id: "sim-2", username: "sim_haoran", nickname: "Haoran" }
  ]);
  mocks.prisma.post.findMany.mockResolvedValue([]);
  mocks.prisma.comment.create.mockResolvedValue({ id: "comment-1" });
  mocks.prisma.conversation.findMany.mockResolvedValue([]);
  mocks.prisma.message.create.mockResolvedValue({ id: "message-2" });
  mocks.prisma.conversation.update.mockResolvedValue({});
  mocks.prisma.aIGenerationLog.create.mockResolvedValue({ id: "log-1" });
  mocks.decideAndGenerateSocialComment.mockResolvedValue({
    decision: "COMMENT",
    text: "A fresh comment generated from full context.",
    model: "test-model",
    capabilityStatus: "TEXT_ONLY"
  });
});

describe("simulation worker", () => {
  it("creates avatar comments for recent public posts with full post context", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        authorId: "real-user",
        content: "I finally got the project running today.",
        imageUrlsJson: JSON.stringify(["/uploads/post.png"]),
        topicsJson: JSON.stringify(["dev", "daily"]),
        author: { id: "real-user", username: "demo", nickname: "Real User" },
        comments: [
          {
            authorId: "real-user",
            content: "Existing human comment.",
            generatedByAvatar: false,
            author: { username: "demo", nickname: "Real User" }
          }
        ]
      }
    ]);

    const result = await runSimulationWorkerOnce({
      now: NOW,
      maxComments: 1,
      maxReplies: 0
    });

    expect(result.commentsCreated).toBe(1);
    expect(mocks.prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postId: "post-1",
          content: "A fresh comment generated from full context.",
          generatedByAvatar: true
        })
      })
    );
    expect(mocks.prisma.aIGenerationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskType: "SIMULATION_FEED_COMMENT",
          sourceId: "post-1",
          accepted: true,
          model: "test-model"
        })
      })
    );
    expect(mocks.decideAndGenerateSocialComment).toHaveBeenCalledWith(
      expect.objectContaining({
        post: expect.objectContaining({
          id: "post-1",
          content: "I finally got the project running today.",
          imageUrls: ["/uploads/post.png"],
          existingComments: [
            {
              authorName: "Real User",
              content: "Existing human comment.",
              generatedByAvatar: false
            }
          ]
        })
      }),
      undefined
    );
  });

  it("does not duplicate comments from the same simulated user on one post", async () => {
    mocks.prisma.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        authorId: "real-user",
        content: "I finally got the project running today.",
        imageUrlsJson: "[]",
        topicsJson: "[]",
        author: { id: "real-user", username: "demo", nickname: "Real User" },
        comments: [
          {
            authorId: "sim-1",
            content: "Existing simulated comment.",
            generatedByAvatar: true,
            author: { username: "sim_chenxi", nickname: "Chenxi" }
          }
        ]
      }
    ]);

    await runSimulationWorkerOnce({
      now: NOW,
      maxComments: 2,
      maxCommentsPerPost: 2,
      maxReplies: 0
    });

    expect(mocks.prisma.comment.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ authorId: "sim-1" })
      })
    );
  });

  it("falls back when the AI output is too similar to an existing comment", async () => {
    mocks.decideAndGenerateSocialComment.mockResolvedValue({
      decision: "COMMENT",
      text: "I finally got the project running today, nice.",
      model: "test-model",
      capabilityStatus: "TEXT_ONLY"
    });
    mocks.prisma.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        authorId: "real-user",
        content: "I finally got the project running today.",
        imageUrlsJson: "[]",
        topicsJson: "[]",
        author: { id: "real-user", username: "demo", nickname: "Real User" },
        comments: [
          {
            authorId: "real-user",
            content: "I finally got the project running today, nice.",
            generatedByAvatar: false,
            author: { username: "demo", nickname: "Real User" }
          }
        ]
      }
    ]);

    await runSimulationWorkerOnce({
      now: NOW,
      maxComments: 1,
      maxReplies: 0
    });

    expect(mocks.prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.not.stringContaining("I finally got the project running today, nice.")
        })
      })
    );
    expect(mocks.prisma.aIGenerationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ model: "simulation-fixture" })
      })
    );
  });

  it("creates an AI proxy direct reply when the latest message is from a real user", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      {
        id: "conversation-1",
        members: [
          { userId: "real-user", user: { id: "real-user", username: "demo", nickname: "Real User" } },
          { userId: "sim-1", user: { id: "sim-1", username: "sim_chenxi", nickname: "Chenxi" } }
        ],
        messages: [
          {
            id: "message-1",
            senderId: "real-user",
            content: "What should I do first?",
            sender: { id: "real-user", username: "demo", nickname: "Real User" }
          }
        ]
      }
    ]);

    const result = await runSimulationWorkerOnce({
      now: NOW,
      maxComments: 0,
      maxReplies: 1
    });

    expect(result.repliesCreated).toBe(1);
    expect(mocks.prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: "conversation-1",
          senderId: "sim-1",
          senderMode: "AI_PROXY"
        })
      })
    );
    expect(mocks.prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: "conversation-1" },
      data: { updatedAt: NOW }
    });
    expect(mocks.prisma.aIGenerationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskType: "SIMULATION_DIRECT_REPLY",
          sourceId: "message-1",
          conversationId: "conversation-1",
          accepted: true
        })
      })
    );
  });

  it("skips direct replies when the latest message is already from a simulated user", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([
      {
        id: "conversation-1",
        members: [
          { userId: "real-user", user: { id: "real-user", username: "demo", nickname: "Real User" } },
          { userId: "sim-1", user: { id: "sim-1", username: "sim_chenxi", nickname: "Chenxi" } }
        ],
        messages: [
          {
            id: "message-1",
            senderId: "sim-1",
            content: "I am here.",
            sender: { id: "sim-1", username: "sim_chenxi", nickname: "Chenxi" }
          }
        ]
      }
    ]);

    const result = await runSimulationWorkerOnce({
      now: NOW,
      maxComments: 0,
      maxReplies: 1
    });

    expect(result.repliesCreated).toBe(0);
    expect(mocks.prisma.message.create).not.toHaveBeenCalled();
  });
});
