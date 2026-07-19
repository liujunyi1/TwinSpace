"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock3, ShieldCheck } from "lucide-react";
import { updateGlobalAgentSettingsAction } from "@/app/agent-actions";
import { AgentScheduleEditor } from "@/components/agent-schedule-editor";
import {
  delayLabel,
  modeLabel,
  type AgentDelayMode,
  type AgentMode,
  type GlobalAgentSettingsView
} from "@/lib/client/agent-view-models";

type AvatarSettingsFormProps = {
  initialSettings: GlobalAgentSettingsView;
  avatarActive: boolean;
  workerOnline: boolean;
};

const MODE_OPTIONS: AgentMode[] = ["MANUAL", "ASSIST", "PROXY"];
const DELAY_OPTIONS: AgentDelayMode[] = ["IMMEDIATE", "SHORT", "LONG", "CUSTOM"];

export function AvatarSettingsForm({
  initialSettings,
  avatarActive,
  workerOnline
}: AvatarSettingsFormProps) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateGlobalAgentSettingsAction({
        defaultMode: settings.defaultMode,
        assistAutoDraft: settings.assistAutoDraft,
        delayMode: settings.delayMode,
        customDelaySeconds: Math.max(1, settings.customDelaySeconds),
        sendBufferSeconds: Math.min(60, Math.max(0, settings.sendBufferSeconds)),
        timezone: settings.timezone.trim(),
        activeWindows: settings.activeWindows,
        receiveAi: settings.receiveAi
      });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error || "保存失败，请重试" });
        return;
      }
      setMessage({ kind: "ok", text: "代理设置已保存" });
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {!avatarActive ? (
        <div className="rounded-[24px] bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            分身尚未激活
          </div>
          <p className="mt-1">设置可以提前保存，但只有状态为 ACTIVE 的分身才能进入 AI 托管。</p>
        </div>
      ) : null}
      {!workerOnline ? (
        <div className="rounded-[24px] bg-red-50 p-4 text-sm leading-6 text-red-700">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Worker 当前离线
          </div>
          <p className="mt-1">辅助草稿和托管任务暂时不会执行，服务恢复后会继续处理有效任务。</p>
        </div>
      ) : null}

      <section className="card p-5">
        <h2 className="text-lg font-semibold">默认代理模式</h2>
        <p className="mt-1 text-sm leading-6 text-muted">单个会话可以覆盖这里的默认值。</p>
        <div className="mt-4 grid gap-2">
          {MODE_OPTIONS.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSettings((current) => ({ ...current, defaultMode: mode }))}
              className={`flex items-center justify-between rounded-2xl px-4 py-3 text-left ${
                settings.defaultMode === mode ? "bg-ink text-white" : "bg-surface text-ink"
              }`}
            >
              <span>
                <span className="block text-sm font-semibold">{modeLabel(mode)}</span>
                <span className={`mt-1 block text-xs ${settings.defaultMode === mode ? "text-white/60" : "text-muted"}`}>
                  {mode === "MANUAL"
                    ? "所有回复由你自己发送"
                    : mode === "ASSIST"
                      ? "生成可编辑草稿，由你确认发送"
                      : "在授权范围内自动创建和发送回复"}
                </span>
              </span>
              {settings.defaultMode === mode ? <Check className="h-4 w-4" aria-hidden /> : null}
            </button>
          ))}
        </div>

        <label className="mt-4 flex items-center justify-between gap-4 rounded-2xl bg-surface px-4 py-3">
          <span>
            <span className="block text-sm font-semibold">自动预生成辅助草稿</span>
            <span className="mt-1 block text-xs text-muted">收到真人消息后提前准备草稿，但不会自动发送。</span>
          </span>
          <input
            type="checkbox"
            checked={settings.assistAutoDraft}
            onChange={(event) =>
              setSettings((current) => ({ ...current, assistAutoDraft: event.target.checked }))
            }
            className="h-5 w-5"
          />
        </label>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Clock3 className="h-5 w-5" aria-hidden />
          <h2 className="text-lg font-semibold">回复延迟与缓冲</h2>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {DELAY_OPTIONS.map((delay) => (
            <button
              key={delay}
              type="button"
              onClick={() => setSettings((current) => ({ ...current, delayMode: delay }))}
              className={`rounded-2xl px-3 py-3 text-sm font-semibold ${
                settings.delayMode === delay ? "bg-ink text-white" : "bg-surface"
              }`}
            >
              {delayLabel(delay)}
            </button>
          ))}
        </div>
        {settings.delayMode === "CUSTOM" ? (
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-medium">自定义延迟（秒）</span>
            <input
              type="number"
              min={1}
              value={settings.customDelaySeconds}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  customDelaySeconds: Number(event.target.value)
                }))
              }
              className="field"
            />
          </label>
        ) : null}
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium">连续消息发送缓冲（0–60 秒）</span>
          <input
            type="number"
            min={0}
            max={60}
            value={settings.sendBufferSeconds}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                sendBufferSeconds: Number(event.target.value)
              }))
            }
            className="field"
          />
          <span className="mt-2 block text-xs leading-5 text-muted">
            默认 15 秒。缓冲期间的新消息会合并到同一个回复任务。
          </span>
        </label>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">活跃时间</h2>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium">IANA 时区</span>
          <input
            value={settings.timezone}
            onChange={(event) =>
              setSettings((current) => ({ ...current, timezone: event.target.value }))
            }
            className="field"
            list="iana-timezones"
            placeholder="Asia/Shanghai"
          />
          <datalist id="iana-timezones">
            <option value="Asia/Shanghai" />
            <option value="Asia/Hong_Kong" />
            <option value="Asia/Tokyo" />
            <option value="Europe/London" />
            <option value="America/New_York" />
            <option value="America/Los_Angeles" />
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
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" aria-hidden />
          <h2 className="text-lg font-semibold">接收 AI 代理内容</h2>
        </div>
        <label className="mt-4 flex items-center justify-between gap-4 rounded-2xl bg-surface px-4 py-3">
          <span>
            <span className="block text-sm font-semibold">允许所有联系人向我发送 AI 代理消息</span>
            <span className="mt-1 block text-xs leading-5 text-muted">关闭后，对方的 AI 分身不能自动回复你；你仍可按联系人单独调整。</span>
          </span>
          <input
            type="checkbox"
            checked={settings.receiveAi}
            onChange={(event) =>
              setSettings((current) => ({ ...current, receiveAi: event.target.checked }))
            }
            className="h-5 w-5"
          />
        </label>
      </section>

      {message ? (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${
            message.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      <button type="button" onClick={save} disabled={pending} className="btn-primary w-full">
        {pending ? "正在保存..." : "保存代理设置"}
      </button>
    </div>
  );
}
