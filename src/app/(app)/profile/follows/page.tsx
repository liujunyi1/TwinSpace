import Link from "next/link";
import { startConversationAction, toggleFollowAction } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function FollowsPage({
  searchParams
}: {
  searchParams?: { type?: string };
}) {
  const user = await requireUser();
  const type = searchParams?.type === "followers" ? "followers" : "following";
  const [following, followers] = await Promise.all([
    prisma.follow.findMany({
      where: { followerId: user.id },
      include: { following: { include: { followers: { where: { followerId: user.id } } } } },
      orderBy: { createdAt: "desc" }
    }),
    prisma.follow.findMany({
      where: { followingId: user.id },
      include: { follower: { include: { followers: { where: { followerId: user.id } } } } },
      orderBy: { createdAt: "desc" }
    })
  ]);
  const rows =
    type === "followers"
      ? followers.map((item) => item.follower)
      : following.map((item) => item.following);

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">我的</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">关注与粉丝</h1>
      </header>
      <div className="mb-5 grid grid-cols-2 rounded-full bg-white p-1">
        <Link
          href="/profile/follows?type=following"
          className={`grid h-11 place-items-center rounded-full text-sm font-semibold ${type === "following" ? "bg-ink text-white" : "text-muted"}`}
        >
          关注 {following.length}
        </Link>
        <Link
          href="/profile/follows?type=followers"
          className={`grid h-11 place-items-center rounded-full text-sm font-semibold ${type === "followers" ? "bg-ink text-white" : "text-muted"}`}
        >
          粉丝 {followers.length}
        </Link>
      </div>

      {rows.length ? (
        <div className="space-y-3">
          {rows.map((item) => {
            const followed = item.followers.length > 0;
            return (
              <article key={item.id} className="card p-4">
                <div className="flex items-center gap-4">
                  <Link href={`/users/${item.id}`}>
                    <Avatar name={item.nickname} src={item.avatarUrl} size="lg" />
                  </Link>
                  <Link href={`/users/${item.id}`} className="min-w-0 flex-1">
                    <h2 className="truncate text-lg font-semibold">{item.nickname}</h2>
                    <p className="truncate text-sm text-muted">@{item.username}</p>
                  </Link>
                </div>
                <div className="mt-4 flex gap-2">
                  <form action={toggleFollowAction} className="flex-1">
                    <input type="hidden" name="followingId" value={item.id} />
                    <button className="btn-secondary w-full" type="submit">
                      {followed ? "已关注" : "关注"}
                    </button>
                  </form>
                  <form action={startConversationAction} className="flex-1">
                    <input type="hidden" name="targetId" value={item.id} />
                    <button className="btn-primary w-full" type="submit">
                      聊天
                    </button>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState title={type === "followers" ? "还没有粉丝" : "还没有关注任何人"} />
      )}
    </main>
  );
}
