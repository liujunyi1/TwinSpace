import Link from "next/link";
import { Bot, ChevronRight, LogOut, Settings } from "lucide-react";
import { deletePostAction, logoutAction } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState } from "@/components/empty-state";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTraits } from "@/lib/profile";
import { formatRelativeTime } from "@/lib/utils";

export default async function ProfilePage() {
  const user = await requireUser();
  const [posts, likes, comments, followingCount, followersCount, myCommentsCount] = await Promise.all([
    prisma.post.findMany({ where: { authorId: user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.postLike.count({ where: { post: { authorId: user.id } } }),
    prisma.comment.count({ where: { post: { authorId: user.id } } }),
    prisma.follow.count({ where: { followerId: user.id } }),
    prisma.follow.count({ where: { followingId: user.id } }),
    prisma.comment.count({ where: { authorId: user.id } })
  ]);
  const traits = parseTraits(user.personalityProfile?.traitsJson);

  return (
    <main className="page-shell">
      <section className="relative overflow-hidden rounded-b-[44px] rounded-t-[28px] bg-gradient-to-b from-white via-white to-surface px-5 pb-7 pt-8 shadow-soft">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-blush via-lilac to-skysoft opacity-80" />
        <div className="relative flex items-start justify-between">
          <Avatar name={user.nickname} src={user.avatarUrl} size="xl" />
          <Link href="/profile/settings" className="grid h-11 w-11 place-items-center rounded-full bg-white/80" aria-label="设置">
            <Settings className="h-5 w-5" aria-hidden />
          </Link>
        </div>
        <div className="relative mt-5">
          <h1 className="text-3xl font-semibold">{user.nickname}</h1>
          <p className="mt-1 text-sm text-muted">@{user.username}</p>
          <p className="mt-4 text-sm leading-6 text-muted">{user.bio || "介绍一下自己吧"}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {traits.labels?.slice(0, 4).map((trait) => (
              <span key={trait} className="chip bg-white/80 text-ink">
                {trait}
              </span>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <Link href="/profile/follows?type=following">
              <p className="text-2xl font-semibold">{followingCount}</p>
              <p className="text-xs text-muted">关注</p>
            </Link>
            <Link href="/profile/follows?type=followers">
              <p className="text-2xl font-semibold">{followersCount}</p>
              <p className="text-xs text-muted">粉丝</p>
            </Link>
            <Link href="/profile/comments">
              <p className="text-2xl font-semibold">{myCommentsCount}</p>
              <p className="text-xs text-muted">历史评论</p>
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-1 text-center">
            <div>
              <p className="text-2xl font-semibold">{likes + comments}</p>
              <p className="text-xs text-muted">获赞与评论</p>
            </div>
          </div>
        </div>
      </section>

      <Link href="/avatar" className="card mt-5 flex items-center justify-between bg-ink p-5 text-white">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/12">
            <Bot className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold">我的分身</h2>
            <p className="text-sm text-white/60">理解你，也代表你</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5" aria-hidden />
      </Link>

      <section className="mt-5 grid gap-3">
        {[
          ["人格与偏好", "/profile/personality"],
          ["偏好设置", "/profile/preferences"],
          ["事实记忆", "/profile/memories"],
          ["关注与粉丝", "/profile/follows"],
          ["历史评论", "/profile/comments"]
        ].map(([label, href]) => (
          <Link key={href} href={href} className="soft-panel flex items-center justify-between px-5 py-4">
            <span className="font-semibold">{label}</span>
            <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
          </Link>
        ))}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">我的帖子</h2>
        {posts.length ? (
          <div className="space-y-3">
            {posts.map((post) => (
              <article key={post.id} className="soft-panel p-4">
                <p className="text-sm leading-6">{post.content}</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted">{formatRelativeTime(post.createdAt)}</p>
                  <form action={deletePostAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <ConfirmSubmitButton message="确定删除这条动态吗？删除后评论、点赞和转发记录也会一起删除。" />
                  </form>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="还没有发布任何内容" />
        )}
      </section>

      <form action={logoutAction} className="mt-6">
        <button className="btn-secondary w-full text-red-600" type="submit">
          <LogOut className="h-4 w-4" aria-hidden />
          退出登录
        </button>
      </form>
    </main>
  );
}
