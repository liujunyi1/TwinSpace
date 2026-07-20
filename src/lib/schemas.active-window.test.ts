import { describe, expect, it } from "vitest";
import {
  agentActiveWindowSchema,
  conversationAgentSettingsSchema
} from "@/lib/schemas";

const baseSettings = {
  conversationId: "conversation-1",
  modeOverride: "INHERIT" as const,
  delayOverride: "INHERIT" as const,
  customDelaySeconds: 60,
  receiveAiFromContact: "INHERIT" as const
};

describe("agent active-window time semantics", () => {
  it.each([
    {
      label: "an all-day window",
      window: { weekday: 1, start: "00:00", end: "00:00" }
    },
    {
      label: "a same-day window",
      window: { weekday: 2, start: "09:00", end: "18:00" }
    },
    {
      label: "an overnight window",
      window: { weekday: 5, start: "22:00", end: "06:00" }
    }
  ])("accepts $label", ({ window }) => {
    expect(agentActiveWindowSchema.safeParse(window).success).toBe(true);
  });

  it.each([
    { weekday: -1, start: "09:00", end: "18:00" },
    { weekday: 7, start: "09:00", end: "18:00" },
    { weekday: 1, start: "24:00", end: "18:00" },
    { weekday: 1, start: "09:00", end: "6:00" }
  ])("rejects an invalid weekday or HH:mm value: %o", (window) => {
    expect(agentActiveWindowSchema.safeParse(window).success).toBe(false);
  });
});

describe("conversation active-window validation by mode", () => {
  it.each(["INHERIT", "ALWAYS", "CUSTOM"] as const)(
    "still validates hidden windows in %s mode",
    (activeWindowMode) => {
      const result = conversationAgentSettingsSchema.safeParse({
        ...baseSettings,
        activeWindowMode,
        activeWindows: [{ weekday: 1, start: "25:00", end: "06:00" }]
      });

      expect(result.success).toBe(false);
    }
  );

  it.each(["INHERIT", "ALWAYS", "CUSTOM"] as const)(
    "accepts overnight windows in %s mode",
    (activeWindowMode) => {
      const result = conversationAgentSettingsSchema.safeParse({
        ...baseSettings,
        activeWindowMode,
        activeWindows: [{ weekday: 1, start: "22:00", end: "06:00" }]
      });

      expect(result.success).toBe(true);
    }
  );
});
