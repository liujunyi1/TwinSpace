import { expect, test } from "@playwright/test";
import { cleanupE2eData, createReadyUser, login } from "./helpers";

test.beforeEach(cleanupE2eData);

test("protected app routes redirect anonymous users to login", async ({ page }) => {
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/login$/);
});

test("a valid user can log in and reach the feed", async ({ page }) => {
  const user = await createReadyUser("auth");

  await login(page, user.username);

  await expect(page).toHaveURL(/\/feed$/);
});
