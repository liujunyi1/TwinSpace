"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  hashPassword,
  requireUser,
  setSessionCookie,
  verifyPassword
} from "@/lib/auth";
import {
  commentSchema,
  loginSchema,
  messageSchema,
  postSchema,
  profileSchema,
  registerSchema
} from "@/lib/schemas";
import { prisma } from "@/lib/prisma";
import { extractPersonalityProfile, generateAvatarReply, generateFriendReplyDraft } from "@/lib/ai";
import { normalizeAnswers } from "@/lib/onboarding";
import { saveAvatarFile, savePostImageFiles } from "@/lib/upload";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function splitList(value?: string | null) {
  return String(value || "")
    .split(/[\n,，、#]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function avatarFromForm(formData: FormData, fallback?: string | null) {
  const uploaded = await saveAvatarFile(formData.get("avatarFile") as File | null);
  if (uploaded) return uploaded;
  const url = String(formData.get("avatarUrl") || "").trim();
  if (url && !/^https?:\/\//i.test(url) && !url.startsWith("/uploads/")) {
    throw new Error("头像链接必须是 http(s) 地址或本地上传图片");
  }
  return url || fallback || null;
}

export async function registerAction(formData: FormData) {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/register", parsed.error.issues[0]?.message || "注册信息不完整");

  const data = parsed.data;
  const passwordHash = await hashPassword(data.password);
  let avatarUrl: string | null;
  try {
    avatarUrl = await avatarFromForm(formData);
  } catch (error) {
    fail("/register", error instanceof Error ? error.message : "头像上传失败");
  }
  try {
    const user = await prisma.user.create({
      data: {
        username: data.username,
        nickname: data.nickname,
        email: data.email.toLowerCase(),
        passwordHash,
        avatarUrl
      }
    });
    setSessionCookie(user.id);
  } catch {
    fail("/register", "用户名或邮箱已被使用");
  }

  redirect("/onboarding");
}

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/login", parsed.error.issues[0]?.message || "登录信息不完整");

  const account = parsed.data.account.toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: parsed.data.account }, { email: account }]
    },
    include: { personalityProfile: true }
  });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    fail("/login", "账号或密码不正确");
  }

  setSessionCookie(user.id);
  redirect(user.personalityProfile ? "/feed" : "/onboarding");
}

export async function logoutAction() {
  clearSessionCookie();
  redirect("/login");
}

export async function saveOnboardingAction(formData: FormData) {
  const user = await requireUser();
  const answers = normalizeAnswers(formData);
  const profile = await extractPersonalityProfile(answers);

  await prisma.$transaction(async (tx) => {
    await tx.onboardingAnswer.deleteMany({ where: { userId: user.id } });
    await tx.onboardingAnswer.createMany({
      data: Object.entries(answers).map(([questionKey, answer]) => ({
        userId: user.id,
        questionKey,
        answerJson: JSON.stringify(answer)
      }))
    });

    await tx.personalityProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        summary: profile.summary,
        traitsJson: JSON.stringify({
          labels: profile.traits,
          extroversion: profile.extroversion,
          emotionalExpression: profile.emotionalExpression,
          directness: profile.directness,
          socialInitiative: profile.socialInitiative,
          interestTopics: profile.interestTopics,
          comfortPreference: profile.comfortPreference,
          boundaries: profile.boundaries
        }),
        communicationStyle: profile.communicationStyle,
        socialStyle: profile.socialStyle,
        emotionalStyle: profile.emotionalStyle,
        replyLength: profile.replyLength,
        emojiPreference: profile.emojiPreference,
        aiAutonomyLevel: profile.avatarAutonomyLevel
      },
      update: {
        summary: profile.summary,
        traitsJson: JSON.stringify({
          labels: profile.traits,
          extroversion: profile.extroversion,
          emotionalExpression: profile.emotionalExpression,
          directness: profile.directness,
          socialInitiative: profile.socialInitiative,
          interestTopics: profile.interestTopics,
          comfortPreference: profile.comfortPreference,
          boundaries: profile.boundaries
        }),
        communicationStyle: profile.communicationStyle,
        socialStyle: profile.socialStyle,
        emotionalStyle: profile.emotionalStyle,
        replyLength: profile.replyLength,
        emojiPreference: profile.emojiPreference,
        aiAutonomyLevel: profile.avatarAutonomyLevel
      }
    });

    await tx.preference.deleteMany({ where: { userId: user.id } });
    await tx.preference.createMany({
      data: [
        ...profile.interestTopics.map((topic) => ({
          userId: user.id,
          category: "喜欢的话题",
          value: topic
        })),
        ...profile.boundaries.map((topic) => ({
          userId: user.id,
          category: "边界与禁忌",
          value: topic
        })),
        {
          userId: user.id,
          category: "回复长度",
          value: profile.replyLength
        },
        {
          userId: user.id,
          category: "表情偏好",
          value: profile.emojiPreference
        }
      ]
    });

    await tx.memory.create({
      data: {
        userId: user.id,
        type: "表达习惯",
        content: profile.communicationStyle,
        sourceType: "注册问答",
        confidence: 0.88,
        status: "CONFIRMED",
        confirmedAt: new Date()
      }
    });
  });

  redirect("/feed");
}

