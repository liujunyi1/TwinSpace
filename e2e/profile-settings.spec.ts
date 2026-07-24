import { expect, test } from "@playwright/test";
import {
  cleanupE2eData,
  createReadyUser,
  expectEventually,
  login,
  prisma
} from "./helpers";

test.beforeEach(cleanupE2eData);

test("profile settings update nickname", async ({ page }) => {
  const user = await createReadyUser("profile");
  const nickname = `Updated ${Date.now()}`;

  await login(page, user.username);
  await page.goto("/profile/settings");
  await page.locator('input[name="nickname"]').fill(nickname);
  await page.locator("form button").click();

  await expectEventually(
    async () => (await prisma.user.findUnique({ where: { id: user.id } }))?.nickname,
    nickname
  );
});

test("profile settings update bio and show it on profile", async ({ page }) => {
  const user = await createReadyUser("bio");
  const bio = `E2E bio ${Date.now()}`;

  await login(page, user.username);
  await page.goto("/profile/settings");
  await page.locator('textarea[name="bio"]').fill(bio);
  await page.locator("form button").click();
  await page.waitForURL(/\/profile$/);

  await expect(page.getByText(bio)).toBeVisible();
});
