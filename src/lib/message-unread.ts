import { prisma } from "@/lib/prisma";

export async function getUnreadConversationCounts(userId: string) {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId },
    select: {
      conversationId: true,
      lastReadAt: true
    }
  });
  if (memberships.length === 0) return {} as Record<string, number>;

  const lastReadByConversation = new Map(
    memberships.map((membership) => [
      membership.conversationId,
      membership.lastReadAt
    ])
  );
  const earliestReadAt = new Date(
    Math.min(...memberships.map((membership) => membership.lastReadAt.getTime()))
  );
  const messages = await prisma.message.findMany({
    where: {
      conversationId: { in: memberships.map((membership) => membership.conversationId) },
      createdAt: { gt: earliestReadAt },
      status: "SENT",
      OR: [{ senderId: null }, { senderId: { not: userId } }],
      hiddenFor: { none: { userId } }
    },
    select: {
      conversationId: true,
      senderId: true,
      createdAt: true
    }
  });

  const counts: Record<string, number> = {};
  for (const message of messages) {
    if (message.senderId === userId) continue;
    const lastReadAt = lastReadByConversation.get(message.conversationId);
    if (!lastReadAt || message.createdAt <= lastReadAt) continue;
    counts[message.conversationId] = (counts[message.conversationId] || 0) + 1;
  }
  return counts;
}

export async function getUnreadConversationCount(userId: string) {
  const counts = await getUnreadConversationCounts(userId);
  return Object.values(counts).filter((count) => count > 0).length;
}

export async function markConversationReadThroughMessage(
  userId: string,
  conversationId: string,
  messageId: string
) {
  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      conversationId,
      status: "SENT",
      hiddenFor: { none: { userId } },
      conversation: { members: { some: { userId } } }
    },
    select: { createdAt: true }
  });
  if (!message) return false;

  const updated = await prisma.conversationMember.updateMany({
    where: {
      conversationId,
      userId,
      lastReadAt: { lt: message.createdAt }
    },
    data: { lastReadAt: message.createdAt }
  });
  return updated.count === 1;
}
