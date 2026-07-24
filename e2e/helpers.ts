import { expect, type Page } from "@playwright/test";
import { PrismaClient, type User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { writeFile } from "node:fs/promises";

process.env.DATABASE_URL = process.env.E2E_DATABASE_URL || "file:./e2e.db";

export const prisma = new PrismaClient();
export const password = "TwinSpace123!";
export const userPrefix = "e2e_";

export function uniqueName(label: string) {
  return `${userPrefix}${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function cleanupE2eData() {
  await prisma.user.deleteMany({
    where: { username: { startsWith: userPrefix } }
  });
}

export async function createPng(path: string) {
  await writeFile(
    path,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64"
    )
  );
}

export async function createReadyUser(label: string, input: Partial<User> = {}) {
  const username = input.username || uniqueName(label);
  return prisma.user.create({
    data: {
      username,
      email: input.email || `${username}@example.test`,
      nickname: input.nickname || label,
      bio: input.bio || `${label} bio`,
      avatarUrl: input.avatarUrl || null,
      passwordHash: await bcrypt.hash(password, 4),
      personalityProfile: {
        create: {
          summary: `${label} E2E profile`,
          traitsJson: JSON.stringify({ labels: ["e2e", label] }),
          communicationStyle: "direct",
          socialStyle: "steady",
          emotionalStyle: "warm",
          replyLength: "short",
          emojiPreference: "rare",
          aiAutonomyLevel: "proxy"
        }
      },
      avatarProfile: {
        create: {
          privateName: `${label} avatar`,
          status: "ACTIVE",
          knowledgeRevision: 1,
          policyRevision: 1,
          calibratedAt: new Date()
        }
      },
      avatarAgentSetting: {
        create: {
          enabled: true,
          defaultMode: "PROXY",
          activeWindowsJson: "[]",
          receiveAi: true
        }
      },
      socialAgentPolicy: {
        create: {
          enabled: false,
          mode: "OFF",
          scope: "PUBLIC",
          activeWindowsJson: "[]"
        }
      }
    }
  });
}

export async function ensureSimulatedUser(username = "sim_chenxi") {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      username,
      email: `${username}@simulation.e2e.test`,
      nickname: "Sim Chenxi",
      bio: "E2E simulated user",
      passwordHash: await bcrypt.hash(password, 4),
      personalityProfile: {
        create: {
          summary: "Simulated E2E persona",
          traitsJson: JSON.stringify({ labels: ["simulated"] }),
          communicationStyle: "warm",
          socialStyle: "active",
          emotionalStyle: "steady",
          replyLength: "short",
          emojiPreference: "rare",
          aiAutonomyLevel: "proxy"
        }
      },
      avatarProfile: {
        create: {
          privateName: "Sim avatar",
          status: "ACTIVE",
          knowledgeRevision: 1,
          policyRevision: 1,
          calibratedAt: new Date()
        }
      },
      avatarAgentSetting: {
        create: {
          enabled: true,
          defaultMode: "PROXY",
          activeWindowsJson: "[]",
          receiveAi: true
        }
      },
      socialAgentPolicy: {
        create: {
          enabled: true,
          mode: "AUTO",
          scope: "PUBLIC",
          activeWindowsJson: "[]",
          dailyCommentLimit: 8
        }
      }
    }
  });
}

export async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.locator('input[name="account"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator("form button").click();
  await page.waitForURL(/\/feed$/);
}

export async function createPost(
  authorId: string,
  input: {
    content?: string;
    visibility?: "PUBLIC" | "FRIENDS" | "PRIVATE";
    allowComments?: boolean;
    topics?: string[];
    imageUrls?: string[];
  } = {}
) {
  return prisma.post.create({
    data: {
      authorId,
      content: input.content || `E2E post ${Date.now()}`,
      visibility: input.visibility || "PUBLIC",
      allowComments: input.allowComments ?? true,
      topicsJson: JSON.stringify(input.topics || []),
      imageUrlsJson: JSON.stringify(input.imageUrls || [])
    }
  });
}

export function directKey(firstUserId: string, secondUserId: string) {
  return `dm:${[firstUserId, secondUserId].sort().join(":")}`;
}

export async function createDirectConversation(ownerId: string, recipientId: string) {
  return prisma.conversation.create({
    data: {
      type: "HUMAN",
      title: "",
      directKey: directKey(ownerId, recipientId),
      members: {
        create: [
          { userId: ownerId, role: "MEMBER" },
          { userId: recipientId, role: "MEMBER" }
        ]
      },
      agentSettings: {
        create: [
          { userId: ownerId, modeOverride: "MANUAL", receiveAiFromContact: "ALLOW" },
          { userId: recipientId, modeOverride: "MANUAL", receiveAiFromContact: "ALLOW" }
        ]
      }
    }
  });
}

export async function expectEventually<T>(
  callback: () => Promise<T>,
  expected: T,
  timeout = 5000
) {
  await expect.poll(callback, { timeout }).toEqual(expected);
}
