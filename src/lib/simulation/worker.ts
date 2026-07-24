import { setTimeout as sleep } from "timers/promises";
import { decideAndGenerateSocialComment } from "@/lib/agent/social-ai";
import { prisma } from "@/lib/prisma";
import {
  findSimulatedPersonaByUsername,
  isSimulatedUsername
} from "@/lib/simulation/personas";
import {
  buildDistinctSimulatedComment,
  buildSimulatedDirectReply,
  deterministicPick,
  isTooSimilarToExistingComment
} from "@/lib/simulation/generator";

type SimulationWorkerOptions = {
  signal?: AbortSignal;
  now?: Date;
  maxPosts?: number;
  maxComments?: number;
  maxCommentsPerPost?: number;
  maxReplies?: number;
};

export type SimulationWorkerResult = {
  commentsCreated: number;
  repliesCreated: number;
};

const SIMULATION_MODEL = "simulation-fixture";

function simulationEnabled() {
  return process.env.SIMULATION_ENABLED !== "false";
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Simulation worker aborted");
  }
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function runSimulationWorkerOnce(
  options: SimulationWorkerOptions = {}
): Promise<SimulationWorkerResult> {
  if (!simulationEnabled()) {
    return { commentsCreated: 0, repliesCreated: 0 };
  }

  const now = options.now || new Date();
  const simulatedUsers = await prisma.user.findMany({
    where: { username: { startsWith: "sim_" } },
    select: { id: true, username: true, nickname: true }
  });
  const simulatedProfiles = simulatedUsers
    .map((user) => ({ user, persona: findSimulatedPersonaByUsername(user.username) }))
    .filter((profile): profile is { user: typeof simulatedUsers[number]; persona: NonNullable<ReturnType<typeof findSimulatedPersonaByUsername>> } =>
      Boolean(profile.persona)
    );

  if (simulatedProfiles.length === 0) {
    return { commentsCreated: 0, repliesCreated: 0 };
  }

  const commentsCreated = await createSimulatedComments({
    now,
    signal: options.signal,
    simulatedProfiles,
    maxPosts: options.maxPosts ?? 25,
    maxComments: options.maxComments ?? 10,
    maxCommentsPerPost: options.maxCommentsPerPost ?? 3
  });
  const repliesCreated = await createSimulatedDirectReplies({
    now,
    signal: options.signal,
    simulatedProfiles,
    maxReplies: options.maxReplies ?? 10
  });

  return { commentsCreated, repliesCreated };
}

