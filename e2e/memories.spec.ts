import { expect, test } from "@playwright/test";
import {
  cleanupE2eData,
  createReadyUser,
  expectEventually,
  login,
  prisma
} from "./helpers";

test.beforeEach(cleanupE2eData);

test("a user can add a fact memory", async ({ page }) => {
  const user = await createReadyUser("memory");
  const content = `E2E memory ${Date.now()}`;

  await login(page, user.username);
  await page.goto("/profile/memories");
  await page.locator('input[name="content"]').fill(content);
  await page.locator("form").first().locator("button").click();

  await expectEventually(
    () => prisma.memory.count({ where: { userId: user.id, content } }),
    1
  );
});

test("a confirmed memory can be disabled", async ({ page }) => {
  const user = await createReadyUser("memory_toggle");
  const memory = await prisma.memory.create({
    data: {
      userId: user.id,
      type: "E2E",
      content: `Toggle memory ${Date.now()}`,
      sourceType: "E2E",
      status: "CONFIRMED",
      enabled: true
    }
  });

  await login(page, user.username);
  await page.goto("/profile/memories");
  await page.locator(`form:has(input[name="id"][value="${memory.id}"])`).first().locator("button").click();

  await expectEventually(
    async () => (await prisma.memory.findUnique({ where: { id: memory.id } }))?.enabled,
    false
  );
});
