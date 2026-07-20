import { ConversationClient } from "@/app/(app)/messages/[conversationId]/conversation-client";
import { MarkConversationRead } from "@/components/mark-conversation-read";
import { getConversationAgentState } from "@/lib/agent/chat-policy";
import { requireUser } from "@/lib/auth";
import { mapConversationAgentState } from "@/lib/client/conversation-agent-mapper";
import { prisma } from "@/lib/prisma";

function heartbeatIsOnline(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const heartbeat = value as Record<string, unknown>;
  const timestamp = heartbeat.lastSeenAt ?? heartbeat.heartbeatAt ?? heartbeat.updatedAt;
  if (!(timestamp instanceof Date) && typeof timestamp !== "string") return false;
  return Date.now() - new Date(timestamp).getTime() < 90_000;
}

export default async function ConversationPage({
  params
}: {
  params: { conversationId: string };
}) {
  const user = await requireUser();
  const membership = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId: params.conversationId,
        userId: user.id
      }
    }
  });
  if (!membership) {
    return (
      <main className="page-shell">
        <p className="card p-6 text-sm text-muted">你没有权限查看这个会话。</p>
      </main>
    );
  }

  const [conversation, heartbeat] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: params.conversationId },
      include: {
        messages: {
          where: {
            status: "SENT",
            hiddenFor: { none: { userId: user.id } }
          },
          orderBy: { createdAt: "asc" },
          include: { sender: true }
        },
        members: { include: { user: true } }
      }
    }),
    prisma.agentWorkerHeartbeat.findFirst()
  ]);
  if (!conversation) {
    return (
      <main className="page-shell">
        <p className="card p-6 text-sm text-muted">会话不存在。</p>
      </main>
    );
  }

  const other = conversation.members.find((member) => member.userId !== user.id)?.user;
  const title = conversation.title || other?.nickname || "会话";
  const agentConfigurable =
    conversation.type !== "AI_CONTACT" && conversation.members.length === 2;
  const rawState = agentConfigurable
    ? await getConversationAgentState(user.id, conversation.id)
    : null;
  const state = mapConversationAgentState(rawState, heartbeatIsOnline(heartbeat));

  const lastVisibleMessage = conversation.messages.at(-1);

  return (
    <>
      <MarkConversationRead
        conversationId={conversation.id}
        messageId={lastVisibleMessage?.id || null}
      />
      <ConversationClient
        conversationId={conversation.id}
        conversationType={String(conversation.type)}
        title={title}
        currentUserId={user.id}
        currentUserName={user.nickname}
        currentUserAvatarUrl={user.avatarUrl}
        otherAvatarUrl={other?.avatarUrl || null}
        initialMessages={conversation.messages.map((message) => ({
          id: message.id,
          senderId: message.senderId,
          senderName: message.sender?.nickname || title,
          senderAvatarUrl: message.sender?.avatarUrl || null,
          content: message.content,
          senderMode: String(message.senderMode),
          createdAt: message.createdAt.toISOString()
        }))}
        initialAgentState={state}
        agentConfigurable={agentConfigurable}
      />
    </>
  );
}
