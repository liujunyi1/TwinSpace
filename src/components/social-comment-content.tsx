"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { editSocialCommentAction } from "@/app/social-agent-actions";

export function SocialCommentContent({
  commentId,
  authorName,
  content,
  editable,
  showAiBadge
}: {
  commentId: string;
  authorName?: string;
  content: string;
  editable: boolean;
  showAiBadge: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextContent = draft.trim();
    if (!nextContent || pending) return;

    setError(null);
    startTransition(async () => {
      const result = await editSocialCommentAction({ commentId, content: nextContent });
      if (!result.ok) {
        setError(result.error || "修改失败");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <form onSubmit={save} className="min-w-0 flex-1 space-y-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="textarea min-h-24 rounded-2xl py-3 text-sm leading-6"
          maxLength={500}
          autoFocus
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="grid h-8 w-8 place-items-center rounded-full bg-ink text-white disabled:opacity-50"
            aria-label="保存评论"
            title="保存评论"
          >
            <Check className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setDraft(content);
              setEditing(false);
              setError(null);
            }}
            className="grid h-8 w-8 place-items-center rounded-full bg-white text-muted disabled:opacity-50"
            aria-label="取消修改"
            title="取消修改"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
          {error ? <span className="text-xs text-red-600">{error}</span> : null}
        </div>
      </form>
    );
  }

  const body = (
    <span>
      {authorName ? <span className="font-semibold">{authorName}</span> : null}
      {showAiBadge ? (
        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
          AI 分身代理
        </span>
      ) : null}
      {authorName ? <span>：</span> : null}
      {content}
    </span>
  );

  if (!editable) {
    return <p className="text-sm leading-6">{body}</p>;
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="block w-full min-w-0 text-left text-sm leading-6"
      aria-label="修改 AI 分身评论"
      title="修改 AI 分身评论"
    >
      {body}
    </button>
  );
}
