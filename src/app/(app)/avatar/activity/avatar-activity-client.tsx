"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Clock3,
  Compass,
  RefreshCw,
  Send,
  Trash2,
  X
} from "lucide-react";
import {
  cancelAgentTaskAction,
  retryAgentTaskAction
} from "@/app/agent-actions";
import { GlobalAgentToggle } from "@/app/(app)/avatar/global-agent-toggle";
import {
  approveSocialDraftAction,
  cancelSocialTaskAction,
  deleteSocialCommentAction
} from "@/app/social-agent-actions";
import type { AgentActivityView } from "@/lib/client/agent-view-models";

export type SocialActivityView = {
  id: string;
  kind: "SOCIAL_COMMENT";
  status: string;
  postId: string;
  postContent: string;
  authorName: string;
  draft: string | null;
  reason: string | null;
  error: string | null;
  capabilityStatus: string | null;
  createdAt: string;
  scheduledFor: string | null;
  redacted: boolean;
  commentId?: string | null;
};

type AvatarActivityClientProps = {
  activities: AgentActivityView[];
  socialActivities: SocialActivityView[];
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
  socialActivities,
  globalEnabled,
  avatarActive,
  workerOnline
}: AvatarActivityClientProps) {
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [socialDrafts, setSocialDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(socialActivities.map((activity) => [activity.id, activity.draft || ""]))
  );
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
      <div className="rounded-[24px] bg-blue-50 p-4 text-sm leading-6 text-blue-900">
        <p className="font-semibold">聊天与动态分别控制</p>
        <p className="mt-1">下面的全局暂停只影响代理聊天；动态浏览请在“动态代理”中独立关闭。</p>
      </div>
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
          <p className="mt-1">聊天与动态的等待、重试任务都不会执行；已保存的活动记录仍可查看。</p>
        </div>
      ) : null}
      {message ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p> : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5" aria-hidden />
            <h2 className="text-lg font-semibold">动态代理</h2>
          </div>
          <Link href="/avatar/social" className="text-sm font-semibold text-muted">
            调整设置
          </Link>
        </div>
        {socialActivities.length ? (
          <div className="space-y-3">
            {socialActivities.map((activity) => {
              const statusLabel =
                activity.status === "PENDING"
                  ? "等待"
                  : activity.status === "RUNNING"
                    ? "处理中"
                    : activity.status === "READY"
                      ? "待确认"
                      : activity.status === "SUCCEEDED"
                        ? "已发布"
                        : activity.status === "SKIP" || activity.status === "SKIPPED"
                          ? "已跳过"
                          : activity.status === "FAILED"
                            ? "失败"
                            : activity.status === "CANCELLED"
                              ? "已取消"
                              : activity.status === "DELETED"
                                ? "已删除"
                                : activity.status;
              const active = ["PENDING", "RUNNING", "READY"].includes(activity.status);
              const ready = activity.status === "READY" && !activity.redacted;
              const draft = socialDrafts[activity.id] ?? "";
              const capabilityLabel =
                activity.capabilityStatus === "TEXT_ONLY"
                  ? "当前模型未启用图片理解，已退化为纯文本"
                  : activity.capabilityStatus === "IMAGE_USED"
                    ? "已使用文字与图片理解"
                    : activity.capabilityStatus === "IMAGE_FALLBACK"
                      ? "图片理解失败，已退化为纯文本"
                      : activity.capabilityStatus === "PURE_IMAGE_SKIPPED"
                        ? "纯图片动态无法可靠理解，已跳过"
                        : activity.capabilityStatus;

              return (
                <article key={activity.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="chip">{statusLabel}</span>
                        <span className="text-xs text-muted">AI 动态评论</span>
                      </div>
                      <h3 className="mt-2 font-semibold">{activity.authorName}</h3>
                    </div>
                    {activity.scheduledFor && active ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden />
                        {countdown(activity.scheduledFor, now)}
                      </span>
                    ) : null}
                  </div>

                  <Link
                    href={`/feed#post-${activity.postId}`}
                    className="mt-3 block rounded-2xl bg-surface px-4 py-3"
                  >
                    <span className="text-xs font-semibold text-muted">目标动态</span>
                    <span className="mt-1 line-clamp-3 block text-sm leading-6">
                      {activity.postContent || "动态正文不可用"}
                    </span>
                  </Link>

                  {ready ? (
                    <label className="mt-3 block">
                      <span className="mb-2 block text-sm font-semibold">可编辑评论草稿</span>
                      <textarea
                        value={draft}
                        onChange={(event) =>
                          setSocialDrafts((current) => ({
                            ...current,
                            [activity.id]: event.target.value
                          }))
                        }
                        rows={4}
                        maxLength={500}
                        className="field min-h-28 resize-y"
                      />
                    </label>
                  ) : (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">
                      {activity.redacted
                        ? "评论正文已删除或脱敏，系统不再保留内容。"
                        : activity.draft || activity.reason || "暂无评论正文"}
                    </p>
                  )}

                  {activity.reason && !ready ? (
                    <p className="mt-2 text-xs leading-5 text-muted">处理说明：{activity.reason}</p>
                  ) : null}
                  {capabilityLabel ? (
                    <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                      能力状态：{capabilityLabel}
                    </p>
                  ) : null}
                  {activity.error ? (
                    <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                      {activity.error}
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {ready ? (
                      <button
                        type="button"
                        disabled={pendingId === activity.id || !draft.trim()}
                        onClick={() =>
                          runAction(activity.id, () =>
                            approveSocialDraftAction({
                              taskId: activity.id,
                              content: draft
                            })
                          )
                        }
                        className="btn-primary h-10 px-4 text-xs"
                      >
                        <Send className="h-4 w-4" aria-hidden />
                        确认发布
                      </button>
                    ) : null}
                    {active ? (
                      <button
                        type="button"
                        disabled={pendingId === activity.id}
                        onClick={() =>
                          runAction(activity.id, () => cancelSocialTaskAction(activity.id))
                        }
                        className="btn-secondary h-10 px-4 text-xs text-red-600"
                      >
                        <X className="h-4 w-4" aria-hidden />
                        取消
                      </button>
                    ) : null}
                    {activity.status === "SUCCEEDED" && activity.commentId ? (
                      <button
                        type="button"
                        disabled={pendingId === activity.id}
                        onClick={() => {
                          if (!window.confirm("确定无痕删除这条 AI 分身评论吗？")) return;
                          runAction(activity.id, () =>
                            deleteSocialCommentAction(activity.commentId as string)
                          );
                        }}
                        className="btn-secondary h-10 px-4 text-xs text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        无痕删除
                      </button>
                    ) : null}
                    {activity.status === "SUCCEEDED" ? (
                      <span className="inline-flex h-10 items-center gap-1 px-2 text-xs font-semibold text-emerald-700">
                        <Check className="h-4 w-4" aria-hidden />
                        已标注 AI 分身代理
                      </span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="card p-5 text-center">
            <p className="font-semibold">还没有动态代理活动</p>
            <p className="mt-2 text-sm text-muted">启用后，浏览、草稿、跳过和发布记录会出现在这里。</p>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">聊天代理</h2>
          <span className="text-xs text-muted">{activities.length}</span>
        </div>
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
                          ? "内容已删除"
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
          <p className="text-xl font-semibold">还没有聊天代理活动</p>
          <p className="mt-2 text-sm leading-6 text-muted">辅助草稿和托管回复会在这里留下可控、可追踪的记录。</p>
        </div>
      )}
      </section>
    </div>
  );
}
