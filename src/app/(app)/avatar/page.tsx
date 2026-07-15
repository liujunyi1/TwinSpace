import { Bot, RotateCcw, Send } from "lucide-react";
import { clearAvatarSessionAction, sendAvatarMessageAction } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatRelativeTime } from "@/lib/utils";

export default async function AvatarPage() {
  const user = await requireUser();
  const profile = await prisma.personalityProfile.findUnique({ where: { userId: user.id } });
  const session = await prisma.avatarChatSession.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });

  return (
    <main className="page-shell">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-muted">分身</p>
          <h1 className="mt-1 text-4xl font-semibold tracking-normal">和自己聊聊</h1>
        </div>
        <form action={clearAvatarSessionAction}>
          <button className="grid h-11 w-11 place-items-center rounded-full bg-white" aria-label="清空对话">
            <RotateCcw className="h-5 w-5" aria-hidden />
          </button>
        </form>
      </header>

      <section className="card mb-5 p-5">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-[30%] bg-ink text-white">
            <Bot className="h-8 w-8" aria-hidden />
          </div>
          <div>
            <h2 className="text-xl font-semibold">{user.nickname} 的分身</h2>
            <p className="text-sm text-muted">理解你，也代表你</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted">
          {profile?.summary || "完成问卷后，这里会显示分身对你的理解摘要。"}
        </p>
      </section>

      <section className="space-y-4 pb-4">
        {session?.messages.length ? (
          session.messages.map((message) => {
            const mine = message.role === "user";
            return (
              <div key={message.id} className={`flex gap-2 ${mine ? "justify-end" : ""}`}>
                {!mine ? (
                  <div className="grid h-10 w-10 place-items-center rounded-[30%] bg-ink text-white">
                    <Bot className="h-5 w-5" aria-hidden />
                  </div>
                ) : null}
                <div className={`max-w-[78%] ${mine ? "text-right" : ""}`}>
                  <div className={`rounded-[24px] px-4 py-3 text-left text-sm leading-6 ${mine ? "bg-ink text-white" : "bg-white text-ink"}`}>
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">{formatRelativeTime(message.createdAt)}</p>
                </div>
                {mine ? <Avatar name={user.nickname} src={user.avatarUrl} size="sm" /> : null}
              </div>
            );
          })
        ) : (
          <div className="card p-6">
            <p className="text-2xl font-semibold leading-9">今天状态怎么样？</p>
            <p className="mt-3 text-sm leading-6 text-muted">把想法丢进来，分身会按你的画像和记忆来回应。</p>
          </div>
        )}
      </section>

      <form action={sendAvatarMessageAction} className="sticky bottom-24 flex gap-2 rounded-full bg-white p-2 shadow-soft">
        <input
          name="content"
          className="min-w-0 flex-1 rounded-full px-4 text-sm outline-none"
          placeholder="和你的分身聊聊"
          aria-label="发送给分身的内容"
          autoComplete="off"
        />
        <button className="grid h-11 w-11 place-items-center rounded-full bg-ink text-white" aria-label="发送">
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </main>
  );
}
