"use client";

import { Plus, Trash2 } from "lucide-react";
import type { AgentActiveWindow } from "@/lib/client/agent-view-models";

const DAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" }
];

type AgentScheduleEditorProps = {
  value: AgentActiveWindow[];
  onChange: (value: AgentActiveWindow[]) => void;
  disabled?: boolean;
};

export function AgentScheduleEditor({
  value,
  onChange,
  disabled = false
}: AgentScheduleEditorProps) {
  const addWindow = (weekday: number) => {
    onChange([...value, { weekday, start: "09:00", end: "18:00" }]);
  };

  const updateWindow = (
    index: number,
    key: "start" | "end",
    nextValue: string
  ) => {
    onChange(
      value.map((window, currentIndex) =>
        currentIndex === index ? { ...window, [key]: nextValue } : window
      )
    );
  };

  const removeWindow = (index: number) => {
    onChange(value.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div className="space-y-3">
      {DAYS.map((day) => {
        const windows = value
          .map((window, index) => ({ window, index }))
          .filter(({ window }) => window.weekday === day.value);
        return (
          <section key={day.value} className="rounded-2xl bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{day.label}</span>
              <button
                type="button"
                onClick={() => addWindow(day.value)}
                disabled={disabled}
                className="inline-flex items-center gap-1 text-xs font-semibold text-muted disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                添加时段
              </button>
            </div>
            {windows.length ? (
              <div className="mt-3 space-y-2">
                {windows.map(({ window, index }) => (
                  <div key={`${day.value}-${index}`} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={window.start}
                      onChange={(event) => updateWindow(index, "start", event.target.value)}
                      disabled={disabled}
                      className="field h-10 min-w-0 px-3 text-xs"
                      aria-label={`${day.label}开始时间`}
                    />
                    <span className="text-xs text-muted">至</span>
                    <input
                      type="time"
                      value={window.end}
                      onChange={(event) => updateWindow(index, "end", event.target.value)}
                      disabled={disabled}
                      className="field h-10 min-w-0 px-3 text-xs"
                      aria-label={`${day.label}结束时间`}
                    />
                    <button
                      type="button"
                      onClick={() => removeWindow(index)}
                      disabled={disabled}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-red-600 disabled:opacity-40"
                      aria-label={`删除${day.label}时段`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">当天不自动运行</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
