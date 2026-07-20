import { z } from "zod";

export const registerSchema = z
  .object({
    username: z.string().min(3, "用户名至少 3 个字符").max(24),
    nickname: z.string().min(1, "请填写昵称").max(24),
    email: z.string().email("邮箱格式不正确"),
    password: z.string().min(8, "密码至少 8 位"),
    confirmPassword: z.string(),
    avatarUrl: z.string().max(500).optional().or(z.literal("")),
    agreed: z.literal("on", { errorMap: () => ({ message: "请先同意用户协议" }) })
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "两次密码不一致"
  });

export const loginSchema = z.object({
  account: z.string().min(1, "请填写用户名或邮箱"),
  password: z.string().min(1, "请填写密码")
});

export const postSchema = z.object({
  content: z.string().trim().min(1, "请输入内容").max(1200, "内容过长"),
  imageUrls: z.string().optional(),
  topics: z.string().optional(),
  location: z.string().optional(),
  visibility: z.enum(["PUBLIC", "FRIENDS", "PRIVATE"]).default("PUBLIC"),
  allowComments: z.coerce.boolean().default(false)
});

export const commentSchema = z.object({
  postId: z.string().min(1),
  parentId: z.string().optional(),
  content: z.string().trim().min(1, "评论不能为空").max(500)
});

export const messageSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().trim().min(1, "消息不能为空").max(1000)
});

export const profileSchema = z.object({
  nickname: z.string().trim().min(1).max(24),
  bio: z.string().trim().max(180),
  avatarUrl: z.string().max(500).optional().or(z.literal(""))
});

export const avatarKnowledgeUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, "标题不能为空").max(80),
  content: z.string().trim().min(1, "知识内容不能为空").max(2000)
});

export const calibrationKindSchema = z.enum([
  "DAILY_CHAT",
  "COMFORT",
  "REFUSAL",
  "FEED_COMMENT"
]);

export const calibrationApprovalSchema = z.object({
  kind: calibrationKindSchema,
  content: z.string().trim().min(1, "校准回复不能为空").max(1200)
});

export const agentModeSchema = z.enum(["MANUAL", "ASSIST", "PROXY"]);
export const agentToggleSchema = z.boolean();
export const agentModeOverrideSchema = z.enum(["INHERIT", "MANUAL", "ASSIST", "PROXY"]);
export const agentDelayModeSchema = z.enum(["IMMEDIATE", "SHORT", "LONG", "CUSTOM"]);
export const agentDelayOverrideSchema = z.enum([
  "INHERIT",
  "IMMEDIATE",
  "SHORT",
  "LONG",
  "CUSTOM"
]);
export const agentActiveWindowModeSchema = z.enum(["INHERIT", "ALWAYS", "CUSTOM"]);
export const agentReceiveAiModeSchema = z.enum(["INHERIT", "ALLOW", "BLOCK"]);

const timeOfDaySchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "时间格式必须为 HH:mm");

export const agentActiveWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: timeOfDaySchema,
  end: timeOfDaySchema
});

export const globalAgentSettingsSchema = z
  .object({
    defaultMode: agentModeSchema,
    assistAutoDraft: z.boolean(),
    delayMode: agentDelayModeSchema,
    customDelaySeconds: z.number().int().min(1).max(86400),
    sendBufferSeconds: z.number().int().min(0).max(60),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/, "请输入有效的 IANA 时区"),
    activeWindows: z.array(agentActiveWindowSchema).max(56),
    receiveAi: z.boolean()
  })
  .superRefine((value, context) => {
    if (value.delayMode === "CUSTOM" && value.customDelaySeconds < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customDelaySeconds"],
        message: "自定义延迟必须大于 0"
      });
    }
  });

export const conversationAgentSettingsSchema = z
  .object({
    conversationId: z.string().min(1),
    modeOverride: agentModeOverrideSchema,
    delayOverride: agentDelayOverrideSchema,
    customDelaySeconds: z.number().int().min(1).max(86400),
    activeWindowMode: agentActiveWindowModeSchema,
    activeWindows: z.array(agentActiveWindowSchema).max(56),
    receiveAiFromContact: agentReceiveAiModeSchema
  })
  .superRefine((value, context) => {
    if (value.delayOverride === "CUSTOM" && value.customDelaySeconds < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customDelaySeconds"],
        message: "自定义延迟必须大于 0"
      });
    }
    if (value.activeWindowMode === "CUSTOM" && value.activeWindows.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeWindows"],
        message: "自定义活跃时间至少需要一个时段"
      });
    }
  });

export const humanChatMessageSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().trim().min(1, "消息不能为空").max(1000)
});

export const assistDraftSendSchema = z.object({
  taskId: z.string().min(1),
  content: z.string().trim().min(1, "消息不能为空").max(1000)
});

export const agentEntityIdSchema = z.string().min(1).max(120);
