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
  avatarKnowledgeUpdateSchema,
  calibrationApprovalSchema,
  calibrationKindSchema,
  commentSchema,
  loginSchema,
  messageSchema,
  postSchema,
  profileSchema,
  registerSchema
} from "@/lib/schemas";
import { prisma } from "@/lib/prisma";
import {
  compileAvatarKnowledge,
  extractPersonalityProfile,
  generateAvatarReply,
  generateCalibrationReply,
  generateFriendReplyDraft
} from "@/lib/ai";
import { normalizeAnswers } from "@/lib/onboarding";
import { saveAvatarFile, savePostImageFiles } from "@/lib/upload";
import {
  CALIBRATION_SCENARIOS,
  isCalibrationComplete,
  type AvatarSourceForCompilation,
  type CalibrationKind
} from "@/lib/agent/knowledge";
import { findVisiblePost } from "@/lib/post-visibility";
import type { Prisma } from "@prisma/client";

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

const AVATAR_PATHS = ["/avatar", "/avatar/build", "/avatar/knowledge", "/avatar/calibration"];

function revalidateAvatarPaths() {
  for (const path of AVATAR_PATHS) revalidatePath(path);
}

async function invalidateAvatarCalibration(
  tx: Prisma.TransactionClient,
  userId: string,
  status?: "DRAFT" | "CALIBRATING"
) {
  const avatar = await tx.avatarProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!avatar) return;

  await tx.avatarCalibrationCase.deleteMany({ where: { userId } });
  const knowledgeCount = await tx.avatarKnowledgePage.count({ where: { userId } });
  await tx.avatarProfile.update({
    where: { userId },
    data: {
      status: status || (knowledgeCount > 0 ? "CALIBRATING" : "DRAFT"),
      knowledgeRevision: { increment: 1 },
      calibratedAt: null
    }
  });
}

async function removeAvatarSourcesByReference(
  tx: Prisma.TransactionClient,
  userId: string,
  kind: string,
  sourceKeys: string[]
) {
  if (sourceKeys.length === 0) return;
  const sources = await tx.avatarKnowledgeSource.findMany({
    where: { userId, kind, sourceKey: { in: sourceKeys } },
    select: { id: true, citations: { select: { knowledgeId: true } } }
  });
  if (sources.length === 0) return;

  const knowledgeIds = [
    ...new Set(sources.flatMap((source) => source.citations.map((citation) => citation.knowledgeId)))
  ];
  await tx.avatarKnowledgeSource.deleteMany({
    where: { id: { in: sources.map((source) => source.id) }, userId }
  });
  if (knowledgeIds.length > 0) {
    await tx.avatarKnowledgePage.updateMany({
      where: { id: { in: knowledgeIds }, userId },
      data: {
        confirmationStatus: "PENDING",
        revision: { increment: 1 }
      }
    });
    const orphaned = await tx.avatarKnowledgePage.findMany({
      where: { id: { in: knowledgeIds }, userId, citations: { none: {} } },
      select: { id: true }
    });
    if (orphaned.length > 0) {
      await tx.avatarKnowledgePage.deleteMany({
        where: { id: { in: orphaned.map((page) => page.id) }, userId }
      });
    }
  }
  await invalidateAvatarCalibration(tx, userId);
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
  const tone = Array.isArray(profile.tone) ? profile.tone.join("、") : profile.tone;
  const expressionRules = Array.isArray(profile.expressionRules)
    ? profile.expressionRules.join("、")
    : profile.expressionRules;
  const friendAiLevel = Array.isArray(profile.friendAiLevel)
    ? profile.friendAiLevel.join("、")
    : profile.friendAiLevel;

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
          boundaries: profile.boundaries,
          tone,
          expressionRules,
          friendAiLevel
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
          boundaries: profile.boundaries,
          tone,
          expressionRules,
          friendAiLevel
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
        },
        {
          userId: user.id,
          category: "常用语气",
          value: tone
        },
        {
          userId: user.id,
          category: "表达规则",
          value: expressionRules
        },
        {
          userId: user.id,
          category: "好友聊天 AI",
          value: friendAiLevel
        }
      ]
    });

    await tx.memory.deleteMany({
      where: { userId: user.id, type: "表达习惯", sourceType: "注册问答" }
    });
    await tx.memory.create({
      data: {
        userId: user.id,
        type: "表达习惯",
        content: `${profile.communicationStyle}；${expressionRules}`,
        sourceType: "注册问答",
        confidence: 0.88,
        status: "CONFIRMED",
        confirmedAt: new Date()
      }
    });

    const avatar = await tx.avatarProfile.findUnique({ where: { userId: user.id } });
    if (avatar) {
      await tx.avatarCalibrationCase.deleteMany({ where: { userId: user.id } });
      await tx.avatarKnowledgePage.deleteMany({ where: { userId: user.id } });
      await tx.avatarKnowledgeSource.deleteMany({ where: { userId: user.id } });
      await tx.avatarProfile.update({
        where: { userId: user.id },
        data: {
          status: "DRAFT",
          knowledgeRevision: { increment: 1 },
          calibratedAt: null
        }
      });
    }
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
  const post = await findVisiblePost(user.id, postId);
  if (!post) return;
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
  const post = await findVisiblePost(user.id, parsed.data.postId);
  if (!post?.allowComments) return;
  if (parsed.data.parentId) {
    const parent = await prisma.comment.findFirst({
      where: { id: parsed.data.parentId, postId: parsed.data.postId },
      select: { id: true }
    });
    if (!parent) return;
  }
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

  await prisma.$transaction(async (tx) => {
    await removeAvatarSourcesByReference(tx, user.id, "POST", [postId]);
    await tx.post.delete({ where: { id: postId } });
  });
  revalidatePath("/feed");
  revalidatePath("/profile");
  revalidatePath("/profile/comments");
}

