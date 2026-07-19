import "server-only";

import { z } from "zod";
import {
  AVATAR_KNOWLEDGE_CATEGORIES,
  sanitizeCompiledKnowledge,
  type AvatarSourceForCompilation,
  type CalibrationKind,
  type CompiledAvatarKnowledge
} from "@/lib/agent/knowledge";
import { derivePersonalityProfile, personalityProfileSchema } from "@/lib/onboarding";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const textResponseSchema = z.object({ text: z.string().min(1) });

function aiConfig() {
  const provider = process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "mock");
  return {
    provider,
    baseUrl: process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "",
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
    model: process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini"
  };
}

export function resolveChatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  if (/\/chat\/completions$/i.test(normalized)) return normalized;

  const apiRoot = normalized.replace(/\/models$/i, "");
  return `${apiRoot}/chat/completions`;
}

async function callStructured<T>(
  schema: z.ZodSchema<T>,
  system: string,
  user: string
): Promise<T | null> {
  const config = aiConfig();
  if (config.provider === "mock" || !config.apiKey || !config.baseUrl) return null;

  try {
    const response = await fetch(resolveChatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return schema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function extractPersonalityProfile(answers: Record<string, string | string[]>) {
  const derived = derivePersonalityProfile(answers);
  const ai = await callStructured(
    personalityProfileSchema,
    "你是社交产品的人格画像抽取器。只返回 JSON，不要输出解释。不得编造用户未提供的事实。必须原样保留 tone、expressionRules 和 friendAiLevel 对应的用户答案。",
    JSON.stringify({ answers })
  );
  if (!ai) return derived;
  return personalityProfileSchema.parse({
    ...ai,
    tone: derived.tone,
    expressionRules: derived.expressionRules,
    friendAiLevel: derived.friendAiLevel
  });
}

export async function generateAvatarReply(context: {
  nickname: string;
  profileSummary: string;
  memories: string[];
  messages: ChatMessage[];
}) {
  const lastUserMessage = [...context.messages].reverse().find((message) => message.role === "user")?.content || "";
  const ai = await callStructured(
    textResponseSchema,
    "你是用户的数字分身聊天助手。不能假装自己是真人，不编造事实，不输出心理诊断或危险建议。只返回 JSON：{\"text\":\"...\"}",
    JSON.stringify(context)
  );
  return (
    ai?.text ||
    `我会按你的风格先接住这件事：${lastUserMessage.slice(0, 48)}。从你的画像看，先把感受和可执行的小步骤分开会更稳。`
  );
}

export async function generateFriendReplyDraft(context: {
  profileSummary: string;
  conversationTitle: string;
  recentMessages: string[];
}) {
  const ai = await callStructured(
    textResponseSchema,
    "你是朋友聊天回复草稿助手。只生成可由用户确认后发送的草稿。只返回 JSON。",
    JSON.stringify(context)
  );
  return ai?.text || "我懂你的意思。要不我们先把最紧急的点对齐一下，我再看看怎么帮你。";
}

export async function generateCommentDraft(context: {
  profileSummary: string;
  postContent: string;
}) {
  const ai = await callStructured(
    textResponseSchema,
    "你是社交评论草稿助手。评论必须由用户确认后才可发布。只返回 JSON。",
    JSON.stringify(context)
  );
  return ai?.text || "这条我有共鸣，尤其是后半段那个转折，很真实。";
}

const compiledKnowledgeResponseSchema = z.object({
  items: z
    .array(
      z.object({
        category: z.enum(AVATAR_KNOWLEDGE_CATEGORIES),
        title: z.string().trim().min(1).max(120),
        content: z.string().trim().min(1).max(1600),
        sourceIds: z.array(z.string().trim().min(1)).min(1).max(30),
        confidence: z.number(),
        requiresConfirmation: z.boolean()
      })
    )
    .max(80)
});

export type CompileAvatarKnowledgeInput = {
  profileSummary: string;
  communicationStyle: string;
  socialStyle: string;
  emotionalStyle: string;
  replyLength: string;
  emojiPreference: string;
  sources: AvatarSourceForCompilation[];
};

function normalizedCompilationSources(sources: AvatarSourceForCompilation[]) {
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    const id = source.id.trim();
    const content = source.content.trim();
    if (!id || !content || seen.has(id)) return [];
    seen.add(id);
    return [{ id, kind: source.kind.trim(), content }];
  });
}

function localCompiledKnowledge(
  input: Omit<CompileAvatarKnowledgeInput, "sources"> & {
    sources: AvatarSourceForCompilation[];
  }
): CompiledAvatarKnowledge[] {
  const items: CompiledAvatarKnowledge[] = [];
  const profileSource =
    input.sources.find((source) => source.kind.toUpperCase().includes("QUESTION")) ??
    input.sources[0];

  if (profileSource) {
    items.push({
      category: "PERSONALITY",
      title: "人格画像",
      content: [input.profileSummary, input.socialStyle, input.emotionalStyle].filter(Boolean).join("；"),
      sourceIds: [profileSource.id],
      confidence: 0.9,
      requiresConfirmation: false
    });
    items.push({
      category: "EXPRESSION_STYLE",
      title: "表达风格",
      content: [
        input.communicationStyle,
        `偏好回复长度：${input.replyLength}`,
        `表情使用偏好：${input.emojiPreference}`
      ]
        .filter(Boolean)
        .join("；"),
      sourceIds: [profileSource.id],
      confidence: 0.9,
      requiresConfirmation: false
    });
  }

  for (const source of input.sources) {
    if (source.id === profileSource?.id) continue;
    const kind = source.kind.toUpperCase();
    const category: CompiledAvatarKnowledge["category"] = kind.includes("MESSAGE") || kind.includes("SAMPLE")
      ? "REPRESENTATIVE_PHRASE"
      : kind.includes("POST")
        ? "INTEREST"
        : "FACT";
    const title =
      category === "REPRESENTATIVE_PHRASE"
        ? "代表性表达"
        : category === "INTEREST"
          ? "兴趣与动态表达"
          : "已确认素材";
    items.push({
      category,
      title,
      content: source.content.slice(0, 1600),
      sourceIds: [source.id],
      confidence: kind.includes("MEMORY") ? 0.9 : 0.75,
      requiresConfirmation: category === "FACT"
    });
  }

  return items;
}

export async function compileAvatarKnowledge(
  input: CompileAvatarKnowledgeInput
): Promise<CompiledAvatarKnowledge[]> {
  const sources = normalizedCompilationSources(input.sources);
  if (sources.length === 0) return [];

  const allowedSourceIds = sources.map((source) => source.id);
  const ai = await callStructured(
    compiledKnowledgeResponseSchema,
    [
      "你是 AI 分身知识编译器，只返回 JSON。",
      "输出格式为 {\"items\":[...]}。",
      `category 只能是：${AVATAR_KNOWLEDGE_CATEGORIES.join("、")}。`,
      "sourceIds 只能引用输入中存在的来源 ID，不得编造事实或来源。",
      "事实、关系、边界、近期事件必须设置 requiresConfirmation=true。"
    ].join(""),
    JSON.stringify({ ...input, sources })
  );

  const fallback = localCompiledKnowledge({ ...input, sources });
  return sanitizeCompiledKnowledge(ai?.items ?? fallback, allowedSourceIds);
}

export type GenerateCalibrationReplyInput = {
  kind: CalibrationKind;
  scenario: string;
  profileSummary: string;
  knowledge: Array<{
    id: string;
    category: string;
    title: string;
    content: string;
  }>;
};

const calibrationFallbacks: Record<CalibrationKind, string> = {
  DAILY_CHAT: "听起来你今天过得挺充实的，哪一段让你印象最深？",
  COMFORT: "听起来这件事确实挺让人挫败的。先缓一缓也没关系，等你愿意时我们再一起理清楚。",
  REFUSAL: "这次我可能没办法答应，希望你能理解。如果有别的合适方式，我可以再看看。",
  FEED_COMMENT: "这段分享很真实，尤其是你提到的变化，让人很有共鸣。"
};

export async function generateCalibrationReply(
  input: GenerateCalibrationReplyInput
): Promise<string> {
  const knowledge = input.knowledge
    .filter((item) => item.id.trim() && item.content.trim())
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      content: item.content
    }));
  const ai = await callStructured(
    textResponseSchema,
    "你正在生成 AI 分身校准样例。严格依据画像和提供的知识，以用户可评估的自然口吻作答，不得编造经历。只返回 JSON：{\"text\":\"...\"}",
    JSON.stringify({ ...input, knowledge })
  );
  return ai?.text || calibrationFallbacks[input.kind];
}
