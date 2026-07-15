import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function avatar(seed: string) {
  return `https://api.dicebear.com/9.x/notionists-neutral/svg?seed=${encodeURIComponent(seed)}`;
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

  await prisma.follow.createMany({
    data: [
      { followerId: demo.id, followingId: friends[0].id },
      { followerId: demo.id, followingId: friends[2].id },
      { followerId: friends[0].id, followingId: demo.id },
      { followerId: friends[1].id, followingId: demo.id },
      { followerId: friends[3].id, followingId: demo.id }
    ]
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
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