export async function repostAction(formData: FormData) {
  const user = await requireUser();
  const postId = String(formData.get("postId") || "");
  const content = String(formData.get("content") || "");
  if (!postId) return;
  const post = await findVisiblePost(user.id, postId);
  if (!post) return;
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
  revalidatePath("/feed");
  revalidatePath("/profile/comments");
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
  const avatarProfile = await prisma.avatarProfile.findUnique({ where: { userId: user.id } });
  if (!avatarProfile || !["ACTIVE", "PAUSED"].includes(avatarProfile.status)) redirect("/avatar");

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
  const knowledge = await prisma.avatarKnowledgePage.findMany({
    where: {
      userId: user.id,
      enabled: true,
      confirmationStatus: { in: ["AUTO", "CONFIRMED"] }
    },
    orderBy: { updatedAt: "desc" },
    take: 8
  });
  const reply = await generateAvatarReply({
    nickname: user.nickname,
    profileSummary: profile?.summary || "暂无画像",
    memories: [
      ...knowledge.map((page) => `${page.title}：${page.content}`),
      ...memories.map((memory) => memory.content)
    ].slice(0, 10),
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
  revalidatePath("/avatar/chat");
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
  revalidatePath("/avatar/chat");
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
  await prisma.$transaction(async (tx) => {
    await removeAvatarSourcesByReference(tx, user.id, "MEMORY", [id]);
    await tx.memory.deleteMany({ where: { id, userId: user.id } });
  });
  revalidatePath("/profile/memories");
  revalidateAvatarPaths();
}

export async function buildAvatarKnowledgeAction(formData: FormData) {
  const user = await requireUser();
  const profile = await prisma.personalityProfile.findUnique({ where: { userId: user.id } });
  if (!profile) fail("/avatar/build", "请先完成人格问卷");

  const selections = [
    ...new Set(
      formData
        .getAll("source")
        .map((value) => String(value))
        .filter((value) => /^(POST|MESSAGE|MEMORY):[^:]+$/.test(value))
    )
  ];
  const idsByKind = {
    POST: selections.filter((item) => item.startsWith("POST:")).map((item) => item.slice(5)),
    MESSAGE: selections.filter((item) => item.startsWith("MESSAGE:")).map((item) => item.slice(8)),
    MEMORY: selections.filter((item) => item.startsWith("MEMORY:")).map((item) => item.slice(7))
  };

  const [answers, posts, messages, memories] = await Promise.all([
    prisma.onboardingAnswer.findMany({
      where: { userId: user.id },
      orderBy: { questionKey: "asc" }
    }),
    prisma.post.findMany({
      where: { id: { in: idsByKind.POST }, authorId: user.id },
      select: { id: true, content: true, createdAt: true }
    }),
    prisma.message.findMany({
      where: {
        id: { in: idsByKind.MESSAGE },
        senderId: user.id,
        senderMode: "HUMAN"
      },
      select: { id: true, content: true, createdAt: true, conversation: { select: { title: true } } }
    }),
    prisma.memory.findMany({
      where: {
        id: { in: idsByKind.MEMORY },
        userId: user.id,
        enabled: true,
        status: "CONFIRMED"
      },
      select: { id: true, content: true, type: true, createdAt: true }
    })
  ]);

  const sourceRows: Array<{
    kind: string;
    sourceKey: string;
    label: string;
    content: string;
  }> = [
    {
      kind: "QUESTIONNAIRE",
      sourceKey: "current-profile",
      label: "问卷画像",
      content: [
        profile.summary,
        `沟通风格：${profile.communicationStyle}`,
        `社交风格：${profile.socialStyle}`,
        `情绪表达：${profile.emotionalStyle}`,
        `回复长度：${profile.replyLength}`,
        `表情偏好：${profile.emojiPreference}`,
        ...answers.map((answer) => `${answer.questionKey}: ${answer.answerJson}`)
      ].join("\n")
    },
    ...posts.map((post) => ({
      kind: "POST",
      sourceKey: post.id,
      label: `动态 · ${post.createdAt.toLocaleDateString("zh-CN")}`,
      content: post.content
    })),
    ...messages.map((message) => ({
      kind: "MESSAGE",
      sourceKey: message.id,
      label: `本人消息 · ${message.conversation.title}`,
      content: message.content
    })),
    ...memories.map((memory) => ({
      kind: "MEMORY",
      sourceKey: memory.id,
      label: `确认记忆 · ${memory.type}`,
      content: memory.content
    }))
  ];

  const manualSample = String(formData.get("manualSample") || "").trim().slice(0, 5000);
  if (manualSample) {
    sourceRows.push({
      kind: "MANUAL",
      sourceKey: `manual-${Date.now()}`,
      label: "手动表达样本",
      content: manualSample
    });
  }

  const compilationSources: AvatarSourceForCompilation[] = sourceRows.map((source) => ({
    id: `${source.kind}:${source.sourceKey}`,
    kind: source.kind,
    content: source.content
  }));
  const proposals = await compileAvatarKnowledge({
    profileSummary: profile.summary,
    communicationStyle: profile.communicationStyle,
    socialStyle: profile.socialStyle,
    emotionalStyle: profile.emotionalStyle,
    replyLength: profile.replyLength,
    emojiPreference: profile.emojiPreference,
    sources: compilationSources
  });

  await prisma.$transaction(async (tx) => {
    await tx.avatarCalibrationCase.deleteMany({ where: { userId: user.id } });
    await tx.avatarKnowledgePage.deleteMany({ where: { userId: user.id } });
    await tx.avatarKnowledgeSource.deleteMany({ where: { userId: user.id } });

    const sourceIds = new Map<string, string>();
    for (const source of sourceRows) {
      const created = await tx.avatarKnowledgeSource.create({
        data: { userId: user.id, ...source }
      });
      sourceIds.set(`${source.kind}:${source.sourceKey}`, created.id);
    }

    for (const proposal of proposals) {
      const citedSourceIds = proposal.sourceIds
        .map((sourceId) => sourceIds.get(sourceId))
        .filter((sourceId): sourceId is string => Boolean(sourceId));
      if (citedSourceIds.length === 0) continue;
      await tx.avatarKnowledgePage.create({
        data: {
          userId: user.id,
          category: proposal.category,
          title: proposal.title,
          content: proposal.content,
          confidence: proposal.confidence,
          confirmationStatus: proposal.requiresConfirmation ? "PENDING" : "AUTO",
          citations: {
            create: citedSourceIds.map((sourceId) => ({ sourceId }))
          }
        }
      });
    }

    await tx.avatarProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        privateName: `${user.nickname}的分身`,
        status: "CALIBRATING",
        knowledgeRevision: 1
      },
      update: {
        status: "CALIBRATING",
        knowledgeRevision: { increment: 1 },
        calibratedAt: null
      }
    });
  });

  revalidateAvatarPaths();
  redirect("/avatar/calibration");
}

