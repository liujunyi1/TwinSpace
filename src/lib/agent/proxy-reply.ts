import { z } from "zod";
import {
  callStructuredStrict,
  getAiProviderConfig,
  hasRealAiProviderConfig
} from "@/lib/ai-provider";

const boundedText = (max: number) => z.string().trim().min(1).max(max);

const proxyReplyInputSchema = z.object({
  owner: z.object({
    nickname: boundedText(120),
    profileSummary: boundedText(1200)
  }),
  conversationTitle: boundedText(200),
  incomingMessages: z
    .array(
      z.object({
        id: boundedText(200),
        content: boundedText(4000),
        createdAt: boundedText(100),
        senderName: boundedText(120)
      })
    )
    .min(1)
    .max(20),
  recentMessages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: boundedText(4000)
      })
    )
    .max(40),
  knowledge: z
    .array(
      z.object({
        id: boundedText(200),
        title: boundedText(200),
        content: boundedText(4000)
      })
    )
    .max(40),
  mode: z.enum(["ASSIST", "PROXY"]),
  expressionRules: z
    .union([boundedText(1000), z.array(boundedText(200)).max(20)])
    .optional()
});

const proxyReplyResponseSchema = z.object({
  text: boundedText(2000)
});

export type GenerateProxyReplyInput = z.infer<typeof proxyReplyInputSchema>;

export type GenerateAssistDraftInput = Omit<GenerateProxyReplyInput, "mode">;

export type ProxyReplyResult = {
  text: string;
  model: string;
};

function deterministicReply(input: GenerateProxyReplyInput): ProxyReplyResult {
  const incoming = input.incomingMessages
    .map((message) => message.content)
    .join("；")
    .slice(0, 80);
  const text =
    input.mode === "ASSIST"
      ? `我看到你提到“${incoming}”。我想先确认一下你的意思，再认真回复你。`
      : `我看到你说的“${incoming}”了。让我按现在的情况想一下，再和你说。`;
  return { text, model: "mock" };
}

function proxySystemPrompt(mode: GenerateProxyReplyInput["mode"]) {
  return [
    "你代表 payload.owner 对当前这一位真人联系人写一条回复。",
    "owner 是被代理的真实用户；你不是独立 AI 联系人，也不能改变发言归属。",
    "incomingMessages 是本次必须回复的连续新消息，每一条都要纳入理解；只能响应这些消息，不能主动发起新话题或连续追发。",
    "recentMessages 中 user 表示当前联系人，assistant 表示 owner 先前发送的内容。",
    "knowledge 已由服务端按 owner 和当前联系人完成权限与关系隔离，只能使用其中内容，不得推断、索取或提及其他联系人的关系知识。",
    mode === "ASSIST"
      ? "当前模式是 ASSIST：生成一条等待 owner 确认的草稿，不要声称已经发送。"
      : "当前模式是 PROXY：生成一条可直接代表 owner 发送的完整回复。",
    "遵循 expressionRules（如有），不得编造 owner 未提供的经历、事实、承诺或行动。",
    "不要输出隐藏推理、分析过程、身份说明、JSON 之外的解释。",
    '只返回 JSON：{"text":"完整回复正文"}'
  ].join("\n");
}

export async function generateProxyReply(
  input: GenerateProxyReplyInput,
  signal?: AbortSignal
): Promise<ProxyReplyResult> {
  const parsed = proxyReplyInputSchema.parse(input);
  const config = getAiProviderConfig();
  if (!hasRealAiProviderConfig(config)) return deterministicReply(parsed);

  const result = await callStructuredStrict(
    proxyReplyResponseSchema,
    proxySystemPrompt(parsed.mode),
    JSON.stringify(parsed),
    signal
  );
  return { text: result.value.text, model: result.model };
}

export function generateAssistDraft(
  input: GenerateAssistDraftInput,
  signal?: AbortSignal
) {
  return generateProxyReply({ ...input, mode: "ASSIST" }, signal);
}
