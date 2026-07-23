import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAvatarReplyStream,
  createCalibrationReplyStream,
  getAiCapabilities
} from "@/lib/ai";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function configureRealProvider(capabilities: string) {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:8317/v1");
  vi.stubEnv("AI_API_KEY", "test-key");
  vi.stubEnv("AI_MODEL", "test-model");
  vi.stubEnv("AI_CAPABILITIES", capabilities);
}

describe("getAiCapabilities", () => {
  it("trims, deduplicates, ignores unknown values, and defaults to text", () => {
    vi.stubEnv(
      "AI_CAPABILITIES",
      " text, image, stream, text, unsupported "
    );
    expect(getAiCapabilities()).toEqual(["text", "image", "stream"]);

    vi.stubEnv("AI_CAPABILITIES", "");
    expect(getAiCapabilities()).toEqual(["text"]);
  });
});

describe("AI text streaming", () => {
  it("yields multiple content deltas from an OpenAI-compatible SSE response", async () => {
    configureRealProvider("text,stream");
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"你"}}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n'
          )
        );
        controller.close();
      }
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const result = await createAvatarReplyStream(
      {
        nickname: "小林",
        profileSummary: "表达温和",
        memories: [],
        messages: [{ role: "user", content: "你好" }]
      },
      controller.signal
    );

    expect(result.mode).toBe("stream");
    if (result.mode !== "stream") throw new Error("Expected stream result");
    const chunks: string[] = [];
    for await (const chunk of result.chunks) chunks.push(chunk);
    expect(chunks).toEqual(["你", "好"]);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.signal?.aborted).toBe(false);
    expect(requestBody.stream).toBe(true);
    expect(requestBody).not.toHaveProperty("response_format");
  });

  it("returns a complete result when a stream request receives standard JSON", async () => {
    configureRealProvider("text,stream");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "这是完整正文" } }]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCalibrationReplyStream({
      kind: "DAILY_CHAT",
      scenario: "朋友分享今天的晚霞。",
      profileSummary: "表达温和",
      knowledge: []
    });

    expect(result).toEqual({ mode: "complete", text: "这是完整正文" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the existing complete API when stream capability is disabled", async () => {
    configureRealProvider("text,image");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ text: "完整能力降级" }) } }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCalibrationReplyStream({
      kind: "COMFORT",
      scenario: "朋友说最近有点挫败。",
      profileSummary: "先共情，再给建议",
      knowledge: []
    });

    expect(result).toEqual({ mode: "complete", text: "完整能力降级" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(requestBody).not.toHaveProperty("stream");
    expect(requestBody).toHaveProperty("response_format");
  });
});
