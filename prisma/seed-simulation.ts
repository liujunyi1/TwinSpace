import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  simulatedPersonas,
  type SimulatedPersona
} from "../src/lib/simulation/personas";

const prisma = new PrismaClient();

function avatar(seed: string) {
  return `https://api.dicebear.com/9.x/notionists-neutral/svg?seed=${encodeURIComponent(seed)}`;
}

function directKey(firstUserId: string, secondUserId: string) {
  return `dm:${[firstUserId, secondUserId].sort().join(":")}`;
}

function simulatedComment(persona: SimulatedPersona, postContent: string) {
  const templates = [
    `这条很有共鸣，尤其是你写到的这个瞬间。${persona.commentStyle}`,
    `看到这里会觉得很真实，不是空泛的分享。${persona.commentStyle}`,
    `这个细节我喜欢，能感觉到你是真的在经历它。${persona.commentStyle}`,
    `读完会想接着听你展开说说。${persona.commentStyle}`
  ];
  return templates[(persona.key.length + postContent.length) % templates.length];
}

async function upsertFollow(followerId: string, followingId: string) {
  if (followerId === followingId) return;
  await prisma.follow.upsert({
    where: { followerId_followingId: { followerId, followingId } },
    update: {},
    create: { followerId, followingId }
  });
}

