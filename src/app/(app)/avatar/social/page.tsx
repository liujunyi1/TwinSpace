import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SocialAgentSettingsClient } from "@/app/(app)/avatar/social/social-agent-settings-client";
import { getSocialAgentSettingsView } from "@/lib/agent/social-agent";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function heartbeatIsOnline(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const heartbeat = value as Record<string, unknown>;
  const timestamp = heartbeat.lastSeenAt ?? heartbeat.heartbeatAt ?? heartbeat.updatedAt;
  if (!(timestamp instanceof Date) && typeof timestamp !== "string") return false;
  return Date.now() - new Date(timestamp).getTime() < 90_000;
}

export default async function AvatarSocialPage() {
  const user = await requireUser();
  const [settings, avatarProfile, heartbeat] = await Promise.all([
    getSocialAgentSettingsView(user.id),
    prisma.avatarProfile.findUnique({
      where: { userId: user.id },
      select: { status: true }
    }),
    prisma.agentWorkerHeartbeat.findFirst()
  ]);

  return (
    <main className="page-shell pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <header className="mb-5">
        <Link href="/avatar" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          返回分身
        </Link>
        <p className="text-sm font-semibold text-muted">分身 · 动态互动</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">动态代理</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          让分身按你的范围和频率浏览动态。建议模式先生成草稿，自动模式会直接发表评论。
        </p>
      </header>
      <SocialAgentSettingsClient
        initialSettings={{
          ...settings,
          activeWindows: settings.activeWindows.map((window) => ({
            weekday: window.day,
            start: window.start,
            end: window.end
          })),
          avatarActive: avatarProfile?.status === "ACTIVE",
          workerOnline: heartbeatIsOnline(heartbeat)
        }}
      />
    </main>
  );
}
