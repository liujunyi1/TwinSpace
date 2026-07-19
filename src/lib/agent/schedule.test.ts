import { describe, expect, it } from "vitest";
import {
  AGENT_TASK_STATES,
  delaySeconds,
  isWithinActiveWindows,
  nextAllowedTime,
  parseActiveWindowsJson,
  scheduledRunAt
} from "@/lib/agent/schedule";

describe("agent schedule", () => {
  it("uses the shared agent task lifecycle", () => {
    expect(AGENT_TASK_STATES).toEqual([
      "PENDING",
      "RUNNING",
      "READY",
      "SUCCEEDED",
      "CANCELLED",
      "FAILED",
      "DELETED"
    ]);
  });

  it("parses valid windows and defaults invalid input to all day", () => {
    expect(
      parseActiveWindowsJson(
        JSON.stringify([{ day: 1, start: "09:00", end: "18:00" }])
      )
    ).toEqual([{ day: 1, start: "09:00", end: "18:00" }]);
    expect(parseActiveWindowsJson("not-json")).toHaveLength(7);
  });

  it("supports overnight windows in an IANA timezone", () => {
    const windows = [{ day: 1, start: "22:00", end: "06:00" }];
    expect(
      isWithinActiveWindows(
        new Date("2026-07-20T15:00:00.000Z"),
        windows,
        "Asia/Shanghai"
      )
    ).toBe(true);
    expect(
      isWithinActiveWindows(
        new Date("2026-07-20T21:00:00.000Z"),
        windows,
        "Asia/Shanghai"
      )
    ).toBe(true);
  });

  it("finds the next allowed minute", () => {
    const next = nextAllowedTime(
      new Date("2026-07-20T00:00:01.000Z"),
      [{ day: 1, start: "09:00", end: "10:00" }],
      "Asia/Shanghai"
    );
    expect(next.toISOString()).toBe("2026-07-20T01:00:00.000Z");
  });

  it("applies deterministic delay ranges before the active window", () => {
    expect(delaySeconds("SHORT", 0, () => 0)).toBe(30);
    expect(delaySeconds("SHORT", 0, () => 0.999)).toBe(90);
    expect(delaySeconds("LONG", 0, () => 0)).toBe(300);
    expect(delaySeconds("LONG", 0, () => 0.999)).toBe(900);
    expect(delaySeconds("CUSTOM", 42)).toBe(42);

    const runAt = scheduledRunAt({
      now: new Date("2026-07-20T00:59:40.000Z"),
      delayMode: "SHORT",
      activeWindows: [{ day: 1, start: "09:00", end: "10:00" }],
      timezone: "Asia/Shanghai",
      random: () => 0
    });
    expect(runAt.toISOString()).toBe("2026-07-20T01:00:10.000Z");
  });
});
