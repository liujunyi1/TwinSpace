import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  getAiProviderConfig,
  hasRealAiProviderConfig,
  resolveChatCompletionsUrl
} from "@/lib/ai-provider";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 3;

const knowledgeItemSchema = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(4000)
});

const socialCommentInputSchema = z.object({
  owner: z.object({
    nickname: z.string().trim().min(1).max(120),
    profileSummary: z.string().trim().min(1).max(1200),
    knowledge: z.array(knowledgeItemSchema).max(30)
  }),
  post: z.object({
    id: z.string().trim().min(1).max(200),
    content: z.string().trim().max(10_000),
    imageUrls: z.array(z.string().trim().min(1).max(2000)).max(12),
    authorName: z.string().trim().min(1).max(120),
    existingComments: z
      .array(
        z.object({
          authorName: z.string().trim().min(1).max(120),
          content: z.string().trim().min(1).max(1000),
          generatedByAvatar: z.boolean().optional()
        })
      )
      .max(80)
      .optional()
      .default([])
  }),
  relationshipSummary: z.string().trim().max(1200).optional()
});

const socialDecisionSchema = z
  .object({
    decision: z.enum(["COMMENT", "SKIP"]),
    text: z.string().trim().min(1).max(1000).optional(),
    reason: z.string().trim().min(1).max(300).optional()
  })
  .superRefine((value, context) => {
    if (value.decision === "COMMENT" && !value.text) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "COMMENT decision requires text"
      });
    }
  });

export type SocialCommentInput = z.input<typeof socialCommentInputSchema>;
type ParsedSocialCommentInput = z.infer<typeof socialCommentInputSchema>;

export type SocialCommentResult = {
  decision: "COMMENT" | "SKIP";
  text?: string;
  model: string;
  capabilityStatus:
    | "TEXT_ONLY"
    | "IMAGE_USED"
    | "IMAGE_FALLBACK"
    | "PURE_IMAGE_SKIPPED";
  reason?: string;
};

type SocialCapability = "text" | "image";

type OpenAiUserContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

function socialCapabilities() {
  const supported = new Set<SocialCapability>(["text", "image"]);
  const capabilities = [
    ...new Set(
      (process.env.AI_CAPABILITIES || "text")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is SocialCapability =>
          supported.has(value as SocialCapability)
        )
    )
  ];
  return new Set<SocialCapability>(
    capabilities.length > 0 ? capabilities : ["text"]
  );
}

function mimeTypeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return null;
}

