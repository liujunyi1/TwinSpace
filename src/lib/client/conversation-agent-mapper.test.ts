import { describe, expect, it } from "vitest";
import {
  buildConversationAgentSettingsPayload,
  mapConversationAgentState,
  mapConversationActiveWindowsToDomain,
  optimisticConversationAgentState,
  type ConversationAgentDomainState
} from "@/lib/client/conversation-agent-mapper";
import {
  DEFAULT_CONVERSATION_AGENT_STATE,
  type ConversationAgentStateView
} from "@/lib/client/agent-view-models";

function domainState(
  overrides: Partial<ConversationAgentDomainState> = {}
): ConversationAgentDomainState {
  return {
    effectiveMode: "ASSIST",
    globalDefaultMode: "ASSIST",
    modeOverride: null,
    delayOverride: null,
    customDelaySeconds: 60,
    activeWindowMode: null,
    activeWindows: [],
    receiveAiFromContact: null,
    globalEnabled: true,
    avatarActive: true,
    recipientAllowsAi: true,
    blockReason: null,
    tasks: [],
    ...overrides
  };
}

function viewState(
  overrides: Partial<ConversationAgentStateView> = {}
): ConversationAgentStateView {
  return {
    ...DEFAULT_CONVERSATION_AGENT_STATE,
    globalDefaultMode: "ASSIST",
    effectiveMode: "ASSIST",
    globalEnabled: true,
    avatarActive: true,
    workerOnline: true,
    ...overrides
  };
}

describe("conversation agent domain to UI mapping", () => {
  it("maps missing overrides to explicit INHERIT selections", () => {
    const result = mapConversationAgentState(domainState(), true);

    expect(result.modeOverride).toBe("INHERIT");
    expect(result.delayOverride).toBe("INHERIT");
    expect(result.activeWindowMode).toBe("INHERIT");
    expect(result.receiveAiFromContact).toBe("INHERIT");
  });

  it.each(["INHERIT", "ALLOW", "BLOCK"] as const)(
    "preserves the %s receive-AI state",
    (receiveAiFromContact) => {
      const result = mapConversationAgentState(
        domainState({ receiveAiFromContact }),
        true
      );

      expect(result.receiveAiFromContact).toBe(receiveAiFromContact);
    }
  );

  it("maps domain day windows to UI weekday windows", () => {
    const result = mapConversationAgentState(
      domainState({
        activeWindowMode: "CUSTOM",
        activeWindows: [{ day: 2, start: "09:00", end: "18:00" }]
      }),
      true
    );

    expect(result.activeWindows).toEqual([
      { weekday: 2, start: "09:00", end: "18:00" }
    ]);
    expect(mapConversationActiveWindowsToDomain(result.activeWindows)).toEqual([
      { day: 2, start: "09:00", end: "18:00" }
    ]);
  });
});

describe("conversation settings payload and optimistic state", () => {
  it("keeps MANUAL and receive-AI tri-state in the save payload", () => {
    const payload = buildConversationAgentSettingsPayload(
      "conversation-1",
      viewState({
        modeOverride: "MANUAL",
        receiveAiFromContact: "INHERIT"
      })
    );

    expect(payload.modeOverride).toBe("MANUAL");
    expect(payload.receiveAiFromContact).toBe("INHERIT");
  });

  it("optimistically updates the badge and the next sheet draft", () => {
    const current = viewState({ modeOverride: "INHERIT", effectiveMode: "ASSIST" });
    const draft = viewState({ modeOverride: "MANUAL", effectiveMode: "ASSIST" });
    const result = optimisticConversationAgentState(current, draft);

    expect(result.effectiveMode).toBe("MANUAL");
    expect(result.modeOverride).toBe("MANUAL");
    expect({ ...result }).toMatchObject({ effectiveMode: "MANUAL", modeOverride: "MANUAL" });
  });

  it("uses the global default mode for an optimistic INHERIT selection", () => {
    const current = viewState({
      globalDefaultMode: "PROXY",
      modeOverride: "MANUAL",
      effectiveMode: "MANUAL"
    });
    const draft = viewState({ modeOverride: "INHERIT" });

    expect(optimisticConversationAgentState(current, draft).effectiveMode).toBe("PROXY");
  });
});
