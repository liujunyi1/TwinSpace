import { expect, test } from "@playwright/test";
import { cleanupE2eData, createPost, createReadyUser, login } from "./helpers";

test.beforeEach(cleanupE2eData);

test("public posts are visible to another user in the feed", async ({ page }) => {
  const author = await createReadyUser("author");
  const viewer = await createReadyUser("viewer");
  const post = await createPost(author.id, {
    content: `Public E2E post ${Date.now()}`,
    visibility: "PUBLIC"
  });

  await login(page, viewer.username);
  await page.goto("/feed");

  await expect(page.locator(`#post-${post.id}`)).toContainText(post.content);
});

test("private posts are hidden from other users but visible to the author", async ({ page }) => {
  const author = await createReadyUser("private_author");
  const viewer = await createReadyUser("private_viewer");
  const post = await createPost(author.id, {
    content: `Private E2E post ${Date.now()}`,
    visibility: "PRIVATE"
  });

  await login(page, viewer.username);
  await page.goto("/feed");
  await expect(page.getByText(post.content)).toHaveCount(0);

  await page.context().clearCookies();
  await login(page, author.username);
  await page.goto("/feed");
  await expect(page.locator(`#post-${post.id}`)).toContainText(post.content);
});
