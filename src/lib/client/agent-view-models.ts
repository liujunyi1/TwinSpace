export type AgentMode = "MANUAL" | "ASSIST" | "PROXY";
export type AgentModeOverride = "INHERIT" | AgentMode;
export type AgentDelayMode = "IMMEDIATE" | "SHORT" | "LONG" | "CUSTOM";
export type AgentDelayOverride = "INHERIT" | AgentDelayMode;
export type AgentActiveWindowMode = "INHERIT" | "ALWAYS" | "CUSTOM";
export type AgentReceiveAiMode = "INHERIT" | "ALLOW" | "BLOCK";

export type AgentActiveWindow = {
  weekday: number;
  start: string;
  end: string;
};

export type GlobalAgentSettingsView = {
  enabled: boolean;
  defaultMode: AgentMode;
  assistAutoDraft: boolean;
  delayMode: AgentDelayMode;
  customDelaySeconds: number;
  sendBufferSeconds: number;
  timezone: string;
  activeWindows: AgentActiveWindow[];
  receiveAi: boolean;
};

export type AgentTaskView = {
  id: string;
  conversationId: string | null;
  conversationTitle?: string | null;
  kind: string;
  status: "PENDING" | "RUNNING" | "READY" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "DELETED";
  draft: string | null;
  reason: string | null;
  error: string | null;
  scheduledFor: string | null;
  createdAt: string;
  sentAt?: string | null;
  redacted?: boolean;
};

export type ConversationAgentStateView = {
  effectiveMode: AgentMode;
  globalDefaultMode: AgentMode;
  modeOverride: AgentModeOverride;
  delayOverride: AgentDelayOverride;
  customDelaySeconds: number;
  activeWindowMode: AgentActiveWindowMode;
  activeWindows: AgentActiveWindow[];
  receiveAiFromContact: AgentReceiveAiMode;
  globalEnabled: boolean;
  avatarActive: boolean;
  workerOnline: boolean;
  recipientAllowsAi: boolean;
  assistAutoDraft: boolean;
  blockReason: string | null;
  tasks: AgentTaskView[];
};

export type AgentActivityView = AgentTaskView & {
  deletedAt?: string | null;
};

export const DEFAULT_GLOBAL_AGENT_SETTINGS: GlobalAgentSettingsView = {
  enabled: false,
  defaultMode: "MANUAL",
  assistAutoDraft: false,
  delayMode: "SHORT",
  customDelaySeconds: 60,
  sendBufferSeconds: 15,
  timezone: "Asia/Shanghai",
  activeWindows: [],
  receiveAi: true
};

export const DEFAULT_CONVERSATION_AGENT_STATE: ConversationAgentStateView = {
  effectiveMode: "MANUAL",
  globalDefaultMode: "MANUAL",
  modeOverride: "INHERIT",
  delayOverride: "INHERIT",
  customDelaySeconds: 60,
  activeWindowMode: "INHERIT",
  activeWindows: [],
  receiveAiFromContact: "INHERIT",
  globalEnabled: false,
  avatarActive: false,
  workerOnline: false,
  recipientAllowsAi: true,
  assistAutoDraft: false,
  blockReason: null,
  tasks: []
};

export function modeLabel(mode: AgentMode | AgentModeOverride) {
  if (mode === "INHERIT") return "继承全局";
  if (mode === "ASSIST") return "AI 辅助";
  if (mode === "PROXY") return "AI 托管";
  return "手动";
}

export function delayLabel(mode: AgentDelayMode | AgentDelayOverride) {
  if (mode === "INHERIT") return "继承全局";
  if (mode === "IMMEDIATE") return "立即";
  if (mode === "SHORT") return "30–90 秒";
  if (mode === "LONG") return "5–15 分钟";
  return "自定义";
}
