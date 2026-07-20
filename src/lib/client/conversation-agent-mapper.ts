import {
  DEFAULT_CONVERSATION_AGENT_STATE,
  type AgentActiveWindowMode,
  type AgentDelayMode,
  type AgentMode,
  type AgentReceiveAiMode,
  type AgentTaskView,
  type ConversationAgentStateView
} from "@/lib/client/agent-view-models";

export type DomainActiveWindow = {
  day: number;
  start: string;
  end: string;
};

type DomainAgentTask = {
  id: string;
  conversationId: string | null;
  kind: string;
  status: string;
  draft: string | null;
  reason: string | null;
  error: string | null;
  scheduledFor: string | null;
  createdAt: string;
  redacted?: boolean;
};

export type ConversationAgentDomainState = {
  effectiveMode: AgentMode;
  globalDefaultMode: AgentMode;
  modeOverride: AgentMode | null;
  delayOverride: AgentDelayMode | null;
  customDelaySeconds: number;
  activeWindowMode: AgentActiveWindowMode | null;
  activeWindows: DomainActiveWindow[];
  receiveAiFromContact: AgentReceiveAiMode | null;
  globalEnabled: boolean;
  avatarActive: boolean;
  workerOnline?: boolean;
  recipientAllowsAi: boolean;
  assistAutoDraft?: boolean;
  blockReason: string | null;
  tasks: DomainAgentTask[];
};

export type ConversationAgentSettingsPayload = {
  conversationId: string;
  modeOverride: ConversationAgentStateView["modeOverride"];
  delayOverride: ConversationAgentStateView["delayOverride"];
  customDelaySeconds: number;
  activeWindowMode: ConversationAgentStateView["activeWindowMode"];
  activeWindows: ConversationAgentStateView["activeWindows"];
  receiveAiFromContact: ConversationAgentStateView["receiveAiFromContact"];
};

export function mapConversationActiveWindowsToDomain(
  activeWindows: ConversationAgentStateView["activeWindows"]
): DomainActiveWindow[] {
  return activeWindows.map((window) => ({
    day: window.weekday,
    start: window.start,
    end: window.end
  }));
}

function taskStatus(value: string): AgentTaskView["status"] {
  if (value === "PENDING") return "PENDING";
  if (value === "RUNNING") return "RUNNING";
  if (value === "READY") return "READY";
  if (value === "SUCCEEDED") return "SUCCEEDED";
  if (value === "FAILED") return "FAILED";
  if (value === "CANCELLED") return "CANCELLED";
  if (value === "DELETED") return "DELETED";
  return "FAILED";
}

function receiveAiMode(value: AgentReceiveAiMode | null): AgentReceiveAiMode {
  if (value === "ALLOW" || value === "BLOCK") return value;
  return "INHERIT";
}

export function mapConversationAgentState(
  raw: ConversationAgentDomainState | null,
  workerOnline: boolean
): ConversationAgentStateView {
  if (!raw) {
    return {
      ...DEFAULT_CONVERSATION_AGENT_STATE,
      activeWindows: [],
      tasks: [],
      workerOnline
    };
  }

  return {
    effectiveMode: raw.effectiveMode,
    globalDefaultMode: raw.globalDefaultMode,
    modeOverride: raw.modeOverride ?? "INHERIT",
    delayOverride: raw.delayOverride ?? "INHERIT",
    customDelaySeconds: raw.customDelaySeconds,
    activeWindowMode: raw.activeWindowMode ?? "INHERIT",
    activeWindows: raw.activeWindows.map((window) => ({
      weekday: window.day,
      start: window.start,
      end: window.end
    })),
    receiveAiFromContact: receiveAiMode(raw.receiveAiFromContact),
    globalEnabled: raw.globalEnabled,
    avatarActive: raw.avatarActive,
    workerOnline,
    recipientAllowsAi: raw.recipientAllowsAi,
    assistAutoDraft: raw.assistAutoDraft ?? false,
    blockReason: raw.blockReason,
    tasks: raw.tasks.map((task) => ({
      id: task.id,
      conversationId: task.conversationId,
      kind: task.kind,
      status: taskStatus(task.status),
      draft: task.redacted ? null : task.draft,
      reason: task.reason,
      error: task.redacted ? null : task.error,
      scheduledFor: task.scheduledFor,
      createdAt: task.createdAt,
      redacted: Boolean(task.redacted)
    }))
  };
}

export function buildConversationAgentSettingsPayload(
  conversationId: string,
  draft: ConversationAgentStateView
): ConversationAgentSettingsPayload {
  return {
    conversationId,
    modeOverride: draft.modeOverride,
    delayOverride: draft.delayOverride,
    customDelaySeconds: draft.customDelaySeconds,
    activeWindowMode: draft.activeWindowMode,
    activeWindows: draft.activeWindows,
    receiveAiFromContact: draft.receiveAiFromContact
  };
}

export function optimisticConversationAgentState(
  current: ConversationAgentStateView,
  draft: ConversationAgentStateView
): ConversationAgentStateView {
  return {
    ...current,
    modeOverride: draft.modeOverride,
    delayOverride: draft.delayOverride,
    customDelaySeconds: draft.customDelaySeconds,
    activeWindowMode: draft.activeWindowMode,
    activeWindows: draft.activeWindows,
    receiveAiFromContact: draft.receiveAiFromContact,
    effectiveMode:
      draft.modeOverride === "INHERIT"
        ? current.globalDefaultMode
        : draft.modeOverride,
    tasks: current.tasks
  };
}
