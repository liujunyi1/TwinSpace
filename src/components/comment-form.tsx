"use client";

import { FormEvent, useRef, useState } from "react";
import { Send } from "lucide-react";
import { createCommentAction } from "@/app/actions";

export function CommentForm({ postId }: { postId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = formRef.current;
    if (!form || submitting) return;

    const formData = new FormData(form);
    const content = String(formData.get("content") || "").trim();
    if (!content) return;

    setSubmitting(true);
    (async () => {
      try {
        await createCommentAction(formData);
        form.reset();
      } finally {
        setSubmitting(false);
      }
    })();
  }

  return (
    <form ref={formRef} onSubmit={submitComment} className="flex gap-2">
      <input type="hidden" name="postId" value={postId} />
      <input
        name="content"
        className="field h-11 flex-1 rounded-full"
        placeholder="写下你的评论"
        aria-label="评论内容"
        disabled={submitting}
      />
      <button
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-white disabled:opacity-60"
        aria-label="发布评论"
        disabled={submitting}
      >
        <Send className="h-4 w-4" aria-hidden />
      </button>
    </form>
  );
}
