"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  approveSocialDraft,
  cancelSocialTask,
  deleteSocialComment,
  enqueueSocialRunNow,
  updateSocialPolicy
} from "@/lib/agent/social-agent";
import { requireUser } from "@/lib/auth";

const timeOfDaySchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "时间格式必须为 HH:mm");

const socialActiveWindowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    start: timeOfDaySchema,
    end: timeOfDaySchema
  })
  .refine((value) => value.start < value.end, {
    message: "结束时间必须晚于开始时间",
    path: ["end"]
  });

const socialPolicySchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(["OFF", "SUGGEST", "AUTO"]),
    scope: z.enum(["MUTUAL", "FOLLOWING", "PUBLIC"]),
    timezone: z
      .string()
      .trim()
      .min(1, "时区不能为空")
      .max(80)
      .regex(/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/, "请输入有效的 IANA 时区"),
    activeWindows: z.array(socialActiveWindowSchema).max(56),
    dailyBatchMin: z.number().int().min(2).max(4),
    dailyBatchMax: z.number().int().min(2).max(4),
    dailyCommentLimit: z.number().int().min(1).max(10),
    authorCooldownHours: z.number().int().min(1).max(168)
  })
  .refine((value) => value.dailyBatchMin <= value.dailyBatchMax, {
    message: "每日最小批次不能大于最大批次",
    path: ["dailyBatchMax"]
  });

const entityIdSchema = z.string().trim().min(1).max(120);
const approveDraftSchema = z.object({
  taskId: entityIdSchema,
  content: z.string().trim().min(1, "评论不能为空").max(500, "评论不能超过 500 字")
});
const noInputSchema = z.undefined();

function firstValidationError(error: z.ZodError) {
  return error.issues[0]?.message || "输入格式不正确";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试";
}

function revalidateSocialPages() {
  revalidatePath("/avatar");
  revalidatePath("/avatar/social");
  revalidatePath("/avatar/activity");
  revalidatePath("/feed");
  revalidatePath("/profile");
  revalidatePath("/profile/comments");
}

export async function updateSocialPolicyAction(input: unknown) {
  const user = await requireUser();
  const parsed = socialPolicySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: firstValidationError(parsed.error) };
  }

  try {
    const result = await updateSocialPolicy(user.id, {
      ...parsed.data,
      activeWindows: parsed.data.activeWindows.map((window) => ({
        day: window.weekday,
        start: window.start,
        end: window.end
      }))
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error || "保存失败" };
    }
    revalidateSocialPages();
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function enqueueSocialRunNowAction(input?: unknown) {
  const user = await requireUser();
  const parsed = noInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: firstValidationError(parsed.error) };
  }

  try {
    const result = await enqueueSocialRunNow(user.id);
    if (!result.ok) {
      return { ok: false as const, error: result.error || "创建浏览任务失败" };
    }
    revalidateSocialPages();
    return { ok: true as const, taskId: result.taskId, reason: result.reason };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function approveSocialDraftAction(input: unknown) {
  const user = await requireUser();
  const parsed = approveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: firstValidationError(parsed.error) };
  }

  try {
    const result = await approveSocialDraft(user.id, parsed.data.taskId, parsed.data.content);
    if (!result.ok) {
      return { ok: false as const, error: result.error || "发布失败" };
    }
    revalidateSocialPages();
    return { ok: true as const, taskId: result.taskId, commentId: result.commentId };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function cancelSocialTaskAction(input: unknown) {
  const user = await requireUser();
  const parsed = entityIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: firstValidationError(parsed.error) };
  }

  try {
    const result = await cancelSocialTask(user.id, parsed.data);
    if (!result.ok) {
      return { ok: false as const, error: result.error || "取消失败" };
    }
    revalidateSocialPages();
    return { ok: true as const, taskId: result.taskId };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}

export async function deleteSocialCommentAction(input: unknown) {
  const user = await requireUser();
  const parsed = entityIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: firstValidationError(parsed.error) };
  }

  try {
    const result = await deleteSocialComment(user.id, parsed.data);
    if (!result.ok) {
      return { ok: false as const, error: result.error || "删除失败" };
    }
    revalidateSocialPages();
    return { ok: true as const, taskId: result.taskId, commentId: result.commentId };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}
