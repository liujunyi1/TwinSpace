"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Home, MessageCircle, Plus, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/feed", label: "动态", icon: Home },
  { href: "/avatar", label: "分身", icon: Bot },
  { href: "/create", label: "发布", icon: Plus, primary: true },
  { href: "/messages", label: "消息", icon: MessageCircle },
  { href: "/profile", label: "我的", icon: UserRound }
];

export function BottomNav({
  unreadConversationCount = 0
}: {
  unreadConversationCount?: number;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-4 z-40 mx-auto flex h-[74px] w-[calc(100%-32px)] max-w-[398px] items-center justify-around rounded-full border border-white/80 bg-white/90 px-3 shadow-soft backdrop-blur"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href || (item.href !== "/feed" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative grid h-14 min-w-14 place-items-center rounded-full text-muted transition",
              active && !item.primary && "bg-surface text-ink",
              item.primary && "h-12 min-w-16 bg-ink text-white shadow-sm",
              item.primary && active && "scale-105"
            )}
            aria-label={
              item.href === "/messages" && unreadConversationCount > 0
                ? `${item.label}，${unreadConversationCount} 个会话未读`
                : item.label
            }
            title={item.label}
          >
            <Icon className={cn("h-5 w-5", item.primary && "h-7 w-7")} aria-hidden />
            {item.href === "/messages" && unreadConversationCount > 0 ? (
              <span className="absolute right-2 top-1 h-5 min-w-5 rounded-full bg-red-500 px-1 text-center text-[11px] font-semibold leading-5 text-white">
                {unreadConversationCount > 99 ? "99+" : unreadConversationCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