export async function updateAvatarKnowledgeAction(formData: FormData) {
  const user = await requireUser();
  const parsed = avatarKnowledgeUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/avatar/knowledge", parsed.error.issues[0]?.message || "知识格式不正确");
  const existing = await prisma.avatarKnowledgePage.findFirst({
    where: { id: parsed.data.id, userId: user.id },
    select: { id: true, revision: true }
  });
  if (!existing) return;

  await prisma.$transaction(async (tx) => {
    await tx.avatarKnowledgePage.update({
      where: { id: existing.id },
      data: {
        title: parsed.data.title,
        content: parsed.data.content,
        confirmationStatus: "CONFIRMED",
        revision: { increment: 1 }
      }
    });
    await invalidateAvatarCalibration(tx, user.id);
  });
  revalidateAvatarPaths();
}

export async function confirmAvatarKnowledgeAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const existing = await prisma.avatarKnowledgePage.findFirst({
    where: { id, userId: user.id },
    select: { id: true }
  });
  if (!existing) return;
  await prisma.$transaction(async (tx) => {
    await tx.avatarKnowledgePage.update({
      where: { id: existing.id },
      data: { confirmationStatus: "CONFIRMED" }
    });
    await invalidateAvatarCalibration(tx, user.id);
  });
  revalidateAvatarPaths();
}

export async function toggleAvatarKnowledgeAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const existing = await prisma.avatarKnowledgePage.findFirst({
    where: { id, userId: user.id },
    select: { id: true, enabled: true }
  });
  if (!existing) return;
  await prisma.$transaction(async (tx) => {
    await tx.avatarKnowledgePage.update({
      where: { id: existing.id },
      data: { enabled: !existing.enabled }
    });
    await invalidateAvatarCalibration(tx, user.id);
  });
  revalidateAvatarPaths();
}

export async function deleteAvatarKnowledgeAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const existing = await prisma.avatarKnowledgePage.findFirst({
    where: { id, userId: user.id },
    select: { id: true }
  });
  if (!existing) return;
  await prisma.$transaction(async (tx) => {
    await tx.avatarKnowledgePage.delete({ where: { id: existing.id } });
    await invalidateAvatarCalibration(tx, user.id);
  });
  revalidateAvatarPaths();
}

export async function deleteAvatarSourceAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const source = await prisma.avatarKnowledgeSource.findFirst({
    where: { id, userId: user.id },
    select: { kind: true, sourceKey: true }
  });
  if (!source) return;
  await prisma.$transaction((tx) =>
    removeAvatarSourcesByReference(tx, user.id, source.kind, [source.sourceKey])
  );
  revalidateAvatarPaths();
}

export async function generateCalibrationAction(formData: FormData) {
  const user = await requireUser();
  const parsedKind = calibrationKindSchema.safeParse(String(formData.get("kind") || ""));
  if (!parsedKind.success) return;
  const avatar = await prisma.avatarProfile.findUnique({ where: { userId: user.id } });
  if (!avatar) redirect("/avatar/build");

  const knowledge = await prisma.avatarKnowledgePage.findMany({
    where: {
      userId: user.id,
      enabled: true,
      confirmationStatus: { in: ["AUTO", "CONFIRMED"] }
    },
    orderBy: { updatedAt: "desc" },
    take: 20
  });
  const personality = await prisma.personalityProfile.findUnique({ where: { userId: user.id } });
  const scenario = CALIBRATION_SCENARIOS[parsedKind.data].scenario;
  const generatedResponse = await generateCalibrationReply({
    kind: parsedKind.data,
    scenario,
    profileSummary: personality?.summary || "暂无画像",
    knowledge: knowledge.map((page) => ({
      id: page.id,
      category: page.category,
      title: page.title,
      content: page.content
    }))
  });

  await prisma.avatarCalibrationCase.upsert({
    where: { userId_kind: { userId: user.id, kind: parsedKind.data } },
    create: {
      userId: user.id,
      kind: parsedKind.data,
      scenario,
      generatedResponse,
      status: "GENERATED",
      knowledgeRevision: avatar.knowledgeRevision
    },
    update: {
      scenario,
      generatedResponse,
      editedResponse: null,
      status: "GENERATED",
      knowledgeRevision: avatar.knowledgeRevision
    }
  });
  await prisma.avatarProfile.update({
    where: { userId: user.id },
    data: { status: "CALIBRATING", calibratedAt: null }
  });
  revalidateAvatarPaths();
  redirect("/avatar/calibration");
}

export async function approveCalibrationAction(formData: FormData) {
  const user = await requireUser();
  const parsed = calibrationApprovalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/avatar/calibration", parsed.error.issues[0]?.message || "校准内容无效");
  const avatar = await prisma.avatarProfile.findUnique({ where: { userId: user.id } });
  if (!avatar) redirect("/avatar/build");

  await prisma.$transaction(async (tx) => {
    const updated = await tx.avatarCalibrationCase.updateMany({
      where: {
        userId: user.id,
        kind: parsed.data.kind,
        knowledgeRevision: avatar.knowledgeRevision
      },
      data: {
        editedResponse: parsed.data.content,
        status: "APPROVED"
      }
    });
    if (updated.count === 0) return;
    const cases = await tx.avatarCalibrationCase.findMany({ where: { userId: user.id } });
    if (
      isCalibrationComplete(
        cases.map((item) => ({
          kind: item.kind as CalibrationKind,
          status: item.status,
          revision: item.knowledgeRevision
        })),
        avatar.knowledgeRevision
      )
    ) {
      await tx.avatarProfile.update({
        where: { userId: user.id },
        data: { status: "ACTIVE", calibratedAt: new Date() }
      });
    }
  });
  revalidateAvatarPaths();
  redirect("/avatar/calibration");
}
