import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    conversationMember: {
      findMany: vi.fn(),
      updateMany: vi.fn()
    },
    message: {
      findMany: vi.fn(),
      findFirst: vi.fn()
    }
  }
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import {
  getUnreadConversationCount,
  getUnreadConversationCounts,
  markConversationReadThroughMessage
} from "@/lib/message-unread";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("message unread counts", () => {
  it("counts only messages newer than each conversation cursor", async () => {
    mocks.prisma.conversationMember.findMany.mockResolvedValue([
      {
        conversationId: "first",
        lastReadAt: new Date("2026-07-20T01:00:00.000Z")
      },
      {
        conversationId: "second",
        lastReadAt: new Date("2026-07-20T02:00:00.000Z")
      }
    ]);
    mocks.prisma.message.findMany.mockResolvedValue([
      {
        conversationId: "first",
        senderId: "other",
        createdAt: new Date("2026-07-20T01:30:00.000Z")
      },
      {
        conversationId: "second",
        senderId: null,
        createdAt: new Date("2026-07-20T02:30:00.000Z")
      },
      {
        conversationId: "second",
        senderId: "owner",
        createdAt: new Date("2026-07-20T03:00:00.000Z")
      }
    ]);

    await expect(getUnreadConversationCounts("owner")).resolves.toEqual({
      first: 1,
      second: 1
    });
    expect(mocks.prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ senderId: null }, { senderId: { not: "owner" } }],
          hiddenFor: { none: { userId: "owner" } }
        })
      })
    );
  });

  it("returns unread conversation count rather than total unread messages", async () => {
    mocks.prisma.conversationMember.findMany.mockResolvedValue([
      {
        conversationId: "conversation",
        lastReadAt: new Date("2026-07-20T01:00:00.000Z")
      }
    ]);
    mocks.prisma.message.findMany.mockResolvedValue([
      {
        conversationId: "conversation",
        senderId: "other",
        createdAt: new Date("2026-07-20T02:00:00.000Z")
      },
      {
        conversationId: "conversation",
        senderId: "other",
        createdAt: new Date("2026-07-20T03:00:00.000Z")
      }
    ]);

    await expect(getUnreadConversationCount("owner")).resolves.toBe(1);
  });
});

describe("markConversationReadThroughMessage", () => {
  it("advances only the member cursor through a visible rendered message", async () => {
    const createdAt = new Date("2026-07-20T03:00:00.000Z");
    mocks.prisma.message.findFirst.mockResolvedValue({ createdAt });
    mocks.prisma.conversationMember.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      markConversationReadThroughMessage("owner", "conversation", "message")
    ).resolves.toBe(true);
    expect(mocks.prisma.conversationMember.updateMany).toHaveBeenCalledWith({
      where: {
        conversationId: "conversation",
        userId: "owner",
        lastReadAt: { lt: createdAt }
      },
      data: { lastReadAt: createdAt }
    });
  });
});