async function seedPersona(persona: SimulatedPersona, passwordHash: string) {
  const user = await prisma.user.upsert({
    where: { username: persona.username },
    update: {
      email: persona.email,
      nickname: persona.nickname,
      avatarUrl: avatar(persona.avatarSeed),
      bio: persona.bio
    },
    create: {
      username: persona.username,
      email: persona.email,
      nickname: persona.nickname,
      passwordHash,
      avatarUrl: avatar(persona.avatarSeed),
      bio: persona.bio
    }
  });

  await prisma.personalityProfile.upsert({
    where: { userId: user.id },
    update: {
      summary: persona.summary,
      traitsJson: JSON.stringify({
        labels: persona.traits,
        occupation: persona.occupation,
        city: persona.city,
        interestTopics: persona.interests
      }),
      communicationStyle: persona.communicationStyle,
      socialStyle: persona.socialStyle,
      emotionalStyle: persona.emotionalStyle,
      replyLength: persona.replyLength,
      emojiPreference: persona.emojiPreference,
      aiAutonomyLevel: persona.aiAutonomyLevel
    },
    create: {
      userId: user.id,
      summary: persona.summary,
      traitsJson: JSON.stringify({
        labels: persona.traits,
        occupation: persona.occupation,
        city: persona.city,
        interestTopics: persona.interests
      }),
      communicationStyle: persona.communicationStyle,
      socialStyle: persona.socialStyle,
      emotionalStyle: persona.emotionalStyle,
      replyLength: persona.replyLength,
      emojiPreference: persona.emojiPreference,
      aiAutonomyLevel: persona.aiAutonomyLevel
    }
  });

  await prisma.preference.deleteMany({
    where: {
      userId: user.id,
      category: { in: ["兴趣话题", "人格标签", "评论风格", "私信风格"] }
    }
  });
  await prisma.preference.createMany({
    data: [
      ...persona.interests.map((value) => ({ userId: user.id, category: "兴趣话题", value })),
      ...persona.traits.map((value) => ({ userId: user.id, category: "人格标签", value })),
      { userId: user.id, category: "评论风格", value: persona.commentStyle },
      { userId: user.id, category: "私信风格", value: persona.dmStyle }
    ]
  });

  await prisma.memory.deleteMany({
    where: { userId: user.id, sourceType: "SIMULATION_FIXTURE" }
  });
  await prisma.memory.createMany({
    data: persona.memories.map((memory) => ({
      userId: user.id,
      type: memory.type,
      content: memory.content,
      sourceType: "SIMULATION_FIXTURE",
      sourceId: persona.key,
      confidence: memory.confidence ?? 0.9,
      status: "CONFIRMED",
      confirmedAt: new Date()
    }))
  });

  await prisma.avatarProfile.upsert({
    where: { userId: user.id },
    update: {
      privateName: `${persona.nickname}的分身`,
      privateAvatarUrl: avatar(`${persona.avatarSeed}-avatar`),
      status: "ACTIVE",
      knowledgeRevision: 1,
      policyRevision: 1,
      calibratedAt: new Date()
    },
    create: {
      userId: user.id,
      privateName: `${persona.nickname}的分身`,
      privateAvatarUrl: avatar(`${persona.avatarSeed}-avatar`),
      status: "ACTIVE",
      knowledgeRevision: 1,
      policyRevision: 1,
      calibratedAt: new Date()
    }
  });

  const source = await prisma.avatarKnowledgeSource.upsert({
    where: {
      userId_kind_sourceKey: {
        userId: user.id,
        kind: "SIMULATION_PERSONA",
        sourceKey: persona.key
      }
    },
    update: {
      label: `${persona.nickname}模拟用户画像`,
      content: JSON.stringify({
        summary: persona.summary,
        communicationStyle: persona.communicationStyle,
        socialStyle: persona.socialStyle,
        emotionalStyle: persona.emotionalStyle,
        commentStyle: persona.commentStyle,
        dmStyle: persona.dmStyle
      }),
      enabled: true
    },
    create: {
      userId: user.id,
      kind: "SIMULATION_PERSONA",
      sourceKey: persona.key,
      label: `${persona.nickname}模拟用户画像`,
      content: JSON.stringify({
        summary: persona.summary,
        communicationStyle: persona.communicationStyle,
        socialStyle: persona.socialStyle,
        emotionalStyle: persona.emotionalStyle,
        commentStyle: persona.commentStyle,
        dmStyle: persona.dmStyle
      })
    }
  });

  await prisma.avatarKnowledgePage.deleteMany({
    where: { userId: user.id, category: "persona" }
  });
  for (const item of persona.knowledge) {
    const knowledge = await prisma.avatarKnowledgePage.create({
      data: {
        userId: user.id,
        category: item.category,
        title: item.title,
        content: item.content,
        confidence: item.confidence ?? 0.9,
        confirmationStatus: "CONFIRMED",
        revision: 1
      }
    });
    await prisma.avatarKnowledgeCitation.create({
      data: { knowledgeId: knowledge.id, sourceId: source.id }
    });
  }

  await prisma.avatarAgentSetting.upsert({
    where: { userId: user.id },
    update: {
      enabled: true,
      defaultMode: "PROXY",
      assistAutoDraft: false,
      delayMode: "SHORT",
      customDelaySeconds: 20,
      sendBufferSeconds: 5,
      timezone: "Asia/Shanghai",
      activeWindowsJson: "[]",
      receiveAi: true,
      policyRevision: 1
    },
    create: {
      userId: user.id,
      enabled: true,
      defaultMode: "PROXY",
      assistAutoDraft: false,
      delayMode: "SHORT",
      customDelaySeconds: 20,
      sendBufferSeconds: 5,
      timezone: "Asia/Shanghai",
      activeWindowsJson: "[]",
      receiveAi: true,
      policyRevision: 1
    }
  });

  await prisma.socialAgentPolicy.upsert({
    where: { userId: user.id },
    update: {
      enabled: true,
      mode: "AUTO",
      scope: "PUBLIC",
      activeWindowsJson: "[]",
      dailyBatchMin: 4,
      dailyBatchMax: 8,
      dailyCommentLimit: 8,
      authorCooldownHours: 2,
      policyRevision: 1
    },
    create: {
      userId: user.id,
      enabled: true,
      mode: "AUTO",
      scope: "PUBLIC",
      timezone: "Asia/Shanghai",
      activeWindowsJson: "[]",
      dailyBatchMin: 4,
      dailyBatchMax: 8,
      dailyCommentLimit: 8,
      authorCooldownHours: 2,
      policyRevision: 1
    }
  });

  for (const calibration of [
    {
      kind: "DAILY_CHAT",
      scenario: "朋友问你今天过得怎么样。",
      response: `今天还算稳定，主要在处理${persona.interests[0]}相关的事情。${persona.dmStyle}`
    },
    {
      kind: "COMFORT",
      scenario: "朋友说最近有点累。",
      response: `听起来这段时间消耗不小。${persona.dmStyle}`
    },
    {
      kind: "REFUSAL",
      scenario: "朋友提出一个不方便答应的请求。",
      response: "这件事我可能没法直接答应，但可以一起看看有没有别的办法。"
    },
    {
      kind: "FEED_COMMENT",
      scenario: "朋友发布了一条公开动态。",
      response: `这条动态挺真实的。${persona.commentStyle}`
    }
  ]) {
    await prisma.avatarCalibrationCase.upsert({
      where: { userId_kind: { userId: user.id, kind: calibration.kind } },
      update: {
        scenario: calibration.scenario,
        generatedResponse: calibration.response,
        editedResponse: calibration.response,
        status: "APPROVED",
        knowledgeRevision: 1
      },
      create: {
        userId: user.id,
        kind: calibration.kind,
        scenario: calibration.scenario,
        generatedResponse: calibration.response,
        editedResponse: calibration.response,
        status: "APPROVED",
        knowledgeRevision: 1
      }
    });
  }

  return { user, persona };
}