export async function createPostAction(formData: FormData) {
  const user = await requireUser();
  const parsed = postSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/create", parsed.error.issues[0]?.message || "发布内容不完整");

  const data = parsed.data;
  let imageUrls: string[];
  try {
    imageUrls = await savePostImageFiles(formData.getAll("imageFiles") as File[]);
  } catch (error) {
    fail("/create", error instanceof Error ? error.message : "图片上传失败");
  }

  const city = String(data.location || "")
    .replace(/[^\p{Script=Han}A-Za-z\s.-]/gu, "")
    .trim()
    .slice(0, 40);

  await prisma.post.create({
    data: {
      authorId: user.id,
      content: data.content,
      imageUrlsJson: JSON.stringify(imageUrls),
      topicsJson: JSON.stringify(splitList(data.topics).slice(0, 5)),
      location: city || null,
      visibility: data.visibility,
      allowComments: data.allowComments
    }
  });
  revalidatePath("/feed");
  redirect("/feed");
}

export async function togglePostLikeAction(formData: FormData) {
  const user = await requireUser();
  const postId = String(formData.get("postId") || "");
  if (!postId) return;
  const existing = await prisma.postLike.findUnique({
    where: { postId_userId: { postId, userId: user.id } }
  });
  if (existing) {
    await prisma.postLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.postLike.create({ data: { postId, userId: user.id } });
  }
  revalidatePath("/feed");
}

export async function createCommentAction(formData: FormData) {
  const user = await requireUser();
  const parsed = commentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const post = await prisma.post.findUnique({ where: { id: parsed.data.postId } });
  if (!post?.allowComments) return;
  await prisma.comment.create({
    data: {
      postId: parsed.data.postId,
      authorId: user.id,
      parentId: parsed.data.parentId || null,
      content: parsed.data.content
    }
  });
  revalidatePath("/feed");
}

export async function deleteCommentAction(formData: FormData) {
  const user = await requireUser();
  const commentId = String(formData.get("commentId") || "");
  if (!commentId) return;

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { authorId: true, postId: true }
  });
  if (!comment || comment.authorId !== user.id) return;

  await prisma.comment.delete({ where: { id: commentId } });
  revalidatePath("/feed");
  revalidatePath("/profile");
  revalidatePath("/profile/comments");
}

export async function deletePostAction(formData: FormData) {
  const user = await requireUser();
  const postId = String(formData.get("postId") || "");
  if (!postId) return;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { authorId: true }
  });
  if (!post || post.authorId !== user.id) return;

  await prisma.post.delete({ where: { id: postId } });
  revalidatePath("/feed");
  revalidatePath("/profile");
  revalidatePath("/profile/comments");
}

export async function repostAction(formData: FormData) {
  const user = await requireUser();
  const postId = String(formData.get("postId") || "");
  const content = String(formData.get("content") || "");
  if (!postId) return;
  await prisma.repost.create({ data: { postId, userId: user.id, content } });
  revalidatePath("/feed");
}

export async function updateProfileAction(formData: FormData) {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/profile/settings", parsed.error.issues[0]?.message || "资料格式不正确");
  let avatarUrl: string | null;
  try {
    avatarUrl = await avatarFromForm(formData, user.avatarUrl);
  } catch (error) {
    fail("/profile/settings", error instanceof Error ? error.message : "头像上传失败");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      nickname: parsed.data.nickname,
      bio: parsed.data.bio,
      avatarUrl
    }
  });
  revalidatePath("/profile");
  redirect("/profile");
}

export async function toggleFollowAction(formData: FormData) {
  const user = await requireUser();
  const followingId = String(formData.get("followingId") || "");
  if (!followingId || followingId === user.id) return;

  const target = await prisma.user.findUnique({ where: { id: followingId } });
  if (!target) return;

  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: user.id, followingId } }
  });
  if (existing) {
    await prisma.follow.delete({ where: { id: existing.id } });
  } else {
    await prisma.follow.create({ data: { followerId: user.id, followingId } });
  }
  revalidatePath("/profile");
  revalidatePath(`/users/${followingId}`);
  revalidatePath("/search");
}

