export const CALIBRATION_KINDS = [
  "DAILY_CHAT",
  "COMFORT",
  "REFUSAL",
  "FEED_COMMENT"
] as const;

export type CalibrationKind = (typeof CALIBRATION_KINDS)[number];

export const CALIBRATION_SCENARIOS: Record<
  CalibrationKind,
  { label: string; scenario: string }
> = {
  DAILY_CHAT: {
    label: "日常聊天",
    scenario: "朋友说：今天忙完后去公园走了一圈，没想到晚霞特别好看。"
  },
  COMFORT: {
    label: "安慰朋友",
    scenario: "朋友说：准备了很久的事情还是没做好，我现在有点怀疑自己。"
  },
  REFUSAL: {
    label: "拒绝请求",
    scenario: "朋友临时请你帮一个会占用整个周末的忙，但你已经有自己的安排。"
  },
  FEED_COMMENT: {
    label: "动态评论",
    scenario: "朋友发动态：第一次坚持晨跑满一个月，速度不快，但终于没有半途而废。"
  }
};

export const AVATAR_KNOWLEDGE_CATEGORIES = [
  "PERSONALITY",
  "EXPRESSION_STYLE",
  "INTEREST",
  "BOUNDARY",
  "FACT",
  "RELATIONSHIP",
  "RECENT_EVENT",
  "REPRESENTATIVE_PHRASE"
] as const;

export type AvatarKnowledgeCategory = (typeof AVATAR_KNOWLEDGE_CATEGORIES)[number];

export type AvatarSourceForCompilation = {
  id: string;
  kind: string;
  content: string;
};

export type CompiledAvatarKnowledge = {
  category: AvatarKnowledgeCategory;
  title: string;
  content: string;
  sourceIds: string[];
  confidence: number;
  requiresConfirmation: boolean;
};

const confirmationRequiredCategories = new Set<AvatarKnowledgeCategory>([
  "FACT",
  "RELATIONSHIP",
  "BOUNDARY",
  "RECENT_EVENT"
]);

export function sanitizeCompiledKnowledge(
  items: readonly CompiledAvatarKnowledge[],
  allowedSourceIds: Iterable<string>
) {
  const allowed = new Set(
    [...allowedSourceIds].map((sourceId) => sourceId.trim()).filter(Boolean)
  );
  const sanitized = new Map<string, CompiledAvatarKnowledge>();

  for (const item of items) {
    const title = item.title.trim();
    const content = item.content.trim();
    if (!title || !content) continue;

    const sourceIds = [
      ...new Set(
        item.sourceIds
          .map((sourceId) => sourceId.trim())
          .filter((sourceId) => allowed.has(sourceId))
      )
    ];
    if (sourceIds.length === 0) continue;

    const numericConfidence = Number(item.confidence);
    const confidence = Number.isFinite(numericConfidence)
      ? Math.min(1, Math.max(0, numericConfidence))
      : 0;
    const requiresConfirmation =
      confirmationRequiredCategories.has(item.category) || item.requiresConfirmation;
    const key = `${item.category}\u0000${title.toLocaleLowerCase()}\u0000${content}`;
    const existing = sanitized.get(key);

    if (existing) {
      existing.sourceIds = [...new Set([...existing.sourceIds, ...sourceIds])];
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.requiresConfirmation =
        existing.requiresConfirmation || requiresConfirmation;
      continue;
    }

    sanitized.set(key, {
      category: item.category,
      title,
      content,
      sourceIds,
      confidence,
      requiresConfirmation
    });
  }

  return [...sanitized.values()];
}

export type CalibrationCaseForReadiness = {
  kind: CalibrationKind;
  status: string;
  revision: number;
};

export function isCalibrationComplete(
  cases: readonly CalibrationCaseForReadiness[],
  revision: number
) {
  const approvedKinds = new Set(
    cases
      .filter((item) => item.revision === revision && item.status === "APPROVED")
      .map((item) => item.kind)
  );
  return CALIBRATION_KINDS.every((kind) => approvedKinds.has(kind));
}