async function createSimulatedComments(input: {
  now: Date;
  signal?: AbortSignal;
  simulatedProfiles: Array<{
    user: { id: string; username: string; nickname: string };
    persona: NonNullable<ReturnType<typeof findSimulatedPersonaByUsername>>;
  }>;
  maxPosts: number;
  maxComments: number;
  maxCommentsPerPost: number;
}) {
  let createdCount = 0;
  const posts = await prisma.post.findMany({
    where: {
      allowComments: true,
      visibility: "PUBLIC"
    },
    orderBy: { createdAt: "desc" },
    take: input.maxPosts,
    include: {
      author: { select: { id: true, username: true, nickname: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        take: 80,
        select: {
          authorId: true,
          content: true,
          generatedByAvatar: true,
          author: { select: { username: true, nickname: true } }
        }
      }
    }
  });

  for (const post of posts) {
    assertNotAborted(input.signal);
    if (createdCount >= input.maxComments) break;
    const existingSimulatedAuthorIds = new Set(
      post.comments
        .filter((comment) => comment.author && isSimulatedUsername(comment.author.username))
        .map((comment) => comment.authorId)
    );
    const remainingForPost = Math.max(
      0,
      input.maxCommentsPerPost - existingSimulatedAuthorIds.size
    );
    if (remainingForPost === 0) continue;

    const candidates = input.simulatedProfiles.filter(
      (profile) =>
        profile.user.id !== post.authorId && !existingSimulatedAuthorIds.has(profile.user.id)
    );
    if (candidates.length === 0) continue;

    const commentSlots = Math.min(remainingForPost, input.maxComments - createdCount);
    for (let slot = 0; slot < commentSlots; slot += 1) {
      assertNotAborted(input.signal);
      const pool = candidates.filter((candidate) => !existingSimulatedAuthorIds.has(candidate.user.id));
      if (pool.length === 0) break;
      const profile = deterministicPick(pool, `${post.id}:${slot}:${input.now.toISOString()}`);
      const existingComments = post.comments.map((comment) => ({
        authorName: comment.author.nickname,
        content: comment.content,
        generatedByAvatar: comment.generatedByAvatar
      }));
      const generated = await generateSimulatedFeedComment({
        post,
        profile,
        existingComments,
        signal: input.signal,
        variantKey: `${slot}:${input.now.toISOString()}`
      });
      if (!generated.content) {
        existingSimulatedAuthorIds.add(profile.user.id);
        continue;
      }
      const comment = await prisma.comment.create({
        data: {
          postId: post.id,
          authorId: profile.user.id,
          content: generated.content,
          generatedByAvatar: true
        }
      });
      post.comments.push({
        authorId: profile.user.id,
        content: generated.content,
        generatedByAvatar: true,
        author: { username: profile.user.username, nickname: profile.user.nickname }
      });
      await prisma.aIGenerationLog.create({
        data: {
          userId: profile.user.id,
          taskType: "SIMULATION_FEED_COMMENT",
          sourceId: post.id,
          inputSummary: JSON.stringify({
            post: post.content.slice(0, 240),
            imageCount: safeJsonParse<string[]>(post.imageUrlsJson, []).length,
            existingCommentCount: existingComments.length
          }),
          output: generated.content,
          accepted: true,
          finalEditedContent: generated.content,
          model: generated.model,
          status: "SUCCEEDED",
          createdAt: input.now
        }
      });
      existingSimulatedAuthorIds.add(profile.user.id);
      createdCount += 1;
    }
  }

  return createdCount;
}

async function generateSimulatedFeedComment(input: {
  post: {
    id: string;
    content: string;
    imageUrlsJson: string;
    topicsJson: string;
    author: { id: string; username: string; nickname: string };
  };
  profile: {
    user: { id: string; username: string; nickname: string };
    persona: NonNullable<ReturnType<typeof findSimulatedPersonaByUsername>>;
  };
  existingComments: Array<{
    authorName: string;
    content: string;
    generatedByAvatar: boolean;
  }>;
  signal?: AbortSignal;
  variantKey: string;
}) {
  const postInput = {
    id: input.post.id,
    content: input.post.content,
    topicsJson: input.post.topicsJson,
    author: input.post.author
  };
  try {
    const decision = await decideAndGenerateSocialComment(
      {
        owner: {
          nickname: input.profile.persona.nickname,
          profileSummary: input.profile.persona.summary,
          knowledge: input.profile.persona.knowledge.map((item) => ({
            id: `${input.profile.persona.key}:${item.title}`,
            title: item.title,
            content: item.content
          }))
        },
        post: {
          id: input.post.id,
          content: input.post.content,
          imageUrls: safeJsonParse<string[]>(input.post.imageUrlsJson, []),
          authorName: input.post.author.nickname,
          existingComments: input.existingComments
        },
        relationshipSummary:
          "这是一个模拟用户分身在社区里进行自然互动。评论必须像真实用户，不要重复已有评论。"
      },
      input.signal
    );
    const text = decision.text?.trim();
    if (
      decision.decision === "COMMENT" &&
      text &&
      !isTooSimilarToExistingComment(text, input.existingComments)
    ) {
      return { content: text, model: decision.model };
    }
  } catch (error) {
    if (input.signal?.aborted) throw error;
  }

  return {
    content: buildDistinctSimulatedComment(
      input.profile.persona,
      postInput,
      input.existingComments,
      input.variantKey
    ),
    model: SIMULATION_MODEL
  };
}

async function createSimulatedDirectReplies(input: {
  now: Date;
  signal?: AbortSignal;
  simulatedProfiles: Array<{
    user: { id: string; username: string; nickname: string };
    persona: NonNullable<ReturnType<typeof findSimulatedPersonaByUsername>>;
  }>;
  maxReplies: number;
}) {
  let createdCount = 0;
  const simulatedUserIds = new Set(input.simulatedProfiles.map((profile) => profile.user.id));
  const conversations = await prisma.conversation.findMany({
    where: {
      type: "HUMAN",
      members: {
        some: {
          user: { username: { startsWith: "sim_" } }
        }
      }
    },
    orderBy: { updatedAt: "desc" },
    take: input.maxReplies * 4,
    include: {
      members: {
        include: {
          user: { select: { id: true, username: true, nickname: true } }
        }
      },
      messages: {
        where: { status: "SENT" },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          sender: { select: { id: true, username: true, nickname: true } }
        }
      }
    }
  });

  for (const conversation of conversations) {
    assertNotAborted(input.signal);
    if (createdCount >= input.maxReplies) break;

    const latest = conversation.messages[0];
    if (!latest?.senderId || simulatedUserIds.has(latest.senderId)) continue;

    const simulatedMember = conversation.members.find((member) =>
      isSimulatedUsername(member.user.username)
    );
    if (!simulatedMember) continue;

    const profile = input.simulatedProfiles.find(
      (candidate) => candidate.user.id === simulatedMember.userId
    );
    if (!profile) continue;

    const content = buildSimulatedDirectReply(profile.persona, {
      id: latest.id,
      content: latest.content,
      sender: latest.sender
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: profile.user.id,
        content,
        senderMode: "AI_PROXY",
        createdAt: input.now
      }
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: input.now }
    });
    await prisma.aIGenerationLog.create({
      data: {
        userId: profile.user.id,
        taskType: "SIMULATION_DIRECT_REPLY",
        sourceId: latest.id,
        conversationId: conversation.id,
        messageId: message.id,
        inputSummary: latest.content.slice(0, 240),
        output: content,
        accepted: true,
        finalEditedContent: content,
        model: SIMULATION_MODEL,
        status: "SUCCEEDED",
        createdAt: input.now
      }
    });
    createdCount += 1;
  }

  return createdCount;
}

export async function runSimulationWorkerLoop(options: SimulationWorkerOptions = {}) {
  const intervalMs = Number(process.env.SIMULATION_WORKER_INTERVAL_MS || 8000);
  while (!options.signal?.aborted) {
    await runSimulationWorkerOnce(options);
    await sleep(Math.max(1000, intervalMs), undefined, { signal: options.signal });
  }
}
