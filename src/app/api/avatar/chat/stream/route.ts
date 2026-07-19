import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAvatarReplyStream } from "@/lib/ai";

const requestSchema = z
  .object({
    content: z.string().trim().min(1).max(1000).optional(),
    userMessageId: z.string().min(1).optional(),
    assistantMessageId: z.string().min(1).optional()
  })
  .refine(
    (value) =>
      Boolean(value.content) ||
      Boolean(value.userMessageId && value.assistantMessageId),
    "缺少消息内容"
  );

type StreamEvent =
  | {
      type: "start";
      userMessage: {
        id: string;
        content: string;
        createdAt: string;
      };
      assistantId: string;
    }
  | { type: "delta"; delta: string }
  | { type: "replace"; text: string; streamed: false }
  | { type: "done"; streamed: boolean }
  | { type: "error"; message: string };

const encoder = new TextEncoder();

function eventLine(event: StreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "消息不能为空" }, { status: 400 });
  }

  const avatar = await prisma.avatarProfile.findUnique({ where: { userId: user.id } });
  if (!avatar || !["ACTIVE", "PAUSED"].includes(avatar.status)) {
    return Response.json({ error: "请先完成分身校准" }, { status: 409 });
  }

  let sessionId: string;
  let userMessage: { id: string; content: string; createdAt: Date };
  let assistantMessage: { id: string };

  if (parsed.data.userMessageId && parsed.data.assistantMessageId) {
    const existingAssistant = await prisma.avatarChatMessage.findFirst({
      where: {
        id: parsed.data.assistantMessageId,
        role: "assistant",
        session: { userId: user.id }
      }
    });
    if (!existingAssistant) {
      return Response.json({ error: "找不到要重新生成的回复" }, { status: 404 });
    }
    const existingUserMessage = await prisma.avatarChatMessage.findFirst({
      where: {
        id: parsed.data.userMessageId,
        role: "user",
        sessionId: existingAssistant.sessionId,
        session: { userId: user.id }
      }
    });
    if (!existingUserMessage) {
      return Response.json({ error: "找不到对应的用户消息" }, { status: 404 });
    }

    sessionId = existingAssistant.sessionId;
    userMessage = existingUserMessage;
    assistantMessage = await prisma.avatarChatMessage.update({
      where: { id: existingAssistant.id },
      data: {
        content: "",
        status: "STREAMING",
        replyToMessageId: existingUserMessage.id
      },
      select: { id: true }
    });
  } else {
    let session = await prisma.avatarChatSession.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" }
    });
    if (!session) {
      session = await prisma.avatarChatSession.create({
        data: { userId: user.id, title: "和我的分身聊聊" }
      });
    }
    sessionId = session.id;

    const created = await prisma.$transaction(async (tx) => {
      const nextUserMessage = await tx.avatarChatMessage.create({
        data: {
          sessionId: session.id,
          role: "user",
          content: parsed.data.content!,
          status: "COMPLETE"
        },
        select: { id: true, content: true, createdAt: true }
      });
      const nextAssistantMessage = await tx.avatarChatMessage.create({
        data: {
          sessionId: session.id,
          role: "assistant",
          content: "",
          status: "STREAMING",
          replyToMessageId: nextUserMessage.id
        },
        select: { id: true }
      });
      await tx.avatarChatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() }
      });
      return { nextUserMessage, nextAssistantMessage };
    });
    userMessage = created.nextUserMessage;
    assistantMessage = created.nextAssistantMessage;
  }

  const [profile, memories, knowledge, history] = await Promise.all([
    prisma.personalityProfile.findUnique({ where: { userId: user.id } }),
    prisma.memory.findMany({
      where: { userId: user.id, enabled: true, status: "CONFIRMED" },
      orderBy: { updatedAt: "desc" },
      take: 6
    }),
    prisma.avatarKnowledgePage.findMany({
      where: {
        userId: user.id,
        enabled: true,
        confirmationStatus: { in: ["AUTO", "CONFIRMED"] }
      },
      orderBy: { updatedAt: "desc" },
      take: 8
    }),
    prisma.avatarChatMessage.findMany({
      where: {
        sessionId,
        id: { not: assistantMessage.id },
        status: { not: "ERROR" }
      },
      orderBy: { createdAt: "desc" },
      take: 20
    })
  ]);

  const modelInput = {
    nickname: user.nickname,
    profileSummary: profile?.summary || "暂无画像",
    memories: [
      ...knowledge.map((page) => `${page.title}：${page.content}`),
      ...memories.map((memory) => memory.content)
    ].slice(0, 10),
    messages: history
      .reverse()
      .filter((message) => message.content)
      .map((message) => ({
        role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: message.content
      }))
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulated = "";
      let streamed = false;
      let lastPersistedAt = 0;
      const enqueue = (event: StreamEvent) => {
        try {
          controller.enqueue(eventLine(event));
        } catch {
          // The client may have stopped reading. Persistence still continues below.
        }
      };

      enqueue({
        type: "start",
        userMessage: {
          id: userMessage.id,
          content: userMessage.content,
          createdAt: userMessage.createdAt.toISOString()
        },
        assistantId: assistantMessage.id
      });

      try {
        const result = await createAvatarReplyStream(modelInput, request.signal);
        if (result.mode === "complete") {
          accumulated = result.text;
          enqueue({ type: "replace", text: accumulated, streamed: false });
        } else {
          streamed = true;
          for await (const delta of result.chunks) {
            if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
            if (!delta) continue;
            accumulated += delta;
            enqueue({ type: "delta", delta });
            if (Date.now() - lastPersistedAt >= 400) {
              lastPersistedAt = Date.now();
              await prisma.avatarChatMessage.update({
                where: { id: assistantMessage.id },
                data: { content: accumulated }
              });
            }
          }
        }

        const current = await prisma.avatarChatMessage.findUnique({
          where: { id: assistantMessage.id },
          select: { status: true }
        });
        if (request.signal.aborted || current?.status === "STOPPED") {
          await prisma.avatarChatMessage.update({
            where: { id: assistantMessage.id },
            data: { content: accumulated, status: "STOPPED" }
          });
          return;
        }
        await prisma.avatarChatMessage.update({
          where: { id: assistantMessage.id },
          data: { content: accumulated, status: "COMPLETE" }
        });
        enqueue({ type: "done", streamed });
      } catch (error) {
        const stopped =
          request.signal.aborted ||
          (error instanceof Error && error.name === "AbortError");
        await prisma.avatarChatMessage.update({
          where: { id: assistantMessage.id },
          data: {
            content: accumulated,
            status: stopped ? "STOPPED" : "ERROR"
          }
        });
        if (!stopped) enqueue({ type: "error", message: "回复生成失败，请重试" });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the consumer.
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}
