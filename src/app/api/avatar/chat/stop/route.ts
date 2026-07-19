import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const stopSchema = z.object({
  assistantMessageId: z.string().min(1)
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const parsed = stopSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "缺少回复 ID" }, { status: 400 });

  const result = await prisma.avatarChatMessage.updateMany({
    where: {
      id: parsed.data.assistantMessageId,
      role: "assistant",
      status: "STREAMING",
      session: { userId: user.id }
    },
    data: { status: "STOPPED" }
  });
  return Response.json({ stopped: result.count > 0 });
}
