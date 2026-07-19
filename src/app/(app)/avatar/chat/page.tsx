import { redirect } from "next/navigation";
import { AvatarChatClient } from "@/app/(app)/avatar/chat/avatar-chat-client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AvatarChatPage() {
  const user = await requireUser();
  const [avatarProfile, session] = await Promise.all([
    prisma.avatarProfile.findUnique({
      where: { userId: user.id },
      select: {
        status: true,
        privateName: true,
        privateAvatarUrl: true
      }
    }),
    prisma.avatarChatSession.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            content: true,
            status: true,
            replyToMessageId: true
          }
        }
      }
    })
  ]);

  if (avatarProfile?.status !== "ACTIVE" && avatarProfile?.status !== "PAUSED") {
    redirect("/avatar");
  }

  return (
    <AvatarChatClient
      initialMessages={(session?.messages || []).map((message) => ({
        id: message.id,
        role: String(message.role),
        content: message.content,
        status: String(message.status),
        replyToMessageId: message.replyToMessageId
      }))}
      userName={user.nickname}
      userAvatarUrl={user.avatarUrl}
      avatarName={avatarProfile.privateName || `${user.nickname} 的分身`}
      avatarAvatarUrl={avatarProfile.privateAvatarUrl}
    />
  );
}
