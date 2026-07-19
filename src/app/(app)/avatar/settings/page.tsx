import { AvatarSettingsForm } from "@/app/(app)/avatar/settings/avatar-settings-form";
import { getGlobalAgentSettingsView } from "@/lib/agent/chat-policy";
import { requireUser } from "@/lib/auth";
import {
  DEFAULT_GLOBAL_AGENT_SETTINGS,
  type GlobalAgentSettingsView
} from "@/lib/client/agent-view-models";
import { prisma } from "@/lib/prisma";

function heartbeatIsOnline(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const heartbeat = value as Record<string, unknown>;
  const timestamp = heartbeat.lastSeenAt ?? heartbeat.heartbeatAt ?? heartbeat.updatedAt;
  if (!(timestamp instanceof Date) && typeof timestamp !== "string") return false;
  return Date.now() - new Date(timestamp).getTime() < 90_000;
}

export default async function AvatarSettingsPage() {
  const user = await requireUser();
  const [rawSettings, avatarProfile, heartbeat] = await Promise.all([
    getGlobalAgentSettingsView(user.id),
    prisma.avatarProfile.findUnique({
      where: { userId: user.id },
      select: { status: true }
    }),
    prisma.agentWorkerHeartbeat.findFirst()
  ]);
  const settings = {
    ...DEFAULT_GLOBAL_AGENT_SETTINGS,
    ...(rawSettings as unknown as Partial<GlobalAgentSettingsView>)
  };

  return (
    <main className="page-shell pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">分身 · 代理控制</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">代理设置</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          这里是所有会话的默认规则。单个联系人可以在聊天页覆盖。
        </p>
      </header>
      <AvatarSettingsForm
        initialSettings={settings}
        avatarActive={avatarProfile?.status === "ACTIVE"}
        workerOnline={heartbeatIsOnline(heartbeat)}
      />
    </main>
  );
}
