import { describe, expect, it } from "vitest";
import {
  isCalibrationComplete,
  sanitizeCompiledKnowledge,
  type CalibrationCaseForReadiness,
  type CompiledAvatarKnowledge
} from "@/lib/agent/knowledge";

describe("sanitizeCompiledKnowledge", () => {
  it("filters unknown sources, forces confirmation, clamps confidence, and deduplicates", () => {
    const items: CompiledAvatarKnowledge[] = [
      {
        category: "FACT",
        title: " 常住城市 ",
        content: " 上海 ",
        sourceIds: ["source-1", "unknown"],
        confidence: 2,
        requiresConfirmation: false
      },
      {
        category: "FACT",
        title: "常住城市",
        content: "上海",
        sourceIds: ["source-2"],
        confidence: 0.5,
        requiresConfirmation: false
      },
      {
        category: "PERSONALITY",
        title: " ",
        content: "应被删除",
        sourceIds: ["source-1"],
        confidence: 0.8,
        requiresConfirmation: false
      }
    ];

    const result = sanitizeCompiledKnowledge(items, ["source-1", "source-2"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: "FACT",
      title: "常住城市",
      content: "上海",
      confidence: 1,
      requiresConfirmation: true
    });
    expect(result[0].sourceIds).toEqual(["source-1", "source-2"]);
  });
});

describe("isCalibrationComplete", () => {
  it("requires all four approved kinds from the same revision", () => {
    const cases: CalibrationCaseForReadiness[] = [
      { kind: "DAILY_CHAT", status: "APPROVED", revision: 2 },
      { kind: "COMFORT", status: "APPROVED", revision: 2 },
      { kind: "REFUSAL", status: "APPROVED", revision: 2 },
      { kind: "FEED_COMMENT", status: "APPROVED", revision: 1 }
    ];

    expect(isCalibrationComplete(cases, 2)).toBe(false);
    expect(
      isCalibrationComplete(
        [...cases, { kind: "FEED_COMMENT", status: "APPROVED", revision: 2 }],
        2
      )
    ).toBe(true);
    expect(
      isCalibrationComplete(
        [...cases, { kind: "FEED_COMMENT", status: "REJECTED", revision: 2 }],
        2
      )
    ).toBe(false);
  });
});
