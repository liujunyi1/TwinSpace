import { AvatarActivityClient } from "@/app/(app)/avatar/activity/avatar-activity-client";
import { getGlobalAgentSettingsView } from "@/lib/agent/chat-policy";
import { getAgentActivities } from "@/lib/agent/chat-tasks";
import { getSocialActivities } from "@/lib/agent/social-agent";
import { requireUser } from "@/lib/auth";
import type {
  AgentActivityView,
  GlobalAgentSettingsView
} from "@/lib/client/agent-view-models";
import type { SocialActivityView } from "@/app/(app)/avatar/activity/avatar-activity-client";
import { prisma } from "@/lib/prisma";

function heartbeatIsOnline(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const heartbeat = value as Record<string, unknown>;
  const timestamp = heartbeat.lastSeenAt ?? heartbeat.heartbeatAt ?? heartbeat.updatedAt;
  if (!(timestamp instanceof Date) && typeof timestamp !== "string") return false;
  return Date.now() - new Date(timestamp).getTime() < 90_000;
}

export default async function AvatarActivityPage() {
  const user = await requireUser();
  const [activities, socialActivities, settings, avatarProfile, heartbeat] = await Promise.all([
    getAgentActivities(user.id),
    getSocialActivities(user.id),
    getGlobalAgentSettingsView(user.id),
    prisma.avatarProfile.findUnique({
      where: { userId: user.id },
      select: { status: true }
    }),
    prisma.agentWorkerHeartbeat.findFirst()
  ]);
  const socialActivityViews: SocialActivityView[] = socialActivities.map((activity) => ({
    id: activity.id,
    kind: "SOCIAL_COMMENT",
    status: activity.status,
    postId: activity.postId,
    postContent: activity.postExcerpt,
    authorName: activity.targetAuthorName,
    draft: activity.draft,
    reason: activity.decisionReason,
    error: activity.error,
    capabilityStatus: activity.capabilityStatus,
    createdAt: activity.createdAt,
    scheduledFor: activity.runAt,
    redacted: activity.redacted,
    commentId: activity.commentId
  }));

  return (
    <main className="page-shell pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">分身 · 可见与可控</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">活动中心</h1>
        <p className="mt-3 text-sm leading-6 text-muted">查看分身等待、发送、失败、取消和删除的全部代理任务。</p>
      </header>
      <AvatarActivityClient
        activities={activities as unknown as AgentActivityView[]}
        socialActivities={socialActivityViews}
        globalEnabled={(settings as unknown as GlobalAgentSettingsView).enabled}
        avatarActive={avatarProfile?.status === "ACTIVE"}
        workerOnline={heartbeatIsOnline(heartbeat)}
      />
    </main>
  );
}
