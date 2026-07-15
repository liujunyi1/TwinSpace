import { z } from "zod";

export type QuestionKind = "single" | "scale" | "multi" | "text";

export type OnboardingQuestion = {
  key: string;
  title: string;
  helper?: string;
  kind: QuestionKind;
  options?: string[];
};

export const onboardingQuestions: OnboardingQuestion[] = [
  {
    key: "social_energy",
    title: "一个空下来的晚上，你更想怎么恢复能量？",
    kind: "single",
    options: ["一个人安静待着", "找熟悉的人聊聊", "去人多的地方转一圈"]
  },
  {
    key: "logic_feeling",
    title: "做重要决定时，你更依赖哪一边？",
    kind: "scale",
    helper: "1 偏感受，5 偏逻辑"
  },
  {
    key: "directness",
    title: "你平时表达观点有多直接？",
    kind: "scale",
    helper: "1 很委婉，5 很直接"
  },
  {
    key: "stress_response",
    title: "压力上来时，你通常会先做什么？",
    kind: "single",
    options: ["拆成任务", "找人倾诉", "先躲开缓一缓", "直接硬扛"]
  },
  {
    key: "comfort_style",
    title: "你希望别人怎么安慰你？",
    kind: "multi",
    options: ["先共情", "给建议", "陪我吐槽", "帮我复盘", "少说教"]
  },
  {
    key: "tone",
    title: "你的常用聊天语气更接近？",
    kind: "multi",
    options: ["简短", "温和", "幽默", "理性", "热情", "克制"]
  },
  {
    key: "emoji",
    title: "你喜欢在消息里使用表情吗？",
    kind: "single",
    options: ["经常用", "偶尔用", "几乎不用"]
  },
  {
    key: "reply_length",
    title: "你更偏好的回复长度？",
    kind: "single",
    options: ["一句话就好", "两三句清楚说完", "可以展开讲"]
  },
  {
    key: "interests",
    title: "你感兴趣的话题有哪些？",
    kind: "multi",
    options: ["学习成长", "职业发展", "电影音乐", "运动户外", "游戏动漫", "心理与关系", "城市生活"]
  },
  {
    key: "taboos",
    title: "不希望 AI 或朋友轻易涉及的话题？",
    kind: "text",
    helper: "例如隐私、家庭、财务、外貌评价等"
  },
  {
    key: "avatar_autonomy",
    title: "你能接受分身主动到什么程度？",
    kind: "single",
    options: ["只在我点按钮时帮忙", "可以提醒和建议", "可在低风险场景代我处理"]
  },
  {
    key: "friend_ai_level",
    title: "朋友聊天里，你希望 AI 默认参与程度是？",
    kind: "single",
    options: ["默认不参与", "只生成草稿", "我开启后可托管"]
  },
  {
    key: "self_traits",
    title: "你觉得自己最明显的三个性格特点是什么？",
    kind: "text"
  },
  {
    key: "expression_rules",
    title: "希望分身保留或避免哪些表达习惯？",
    kind: "text",
    helper: "例如不要太官方、少用感叹号、保留一点幽默感"
  }
];

export const personalityProfileSchema = z.object({
  summary: z.string(),
  traits: z.array(z.string()),
  extroversion: z.number().min(1).max(5),
  emotionalExpression: z.number().min(1).max(5),
  decisionStyle: z.string(),
  directness: z.number().min(1).max(5),
  socialInitiative: z.number().min(1).max(5),
  replyLength: z.string(),
  emojiPreference: z.string(),
  interestTopics: z.array(z.string()),
  comfortPreference: z.array(z.string()),
  boundaries: z.array(z.string()),
  avatarAutonomyLevel: z.string(),
  communicationStyle: z.string(),
  socialStyle: z.string(),
  emotionalStyle: z.string()
});

export type PersonalityProfileResult = z.infer<typeof personalityProfileSchema>;

export function normalizeAnswers(formData: FormData) {
  const answers: Record<string, string | string[]> = {};
  for (const question of onboardingQuestions) {
    if (question.kind === "multi") {
      answers[question.key] = formData.getAll(question.key).map(String).filter(Boolean);
    } else {
      answers[question.key] = String(formData.get(question.key) || "");
    }
  }
  return answers;
}

function asNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : String(value || "").split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean);
}

export function derivePersonalityProfile(
  answers: Record<string, string | string[]>
): PersonalityProfileResult {
  const socialEnergy = String(answers.social_energy || "");
  const extroversion = socialEnergy.includes("人多")
    ? 5
    : socialEnergy.includes("聊")
      ? 4
      : 2;
  const directness = asNumber(answers.directness, 3);
  const logic = asNumber(answers.logic_feeling, 3);
  const tones = asArray(answers.tone);
  const interests = asArray(answers.interests);
  const comfort = asArray(answers.comfort_style);
  const boundaries = asArray(answers.taboos);
  const selfTraits = asArray(answers.self_traits).slice(0, 3);

  const communicationStyle =
    directness >= 4
      ? "表达清楚直接，适合先给结论再补充理由"
      : "表达相对委婉，适合先确认感受再给建议";
  const decisionStyle = logic >= 4 ? "逻辑分析型" : logic <= 2 ? "感受优先型" : "逻辑与感受平衡型";
  const emotionalStyle = comfort.includes("先共情") ? "需要先被理解，再进入解决问题" : "更重视有效建议和可执行行动";
  const replyLength = String(answers.reply_length || "两三句清楚说完");
  const emojiPreference = String(answers.emoji || "偶尔用");
  const avatarAutonomyLevel = String(answers.avatar_autonomy || "只在我点按钮时帮忙");

  const traits = [
    ...selfTraits,
    logic >= 4 ? "理性" : "敏感",
    directness >= 4 ? "坦率" : "细腻",
    extroversion >= 4 ? "社交型" : "内省型"
  ]
    .filter(Boolean)
    .slice(0, 6);

  return personalityProfileSchema.parse({
    summary: `你更像一个${decisionStyle}的人，${communicationStyle}。在社交上偏${extroversion >= 4 ? "主动连接" : "保留边界"}，压力下通常会${answers.stress_response || "先稳定自己"}。`,
    traits,
    extroversion,
    emotionalExpression: comfort.includes("陪我吐槽") ? 4 : 3,
    decisionStyle,
    directness,
    socialInitiative: extroversion,
    replyLength,
    emojiPreference,
    interestTopics: interests,
    comfortPreference: comfort,
    boundaries,
    avatarAutonomyLevel,
    communicationStyle,
    socialStyle: extroversion >= 4 ? "愿意回应和发起互动" : "更重视熟人和低压力互动",
    emotionalStyle
  });
}
