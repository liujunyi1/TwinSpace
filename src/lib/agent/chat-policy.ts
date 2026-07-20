import { prisma } from "@/lib/prisma";
import {
  AGENT_MODES,
  DELAY_MODES,
  parseActiveWindowsJson,
  type ActiveWindow,
  type AgentMode,
  type DelayMode
} from "@/lib/agent/schedule";

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const WORKER_FRESHNESS_MS = 60_000;

const ACTIVE_WINDOW_MODES = ["INHERIT", "ALWAYS", "CUSTOM"] as const;
type ActiveWindowMode = (typeof ACTIVE_WINDOW_MODES)[number];

const RECEIVE_AI_MODES = ["INHERIT", "ALLOW", "BLOCK"] as const;
type ReceiveAiMode = (typeof RECEIVE_AI_MODES)[number];

export type AgentTaskView = {
  id: string;
  conversationId: string;
  kind: string;
  status: string;
  draft: string | null;
  reason: string | null;
  error: string | null;
  scheduledFor: string;
  readyAt?: string;
  createdAt: string;
  redacted: boolean;
};

export type GlobalAgentSettingsView = {
  enabled: boolean;
  defaultMode: AgentMode;
  assistAutoDraft: boolean;
  delayMode: DelayMode;
  customDelaySeconds: number;
  sendBufferSeconds: number;
  timezone: string;
  activeWindows: ActiveWindow[];
  receiveAi: boolean;
  avatarActive: boolean;
  workerOnline: boolean;
};

export type EffectiveChatPolicy = {
  allowed: boolean;
  mode: AgentMode;
  globalDefaultMode: AgentMode;
  delayMode: DelayMode;
  customDelaySeconds: number;
  sendBufferSeconds: number;
  timezone: string;
  activeWindows: ActiveWindow[];
  assistAutoDraft: boolean;
  policyRevision: number;
  knowledgeRevision: number;
  recipientAllowsAi: boolean;
  blockReason: string | null;
  avatarActive: boolean;
  globalEnabled: boolean;
  workerOnline: boolean;
  conversationType: string;
  memberCount: number;
  contactId: string | null;
};

export type ConversationAgentState = {
  effectiveMode: AgentMode;
  globalDefaultMode: AgentMode;
  modeOverride: AgentMode | null;
  delayOverride: DelayMode | null;
  customDelaySeconds: number;
  activeWindowMode: ActiveWindowMode;
  activeWindows: ActiveWindow[];
  receiveAiFromContact: ReceiveAiMode;
  globalEnabled: boolean;
  avatarActive: boolean;
  workerOnline: boolean;
  recipientAllowsAi: boolean;
  blockReason: string | null;
  tasks: AgentTaskView[];
};

function agentMode(value?: string | null): AgentMode {
  return AGENT_MODES.includes(value as AgentMode)
    ? (value as AgentMode)
    : "MANUAL";
}

function optionalAgentMode(value?: string | null): AgentMode | null {
  return AGENT_MODES.includes(value as AgentMode) ? (value as AgentMode) : null;
}

function delayMode(value?: string | null): DelayMode {
  return DELAY_MODES.includes(value as DelayMode)
    ? (value as DelayMode)
    : "SHORT";
}

function optionalDelayMode(value?: string | null): DelayMode | null {
  return DELAY_MODES.includes(value as DelayMode) ? (value as DelayMode) : null;
}

function activeWindowMode(value?: string | null): ActiveWindowMode {
  return ACTIVE_WINDOW_MODES.includes(value as ActiveWindowMode)
    ? (value as ActiveWindowMode)
    : "INHERIT";
}

function receiveAiMode(value?: string | null): ReceiveAiMode {
  return RECEIVE_AI_MODES.includes(value as ReceiveAiMode)
    ? (value as ReceiveAiMode)
    : "INHERIT";
}

async function workerOnline(now = new Date()) {
  const heartbeat = await prisma.agentWorkerHeartbeat.findFirst({
    orderBy: { lastSeenAt: "desc" }
  });
  return Boolean(
    heartbeat &&
      heartbeat.status === "ONLINE" &&
      now.getTime() - heartbeat.lastSeenAt.getTime() <= WORKER_FRESHNESS_MS
  );
}

export async function getGlobalAgentSettingsView(
  userId: string
): Promise<GlobalAgentSettingsView> {
  const [setting, avatar, online] = await Promise.all([
    prisma.avatarAgentSetting.findUnique({ where: { userId } }),
    prisma.avatarProfile.findUnique({
      where: { userId },
      select: { status: true }
    }),
    workerOnline()
  ]);

  return {
    enabled: setting?.enabled ?? false,
    defaultMode: agentMode(setting?.defaultMode),
    assistAutoDraft: setting?.assistAutoDraft ?? false,
    delayMode: delayMode(setting?.delayMode),
    customDelaySeconds: setting?.customDelaySeconds ?? 60,
    sendBufferSeconds: setting?.sendBufferSeconds ?? 15,
    timezone: setting?.timezone || DEFAULT_TIMEZONE,
    activeWindows: parseActiveWindowsJson(setting?.activeWindowsJson),
    receiveAi: setting?.receiveAi ?? true,
    avatarActive: avatar?.status === "ACTIVE",
    workerOnline: online
  };
}

