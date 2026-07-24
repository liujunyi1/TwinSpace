import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { writeFile } from "node:fs/promises";

process.env.DATABASE_URL = process.env.E2E_DATABASE_URL || "file:./e2e.db";

const prisma = new PrismaClient();
const password = "TwinSpace123!";
const userPrefix = "e2e_";

test.beforeEach(async () => {
  await prisma.user.deleteMany({
    where: { username: { startsWith: userPrefix } }
  });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

function uniqueName(label: string) {
  return `${userPrefix}${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createPng(path: string) {
  await writeFile(
    path,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64"
    )
  );
}

async function createReadyUser(label: string) {
  const username = uniqueName(label);
  const user = await prisma.user.create({
    data: {
      username,
      email: `${username}@example.test`,
      nickname: label,
      passwordHash: await bcrypt.hash(password, 4),
      personalityProfile: {
        create: {
          summary: "E2E user",
          traitsJson: JSON.stringify({ labels: ["测试"] }),
          communicationStyle: "直接",
          socialStyle: "稳定",
          emotionalStyle: "温和",
          replyLength: "短",
          emojiPreference: "少",
          aiAutonomyLevel: "托管"
        }
      },
      avatarProfile: {
        create: {
          privateName: `${label} 分身`,
          status: "ACTIVE"
        }
      },
      avatarAgentSetting: {
        create: {
          enabled: true,
          defaultMode: "PROXY",
          activeWindowsJson: "[]",
          receiveAi: true
        }
      }
    }
  });
  return { ...user, plainPassword: password };
}

async function login(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.locator('input[name="account"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator("form button").click();
  await page.waitForURL(/\/feed$/);
}

test("registration and profile settings show uploaded avatar previews", async ({ page }, testInfo) => {
  const avatarPath = testInfo.outputPath("avatar.png");
  await createPng(avatarPath);

  await page.goto("/register");
  await page.locator('input[name="avatarFile"]').setInputFiles(avatarPath);
  await expect(page.locator('[data-testid="avatarFile-preview"] img')).toHaveAttribute(
    "src",
    /blob:/
  );

  const user = await createReadyUser("avatar");
  await login(page, user.username);
  await page.goto("/profile/settings");
  await page.locator('input[name="avatarFile"]').setInputFiles(avatarPath);
  await expect(page.locator('[data-testid="avatarFile-preview"] img')).toHaveAttribute(
    "src",
    /blob:/
  );
});

test("feed comments clear after submit and delete flows use the custom dialog", async ({ page }) => {
  const user = await createReadyUser("feed");
  await login(page, user.username);

  const postText = `E2E 动态 ${Date.now()}`;
  const commentText = `E2E 评论 ${Date.now()}`;
  let nativeDialogOpened = false;
  page.on("dialog", async (dialog) => {
    nativeDialogOpened = true;
    await dialog.dismiss();
  });

  await page.goto("/create");
  await page.locator('textarea[name="content"]').fill(postText);
  await page.locator("form button").last().click();
  await page.waitForURL(/\/feed$/);

  const post = page.locator("article").filter({ hasText: postText }).first();
  await expect(post).toBeVisible();

  const commentForm = post.locator('form:has(input[name="content"])');
  await commentForm.locator('input[name="content"]').fill(commentText);
  await commentForm.locator("button").click();
  await expect(post).toContainText(commentText);
  await expect(commentForm.locator('input[name="content"]')).toHaveValue("");
  const createdPost = await prisma.post.findFirstOrThrow({
    where: { content: postText },
    select: { id: true }
  });
  await prisma.comment.createMany({
    data: [1, 2, 3].map((index) => ({
      postId: createdPost.id,
      authorId: user.id,
      content: `E2E extra comment ${index}`
    }))
  });
  await page.reload();
  const postAfterReload = page.locator("article").filter({ hasText: postText }).first();
  await expect(postAfterReload).toContainText("E2E extra comment 3");

  await postAfterReload.locator('form:has(input[name="commentId"]) button').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(nativeDialogOpened).toBe(false);
  await page.getByRole("dialog").locator("button").first().click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await postAfterReload.locator('form:has(input[name="postId"]) button').first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(nativeDialogOpened).toBe(false);
});

test("manual fallback caused by the recipient blocking AI replies is explained", async ({ page }) => {
  const owner = await createReadyUser("owner");
  const recipient = await createReadyUser("recipient");
  const conversation = await prisma.conversation.create({
    data: {
      type: "HUMAN",
      title: "",
      directKey: `${owner.id}:${recipient.id}`,
      members: {
        create: [
          { userId: owner.id, role: "MEMBER" },
          { userId: recipient.id, role: "MEMBER" }
        ]
      },
      agentSettings: {
        create: [
          {
            userId: owner.id,
            modeOverride: "PROXY",
            receiveAiFromContact: "INHERIT"
          },
          {
            userId: recipient.id,
            receiveAiFromContact: "BLOCK"
          }
        ]
      }
    }
  });

  await login(page, owner.username);
  await page.goto(`/messages/${conversation.id}`);

  await expect(
    page.getByText("对方拒绝 AI 回复，当前会话已切换为手动回复。")
  ).toBeVisible();
  await expect(page.getByText("手动 · 对方拒绝 AI 回复")).toBeVisible();
});
