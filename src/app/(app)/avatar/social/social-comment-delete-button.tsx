"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteSocialCommentAction } from "@/app/social-agent-actions";

export function SocialCommentDeleteButton({ commentId }: { commentId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    if (!window.confirm("确定无痕删除这条 AI 分身评论吗？")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteSocialCommentAction(commentId);
      if (!result.ok) {
        setError(result.error || "删除失败");
        return;
      }
      router.refresh();
    });
  };

  return (
    <span className="shrink-0">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-white disabled:opacity-50"
        aria-label="无痕删除 AI 分身评论"
        title="无痕删除 AI 分身评论"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
      {error ? <span className="sr-only" role="alert">{error}</span> : null}
    </span>
  );
}