export async function getEffectiveChatPolicy(
  ownerId: string,
  conversationId: string
): Promise<EffectiveChatPolicy> {
  const [ownerSetting, avatar, conversation, online] = await Promise.all([
    prisma.avatarAgentSetting.findUnique({ where: { userId: ownerId } }),
    prisma.avatarProfile.findUnique({
      where: { userId: ownerId },
      select: {
        status: true,
        policyRevision: true,
        knowledgeRevision: true
      }
    }),
    prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: { select: { userId: true } },
        agentSettings: true
      }
    }),
    workerOnline()
  ]);

  if (!conversation) throw new Error("会话不存在");
  if (!conversation.members.some((member) => member.userId === ownerId)) {
    throw new Error("你不是该会话成员");
  }

  const ownerConversationSetting = conversation.agentSettings.find(
    (setting) => setting.userId === ownerId
  );
  const contactId =
    conversation.members.find((member) => member.userId !== ownerId)?.userId ?? null;
  const [recipientGlobalSetting, recipientConversationSetting] = contactId
    ? await Promise.all([
        prisma.avatarAgentSetting.findUnique({ where: { userId: contactId } }),
        prisma.conversationAgentSetting.findUnique({
          where: {
            conversationId_userId: {
              conversationId,
              userId: contactId
            }
          }
        })
      ])
    : [null, null];

  const recipientReceiveMode = receiveAiMode(
    recipientConversationSetting?.receiveAiFromContact
  );
  const recipientAllowsAi =
    recipientReceiveMode === "ALLOW"
      ? true
      : recipientReceiveMode === "BLOCK"
        ? false
        : recipientGlobalSetting?.receiveAi ?? true;
  const globalDefaultMode = agentMode(ownerSetting?.defaultMode);
  const configuredMode =
    optionalAgentMode(ownerConversationSetting?.modeOverride) ??
    globalDefaultMode;
  const effectiveDelayMode =
    optionalDelayMode(ownerConversationSetting?.delayOverride) ??
    delayMode(ownerSetting?.delayMode);
  const windowMode = activeWindowMode(ownerConversationSetting?.activeWindowMode);
  const activeWindows =
    windowMode === "CUSTOM"
      ? parseActiveWindowsJson(ownerConversationSetting?.activeWindowsJson)
      : windowMode === "ALWAYS"
        ? parseActiveWindowsJson(null)
        : parseActiveWindowsJson(ownerSetting?.activeWindowsJson);
  const avatarActive = avatar?.status === "ACTIVE";
  const globalEnabled = ownerSetting?.enabled ?? false;
  const isHumanDirectMessage =
    conversation.type === "HUMAN" && conversation.members.length === 2;

  let blockReason: string | null = null;
  if (!isHumanDirectMessage) blockReason = "NOT_HUMAN_DIRECT_MESSAGE";
  else if (!avatarActive) blockReason = "AVATAR_NOT_ACTIVE";
  else if (!globalEnabled) blockReason = "GLOBAL_DISABLED";
  else if (!recipientAllowsAi) blockReason = "RECIPIENT_BLOCKED_AI";
  else if (configuredMode === "MANUAL") blockReason = "MANUAL_MODE";

  const allowed = blockReason === null;
  const conversationRevision = ownerConversationSetting?.revision ?? 1;
  const globalPolicyRevision = ownerSetting?.policyRevision ?? 1;
  const avatarPolicyRevision = avatar?.policyRevision ?? 1;

  return {
    allowed,
    mode: allowed ? configuredMode : "MANUAL",
    globalDefaultMode,
    delayMode: effectiveDelayMode,
    customDelaySeconds:
      ownerConversationSetting?.customDelaySeconds ??
      ownerSetting?.customDelaySeconds ??
      60,
    sendBufferSeconds: ownerSetting?.sendBufferSeconds ?? 15,
    timezone: ownerSetting?.timezone || DEFAULT_TIMEZONE,
    activeWindows,
    assistAutoDraft: ownerSetting?.assistAutoDraft ?? false,
    policyRevision: Math.max(
      conversationRevision,
      globalPolicyRevision,
      avatarPolicyRevision
    ),
    knowledgeRevision: avatar?.knowledgeRevision ?? 0,
    recipientAllowsAi,
    blockReason,
    avatarActive,
    globalEnabled,
    workerOnline: online,
    conversationType: conversation.type,
    memberCount: conversation.members.length,
    contactId
  };
}

export async function getConversationAgentState(
  userId: string,
  conversationId: string
): Promise<ConversationAgentState> {
  const [policy, setting, tasks] = await Promise.all([
    getEffectiveChatPolicy(userId, conversationId),
    prisma.conversationAgentSetting.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId
        }
      }
    }),
    prisma.agentTask.findMany({
      where: { ownerId: userId, conversationId },
      orderBy: { createdAt: "desc" },
      take: 20
    })
  ]);

  return {
    effectiveMode: policy.mode,
    globalDefaultMode: policy.globalDefaultMode,
    modeOverride: optionalAgentMode(setting?.modeOverride),
    delayOverride: optionalDelayMode(setting?.delayOverride),
    customDelaySeconds:
      setting?.customDelaySeconds ?? policy.customDelaySeconds,
    activeWindowMode: activeWindowMode(setting?.activeWindowMode),
    activeWindows: policy.activeWindows,
    receiveAiFromContact: receiveAiMode(setting?.receiveAiFromContact),
    globalEnabled: policy.globalEnabled,
    avatarActive: policy.avatarActive,
    workerOnline: policy.workerOnline,
    recipientAllowsAi: policy.recipientAllowsAi,
    blockReason: policy.blockReason,
    tasks: tasks.map((task) => {
      const redacted = Boolean(task.redactedAt);
      return {
        id: task.id,
        conversationId: task.conversationId,
        kind: task.kind,
        status: task.status,
        draft: redacted ? null : task.draftContent,
        reason: task.cancelReason,
        error: redacted ? null : task.error,
        scheduledFor: task.runAt.toISOString(),
        readyAt: task.readyAt?.toISOString(),
        createdAt: task.createdAt.toISOString(),
        redacted
      };
    })
  };
}
