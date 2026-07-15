import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { startConversationAction, toggleFollowAction } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTraits } from "@/lib/profile";
import { formatRelativeTime } from "@/lib/utils";
import { redirect } from "next/navigation";

export default async function UserProfilePage({
  params
}: {
  params: { userId: string };
}) {
  const currentUser = await requireUser();
  if (params.userId === currentUser.id) redirect("/profile");

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    include: {
      personalityProfile: true,
      posts: { orderBy: { createdAt: "desc" }, take: 10 },
      followers: true,
      following: true
    }
  });
  if (!user) {
    return (
      <main className="page-shell">
        <EmptyState title="用户不存在" />
      </main>
    );
  }

  const followed = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: currentUser.id, followingId: user.id } }
  });
  const traits = parseTraits(user.personalityProfile?.traitsJson);

  return (
    <main className="page-shell">
      <section className="card overflow-hidden p-5">
        <div className="flex items-start gap-5">
          <Avatar name={user.nickname} src={user.avatarUrl} size="xl" />
          <div className="min-w-0 flex-1 pt-2">
            <h1 className="truncate text-3xl font-semibold">{user.nickname}</h1>
            <p className="mt-1 text-sm text-muted">@{user.username}</p>
            <p className="mt-3 text-sm leading-6 text-muted">{user.bio || "还没有简介"}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {traits.labels?.slice(0, 5).map((trait) => (
            <span key={trait} className="chip">
              {trait}
            </span>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-semibold">{user.following.length}</p>
            <p className="text-xs text-muted">关注</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">{user.followers.length}</p>
            <p className="text-xs text-muted">粉丝</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">{user.posts.length}</p>
            <p className="text-xs text-muted">帖子</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <form action={toggleFollowAction}>
            <input type="hidden" name="followingId" value={user.id} />
            <button className="btn-secondary w-full" type="submit">
              {followed ? "已关注" : "关注"}
            </button>
          </form>
          <form action={startConversationAction}>
            <input type="hidden" name="targetId" value={user.id} />
            <button className="btn-primary w-full" type="submit">
              <MessageCircle className="h-4 w-4" aria-hidden />
              聊天
            </button>
          </form>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Ta 的帖子</h2>
        {user.posts.length ? (
          <div className="space-y-3">
            {user.posts.map((post) => (
              <article key={post.id} className="soft-panel p-4">
                <p className="text-sm leading-6">{post.content}</p>
                <p className="mt-2 text-xs text-muted">{formatRelativeTime(post.createdAt)}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="还没有发布内容" />
        )}
      </section>
    </main>
  );
}
