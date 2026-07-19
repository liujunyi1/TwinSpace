"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { toggleGlobalAgentAction } from "@/app/agent-actions";

type GlobalAgentToggleProps = {
  initialEnabled: boolean;
  avatarActive: boolean;
  workerOnline: boolean;
  compact?: boolean;
};

export function GlobalAgentToggle({
  initialEnabled,
  avatarActive,
  workerOnline,
  compact = false
}: GlobalAgentToggleProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => setEnabled(initialEnabled), [initialEnabled]);

  const toggle = () => {
    const next = !enabled;
    setMessage(null);
    startTransition(async () => {
      const result = await toggleGlobalAgentAction(next);
      if (!result.ok) {
        setMessage(result.error || "设置失败，请重试");
        return;
      }
      setEnabled(next);
      router.refresh();
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={pending || !avatarActive}
        className={`flex w-full items-center justify-between gap-4 rounded-2xl ${
          compact ? "px-4 py-3" : "px-5 py-4"
        } ${enabled ? "bg-emerald-50 text-emerald-900" : "bg-surface text-ink"} disabled:opacity-50`}
      >
        <span className="flex items-center gap-3 text-left">
          <span
            className={`grid h-10 w-10 place-items-center rounded-full ${
              enabled ? "bg-emerald-600 text-white" : "bg-white text-muted"
            }`}
          >
            {enabled ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
          </span>
          <span>
            <span className="block text-sm font-semibold">{enabled ? "代理中" : "已暂停"}</span>
            <span className="mt-0.5 block text-xs opacity-70">
              {!avatarActive
                ? "完成并激活分身后才能开启"
                : !workerOnline
                  ? "Worker 离线，设置会保留但不会执行"
                  : enabled
                    ? "点击立即暂停全部自动行为"
                    : "点击恢复已保存的代理设置"}
            </span>
          </span>
        </span>
        <span
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${
            enabled ? "bg-emerald-600" : "bg-line"
          }`}
          aria-hidden
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
              enabled ? "left-6" : "left-1"
            }`}
          />
        </span>
      </button>
      {message ? <p className="mt-2 text-xs text-red-600">{message}</p> : null}
    </div>
  );
}
