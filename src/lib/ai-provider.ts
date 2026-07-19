import type { ZodSchema } from "zod";

export type AiProviderConfig = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function getAiProviderConfig(): AiProviderConfig {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  return {
    provider: process.env.AI_PROVIDER || (apiKey ? "openai" : "mock"),
    baseUrl: process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "",
    apiKey,
    model: process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini"
  };
}

export function hasRealAiProviderConfig(config = getAiProviderConfig()) {
  return config.provider !== "mock" && Boolean(config.apiKey) && Boolean(config.baseUrl);
}

export function resolveChatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  if (/\/chat\/completions$/i.test(normalized)) return normalized;

  const apiRoot = normalized.replace(/\/models$/i, "");
  return `${apiRoot}/chat/completions`;
}

export async function callStructuredStrict<T>(
  schema: ZodSchema<T>,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<{ value: T; model: string }> {
  const config = getAiProviderConfig();
  if (!hasRealAiProviderConfig(config)) {
    throw new Error("AI provider is not fully configured");
  }

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
  if (!content) throw new Error("AI provider returned an empty response");

  return {
    value: schema.parse(JSON.parse(content)),
    model: config.model
  };
}
