import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { simulatedPersonas, type SimulatedPersona } from "../src/lib/simulation/personas";

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
  const index = (persona.key.length + postContent.length) % templates.length;
  return templates[index];
}

async function seedSimulatedUsers(input: {
  passwordHash: string;
  anchorUserIds: string[];
}) {
  const users = [];
  for (const persona of simulatedPersonas) {
    const user = await prisma.user.create({
      data: {
        username: persona.username,
        email: persona.email,
        nickname: persona.nickname,
        passwordHash: input.passwordHash,
        avatarUrl: avatar(persona.avatarSeed),
        bio: persona.bio
      }
    });
    users.push({ user, persona });

    await prisma.personalityProfile.create({
      data: {
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

    await prisma.preference.createMany({
      data: [
        ...persona.interests.map((value) => ({ userId: user.id, category: "兴趣话题", value })),
        ...persona.traits.map((value) => ({ userId: user.id, category: "人格标签", value })),
        { userId: user.id, category: "评论风格", value: persona.commentStyle },
        { userId: user.id, category: "私信风格", value: persona.dmStyle }
      ]
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

    const knowledgeRevision = 1;
    await prisma.avatarProfile.create({
      data: {
        userId: user.id,
        privateName: `${persona.nickname}的分身`,
        privateAvatarUrl: avatar(`${persona.avatarSeed}-avatar`),
        status: "ACTIVE",
        knowledgeRevision,
        policyRevision: 1,
        calibratedAt: new Date()
      }
    });

    const source = await prisma.avatarKnowledgeSource.create({
      data: {
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

    for (const item of persona.knowledge) {
      const knowledge = await prisma.avatarKnowledgePage.create({
        data: {
          userId: user.id,
          category: item.category,
          title: item.title,
          content: item.content,
          confidence: item.confidence ?? 0.9,
          confirmationStatus: "CONFIRMED",
          revision: knowledgeRevision
        }
      });
      await prisma.avatarKnowledgeCitation.create({
        data: { knowledgeId: knowledge.id, sourceId: source.id }
      });
    }

    await prisma.avatarAgentSetting.create({
      data: {
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

    await prisma.socialAgentPolicy.create({
      data: {
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

    await prisma.avatarCalibrationCase.createMany({
      data: [
        {
          userId: user.id,
          kind: "DAILY_CHAT",
          scenario: "朋友问你今天过得怎么样。",
          generatedResponse: `今天还算稳定，主要在处理${persona.interests[0]}相关的事情。${persona.dmStyle}`,
          editedResponse: `今天还算稳定，主要在处理${persona.interests[0]}相关的事情。${persona.dmStyle}`,
          status: "APPROVED",
          knowledgeRevision
        },
        {
          userId: user.id,
          kind: "COMFORT",
          scenario: "朋友说最近有点累。",
          generatedResponse: `听起来这段时间消耗不小。${persona.dmStyle}`,
          editedResponse: `听起来这段时间消耗不小。${persona.dmStyle}`,
          status: "APPROVED",
          knowledgeRevision
        },
        {
          userId: user.id,
          kind: "REFUSAL",
          scenario: "朋友提出一个不方便答应的请求。",
          generatedResponse: "这件事我可能没法直接答应，但可以一起看看有没有别的办法。",
          editedResponse: "这件事我可能没法直接答应，但可以一起看看有没有别的办法。",
          status: "APPROVED",
          knowledgeRevision
        },
        {
          userId: user.id,
          kind: "FEED_COMMENT",
          scenario: "朋友发布了一条公开动态。",
          generatedResponse: `这条动态挺真实的。${persona.commentStyle}`,
          editedResponse: `这条动态挺真实的。${persona.commentStyle}`,
          status: "APPROVED",
          knowledgeRevision
        }
      ]
    });
  }

  const followRows = [];
  for (let index = 0; index < users.length; index += 1) {
    const current = users[index].user;
    const next = users[(index + 1) % users.length].user;
    const secondNext = users[(index + 2) % users.length].user;
    followRows.push({ followerId: current.id, followingId: next.id });
    followRows.push({ followerId: next.id, followingId: current.id });
    followRows.push({ followerId: current.id, followingId: secondNext.id });
    for (const anchorUserId of input.anchorUserIds.slice(0, 2)) {
      followRows.push({ followerId: current.id, followingId: anchorUserId });
      followRows.push({ followerId: anchorUserId, followingId: current.id });
    }
  }
  await prisma.follow.createMany({ data: followRows });

  const createdPosts = [];
  for (const profile of users) {
    for (const post of profile.persona.posts) {
      const created = await prisma.post.create({
        data: {
          authorId: profile.user.id,
          content: post.content,
          topicsJson: JSON.stringify(post.topics),
          location: post.location || profile.persona.city,
          visibility: "PUBLIC",
          allowComments: true
        }
      });
      createdPosts.push(created);
    }
  }

  for (let index = 0; index < createdPosts.length; index += 1) {
    const post = createdPosts[index];
    const authors = [
      users[(index + 3) % users.length],
      users[(index + 7) % users.length]
    ].filter((profile) => profile.user.id !== post.authorId);
    await prisma.comment.createMany({
      data: authors.map(({ user, persona }) => ({
        postId: post.id,
        authorId: user.id,
        content: simulatedComment(persona, post.content),
        generatedByAvatar: true
      }))
    });
  }

  for (let index = 0; index < Math.min(5, users.length); index += 1) {
    const simulated = users[index];
    const anchorUserId = input.anchorUserIds[index % input.anchorUserIds.length];
    const conversation = await prisma.conversation.create({
      data: {
        title: `${simulated.persona.nickname} 与真实用户`,
        type: "HUMAN",
        aiMode: "PROXY",
        directKey: directKey(anchorUserId, simulated.user.id),
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

  return users.map((profile) => profile.user);
}

async function main() {
  await prisma.conversation.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("TwinSpace123!", 12);
  const demo = await prisma.user.create({
    data: {
      username: "demo",
      email: "demo@twinspace.local",
      nickname: "林澈",
      passwordHash,
      avatarUrl: avatar("Lin"),
      bio: "慢热但认真，喜欢把复杂问题拆小。"
    }
  });

  const friends = await Promise.all(
    [
      ["qingluo", "青络", "解决问题前会先陪你把话说顺。"],
      ["muyu", "木鱼", "咖啡、跑步和周末小展览爱好者。"],
      ["hannah", "Hannah", "冷静复盘型朋友，擅长把卡点说清楚。"],
      ["ake", "阿珂", "经常分享城市角落和新歌。"],
      ["orbit", "Orbit", "AI 观察员"],
      ["mira", "Mira", "AI 对话角色"]
    ].map(([username, nickname, bio]) =>
      prisma.user.create({
        data: {
          username,
          email: `${username}@twinspace.local`,
          nickname,
          passwordHash,
          avatarUrl: avatar(username),
          bio
        }
      })
    )
  );

  const stage2Users = await Promise.all(
    [
      {
        username: "stage2_alice",
        nickname: "阶段二 Alice",
        bio: "阶段二代理聊天验收账号，默认使用 AI 托管。",
        defaultMode: "PROXY",
        assistAutoDraft: false,
        socialMode: "AUTO",
        socialScope: "FOLLOWING"
      },
      {
        username: "stage2_bob",
        nickname: "阶段二 Bob",
        bio: "阶段二代理聊天验收账号，默认使用 AI 辅助。",
        defaultMode: "ASSIST",
        assistAutoDraft: true,
        socialMode: "SUGGEST",
        socialScope: "MUTUAL"
      }
    ].map((account) =>
      prisma.user.create({
        data: {
          username: account.username,
          email: `${account.username}@twinspace.local`,
          nickname: account.nickname,
          passwordHash,
          avatarUrl: avatar(account.username),
          bio: account.bio
        }
      })
    )
  );

  await prisma.follow.createMany({
    data: [
      { followerId: demo.id, followingId: friends[0].id },
      { followerId: demo.id, followingId: friends[2].id },
      { followerId: friends[0].id, followingId: demo.id },
      { followerId: friends[1].id, followingId: demo.id },
      { followerId: friends[3].id, followingId: demo.id },
      { followerId: stage2Users[0].id, followingId: stage2Users[1].id },
      { followerId: stage2Users[1].id, followingId: stage2Users[0].id }
    ]
  });

  const simulatedUsers = await seedSimulatedUsers({
    passwordHash,
    anchorUserIds: [demo.id, ...friends.map((friend) => friend.id), ...stage2Users.map((user) => user.id)]
  });

  await prisma.personalityProfile.create({
    data: {
      userId: demo.id,
      summary:
        "你是偏理性、慢热但很可靠的人。面对压力时会先拆任务，再找一个能落地的小动作；表达上喜欢清楚、克制、有一点轻松感。",
      traitsJson: JSON.stringify({
        labels: ["理性", "慢热", "专注", "可靠", "边界清晰"],
        extroversion: 2,
        emotionalExpression: 3,
        directness: 4,
        socialInitiative: 2,
        interestTopics: ["职业发展", "运动户外", "城市生活"],
        comfortPreference: ["先共情", "帮我复盘"],
        boundaries: ["财务隐私", "过度追问"]
      }),
      communicationStyle: "先给结论，再补充理由；语气克制但不冷淡。",
      socialStyle: "偏熟人社交，重视低压力、可持续的互动。",
      emotionalStyle: "需要先被理解，再进入解决问题。",
      replyLength: "两三句清楚说完",
      emojiPreference: "偶尔用",
      aiAutonomyLevel: "只在我点按钮时帮忙"
    }
  });

  await prisma.preference.createMany({
    data: [
      "职业发展",
      "运动户外",
      "城市生活",
      "少用感叹号",
      "回复短一点"
    ].map((value) => ({
      userId: demo.id,
      category: value.includes("用") || value.includes("回复") ? "表达习惯" : "喜欢的话题",
      value
    }))
  });

  await prisma.memory.createMany({
    data: [
      {
        userId: demo.id,
        type: "兴趣偏好",
        content: "用户喜欢用跑步整理思路。",
        sourceType: "注册问答",
        confidence: 0.92,
        status: "CONFIRMED",
        confirmedAt: new Date()
      },
      {
        userId: demo.id,
        type: "表达习惯",
        content: "用户不喜欢过于夸张的语气和连续感叹号。",
        sourceType: "注册问答",
        confidence: 0.88,
        status: "CONFIRMED",
        confirmedAt: new Date()
      },
      {
        userId: demo.id,
        type: "近期事件",
        content: "用户提到这周在准备一次项目展示。",
        sourceType: "分身聊天",
        confidence: 0.7,
        status: "PENDING"
      }
    ]
  });

  const authors = [demo, ...friends.slice(0, 4)];
  const postTexts = [
    "今天把待办拆成了三层，突然发现最难的不是开始，而是承认有些事需要先放下。",
    "午休绕学校走了一圈，风比空调更像重启按钮。",
    "如果一段关系里总要猜对方在想什么，可能就需要一场更直接的对话。",
    "最近在练习把“我应该”换成“我选择”，体验还挺不一样。",
    "周末想找一个安静的展，看完能坐下来喝杯咖啡那种。",
    "今天的好消息：一个拖了很久的小 bug 终于被我定位到了。",
    "越忙的时候越需要把聊天说短，但不是把关心也变少。",
    "有没有适合通勤听的播客？最好是 30 分钟以内。"
  ];

  const posts = [];
  for (let i = 0; i < postTexts.length; i += 1) {
    const post = await prisma.post.create({
      data: {
        authorId: authors[i % authors.length].id,
        content: postTexts[i],
        topicsJson: JSON.stringify(i % 2 === 0 ? ["复盘", "关系"] : ["日常", "城市"]),
        location: i % 3 === 0 ? "上海" : null,
        allowComments: true
      }
    });
    posts.push(post);
  }

  for (const post of posts) {
    await prisma.postLike.createMany({
      data: [demo.id, friends[0].id, friends[1].id]
        .filter((userId) => userId !== post.authorId)
        .map((userId) => ({ postId: post.id, userId }))
    });
    await prisma.comment.create({
      data: {
        postId: post.id,
        authorId: friends[2].id,
        content: "这个说法很准确，尤其是最后一句。"
      }
    });
    if (post.authorId !== demo.id && posts.indexOf(post) < 5) {
      await prisma.comment.create({
        data: {
          postId: post.id,
          authorId: demo.id,
          content: "我先记下这个角度，感觉可以拿来做一次复盘。"
        }
      });
    }
  }

  const conversations = [
    { title: "青络", type: "HUMAN", other: friends[0] },
    { title: "Hannah", type: "HUMAN", other: friends[2] },
    { title: "Orbit", type: "AI_CONTACT", other: friends[4] }
  ];

  for (const item of conversations) {
    const conversation = await prisma.conversation.create({
      data: {
        title: item.title,
        type: item.type,
        aiMode: item.type === "HUMAN" ? "MANUAL" : "MANUAL",
        directKey: item.type === "HUMAN" ? directKey(demo.id, item.other.id) : null,
        members: {
          create: [
            { userId: demo.id, role: "OWNER" },
            { userId: item.other.id, role: item.type === "AI_CONTACT" ? "AI" : "MEMBER" }
          ]
        }
      }
    });
    await prisma.message.createMany({
      data: [
        {
          conversationId: conversation.id,
          senderId: item.other.id,
          content:
            item.type === "AI_CONTACT"
              ? "我可以帮你把今天的动态整理成一条更自然的表达。"
              : "你最近在忙啥呢？",
          senderMode: item.type === "AI_CONTACT" ? "AI" : "HUMAN"
        },
        {
          conversationId: conversation.id,
          senderId: demo.id,
          content: "还在收尾项目，想尽量把节奏稳住。",
          senderMode: "HUMAN"
        }
      ]
    });
  }

  const stage2Revision = 1;
  const stage2CalibratedAt = new Date();
  const stage2Profiles = [
    {
      user: stage2Users[0],
      summary: "表达直接、友好，习惯先回应对方的重点，再给出简短追问。",
      communicationStyle: "自然、简洁、可靠，通常回复两三句。",
      socialStyle: "重视熟人之间稳定且不过度打扰的联系。",
      emotionalStyle: "先接住情绪，再讨论具体行动。",
      defaultMode: "PROXY",
      assistAutoDraft: false
      ,
      socialMode: "AUTO",
      socialScope: "FOLLOWING"
    },
    {
      user: stage2Users[1],
      summary: "语气温和、思路清楚，倾向先确认理解是否准确。",
      communicationStyle: "克制、具体，避免夸张表达。",
      socialStyle: "偏好低压力的日常交流。",
      emotionalStyle: "用简短共情表达支持。",
      defaultMode: "ASSIST",
      assistAutoDraft: true
      ,
      socialMode: "SUGGEST",
      socialScope: "MUTUAL"
    }
  ];

  for (const profile of stage2Profiles) {
    await prisma.personalityProfile.create({
      data: {
        userId: profile.user.id,
        summary: profile.summary,
        traitsJson: JSON.stringify({
          labels: ["友好", "清晰", "可靠"],
          expressionRules: ["回复简洁", "不连续使用感叹号"]
        }),
        communicationStyle: profile.communicationStyle,
        socialStyle: profile.socialStyle,
        emotionalStyle: profile.emotionalStyle,
        replyLength: "两三句",
        emojiPreference: "偶尔用",
        aiAutonomyLevel: profile.defaultMode
      }
    });
    await prisma.avatarProfile.create({
      data: {
        userId: profile.user.id,
        privateName: `${profile.user.nickname}的分身`,
        status: "ACTIVE",
        knowledgeRevision: stage2Revision,
        policyRevision: stage2Revision,
        calibratedAt: stage2CalibratedAt
      }
    });
    await prisma.avatarAgentSetting.create({
      data: {
        userId: profile.user.id,
        enabled: true,
        defaultMode: profile.defaultMode,
        assistAutoDraft: profile.assistAutoDraft,
        delayMode: "SHORT",
        customDelaySeconds: 60,
        sendBufferSeconds: 15,
        timezone: "Asia/Shanghai",
        activeWindowsJson: "[]",
        receiveAi: true,
        policyRevision: stage2Revision
      }
    });
    await prisma.socialAgentPolicy.create({
      data: {
        userId: profile.user.id,
        enabled: true,
        mode: profile.socialMode,
        scope: profile.socialScope,
        timezone: "Asia/Shanghai",
        activeWindowsJson: "[]",
        dailyBatchMin: 2,
        dailyBatchMax: 4,
        dailyCommentLimit: 3,
        authorCooldownHours: 24,
        policyRevision: stage2Revision
      }
    });
    await prisma.avatarCalibrationCase.createMany({
      data: [
        ["DAILY_CHAT", "朋友问你最近在忙什么。", "最近在收尾一些事情，节奏还算稳。你呢？"],
        ["COMFORT", "朋友说今天有些疲惫。", "听起来今天消耗挺大，先让自己缓一会儿也可以。"],
        ["REFUSAL", "朋友提出一个你不方便答应的请求。", "这次我可能没法答应，但可以一起看看有没有别的办法。"],
        ["FEED_COMMENT", "朋友分享了一条日常动态。", "这个瞬间挺有共鸣的，尤其是你提到的那个细节。"]
      ].map(([kind, scenario, generatedResponse]) => ({
        userId: profile.user.id,
        kind,
        scenario,
        generatedResponse,
        editedResponse: generatedResponse,
        status: "APPROVED",
        knowledgeRevision: stage2Revision
      }))
    });
  }

  await prisma.post.createMany({
    data: [
      {
        authorId: stage2Users[0].id,
        content: "阶段三验收动态：今天把一个复杂需求拆成了三个可以逐步确认的小问题。",
        topicsJson: JSON.stringify(["阶段三", "公开动态"]),
        visibility: "PUBLIC",
        allowComments: true
      },
      {
        authorId: stage2Users[1].id,
        content: "阶段三互关验收动态：周末准备去散步，想找一条安静、树多一点的路线。",
        topicsJson: JSON.stringify(["阶段三", "互相关注"]),
        visibility: "FRIENDS",
        allowComments: true
      }
    ]
  });

  const stage2Conversation = await prisma.conversation.create({
    data: {
      title: "阶段二代理聊天验收",
      type: "HUMAN",
      aiMode: "MANUAL",
      directKey: directKey(stage2Users[0].id, stage2Users[1].id),
      members: {
        create: [
          { userId: stage2Users[0].id, role: "OWNER" },
          { userId: stage2Users[1].id, role: "MEMBER" }
        ]
      }
    }
  });
  await prisma.conversationAgentSetting.createMany({
    data: [
      {
        conversationId: stage2Conversation.id,
        userId: stage2Users[0].id,
        modeOverride: "PROXY",
        activeWindowMode: "INHERIT",
        receiveAiFromContact: "ALLOW",
        revision: stage2Revision
      },
      {
        conversationId: stage2Conversation.id,
        userId: stage2Users[1].id,
        modeOverride: "ASSIST",
        activeWindowMode: "INHERIT",
        receiveAiFromContact: "ALLOW",
        revision: stage2Revision
      }
    ]
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: stage2Conversation.id,
        senderId: stage2Users[1].id,
        content: "这是一条用于触发 Alice 分身托管的真人消息。",
        senderMode: "HUMAN"
      },
      {
        conversationId: stage2Conversation.id,
        senderId: stage2Users[0].id,
        content: "收到，我们可以用这个会话验收辅助与托管模式。",
        senderMode: "HUMAN"
      }
    ]
  });

  const avatarSession = await prisma.avatarChatSession.create({
    data: { userId: demo.id, title: "默认对话" }
  });
  await prisma.avatarChatMessage.createMany({
    data: [
      {
        sessionId: avatarSession.id,
        role: "assistant",
        content: "今天状态怎么样？可以只说一个关键词。"
      },
      {
        sessionId: avatarSession.id,
        role: "user",
        content: "有点卡，但不是很焦虑。"
      },
      {
        sessionId: avatarSession.id,
        role: "assistant",
        content: "那先别急着给自己下判断。你更适合把卡点写成一个可验证的问题，再做一个小实验。"
      }
    ]
  });

  console.log("Seed complete. Demo account: demo / TwinSpace123!");
  console.log("Stage 2 accounts: stage2_alice / TwinSpace123!, stage2_bob / TwinSpace123!");
  console.log(`Simulation accounts: ${simulatedUsers.length} users / TwinSpace123!`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
