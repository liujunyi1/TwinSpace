import { describe, expect, it, vi } from "vitest";
import { resolveChatCompletionsUrl } from "@/lib/ai";
import { derivePersonalityProfile } from "@/lib/onboarding";

vi.mock("server-only", () => ({}));

describe("resolveChatCompletionsUrl", () => {
  it("normalizes API roots, model-list endpoints, and complete endpoints", () => {
    expect(resolveChatCompletionsUrl("http://127.0.0.1:8317/v1")).toBe(
      "http://127.0.0.1:8317/v1/chat/completions"
    );
    expect(resolveChatCompletionsUrl("http://127.0.0.1:8317/v1/models/")).toBe(
      "http://127.0.0.1:8317/v1/chat/completions"
    );
    expect(
      resolveChatCompletionsUrl(
        "http://127.0.0.1:8317/v1/chat/completions/"
      )
    ).toBe("http://127.0.0.1:8317/v1/chat/completions");
  });
});

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

  it("preserves tone, expression rules, and friend AI level", () => {
    const profile = derivePersonalityProfile({
      social_energy: "找熟悉的人聊聊",
      logic_feeling: "3",
      directness: "99",
      tone: ["温和", "幽默"],
      expression_rules: "不要太官方，少用感叹号",
      friend_ai_level: "我开启后可托管"
    });

    expect(profile.directness).toBe(5);
    expect(profile.tone).toEqual(["温和", "幽默"]);
    expect(profile.expressionRules).toBe("不要太官方，少用感叹号");
    expect(profile.friendAiLevel).toBe("我开启后可托管");
    expect(profile.communicationStyle).toContain("温和、幽默");
    expect(profile.communicationStyle).toContain("少用感叹号");
  });
});
