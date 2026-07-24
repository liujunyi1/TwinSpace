import { createHash } from "crypto";
import type { SimulatedPersona } from "@/lib/simulation/personas";

type TargetPost = {
  id: string;
  content: string;
  topicsJson?: string;
  author?: { nickname?: string | null } | null;
};

type ExistingComment = {
  content: string;
};

type TargetMessage = {
  id: string;
  content: string;
  sender?: { nickname?: string | null } | null;
};

function hashIndex(key: string, length: number) {
  if (length <= 0) return 0;
  const digest = createHash("sha256").update(key).digest();
  return digest.readUInt32BE(0) % length;
}

export function deterministicPick<T>(items: T[], key: string) {
  return items[hashIndex(key, items.length)];
}

function normalizedText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?;；:："'“”‘’()[\]{}<>《》]/g, "");
}

function characterBigrams(value: string) {
  const normalized = normalizedText(value);
  if (normalized.length <= 1) return new Set(normalized ? [normalized] : []);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

export function commentSimilarity(first: string, second: string) {
  const firstGrams = characterBigrams(first);
  const secondGrams = characterBigrams(second);
  if (firstGrams.size === 0 || secondGrams.size === 0) return 0;
  let intersection = 0;
  for (const gram of firstGrams) {
    if (secondGrams.has(gram)) intersection += 1;
  }
  return intersection / Math.max(firstGrams.size, secondGrams.size);
}

export function isTooSimilarToExistingComment(
  content: string,
  existingComments: ExistingComment[],
  threshold = 0.52
) {
  const normalized = normalizedText(content);
  if (!normalized) return true;
  return existingComments.some((comment) => {
    const existing = normalizedText(comment.content);
    if (!existing) return false;
    return (
      normalized === existing ||
      normalized.includes(existing) ||
      existing.includes(normalized) ||
      commentSimilarity(normalized, existing) >= threshold
    );
  });
}

function parseTopics(topicsJson?: string) {
  if (!topicsJson) return [];
  try {
    const value = JSON.parse(topicsJson);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function topicHint(persona: SimulatedPersona, post: TargetPost) {
  const topics = parseTopics(post.topicsJson);
  const matched = topics.find((topic) =>
    persona.interests.some((interest) => topic.includes(interest))
  );
  return matched || topics[0] || persona.interests[0] || "这件事";
}

function shortExcerpt(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact;
}

export function buildSimulatedComment(
  persona: SimulatedPersona,
  post: TargetPost,
  variantKey = ""
) {
  const authorName = post.author?.nickname || "你";
  const hint = topicHint(persona, post);
  const templates = [
    `${authorName}这个分享里最有意思的是「${hint}」这一点，能看出不是随手一写。`,
    `看到「${shortExcerpt(post.content)}」这里，我会更想知道后面你怎么推进。`,
    `这条的重点不只是结果，过程里那个小变化其实更打动人。`,
    `如果换个角度看，${hint}背后其实有一个挺清楚的阶段感。`,
    `这条动态很具体，具体到能让人看见你真的往前走了一步。`,
    `我会把这条当成一个小里程碑，语气日常，但信息量不低。`,
    `这里最真实的是你没有把事情说得太满，反而更可信。`,
    `从${persona.occupation}的视角看，这种细节比一句总结更有价值。`,
    `这让我想到${persona.interests[0]}里也常见的一点：真正的变化通常先出现在很小的动作里。`,
    `我喜欢这条里没有刻意煽情的部分，反而更容易让人接住。`,
    `这个瞬间挺值得记下来，之后回头看会知道自己不是原地不动。`,
    `${authorName}，这条让我感觉你已经把一个模糊的状态整理成了可说清的东西。`
  ];
  return deterministicPick(templates, `${persona.key}:comment:${post.id}:${variantKey}`);
}

export function buildDistinctSimulatedComment(
  persona: SimulatedPersona,
  post: TargetPost,
  existingComments: ExistingComment[],
  variantKey = ""
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const content = buildSimulatedComment(persona, post, `${variantKey}:${attempt}`);
    if (!isTooSimilarToExistingComment(content, existingComments, 0.5)) {
      return content;
    }
  }
  return `${persona.nickname}换个角度看，${topicHint(persona, post)}这里还有一点值得继续聊。`;
}

export function buildSimulatedDirectReply(persona: SimulatedPersona, message: TargetMessage) {
  const senderName = message.sender?.nickname || "你";
  const templates = [
    `${senderName}，我看到了。${persona.dmStyle}`,
    `这件事我理解，先不用急着一下子处理完。${persona.dmStyle}`,
    `如果按我的节奏，我会先抓一个最小的下一步。${persona.dmStyle}`,
    `你刚说的「${shortExcerpt(message.content)}」我有印象。${persona.dmStyle}`,
    `我在，先把你最想确认的那一点说出来就好。${persona.dmStyle}`
  ];
  return deterministicPick(templates, `${persona.key}:dm:${message.id}`);
}
