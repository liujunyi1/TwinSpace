"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Clock3,
  Eye,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import {
  enqueueSocialRunNowAction,
  updateSocialPolicyAction
} from "@/app/social-agent-actions";
import { AgentScheduleEditor } from "@/components/agent-schedule-editor";

type SocialMode = "OFF" | "SUGGEST" | "AUTO";
type SocialScope = "MUTUAL" | "FOLLOWING" | "PUBLIC";

type SocialActiveWindow = {
  weekday: number;
  start: string;
  end: string;
};

export type SocialAgentSettingsView = {
  enabled: boolean;
  mode: SocialMode;
  scope: SocialScope;
  timezone: string;
  activeWindows: SocialActiveWindow[];
  dailyBatchMin: number;
  dailyBatchMax: number;
  dailyCommentLimit: number;
  authorCooldownHours: number;
  nextRunAt: string | null;
  avatarActive: boolean;
  workerOnline: boolean;
};

const MODE_OPTIONS: Array<{
  value: SocialMode;
  label: string;
  description: string;
}> = [
  { value: "OFF", label: "关闭", description: "不浏览，也不生成评论" },
  { value: "SUGGEST", label: "建议", description: "生成可编辑草稿，由你确认发布" },
  { value: "AUTO", label: "自动", description: "在限制内自动浏览并发表评论" }
];

const SCOPE_OPTIONS: Array<{
  value: SocialScope;
  label: string;
  description: string;
}> = [
  { value: "MUTUAL", label: "互相关注", description: "只浏览与你互关的用户" },
  { value: "FOLLOWING", label: "我关注的人", description: "浏览你主动关注的用户" },
  { value: "PUBLIC", label: "公开动态", description: "可浏览社区内全部公开动态" }
];

