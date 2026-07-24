import { describe, expect, it } from "vitest";
import {
  conversationModeSubtitle,
  conversationPolicyProblem,
  isRecipientBlockedAi
} from "@/lib/client/conversation-agent-status";
import {
  DEFAULT_CONVERSATION_AGENT_STATE,
  type ConversationAgentStateView
} from "@/lib/client/agent-view-models";

function state(overrides: Partial<ConversationAgentStateView> = {}) {
  return {
    ...DEFAULT_CONVERSATION_AGENT_STATE,
    effectiveMode: "PROXY",
    globalDefaultMode: "PROXY",
    modeOverride: "INHERIT",
    globalEnabled: true,
    avatarActive: true,
    workerOnline: true,
    recipientAllowsAi: true,
    tasks: [],
    ...overrides
  } satisfies ConversationAgentStateView;
}

describe("conversation agent status copy", () => {
  it("shows a recipient AI-reply block even after the effective mode falls back to MANUAL", () => {
    const blocked = state({
      effectiveMode: "MANUAL",
      modeOverride: "PROXY",
      recipientAllowsAi: false,
      blockReason: "RECIPIENT_BLOCKED_AI"
    });

    expect(isRecipientBlockedAi(blocked)).toBe(true);
    expect(conversationPolicyProblem(blocked, true)).toBe(
      "对方拒绝 AI 回复，当前会话已切换为手动回复。"
    );
    expect(conversationModeSubtitle(blocked, "HUMAN")).toBe(
      "手动 · 对方拒绝 AI 回复"
    );
  });

  it("does not show a policy warning for an intentionally manual conversation", () => {
    const manual = state({
      effectiveMode: "MANUAL",
      modeOverride: "MANUAL",
      blockReason: "MANUAL_MODE"
    });

    expect(conversationPolicyProblem(manual, true)).toBeNull();
    expect(conversationModeSubtitle(manual, "HUMAN")).toBe("手动 · 本会话覆盖");
  });

  it("keeps AI contacts independent from two-person agent status labels", () => {
    expect(conversationModeSubtitle(state(), "AI_CONTACT")).toBe("独立 AI 联系人");
  });
});
