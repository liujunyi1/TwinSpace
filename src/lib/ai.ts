import "server-only";

import { z } from "zod";
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

async function openAiCompatibleJson<T>(
  schema: z.ZodSchema<T>,
  system: string,
  user: string
): Promise<T | null> {
  const config = aiConfig();
  if (config.provider === "mock" || !config.apiKey || !config.baseUrl) return null;

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
  const ai = await openAiCompatibleJson(
    personalityProfileSchema,
    "你是社交产品的人格画像抽取器。只返回 JSON，不要输出解释。不得编造用户未提供的事实。",
    JSON.stringify({ answers })
  );
  return ai ?? derivePersonalityProfile(answers);
}

export async function generateAvatarReply(context: {
  nickname: string;
  profileSummary: string;
  memories: string[];
  messages: ChatMessage[];
}) {
  const lastUserMessage = [...context.messages].reverse().find((message) => message.role === "user")?.content || "";
  const ai = await openAiCompatibleJson(
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
  const ai = await openAiCompatibleJson(
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
  const ai = await openAiCompatibleJson(
    textResponseSchema,
    "你是社交评论草稿助手。评论必须由用户确认后才可发布。只返回 JSON。",
    JSON.stringify(context)
  );
  return ai?.text || "这条我有共鸣，尤其是后半段那个转折，很真实。";
}
