export const AGENT_MODES = ["MANUAL", "ASSIST", "PROXY"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

export const DELAY_MODES = ["IMMEDIATE", "SHORT", "LONG", "CUSTOM"] as const;
export type DelayMode = (typeof DELAY_MODES)[number];

export const AGENT_TASK_STATES = [
  "PENDING",
  "RUNNING",
  "READY",
  "SUCCEEDED",
  "CANCELLED",
  "FAILED",
  "DELETED"
] as const;
export type AgentTaskState = (typeof AGENT_TASK_STATES)[number];

export type ActiveWindow = {
  day: number;
  start: string;
  end: string;
};

export const DEFAULT_TIMEZONE = "UTC";

export const DEFAULT_ACTIVE_WINDOWS: ActiveWindow[] = Array.from(
  { length: 7 },
  (_, day) => ({ day, start: "00:00", end: "00:00" })
);

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

function isActiveWindow(value: unknown): value is ActiveWindow {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ActiveWindow>;
  return (
    Number.isInteger(item.day) &&
    Number(item.day) >= 0 &&
    Number(item.day) <= 6 &&
    typeof item.start === "string" &&
    timePattern.test(item.start) &&
    typeof item.end === "string" &&
    timePattern.test(item.end)
  );
}

export function parseActiveWindowsJson(value?: string | null): ActiveWindow[] {
  if (!value?.trim()) return DEFAULT_ACTIVE_WINDOWS.map((window) => ({ ...window }));

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return DEFAULT_ACTIVE_WINDOWS.map((window) => ({ ...window }));
    }
    const windows = parsed.filter(isActiveWindow);
    if (windows.length === 0) {
      return DEFAULT_ACTIVE_WINDOWS.map((window) => ({ ...window }));
    }
    const unique = new Map<string, ActiveWindow>();
    for (const window of windows) {
      unique.set(`${window.day}:${window.start}-${window.end}`, {
        day: window.day,
        start: window.start,
        end: window.end
      });
    }
    return [...unique.values()];
  } catch {
    return DEFAULT_ACTIVE_WINDOWS.map((window) => ({ ...window }));
  }
}

export function normalizeTimezone(timezone?: string | null) {
  const candidate = timezone?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function localWeekdayAndMinute(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTimezone(timezone),
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value || "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return { day: weekdayIndex[weekday] ?? 0, minute: hour * 60 + minute };
}

export function isWithinActiveWindows(
  date: Date,
  windows: readonly ActiveWindow[],
  timezone: string
) {
  const effectiveWindows =
    windows.length > 0 ? windows : DEFAULT_ACTIVE_WINDOWS;
  const local = localWeekdayAndMinute(date, timezone);

  return effectiveWindows.some((window) => {
    const start = timeToMinutes(window.start);
    const end = timeToMinutes(window.end);
    if (start === end) return local.day === window.day;
    if (start < end) {
      return local.day === window.day && local.minute >= start && local.minute < end;
    }
    const previousLocalDay = (local.day + 6) % 7;
    return (
      (local.day === window.day && local.minute >= start) ||
      (window.day === previousLocalDay && local.minute < end)
    );
  });
}

export function nextAllowedTime(
  from: Date,
  windows: readonly ActiveWindow[],
  timezone: string
) {
  if (isWithinActiveWindows(from, windows, timezone)) return new Date(from);

  const minuteMs = 60_000;
  let candidate = new Date(Math.ceil(from.getTime() / minuteMs) * minuteMs);
  const maximumChecks = 8 * 24 * 60;
  for (let index = 0; index < maximumChecks; index += 1) {
    if (isWithinActiveWindows(candidate, windows, timezone)) return candidate;
    candidate = new Date(candidate.getTime() + minuteMs);
  }
  return new Date(from);
}

function boundedRandom(random: () => number) {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}

export function delaySeconds(
  mode: DelayMode,
  customDelaySeconds = 0,
  random: () => number = Math.random
) {
  if (mode === "IMMEDIATE") return 0;
  if (mode === "SHORT") return 30 + Math.floor(boundedRandom(random) * 61);
  if (mode === "LONG") return 300 + Math.floor(boundedRandom(random) * 601);
  const numeric = Number(customDelaySeconds);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(86_400, Math.max(0, Math.round(numeric)));
}

export function scheduledRunAt(input: {
  now: Date;
  delayMode: DelayMode;
  customDelaySeconds?: number;
  activeWindows: readonly ActiveWindow[];
  timezone: string;
  random?: () => number;
}) {
  const delayed = new Date(
    input.now.getTime() +
      delaySeconds(
        input.delayMode,
        input.customDelaySeconds,
        input.random
      ) *
        1000
  );
  return nextAllowedTime(delayed, input.activeWindows, input.timezone);
}
