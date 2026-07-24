import { expect, test } from "@playwright/test";
import {
  cleanupE2eData,
  createReadyUser,
  expectEventually,
  login,
  prisma
} from "./helpers";

test.beforeEach(cleanupE2eData);

test("search by username opens a matching user's profile", async ({ page }) => {
  const viewer = await createReadyUser("search_viewer");
  const target = await createReadyUser("search_target", { nickname: `Search Target ${Date.now()}` });

  await login(page, viewer.username);
  await page.goto(`/search?q=${target.username}`);
  await page.getByRole("link", { name: new RegExp(target.nickname) }).first().click();

  await expect(page).toHaveURL(new RegExp(`/users/${target.id}$`));
});

test("search results can follow another user", async ({ page }) => {
  const viewer = await createReadyUser("follow_viewer");
  const target = await createReadyUser("follow_target");

  await login(page, viewer.username);
  await page.goto(`/search?q=${target.username}`);
  await page
    .locator(`form:has(input[name="followingId"][value="${target.id}"])`)
    .locator("button")
    .click();

  await expectEventually(
    () =>
      prisma.follow.count({
        where: { followerId: viewer.id, followingId: target.id }
      }),
    1
  );
});
