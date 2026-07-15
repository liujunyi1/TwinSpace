import Link from "next/link";
import { Search } from "lucide-react";
import { startConversationAction, toggleFollowAction } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { TopBar } from "@/components/top-bar";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function SearchPage({
  searchParams
}: {
  searchParams?: { q?: string };
}) {
  const user = await requireUser();
  const q = String(searchParams?.q || "").trim();
  const users = q
    ? await prisma.user.findMany({
        where: {
          id: { not: user.id },
          OR: [{ username: { contains: q } }, { nickname: { contains: q } }]
        },
        include: {
          personalityProfile: true,
          followers: { where: { followerId: user.id } }
        },
        take: 20
      })
    : await prisma.user.findMany({
        where: { id: { not: user.id } },
        include: {
          personalityProfile: true,
          followers: { where: { followerId: user.id } }
        },
        take: 12
      });

  return (
    <main className="page-shell">
      <TopBar title="搜索" muted="用户" />
      <form className="card mb-5 flex items-center gap-3 p-3" action="/search">
        <Search className="ml-2 h-5 w-5 text-muted" aria-hidden />
        <input
          name="q"
          defaultValue={q}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
          placeholder="搜索昵称或用户名"
          aria-label="搜索昵称或用户名"
        />
        <button className="btn-primary h-11 px-5">搜索</button>
      </form>

      <div className="space-y-3">
        {users.map((item) => {
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
                  <p className="mt-1 line-clamp-1 text-xs text-muted">
                    {item.bio || item.personalityProfile?.summary || "还没有简介"}
                  </p>
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
    </main>
  );
}
