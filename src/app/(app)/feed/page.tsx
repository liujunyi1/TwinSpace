import Link from "next/link";
import { Heart, MessageCircle, Repeat2, Send, Bookmark, Search } from "lucide-react";
import {
  createCommentAction,
  deleteCommentAction,
  deletePostAction,
  repostAction,
  togglePostLikeAction
} from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState } from "@/components/empty-state";
import { ImageLightbox } from "@/components/image-lightbox";
import { TopBar } from "@/components/top-bar";
import { requireUser } from "@/lib/auth";
import { visiblePostWhere } from "@/lib/post-visibility";
import { prisma } from "@/lib/prisma";
import { formatRelativeTime, safeJsonParse } from "@/lib/utils";

export default async function FeedPage() {
  const user = await requireUser();
  const posts = await prisma.post.findMany({
    where: visiblePostWhere(user.id),
    orderBy: { createdAt: "desc" },
    include: {
      author: true,
      likes: true,
      reposts: true,
      comments: {
        orderBy: { createdAt: "asc" },
        include: { author: true, likes: true, replies: { include: { author: true } } }
      }
    }
  });

  return (
    <main className="page-shell">
      <TopBar
        title="动态"
        muted="社区"
        action={
          <div className="flex gap-2">
            <Link href="/search" className="grid h-10 w-10 place-items-center rounded-full bg-white" aria-label="搜索用户">
              <Search className="h-5 w-5" aria-hidden />
            </Link>
            <Link href="/create" className="btn-secondary h-10 px-4">
              发布
            </Link>
          </div>
        }
      />

      <section className="card mb-6 p-5">
        <p className="text-sm text-muted">当前可见动态概览</p>
        <p className="mt-2 text-lg text-muted">
          动态 <span className="text-3xl font-semibold text-ink">{posts.length}</span> 条
          <span className="mx-2">|</span>
          点赞 <span className="text-3xl font-semibold text-ink">
            {posts.reduce((sum, post) => sum + post.likes.length, 0)}
          </span>
          <span className="mx-2">|</span>
          评论 <span className="text-3xl font-semibold text-ink">
            {posts.reduce((sum, post) => sum + post.comments.length, 0)}
          </span>
        </p>
      </section>

      {posts.length === 0 ? (
        <EmptyState title="还没有动态" description="发布第一条帖子后会显示在这里。" />
      ) : (
        <div className="space-y-5">
          {posts.map((post) => {
            const topics = safeJsonParse<string[]>(post.topicsJson, []);
            const images = safeJsonParse<string[]>(post.imageUrlsJson, []);
            const liked = post.likes.some((like) => like.userId === user.id);
            return (
              <article key={post.id} className="card overflow-hidden p-5">
                <div className="flex items-start gap-3">
                  <Link href={post.authorId === user.id ? "/profile" : `/users/${post.authorId}`} aria-label={`查看 ${post.author.nickname} 的主页`}>
                    <Avatar name={post.author.nickname} src={post.author.avatarUrl} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={post.authorId === user.id ? "/profile" : `/users/${post.authorId}`} className="font-semibold">
                          {post.author.nickname}
                        </Link>
                        <p className="text-xs text-muted">
                          @{post.author.username} · {formatRelativeTime(post.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="chip">{post.visibility === "PUBLIC" ? "公开" : "有限可见"}</span>
                        {post.authorId === user.id ? (
                          <form action={deletePostAction}>
                            <input type="hidden" name="postId" value={post.id} />
                            <ConfirmSubmitButton message="确定删除这条动态吗？删除后评论、点赞和转发记录也会一起删除。" />
                          </form>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-4 whitespace-pre-wrap text-[15px] leading-7">{post.content}</p>
                    {topics.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {topics.map((topic) => (
                          <span key={topic} className="chip">
                            #{topic}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {post.location ? (
                      <p className="mt-3 text-xs text-muted">位置：{post.location}</p>
                    ) : null}
                    <ImageLightbox images={images} />
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between text-muted">
                  <form action={togglePostLikeAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <button className="inline-flex items-center gap-1 rounded-full px-2 py-2" aria-label="点赞">
                      <Heart className={liked ? "h-5 w-5 fill-red-500 text-red-500" : "h-5 w-5"} />
                      <span className="text-sm">{post.likes.length}</span>
                    </button>
                  </form>
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-2 text-sm">
                    <MessageCircle className="h-5 w-5" /> {post.comments.length}
                  </span>
                  <form action={repostAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <button className="inline-flex items-center gap-1 rounded-full px-2 py-2" aria-label="转发">
                      <Repeat2 className="h-5 w-5" />
                      <span className="text-sm">{post.reposts.length}</span>
                    </button>
                  </form>
                  <button className="inline-flex items-center gap-1 rounded-full px-2 py-2" aria-label="收藏">
                    <Bookmark className="h-5 w-5" />
                  </button>
                </div>

                <div className="mt-3 rounded-[24px] bg-surface p-3">
                  {post.comments.slice(0, 3).map((comment) => (
                    <div key={comment.id} className="mb-3 flex gap-2 text-sm leading-6">
                      <Avatar name={comment.author.nickname} src={comment.author.avatarUrl} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p>
                          <span className="font-semibold">{comment.author.nickname}：</span>
                          {comment.content}
                        </p>
                      </div>
                      {comment.authorId === user.id ? (
                        <form action={deleteCommentAction} className="shrink-0">
                          <input type="hidden" name="commentId" value={comment.id} />
                          <ConfirmSubmitButton message="确定删除这条评论吗？" />
                        </form>
                      ) : null}
                    </div>
                  ))}
                  {post.allowComments ? (
                    <form action={createCommentAction} className="flex gap-2">
                      <input type="hidden" name="postId" value={post.id} />
                      <input
                        name="content"
                        className="field h-11 flex-1 rounded-full"
                        placeholder="写下你的评论"
                        aria-label="评论内容"
                      />
                      <button className="grid h-11 w-11 place-items-center rounded-full bg-ink text-white" aria-label="发布评论">
                        <Send className="h-4 w-4" aria-hidden />
                      </button>
                    </form>
                  ) : (
                    <p className="text-sm text-muted">作者关闭了评论。</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