async function main() {
  const passwordHash = await bcrypt.hash("TwinSpace123!", 12);
  const profiles = [];
  for (const persona of simulatedPersonas) {
    profiles.push(await seedPersona(persona, passwordHash));
  }

  const realUsers = await prisma.user.findMany({
    where: { NOT: { username: { startsWith: "sim_" } } },
    select: { id: true },
    take: 6
  });
  const anchorUserIds = realUsers.map((user) => user.id);

  for (let index = 0; index < profiles.length; index += 1) {
    const current = profiles[index].user;
    const next = profiles[(index + 1) % profiles.length].user;
    const secondNext = profiles[(index + 2) % profiles.length].user;
    await upsertFollow(current.id, next.id);
    await upsertFollow(next.id, current.id);
    await upsertFollow(current.id, secondNext.id);
    for (const anchorUserId of anchorUserIds.slice(0, 2)) {
      await upsertFollow(current.id, anchorUserId);
      await upsertFollow(anchorUserId, current.id);
    }
  }

  const createdPosts = [];
  for (const profile of profiles) {
    for (const post of profile.persona.posts) {
      const existing = await prisma.post.findFirst({
        where: { authorId: profile.user.id, content: post.content }
      });
      const created =
        existing ||
        (await prisma.post.create({
          data: {
            authorId: profile.user.id,
            content: post.content,
            topicsJson: JSON.stringify(post.topics),
            location: post.location || profile.persona.city,
            visibility: "PUBLIC",
            allowComments: true
          }
        }));
      createdPosts.push(created);
    }
  }

  for (let index = 0; index < createdPosts.length; index += 1) {
    const post = createdPosts[index];
    const existingCommentAuthors = await prisma.comment.findMany({
      where: {
        postId: post.id,
        author: { username: { startsWith: "sim_" } }
      },
      select: { authorId: true }
    });
    const existingAuthorIds = new Set(existingCommentAuthors.map((comment) => comment.authorId));
    const commenters = [profiles[(index + 3) % profiles.length], profiles[(index + 7) % profiles.length]]
      .filter((profile) => profile.user.id !== post.authorId)
      .filter((profile) => !existingAuthorIds.has(profile.user.id));

    if (commenters.length > 0) {
      await prisma.comment.createMany({
        data: commenters.map(({ user, persona }) => ({
          postId: post.id,
          authorId: user.id,
          content: simulatedComment(persona, post.content),
          generatedByAvatar: true
        }))
      });
    }
  }

  for (let index = 0; index < Math.min(5, profiles.length, anchorUserIds.length); index += 1) {
    const simulated = profiles[index];
    const anchorUserId = anchorUserIds[index % anchorUserIds.length];
    const key = directKey(anchorUserId, simulated.user.id);
    const existingConversation = await prisma.conversation.findUnique({
      where: { directKey: key }
    });
    if (existingConversation) continue;

    const conversation = await prisma.conversation.create({
      data: {
        title: `${simulated.persona.nickname} 与真实用户`,
        type: "HUMAN",
        aiMode: "PROXY",
        directKey: key,
        members: {
          create: [
            { userId: anchorUserId, role: "OWNER" },
            { userId: simulated.user.id, role: "MEMBER" }
          ]
        }
      }
    });
    await prisma.conversationAgentSetting.createMany({
      data: [
        {
          conversationId: conversation.id,
          userId: anchorUserId,
          modeOverride: "MANUAL",
          activeWindowMode: "INHERIT",
          receiveAiFromContact: "ALLOW",
          revision: 1
        },
        {
          conversationId: conversation.id,
          userId: simulated.user.id,
          modeOverride: "PROXY",
          activeWindowMode: "INHERIT",
          receiveAiFromContact: "ALLOW",
          revision: 1
        }
      ]
    });
    await prisma.message.createMany({
      data: [
        {
          conversationId: conversation.id,
          senderId: anchorUserId,
          content: "你好，想和你聊聊最近的状态。",
          senderMode: "HUMAN"
        },
        {
          conversationId: conversation.id,
          senderId: simulated.user.id,
          content: `我在。${simulated.persona.dmStyle}`,
          senderMode: "AI_PROXY"
        }
      ]
    });
  }

  const simulatedUsers = await prisma.user.count({ where: { username: { startsWith: "sim_" } } });
  const simulatedPosts = await prisma.post.count({
    where: { author: { username: { startsWith: "sim_" } } }
  });
  const simulatedComments = await prisma.comment.count({
    where: { author: { username: { startsWith: "sim_" } } }
  });
  console.log(
    `Simulation seed complete: users=${simulatedUsers}, posts=${simulatedPosts}, comments=${simulatedComments}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
