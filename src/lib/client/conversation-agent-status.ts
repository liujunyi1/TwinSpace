import {
  modeLabel,
  type ConversationAgentStateView
} from "@/lib/client/agent-view-models";

export function isRecipientBlockedAi(state: ConversationAgentStateView) {
  return (
    !state.recipientAllowsAi || state.blockReason === "RECIPIENT_BLOCKED_AI"
  );
}

export function conversationPolicyProblem(
  state: ConversationAgentStateView,
  agentConfigurable: boolean
) {
  const recipientBlockedAi = isRecipientBlockedAi(state);
  if (!agentConfigurable || (state.effectiveMode === "MANUAL" && !recipientBlockedAi)) {
    return null;
  }

  if (recipientBlockedAi) {
    return "对方拒绝 AI 回复，当前会话已切换为手动回复。";
  }
  if (!state.avatarActive) {
    return "分身尚未激活，当前会话只能手动发送。";
  }
  if (!state.globalEnabled) {
    return "全局代理已暂停，当前会话不会生成或自动发送。";
  }
  if (!state.workerOnline) {
    return "后台 Worker 离线，辅助和托管任务暂时不会执行。";
  }
  return state.blockReason;
}

export function conversationModeSubtitle(
  state: ConversationAgentStateView,
  conversationType: string
) {
  if (conversationType === "AI_CONTACT") {
    return "独立 AI 联系人";
  }

  const sourceLabel = isRecipientBlockedAi(state)
    ? "对方拒绝 AI 回复"
    : state.modeOverride === "INHERIT"
      ? "继承全局"
      : "本会话覆盖";

  return `${modeLabel(state.effectiveMode)} · ${sourceLabel}`;
}
