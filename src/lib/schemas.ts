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