export function SocialAgentSettingsClient({
  initialSettings
}: {
  initialSettings: SocialAgentSettingsView;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [pendingAction, setPendingAction] = useState<"save" | "run" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const save = () => {
    setPendingAction("save");
    setMessage(null);
    startTransition(async () => {
      const result = await updateSocialPolicyAction({
        enabled: settings.enabled,
        mode: settings.mode,
        scope: settings.scope,
        timezone: settings.timezone,
        activeWindows: settings.activeWindows,
        dailyBatchMin: Number(settings.dailyBatchMin),
        dailyBatchMax: Number(settings.dailyBatchMax),
        dailyCommentLimit: Number(settings.dailyCommentLimit),
        authorCooldownHours: Number(settings.authorCooldownHours)
      });
      setPendingAction(null);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error || "保存失败，请重试" });
        return;
      }
      setMessage({ kind: "ok", text: "动态代理设置已保存" });
      router.refresh();
    });
  };

  const runNow = () => {
    setPendingAction("run");
    setMessage(null);
    startTransition(async () => {
      const result = await enqueueSocialRunNowAction();
      setPendingAction(null);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error || "创建浏览任务失败" });
        return;
      }
      setMessage({ kind: "ok", text: "已加入一次立即浏览任务" });
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {!settings.avatarActive ? (
        <div className="rounded-[24px] bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            分身尚未激活
          </div>
          <p className="mt-1">设置可以保存，但浏览与评论任务需要先完成分身构建和校准。</p>
        </div>
      ) : null}
      {!settings.workerOnline ? (
        <div className="rounded-[24px] bg-red-50 p-4 text-sm leading-6 text-red-700">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Worker 当前离线
          </div>
          <p className="mt-1">定时浏览和评论暂时不会执行，已保存的设置与任务不会丢失。</p>
        </div>
      ) : null}

      <section className="card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">启用动态代理</h2>
            <p className="mt-1 text-sm leading-6 text-muted">这是独立开关，不受聊天代理的全局暂停影响。</p>
          </div>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) =>
              setSettings((current) => ({ ...current, enabled: event.target.checked }))
            }
            className="h-5 w-5"
            aria-label="启用动态代理"
          />
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5" aria-hidden />
          <h2 className="text-lg font-semibold">运行模式</h2>
        </div>
        <div className="mt-4 grid gap-2">
          {MODE_OPTIONS.map((option) => {
            const selected = settings.mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  setSettings((current) => ({ ...current, mode: option.value }))
                }
                className={`flex items-center justify-between rounded-2xl px-4 py-3 text-left ${
                  selected ? "bg-ink text-white" : "bg-surface text-ink"
                }`}
              >
                <span>
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className={`mt-1 block text-xs ${selected ? "text-white/60" : "text-muted"}`}>
                    {option.description}
                  </span>
                </span>
                {selected ? <Check className="h-4 w-4" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" aria-hidden />
          <h2 className="text-lg font-semibold">浏览范围</h2>
        </div>
        <div className="mt-4 grid gap-2">
          {SCOPE_OPTIONS.map((option) => {
            const selected = settings.scope === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  setSettings((current) => ({ ...current, scope: option.value }))
                }
                className={`rounded-2xl px-4 py-3 text-left ${
                  selected ? "bg-ink text-white" : "bg-surface text-ink"
                }`}
              >
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className={`mt-1 block text-xs ${selected ? "text-white/60" : "text-muted"}`}>
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Clock3 className="h-5 w-5" aria-hidden />
          <h2 className="text-lg font-semibold">浏览时段</h2>
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium">IANA 时区</span>
          <input
            value={settings.timezone}
            onChange={(event) =>
              setSettings((current) => ({ ...current, timezone: event.target.value }))
            }
            className="field"
            list="social-iana-timezones"
            placeholder="Asia/Shanghai"
          />
          <datalist id="social-iana-timezones">
            <option value="Asia/Shanghai" />
            <option value="Asia/Hong_Kong" />
            <option value="Asia/Tokyo" />
            <option value="Europe/London" />
            <option value="America/New_York" />
            <option value="UTC" />
          </datalist>
        </label>
        <div className="mt-4">
          <AgentScheduleEditor
            value={settings.activeWindows}
            onChange={(activeWindows) =>
              setSettings((current) => ({ ...current, activeWindows }))
            }
          />
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">不添加时段时按全天可运行处理。</p>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">频率与上限</h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label>
            <span className="mb-2 block text-sm font-medium">每日最少批次</span>
            <input
              type="number"
              min={2}
              max={4}
              value={settings.dailyBatchMin}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  dailyBatchMin: Number(event.target.value)
                }))
              }
              className="field"
            />
          </label>
          <label>
            <span className="mb-2 block text-sm font-medium">每日最多批次</span>
            <input
              type="number"
              min={2}
              max={4}
              value={settings.dailyBatchMax}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  dailyBatchMax: Number(event.target.value)
                }))
              }
              className="field"
            />
          </label>
          <label>
            <span className="mb-2 block text-sm font-medium">每日评论上限</span>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.dailyCommentLimit}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  dailyCommentLimit: Number(event.target.value)
                }))
              }
              className="field"
            />
          </label>
          <label>
            <span className="mb-2 block text-sm font-medium">同一作者冷却（小时）</span>
            <input
              type="number"
              min={1}
              max={168}
              value={settings.authorCooldownHours}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  authorCooldownHours: Number(event.target.value)
                }))
              }
              className="field"
            />
          </label>
        </div>
      </section>

      <section className="rounded-[28px] bg-ink p-5 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">下次计划</p>
        <p className="mt-2 font-semibold">
          {settings.nextRunAt
            ? new Date(settings.nextRunAt).toLocaleString("zh-CN")
            : "尚未安排下一次浏览"}
        </p>
        <p className="mt-2 text-xs leading-5 text-white/60">
          “立即浏览一次”仍会遵守当前范围、评论上限和作者冷却规则。
        </p>
        <button
          type="button"
          onClick={runNow}
          disabled={pendingAction !== null}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white font-semibold text-ink disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {pendingAction === "run" ? "正在加入任务..." : "立即浏览一次"}
        </button>
      </section>

      {message ? (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${
            message.kind === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      <button
        type="button"
        onClick={save}
        disabled={pendingAction !== null}
        className="btn-primary w-full"
      >
        {pendingAction === "save" ? "正在保存..." : "保存动态代理设置"}
      </button>
    </div>
  );
}
