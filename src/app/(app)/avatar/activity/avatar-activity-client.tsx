"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Clock3, RefreshCw, X } from "lucide-react";
import {
  cancelAgentTaskAction,
  retryAgentTaskAction
} from "@/app/agent-actions";
import { GlobalAgentToggle } from "@/app/(app)/avatar/global-agent-toggle";
import type { AgentActivityView } from "@/lib/client/agent-view-models";

type AvatarActivityClientProps = {
  activities: AgentActivityView[];
  globalEnabled: boolean;
  avatarActive: boolean;
  workerOnline: boolean;
};

const STATUS_LABELS: Record<AgentActivityView["status"], string> = {
  PENDING: "等待",
  RUNNING: "处理中",
  READY: "待发送",
  SUCCEEDED: "已发送",
  FAILED: "失败",
  CANCELLED: "已取消",
  DELETED: "已删除"
};

function countdown(target: string | null, now: number) {
  if (!target) return null;
  const seconds = Math.max(0, Math.ceil((new Date(target).getTime() - now) / 1000));
  if (seconds >= 60) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
  return `${seconds}秒`;
}

export function AvatarActivityClient({
  activities,
  globalEnabled,
  avatarActive,
  workerOnline
}: AvatarActivityClientProps) {
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => router.refresh(), 5000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(refresh);
    };
  }, [router]);

  const grouped = useMemo(() => {
    const groups = new Map<string, AgentActivityView[]>();
    for (const activity of activities) {
      const group = activity.status;
      groups.set(group, [...(groups.get(group) || []), activity]);
    }
    return groups;
  }, [activities]);

  const runAction = (
    id: string,
    action: (taskId: string) => Promise<{ ok: boolean; error?: string }>
  ) => {
    setPendingId(id);
    setMessage(null);
    startTransition(async () => {
      const result = await action(id);
      setPendingId(null);
      if (!result.ok) {
        setMessage(result.error || "操作失败，请重试");
        return;
      }
      router.refresh();
    });
  };

  const statusOrder: AgentActivityView["status"][] = [
    "PENDING",
    "RUNNING",
    "READY",
    "FAILED",
    "SUCCEEDED",
    "CANCELLED",
    "DELETED"
  ];

  return (
    <div className="space-y-5">
      <GlobalAgentToggle
        initialEnabled={globalEnabled}
        avatarActive={avatarActive}
        workerOnline={workerOnline}
      />
      {!workerOnline ? (
        <div className="rounded-[24px] bg-red-50 p-4 text-sm leading-6 text-red-700">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4" aria-hidden />
            Worker 离线
          </div>
          <p className="mt-1">等待和重试任务不会执行；已保存的活动记录仍可查看。</p>
        </div>
      ) : null}
      {message ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p> : null}

      {activities.length ? (
        statusOrder.map((status) => {
          const items = grouped.get(status) || [];
          if (!items.length) return null;
          return (
            <section key={status}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">{STATUS_LABELS[status]}</h2>
                <span className="text-xs text-muted">{items.length}</span>
              </div>
              <div className="space-y-3">
                {items.map((activity) => {
                  const redacted = activity.redacted || activity.status === "DELETED";
                  const remaining = countdown(activity.scheduledFor, now);
                  return (
                    <article key={activity.id} className="card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="chip">{STATUS_LABELS[activity.status]}</span>
                            <span className="text-xs text-muted">{activity.kind}</span>
                          </div>
                          <h3 className="mt-2 font-semibold">
                            {activity.conversationTitle || "代理活动"}
                          </h3>
                        </div>
                        {remaining && (status === "PENDING" || status === "RUNNING") ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted">
                            <Clock3 className="h-3.5 w-3.5" aria-hidden />
                            {remaining}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">
                        {redacted
                          ? "内容已删除或脱敏，系统不再保留正文。"
                          : activity.draft || activity.reason || "暂无正文预览"}
                      </p>
                      {activity.error ? (
                        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                          {activity.error}
                        </p>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {activity.conversationId ? (
                          <Link
                            href={`/messages/${activity.conversationId}`}
                            className="btn-secondary h-10 px-4 text-xs"
                          >
                            查看会话
                          </Link>
                        ) : null}
                        {status === "PENDING" || status === "RUNNING" || status === "READY" ? (
                          <button
                            type="button"
                            onClick={() => runAction(activity.id, cancelAgentTaskAction)}
                            disabled={pendingId === activity.id}
                            className="btn-secondary h-10 px-4 text-xs text-red-600"
                          >
                            <X className="h-4 w-4" aria-hidden />
                            取消
                          </button>
                        ) : null}
                        {status === "FAILED" ? (
                          <button
                            type="button"
                            onClick={() => runAction(activity.id, retryAgentTaskAction)}
                            disabled={pendingId === activity.id}
                            className="btn-secondary h-10 px-4 text-xs"
                          >
                            <RefreshCw className="h-4 w-4" aria-hidden />
                            重试
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })
      ) : (
        <div className="card p-6 text-center">
          <p className="text-xl font-semibold">还没有代理活动</p>
          <p className="mt-2 text-sm leading-6 text-muted">辅助草稿和托管回复会在这里留下可控、可追踪的记录。</p>
        </div>
      )}
    </div>
  );
}
