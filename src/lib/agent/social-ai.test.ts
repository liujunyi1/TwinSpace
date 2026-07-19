import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideAndGenerateSocialComment,
  type SocialCommentInput
} from "@/lib/agent/social-ai";

const files = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  readFile: files.readFile,
  stat: files.stat
}));

beforeEach(() => {
  files.readFile.mockReset();
  files.stat.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function input(overrides?: Partial<SocialCommentInput["post"]>): SocialCommentInput {
  return {
    owner: {
      nickname: "林澈",
      profileSummary: "表达温和、简短。",
      knowledge: [
        { id: "style-1", title: "表达风格", content: "少用感叹号。" }
      ]
    },
    post: {
      id: "post-1",
      content: "第一次坚持晨跑满一个月，终于没有半途而废。",
      imageUrls: [],
      authorName: "青络",
      ...overrides
    },
    relationshipSummary: "双方是经常交流近况的朋友。"
  };
}

function configureReal(capabilities: string) {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:8317/v1");
  vi.stubEnv("AI_API_KEY", "test-key");
  vi.stubEnv("AI_MODEL", "text-model");
  vi.stubEnv("AI_CAPABILITIES", capabilities);
}

function decisionResponse(text = "坚持一个月很不容易，这个节奏很稳。") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ decision: "COMMENT", text })
          }
        }
      ]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("decideAndGenerateSocialComment", () => {
  it("uses a strict text-only request for a text post", async () => {
    configureReal("text");
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        decisionResponse()
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await decideAndGenerateSocialComment(input());

    expect(result.capabilityStatus).toBe("TEXT_ONLY");
    expect(result.model).toBe("text-model");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      messages: Array<{ content: unknown }>;
    };
    expect(typeof body.messages[1].content).toBe("string");
  });

  it("loads a local public image and sends multimodal content", async () => {
    configureReal("text,image");
    vi.stubEnv("AI_IMAGE_MODEL", "image-model");
    files.stat.mockResolvedValue({
      size: 3,
      isFile: () => true
    });
    files.readFile.mockResolvedValue(Buffer.from([1, 2, 3]));
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        decisionResponse("图文一起看更能感受到这一个月的坚持。")
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await decideAndGenerateSocialComment(
      input({ imageUrls: ["/uploads/run.png"] })
    );

    expect(result.capabilityStatus).toBe("IMAGE_USED");
    expect(result.model).toBe("image-model");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      model: string;
      messages: Array<{
        content: Array<{
          type: string;
          image_url?: { url: string };
        }>;
      }>;
    };
    expect(body.model).toBe("image-model");
    expect(body.messages[1].content[1].image_url?.url).toMatch(
      /^data:image\/png;base64,/
    );
  });

  it("retries once with text after an image request fails", async () => {
    configureReal("text,image");
    files.stat.mockResolvedValue({
      size: 3,
      isFile: () => true
    });
    files.readFile.mockResolvedValue(Buffer.from([1, 2, 3]));
    let callCount = 0;
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => {
        callCount += 1;
        return callCount === 1
          ? new Response(null, { status: 500 })
          : decisionResponse("只看正文也值得为这份坚持点赞。");
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await decideAndGenerateSocialComment(
      input({ imageUrls: ["/uploads/run.webp"] })
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.capabilityStatus).toBe("IMAGE_FALLBACK");
    expect(result.model).toBe("text-model");
    const secondRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const secondBody = JSON.parse(String(secondRequest.body)) as {
      messages: Array<{ content: unknown }>;
    };
    expect(typeof secondBody.messages[1].content).toBe("string");
  });

  it("skips a pure-image post when image capability is unavailable", async () => {
    configureReal("text");
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        decisionResponse()
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await decideAndGenerateSocialComment(
      input({ content: "", imageUrls: ["/uploads/photo.jpg"] })
    );

    expect(result.decision).toBe("SKIP");
    expect(result.capabilityStatus).toBe("PURE_IMAGE_SKIPPED");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(files.readFile).not.toHaveBeenCalled();
  });

  it("ignores unknown capabilities and falls back to text capability", async () => {
    configureReal("video,unknown,stream");
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        decisionResponse()
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await decideAndGenerateSocialComment(input());

    expect(result.capabilityStatus).toBe("TEXT_ONLY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns deterministic output in mock mode without fs or fetch", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        decisionResponse()
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await decideAndGenerateSocialComment(input());
    const second = await decideAndGenerateSocialComment(input());

    expect(first).toEqual(second);
    expect(first.model).toBe("mock");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(files.readFile).not.toHaveBeenCalled();
  });
});
