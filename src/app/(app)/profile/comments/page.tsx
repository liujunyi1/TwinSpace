import Link from "next/link";
import { deleteCommentAction } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState } from "@/components/empty-state";
import { requireUser } from "@/lib/auth";
import { visiblePostWhere } from "@/lib/post-visibility";
import { prisma } from "@/lib/prisma";
import { formatRelativeTime } from "@/lib/utils";

export default async function MyCommentsPage() {
  const user = await requireUser();
  const comments = await prisma.comment.findMany({
    where: {
      authorId: user.id,
      post: { is: visiblePostWhere(user.id) }
    },
    orderBy: { createdAt: "desc" },
    include: { post: { include: { author: true } } }
  });

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">我的</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">历史评论</h1>
      </header>
      {comments.length ? (
        <div className="space-y-4">
          {comments.map((comment) => (
            <article key={comment.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm leading-6">{comment.content}</p>
                  <p className="mt-2 text-xs text-muted">{formatRelativeTime(comment.createdAt)}</p>
                </div>
                <form action={deleteCommentAction} className="shrink-0">
                  <input type="hidden" name="commentId" value={comment.id} />
                  <ConfirmSubmitButton message="确定删除这条评论吗？" />
                </form>
              </div>
              <div className="mt-4 rounded-[24px] bg-surface p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Link href={comment.post.authorId === user.id ? "/profile" : `/users/${comment.post.authorId}`}>
                    <Avatar name={comment.post.author.nickname} src={comment.post.author.avatarUrl} size="sm" />
                  </Link>
                  <div>
                    <p className="text-sm font-semibold">{comment.post.author.nickname}</p>
                    <p className="text-xs text-muted">原帖</p>
                  </div>
                </div>
                <p className="line-clamp-3 text-sm leading-6 text-muted">{comment.post.content}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="还没有评论记录" />
      )}
    </main>
  );
}
