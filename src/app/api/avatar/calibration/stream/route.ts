import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calibrationKindSchema } from "@/lib/schemas";
import { CALIBRATION_SCENARIOS } from "@/lib/agent/knowledge";
import { createCalibrationReplyStream } from "@/lib/ai";

type StreamEvent =
  | { type: "start"; kind: string }
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
  const kind = calibrationKindSchema.safeParse(
    typeof body === "object" && body ? (body as { kind?: unknown }).kind : undefined
  );
  if (!kind.success) return Response.json({ error: "校准场景无效" }, { status: 400 });

  const [avatar, personality, knowledge] = await Promise.all([
    prisma.avatarProfile.findUnique({ where: { userId: user.id } }),
    prisma.personalityProfile.findUnique({ where: { userId: user.id } }),
    prisma.avatarKnowledgePage.findMany({
      where: {
        userId: user.id,
        enabled: true,
        confirmationStatus: { in: ["AUTO", "CONFIRMED"] }
      },
      orderBy: { updatedAt: "desc" },
      take: 20
    })
  ]);
  if (!avatar) return Response.json({ error: "请先构建分身" }, { status: 409 });

  const scenario = CALIBRATION_SCENARIOS[kind.data].scenario;
  await prisma.avatarCalibrationCase.upsert({
    where: { userId_kind: { userId: user.id, kind: kind.data } },
    create: {
      userId: user.id,
      kind: kind.data,
      scenario,
      generatedResponse: "",
      status: "GENERATING",
      knowledgeRevision: avatar.knowledgeRevision
    },
    update: {
      scenario,
      generatedResponse: "",
      editedResponse: null,
      status: "GENERATING",
      knowledgeRevision: avatar.knowledgeRevision
    }
  });
  await prisma.avatarProfile.update({
    where: { userId: user.id },
    data: { status: "CALIBRATING", calibratedAt: null }
  });

  const modelInput = {
    kind: kind.data,
    scenario,
    profileSummary: personality?.summary || "暂无画像",
    knowledge: knowledge.map((page) => ({
      id: page.id,
      category: page.category,
      title: page.title,
      content: page.content
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
          // The browser may have navigated away.
        }
      };

      enqueue({ type: "start", kind: kind.data });
      try {
        const result = await createCalibrationReplyStream(modelInput, request.signal);
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
              await prisma.avatarCalibrationCase.update({
                where: { userId_kind: { userId: user.id, kind: kind.data } },
                data: { generatedResponse: accumulated }
              });
            }
          }
        }

        await prisma.avatarCalibrationCase.update({
          where: { userId_kind: { userId: user.id, kind: kind.data } },
          data: { generatedResponse: accumulated, status: "GENERATED" }
        });
        enqueue({ type: "done", streamed });
      } catch (error) {
        await prisma.avatarCalibrationCase.update({
          where: { userId_kind: { userId: user.id, kind: kind.data } },
          data: {
            generatedResponse: accumulated,
            status:
              request.signal.aborted ||
              (error instanceof Error && error.name === "AbortError")
                ? "CANCELLED"
                : "ERROR"
          }
        });
        if (!request.signal.aborted) {
          enqueue({ type: "error", message: "校准回复生成失败，请重试" });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
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
