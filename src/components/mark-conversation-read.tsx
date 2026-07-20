"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markConversationReadAction } from "@/app/message-actions";

export function MarkConversationRead({
  conversationId,
  messageId
}: {
  conversationId: string;
  messageId: string | null;
}) {
  const router = useRouter();
  const submitted = useRef(false);

  useEffect(() => {
    if (!messageId || submitted.current) return;
    submitted.current = true;
    void markConversationReadAction(conversationId, messageId).then((result) => {
      if (result.changed) router.refresh();
    });
  }, [conversationId, messageId, router]);

  return null;
}
