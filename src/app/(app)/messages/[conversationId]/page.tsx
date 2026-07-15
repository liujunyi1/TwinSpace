import Link from "next/link";
import { ArrowLeft, Bot, Send } from "lucide-react";
import { sendFriendMessageAction } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cn, formatRelativeTime } from "@/lib/utils";

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

  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    include: {
      messages: { orderBy: { createdAt: "asc" }, include: { sender: true } },
      members: { include: { user: true } }
    }
  });
  if (!conversation) {
    return (
      <main className="page-shell">
        <p className="card p-6 text-sm text-muted">会话不存在。</p>
      </main>
    );
  }

  const other = conversation.members.find((member) => member.userId !== user.id)?.user;
  const title = conversation.title || other?.nickname || "会话";

  return (
    <main className="page-shell flex min-h-screen flex-col">
      <header className="mb-5 flex items-center justify-between">
        <Link href="/messages" className="grid h-11 w-11 place-items-center rounded-full bg-white" aria-label="返回">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="text-center">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-xs text-muted">
            {conversation.type === "AI_CONTACT" ? "AI 联系人" : "真人好友"} · {conversation.aiMode}
          </p>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-full bg-white">
          {conversation.type === "AI_CONTACT" ? <Bot className="h-5 w-5" aria-hidden /> : null}
        </div>
      </header>

      <section className="flex-1 space-y-4 pb-4">
        {conversation.messages.map((message) => {
          const mine = message.senderId === user.id;
          const senderName = message.sender?.nickname || title;
          return (
            <div key={message.id} className={cn("flex gap-2", mine && "justify-end")}>
              {!mine ? <Avatar name={senderName} src={message.sender?.avatarUrl || other?.avatarUrl} size="sm" /> : null}
              <div className={cn("max-w-[78%]", mine && "text-right")}>
                <div
                  className={cn(
                    "rounded-[24px] px-4 py-3 text-left text-sm leading-6",
                    mine ? "bg-ink text-white" : "bg-white text-ink"
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.senderMode === "AI_PROXY" || message.senderMode === "AI" ? (
                    <span className="mt-2 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px]">
                      AI
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-muted">{formatRelativeTime(message.createdAt)}</p>
              </div>
            </div>
          );
        })}
      </section>

      <form action={sendFriendMessageAction} className="sticky bottom-24 flex gap-2 rounded-full bg-white p-2 shadow-soft">
        <input type="hidden" name="conversationId" value={conversation.id} />
        <input
          name="content"
          className="min-w-0 flex-1 rounded-full px-4 text-sm outline-none"
          placeholder="输入消息"
          aria-label="消息内容"
          autoComplete="off"
        />
        <button className="grid h-11 w-11 place-items-center rounded-full bg-ink text-white" aria-label="发送">
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </main>
  );
}
