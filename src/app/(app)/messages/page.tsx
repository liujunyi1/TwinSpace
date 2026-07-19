import Link from "next/link";
import { Activity, Bot, ScanLine, UserPlus } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { TopBar } from "@/components/top-bar";
import { getConversationAgentState } from "@/lib/agent/chat-policy";
import { requireUser } from "@/lib/auth";
import {
  DEFAULT_CONVERSATION_AGENT_STATE,
  modeLabel,
  type ConversationAgentStateView
} from "@/lib/client/agent-view-models";
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
  const stateEntries = await Promise.all(
    memberships.map(async ({ conversation }) => {
      if (conversation.type === "AI_CONTACT") {
        return [conversation.id, null] as const;
      }
      const raw = await getConversationAgentState(user.id, conversation.id);
      return [
        conversation.id,
        {
          ...DEFAULT_CONVERSATION_AGENT_STATE,
          ...(raw as unknown as Partial<ConversationAgentStateView>)
        }
      ] as const;
    })
  );
  const stateByConversation = new Map(stateEntries);

  return (
    <main className="page-shell">
      <TopBar
        title="消息"
        muted="话题"
        action={
          <div className="flex gap-2">
            <Link
              href="/avatar/activity"
              className="grid h-10 w-10 place-items-center rounded-full bg-white"
              aria-label="分身活动中心"
            >
              <Activity className="h-5 w-5" aria-hidden />
            </Link>
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
            const agentState = stateByConversation.get(conversation.id);
            const pendingCount =
              agentState?.tasks.filter((task) =>
                task.status === "PENDING" || task.status === "RUNNING" || task.status === "READY"
              ).length || 0;
            const failedCount =
              agentState?.tasks.filter((task) => task.status === "FAILED").length || 0;
            const lastAgentLabel =
              last?.senderMode === "AI_PROXY"
                ? "AI 分身代理"
                : last?.senderMode === "AI_ASSISTED"
                  ? "AI 辅助生成"
                  : last?.senderMode === "AI"
                    ? "AI 联系人"
                    : null;

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
                  {failedCount ? (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-white bg-red-500"
                      aria-label={`${failedCount} 个失败任务`}
                    />
                  ) : pendingCount ? (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-white bg-amber-400"
                      aria-label={`${pendingCount} 个待处理任务`}
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="truncate text-xl font-semibold">{title}</h2>
                      <span className="chip shrink-0 px-2 py-1 text-[10px]">
                        {conversation.type === "AI_CONTACT"
                          ? "AI 联系人"
                          : modeLabel(agentState?.effectiveMode || "MANUAL")}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-muted">
                      {last ? formatRelativeTime(last.createdAt) : ""}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">
                    {lastAgentLabel ? `${lastAgentLabel} · ` : ""}
                    {last?.content || "还没有消息"}
                  </p>
                  {failedCount || pendingCount ? (
                    <p className={`mt-1 text-xs font-semibold ${failedCount ? "text-red-600" : "text-amber-700"}`}>
                      {failedCount
                        ? `${failedCount} 个任务失败`
                        : `${pendingCount} 个代理任务待处理`}
                    </p>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