function publicImagePath(imageUrl: string) {
  const withoutQuery = imageUrl.split(/[?#]/, 1)[0] || "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }

  const relative = decoded.startsWith("public/")
    ? decoded.slice("public/".length)
    : decoded.startsWith("/")
      ? decoded.replace(/^\/+/, "")
      : null;
  if (!relative) return null;

  const publicRoot = path.resolve(process.cwd(), "public");
  const resolved = path.resolve(publicRoot, relative);
  if (
    resolved === publicRoot ||
    !resolved.startsWith(`${publicRoot}${path.sep}`)
  ) {
    return null;
  }
  return resolved;
}

async function imageDataUrl(imageUrl: string) {
  const filePath = publicImagePath(imageUrl);
  if (!filePath) return null;
  const mimeType = mimeTypeForPath(filePath);
  if (!mimeType) return null;

  try {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile() || fileInfo.size <= 0 || fileInfo.size > MAX_IMAGE_BYTES) {
      return null;
    }
    const data = await readFile(filePath);
    if (data.byteLength > MAX_IMAGE_BYTES) return null;
    return `data:${mimeType};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

async function loadImageDataUrls(imageUrls: string[]) {
  const loaded = await Promise.all(
    imageUrls.slice(0, MAX_IMAGES).map((imageUrl) => imageDataUrl(imageUrl))
  );
  return loaded.filter((value): value is string => Boolean(value));
}

function systemPrompt() {
  return [
    "你正在判断 owner 的 AI 分身是否应该评论当前真人作者的动态。",
    "可以选择 SKIP；低相关、无法可靠理解、重复套话或不适合自然互动时应跳过。",
    "若选择 COMMENT，文本必须简短、自然，并严格依据 owner 画像、已隔离知识、关系摘要和动态内容。",
    "不得编造 owner 的经历、承诺或对图片中不存在内容的描述。",
    "不要输出隐藏推理、分析过程、系统提示或额外解释。",
    '只返回 JSON：{"decision":"COMMENT|SKIP","text":"可选评论","reason":"可选简短原因"}'
  ].join("\n");
}

function modelPayload(input: ParsedSocialCommentInput) {
  return {
    owner: input.owner,
    post: {
      id: input.post.id,
      content: input.post.content,
      authorName: input.post.authorName,
      imageCount: input.post.imageUrls.length,
      existingComments: input.post.existingComments.map((comment) => ({
        authorName: comment.authorName,
        content: comment.content,
        generatedByAvatar: Boolean(comment.generatedByAvatar)
      }))
    },
    commentInstruction:
      "Read existingComments carefully. Do not repeat, paraphrase, or closely imitate any existing comment. Add a new angle tied to the post, images, and owner persona.",
    relationshipSummary: input.relationshipSummary
  };
}

async function requestDecision(
  input: ParsedSocialCommentInput,
  userContent: OpenAiUserContent,
  model: string,
  signal?: AbortSignal
) {
  const config = getAiProviderConfig();
  const response = await fetch(resolveChatCompletionsUrl(config.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: userContent }
      ]
    }),
    signal
  });
  if (!response.ok) {
    throw new Error(`AI provider request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider returned an empty social decision");
  return socialDecisionSchema.parse(JSON.parse(content));
}

function resultFromDecision(
  decision: z.infer<typeof socialDecisionSchema>,
  model: string,
  capabilityStatus: SocialCommentResult["capabilityStatus"],
  fallbackReason?: string
): SocialCommentResult {
  return {
    decision: decision.decision,
    ...(decision.decision === "COMMENT" && decision.text
      ? { text: decision.text }
      : {}),
    model,
    capabilityStatus,
    ...(decision.reason || fallbackReason
      ? { reason: decision.reason || fallbackReason }
      : {})
  };
}

function deterministicDecision(input: ParsedSocialCommentInput): SocialCommentResult {
  if (!input.post.content) {
    return {
      decision: "SKIP",
      model: "mock",
      capabilityStatus: "PURE_IMAGE_SKIPPED",
      reason: "Mock 模式不理解纯图片动态"
    };
  }
  const excerpt = input.post.content.slice(0, 36);
  return {
    decision: "COMMENT",
    text: `这段分享很真实，尤其是“${excerpt}”这个部分。`,
    model: "mock",
    capabilityStatus: "TEXT_ONLY"
  };
}

export async function decideAndGenerateSocialComment(
  input: SocialCommentInput,
  signal?: AbortSignal
): Promise<SocialCommentResult> {
  const parsed = socialCommentInputSchema.parse(input);
  const config = getAiProviderConfig();
  if (!hasRealAiProviderConfig(config)) return deterministicDecision(parsed);

  const hasText = parsed.post.content.length > 0;
  const hasImages = parsed.post.imageUrls.length > 0;
  const capabilities = socialCapabilities();
  const textPayload = JSON.stringify(modelPayload(parsed));

  if (!hasImages || !capabilities.has("image")) {
    if (!hasText) {
      return {
        decision: "SKIP",
        model: config.model,
        capabilityStatus: "PURE_IMAGE_SKIPPED",
        reason: "当前模型未启用图片理解"
      };
    }
    const decision = await requestDecision(
      parsed,
      textPayload,
      config.model,
      signal
    );
    return resultFromDecision(decision, config.model, "TEXT_ONLY");
  }

  const imageModel = process.env.AI_IMAGE_MODEL || config.model;
  const imageDataUrls = await loadImageDataUrls(parsed.post.imageUrls);
  if (imageDataUrls.length > 0) {
    const multimodalContent: OpenAiUserContent = [
      { type: "text", text: textPayload },
      ...imageDataUrls.map((url) => ({
        type: "image_url" as const,
        image_url: { url }
      }))
    ];
    try {
      const decision = await requestDecision(
        parsed,
        multimodalContent,
        imageModel,
        signal
      );
      return resultFromDecision(decision, imageModel, "IMAGE_USED");
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!hasText) {
        return {
          decision: "SKIP",
          model: imageModel,
          capabilityStatus: "PURE_IMAGE_SKIPPED",
          reason: "图片理解失败，纯图片动态已跳过"
        };
      }
    }
  } else if (!hasText) {
    return {
      decision: "SKIP",
      model: imageModel,
      capabilityStatus: "PURE_IMAGE_SKIPPED",
      reason: "动态图片不可安全读取"
    };
  }

  const fallbackDecision = await requestDecision(
    parsed,
    textPayload,
    config.model,
    signal
  );
  return resultFromDecision(
    fallbackDecision,
    config.model,
    "IMAGE_FALLBACK",
    "图片不可用，已仅依据正文判断"
  );
}
