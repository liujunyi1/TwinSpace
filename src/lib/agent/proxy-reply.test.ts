import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateAssistDraft,
  generateProxyReply,
  type GenerateProxyReplyInput
} from "@/lib/agent/proxy-reply";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function input(mode: "ASSIST" | "PROXY" = "PROXY"): GenerateProxyReplyInput {
  return {
    owner: {
      nickname: "林澈",
      profileSummary: "表达温和、简短，先回应感受再讨论行动。"
    },
    conversationTitle: "林澈与青络",
    incomingMessages: [
      {
        id: "message-1",
        content: "今天工作有点不顺。",
        createdAt: "2026-07-19T10:00:00.000Z",
        senderName: "青络"
      },
      {
        id: "message-2",
        content: "你有空的时候想听听你的看法。",
        createdAt: "2026-07-19T10:00:05.000Z",
        senderName: "青络"
      }
    ],
    recentMessages: [
      { role: "user", content: "最近项目快收尾了吗？" },
      { role: "assistant", content: "还在收尾，我会尽量把节奏稳住。" }
    ],
    knowledge: [
      {
        id: "relationship-current-contact",
        title: "与青络的沟通方式",
        content: "适合先共情，再给一个简短建议。"
      },
      {
        id: "general-style",
        title: "通用表达",
        content: "少用感叹号，不做未经确认的承诺。"
      }
    ],
    mode,
    expressionRules: "两三句说清楚"
  };
}

function configureRealProvider() {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:8317/v1");
  vi.stubEnv("AI_API_KEY", "test-key");
  vi.stubEnv("AI_MODEL", "test-model");
}

describe("generateProxyReply", () => {
  it("uses every trigger message and only the caller-isolated knowledge payload", async () => {
    configureRealProvider();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({ text: "听起来今天确实不太顺。你愿意的话，可以先说说最卡的是哪一段。" })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateProxyReply(input());

    expect(result).toEqual({
      text: "听起来今天确实不太顺。你愿意的话，可以先说说最卡的是哪一段。",
      model: "test-model"
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const payload = JSON.parse(body.messages[1].content) as GenerateProxyReplyInput;
    expect(payload.incomingMessages.map((message) => message.id)).toEqual([
      "message-1",
      "message-2"
    ]);
    expect(payload.knowledge.map((item) => item.id)).toEqual([
      "relationship-current-contact",
      "general-style"
    ]);
    expect(body.messages[0].content).toContain("当前这一位真人联系人");
    expect(body.messages[0].content).toContain("不能主动发起新话题");
    expect(body.messages[0].content).toContain("不要输出隐藏推理");
  });

  it("throws instead of falling back when a configured provider request fails", async () => {
    configureRealProvider();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        throw new Error("network unavailable");
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateProxyReply(input())).rejects.toThrow("network unavailable");
  });

  it("returns deterministic mock output only in mock mode", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 500 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await generateProxyReply(input());
    const second = await generateProxyReply(input());
    const assistInput = input("ASSIST");
    const assist = await generateAssistDraft({
      owner: assistInput.owner,
      conversationTitle: assistInput.conversationTitle,
      incomingMessages: assistInput.incomingMessages,
      recentMessages: assistInput.recentMessages,
      knowledge: assistInput.knowledge,
      expressionRules: assistInput.expressionRules
    });

    expect(first).toEqual(second);
    expect(first.model).toBe("mock");
    expect(first.text).toContain("今天工作有点不顺");
    expect(assist.model).toBe("mock");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
