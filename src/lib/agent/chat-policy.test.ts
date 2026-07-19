import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConversationAgentState,
  getEffectiveChatPolicy,
  getGlobalAgentSettingsView
} from "@/lib/agent/chat-policy";

const database = vi.hoisted(() => ({
  avatarAgentSettingFindUnique: vi.fn(),
  avatarProfileFindUnique: vi.fn(),
  conversationFindUnique: vi.fn(),
  conversationAgentSettingFindUnique: vi.fn(),
  agentTaskFindMany: vi.fn(),
  heartbeatFindFirst: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    avatarAgentSetting: {
      findUnique: database.avatarAgentSettingFindUnique
    },
    avatarProfile: {
      findUnique: database.avatarProfileFindUnique
    },
    conversation: {
      findUnique: database.conversationFindUnique
    },
    conversationAgentSetting: {
      findUnique: database.conversationAgentSettingFindUnique
    },
    agentTask: {
      findMany: database.agentTaskFindMany
    },
    agentWorkerHeartbeat: {
      findFirst: database.heartbeatFindFirst
    }
  }
}));

type GlobalSetting = {
  userId: string;
  enabled: boolean;
  defaultMode: string;
  assistAutoDraft: boolean;
  delayMode: string;
  customDelaySeconds: number;
  sendBufferSeconds: number;
  timezone: string;
  activeWindowsJson: string;
  receiveAi: boolean;
  policyRevision: number;
};

type ConversationSetting = {
  userId: string;
  modeOverride: string | null;
  delayOverride: string | null;
  customDelaySeconds: number | null;
  activeWindowMode: string;
  activeWindowsJson: string | null;
  receiveAiFromContact: string;
  revision: number;
};

let ownerGlobal: GlobalSetting;
let recipientGlobal: GlobalSetting;
let ownerConversation: ConversationSetting;
let recipientConversation: ConversationSetting;
let avatar: {
  status: string;
  policyRevision: number;
  knowledgeRevision: number;
};
let conversation: {
  id: string;
  type: string;
  aiMode: string;
  members: Array<{ userId: string }>;
  agentSettings: ConversationSetting[];
};
let heartbeat: {
  status: string;
  lastSeenAt: Date;
};

beforeEach(() => {
  vi.clearAllMocks();
  ownerGlobal = {
    userId: "owner",
    enabled: true,
    defaultMode: "PROXY",
    assistAutoDraft: true,
    delayMode: "SHORT",
    customDelaySeconds: 60,
    sendBufferSeconds: 15,
    timezone: "Asia/Shanghai",
    activeWindowsJson: "[]",
    receiveAi: true,
    policyRevision: 2
  };
  recipientGlobal = {
    ...ownerGlobal,
    userId: "contact",
    defaultMode: "MANUAL",
    receiveAi: true
  };
  ownerConversation = {
    userId: "owner",
    modeOverride: null,
    delayOverride: null,
    customDelaySeconds: null,
    activeWindowMode: "INHERIT",
    activeWindowsJson: null,
    receiveAiFromContact: "INHERIT",
    revision: 1
  };
  recipientConversation = {
    ...ownerConversation,
    userId: "contact"
  };
  avatar = {
    status: "ACTIVE",
    policyRevision: 2,
    knowledgeRevision: 4
  };
  conversation = {
    id: "conversation-1",
    type: "HUMAN",
    aiMode: "MANUAL",
    members: [{ userId: "owner" }, { userId: "contact" }],
    agentSettings: [ownerConversation, recipientConversation]
  };
  heartbeat = {
    status: "ONLINE",
    lastSeenAt: new Date()
  };

  database.avatarAgentSettingFindUnique.mockImplementation(
    async (args: { where: { userId: string } }) =>
      args.where.userId === "owner" ? ownerGlobal : recipientGlobal
  );
  database.avatarProfileFindUnique.mockImplementation(async () => avatar);
  database.conversationFindUnique.mockImplementation(async () => conversation);
  database.conversationAgentSettingFindUnique.mockImplementation(
    async (args: {
      where: { conversationId_userId: { userId: string } };
    }) =>
      args.where.conversationId_userId.userId === "owner"
        ? ownerConversation
        : recipientConversation
  );
  database.agentTaskFindMany.mockResolvedValue([]);
  database.heartbeatFindFirst.mockImplementation(async () => heartbeat);
});

describe("getEffectiveChatPolicy", () => {
  it("ignores the legacy Conversation.aiMode value", async () => {
    conversation.aiMode = "PROXY";
    ownerGlobal.defaultMode = "MANUAL";

    const policy = await getEffectiveChatPolicy("owner", conversation.id);

    expect(policy.allowed).toBe(false);
    expect(policy.mode).toBe("MANUAL");
    expect(policy.blockReason).toBe("MANUAL_MODE");
  });

  it("blocks when the avatar is not ACTIVE", async () => {
    avatar.status = "CALIBRATING";

    const policy = await getEffectiveChatPolicy("owner", conversation.id);

    expect(policy.allowed).toBe(false);
    expect(policy.mode).toBe("MANUAL");
    expect(policy.blockReason).toBe("AVATAR_NOT_ACTIVE");
  });

  it("blocks when global automation is disabled", async () => {
    ownerGlobal.enabled = false;

    const policy = await getEffectiveChatPolicy("owner", conversation.id);

    expect(policy.allowed).toBe(false);
    expect(policy.blockReason).toBe("GLOBAL_DISABLED");
  });

  it("uses the conversation mode override before the global mode", async () => {
    ownerGlobal.defaultMode = "MANUAL";
    ownerConversation.modeOverride = "ASSIST";

    const policy = await getEffectiveChatPolicy("owner", conversation.id);

    expect(policy.allowed).toBe(true);
    expect(policy.mode).toBe("ASSIST");
  });

  it("lets recipient BLOCK win while preserving the configured override", async () => {
    ownerConversation.modeOverride = "PROXY";
    recipientConversation.receiveAiFromContact = "BLOCK";

    const state = await getConversationAgentState("owner", conversation.id);

    expect(state.modeOverride).toBe("PROXY");
    expect(state.effectiveMode).toBe("MANUAL");
    expect(state.recipientAllowsAi).toBe(false);
    expect(state.blockReason).toBe("RECIPIENT_BLOCKED_AI");
  });

  it("blocks non-HUMAN and non-two-member conversations", async () => {
    conversation.type = "AI_CONTACT";
    let policy = await getEffectiveChatPolicy("owner", conversation.id);
    expect(policy.blockReason).toBe("NOT_HUMAN_DIRECT_MESSAGE");

    conversation.type = "HUMAN";
    conversation.members = [{ userId: "owner" }];
    policy = await getEffectiveChatPolicy("owner", conversation.id);
    expect(policy.blockReason).toBe("NOT_HUMAN_DIRECT_MESSAGE");
  });
});

describe("getGlobalAgentSettingsView", () => {
  it("reports fresh ONLINE and stale worker heartbeats", async () => {
    let view = await getGlobalAgentSettingsView("owner");
    expect(view.workerOnline).toBe(true);

    heartbeat.lastSeenAt = new Date(Date.now() - 120_000);
    view = await getGlobalAgentSettingsView("owner");
    expect(view.workerOnline).toBe(false);
  });
});
