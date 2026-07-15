import Link from "next/link";
import { Bot, ScanLine, UserPlus } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { TopBar } from "@/components/top-bar";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatRelativeTime } from "@/lib/utils";

export default async function MessagesPage() {
  const user = await requireUser();
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: user.id },
    include: {
      conversation: {
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
          members: { include: { user: true } }
        }
      }
    },
    orderBy: { conversation: { updatedAt: "desc" } }
  });

  return (
    <main className="page-shell">
      <TopBar
        title="消息"
        muted="话题"
        action={
          <div className="flex gap-2">
            <button className="grid h-10 w-10 place-items-center rounded-full bg-white" aria-label="扫一扫">
              <ScanLine className="h-5 w-5" aria-hidden />
            </button>
            <button className="grid h-10 w-10 place-items-center rounded-full bg-white" aria-label="添加好友">
              <UserPlus className="h-5 w-5" aria-hidden />
            </button>
          </div>
        }
      />

      {memberships.length === 0 ? (
        <EmptyState title="暂无会话" />
      ) : (
        <div className="space-y-4">
          {memberships.map(({ conversation }) => {
            const last = conversation.messages[0];
            const other = conversation.members.find((member) => member.userId !== user.id)?.user;
            const title = conversation.title || other?.nickname || "会话";
            return (
              <Link
                key={conversation.id}
                href={`/messages/${conversation.id}`}
                className="card flex items-center gap-4 p-4 transition active:scale-[0.99]"
              >
                <div className="relative">
                  <Avatar name={title} src={other?.avatarUrl} size="lg" />
                  {conversation.type === "AI_CONTACT" ? (
                    <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-ink text-white">
                      <Bot className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="truncate text-xl font-semibold">{title}</h2>
                    <span className="shrink-0 text-xs text-muted">
                      {last ? formatRelativeTime(last.createdAt) : ""}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">
                    {conversation.aiMode === "PROXY" ? "AI 托管中 · " : ""}
                    {last?.content || "还没有消息"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
