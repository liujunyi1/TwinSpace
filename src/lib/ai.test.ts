import { describe, expect, it } from "vitest";
import { derivePersonalityProfile } from "@/lib/onboarding";

describe("derivePersonalityProfile", () => {
  it("creates a usable structured profile from onboarding answers", () => {
    const profile = derivePersonalityProfile({
      social_energy: "一个人安静待着",
      logic_feeling: "5",
      directness: "4",
      stress_response: "拆成任务",
      comfort_style: ["先共情", "帮我复盘"],
      tone: ["简短", "理性"],
      emoji: "偶尔用",
      reply_length: "两三句清楚说完",
      interests: ["职业发展", "运动户外"],
      taboos: "财务,家庭",
      avatar_autonomy: "只在我点按钮时帮忙",
      self_traits: "专注,慢热"
    });

    expect(profile.decisionStyle).toBe("逻辑分析型");
    expect(profile.directness).toBe(4);
    expect(profile.boundaries).toContain("财务");
  });
});