export async function startConversationAction(formData: FormData) {
  const user = await requireUser();
  const targetId = String(formData.get("targetId") || "");
  if (!targetId || targetId === user.id) redirect("/messages");

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) redirect("/messages");

  const existingMemberships = await prisma.conversationMember.findMany({
    where: { userId: user.id, conversation: { type: "HUMAN" } },
    include: { conversation: { include: { members: true } } }
  });
  const existing = existingMemberships.find((membership) => {
    const memberIds = membership.conversation.members.map((member) => member.userId);
    return memberIds.length === 2 && memberIds.includes(targetId);
  });

  if (existing) redirect(`/messages/${existing.conversationId}`);

  const conversation = await prisma.conversation.create({
    data: {
      type: "HUMAN",
      title: target.nickname,
      members: {
        create: [
          { userId: user.id, role: "OWNER" },
          { userId: target.id, role: "MEMBER" }
        ]
      }
    }
  });
  redirect(`/messages/${conversation.id}`);
}

export async function sendFriendMessageAction(formData: FormData) {
  const user = await requireUser();
  const parsed = messageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  const membership = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId: parsed.data.conversationId,
        userId: user.id
      }
    }
  });
  if (!membership) return;

  const conversation = await prisma.conversation.findUnique({
    where: { id: parsed.data.conversationId },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 8 } }
  });
  if (!conversation) return;

  await prisma.message.create({
    data: {
      conversationId: parsed.data.conversationId,
      senderId: user.id,
      content: parsed.data.content,
      senderMode: conversation.aiMode === "PROXY" ? "AI_PROXY" : "HUMAN"
    }
  });

  if (conversation.type === "AI_CONTACT") {
    const profile = await prisma.personalityProfile.findUnique({ where: { userId: user.id } });
    const text = await generateFriendReplyDraft({
      profileSummary: profile?.summary || "暂无画像",
      conversationTitle: conversation.title,
      recentMessages: conversation.messages.map((message) => message.content).reverse()
    });
    await prisma.message.create({
      data: {
        conversationId: parsed.data.conversationId,
        senderId: null,
        content: text,
        senderMode: "AI"
      }
    });
  }

  revalidatePath(`/messages/${parsed.data.conversationId}`);
  revalidatePath("/messages");
}

export async function sendAvatarMessageAction(formData: FormData) {
  const user = await requireUser();
  const content = String(formData.get("content") || "").trim();
  if (!content) return;

  let session = await prisma.avatarChatSession.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });
  if (!session) {
    session = await prisma.avatarChatSession.create({
      data: { userId: user.id, title: "和我的分身聊聊" },
      include: { messages: true }
    });
  }

  await prisma.avatarChatMessage.create({
    data: { sessionId: session.id, role: "user", content }
  });

  const profile = await prisma.personalityProfile.findUnique({ where: { userId: user.id } });
  const memories = await prisma.memory.findMany({
    where: { userId: user.id, enabled: true, status: "CONFIRMED" },
    orderBy: { updatedAt: "desc" },
    take: 6
  });
  const reply = await generateAvatarReply({
    nickname: user.nickname,
    profileSummary: profile?.summary || "暂无画像",
    memories: memories.map((memory) => memory.content),
    messages: [
      ...session.messages.map((message) => ({
        role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: message.content
      })),
      { role: "user" as const, content }
    ]
  });

  await prisma.avatarChatMessage.create({
    data: { sessionId: session.id, role: "assistant", content: reply }
  });
  await prisma.avatarChatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
  revalidatePath("/avatar");
}

export async function clearAvatarSessionAction() {
  const user = await requireUser();
  const session = await prisma.avatarChatSession.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" }
  });
  if (session) {
    await prisma.avatarChatMessage.deleteMany({ where: { sessionId: session.id } });
  }
  revalidatePath("/avatar");
}

export async function addMemoryAction(formData: FormData) {
  const user = await requireUser();
  const content = String(formData.get("content") || "").trim();
  const type = String(formData.get("type") || "基本事实");
  if (!content) return;
  await prisma.memory.create({
    data: {
      userId: user.id,
      type,
      content,
      sourceType: "用户手动添加",
      confidence: 1,
      status: "CONFIRMED",
      confirmedAt: new Date()
    }
  });
  revalidatePath("/profile/memories");
}

export async function toggleMemoryAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const memory = await prisma.memory.findFirst({ where: { id, userId: user.id } });
  if (!memory) return;
  await prisma.memory.update({ where: { id }, data: { enabled: !memory.enabled } });
  revalidatePath("/profile/memories");
}

export async function confirmMemoryAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  await prisma.memory.updateMany({
    where: { id, userId: user.id },
    data: { status: "CONFIRMED", confirmedAt: new Date(), enabled: true }
  });
  revalidatePath("/profile/memories");
}

export async function deleteMemoryAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  await prisma.memory.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/profile/memories");
}
