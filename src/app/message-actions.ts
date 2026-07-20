"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { markConversationReadThroughMessage } from "@/lib/message-unread";

export async function markConversationReadAction(
  conversationId: string,
  messageId: string
) {
  if (!conversationId || !messageId) {
    return { ok: false, changed: false, error: "缺少会话或消息" };
  }
  const user = await requireUser();
  const changed = await markConversationReadThroughMessage(
    user.id,
    conversationId,
    messageId
  );
  if (changed) revalidatePath("/messages", "layout");
  return { ok: true, changed };
}
