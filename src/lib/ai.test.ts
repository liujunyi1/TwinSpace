import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateFriendReplyDraft,
  resolveChatCompletionsUrl
} from "@/lib/ai";
import { derivePersonalityProfile } from "@/lib/onboarding";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

describe("generateFriendReplyDraft", () => {
  it("keeps AI_CONTACT separate and includes the latest user message", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:8317/v1");
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL", "test-model");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ text: "独立联系人回复" })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateFriendReplyDraft({
      profileSummary: "正在聊天的用户偏好简短回复",
      conversationTitle: "Orbit",
      recentMessages: ["之前的消息"],
      latestUserMessage: "这是刚刚发送的新消息"
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(body.messages[1].content) as {
      latestUserMessage: string;
      recentMessages: string[];
    };
    expect(payload.latestUserMessage).toBe("这是刚刚发送的新消息");
    expect(payload.recentMessages.at(-1)).toBe("这是刚刚发送的新消息");
    expect(body.messages[0].content).toContain("独立 AI 联系人");
    expect(body.messages[0].content).toContain("不是任何真人用户的分身代理");
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
