import { expect, test } from "@playwright/test";
import { cleanupE2eData, createPost, createReadyUser, login } from "./helpers";

test.beforeEach(cleanupE2eData);

test("another user's recent post links back to the feed post anchor", async ({ page }) => {
  const author = await createReadyUser("recent_author");
  const viewer = await createReadyUser("recent_viewer");
  const post = await createPost(author.id, { content: `Recent profile post ${Date.now()}` });

  await login(page, viewer.username);
  await page.goto(`/users/${author.id}`);
  await page.getByText(post.content).click();

  await expect(page).toHaveURL(new RegExp(`/feed#post-${post.id}$`));
});

test("my profile post body links back to the feed post anchor", async ({ page }) => {
  const user = await createReadyUser("own_recent");
  const post = await createPost(user.id, { content: `Own profile post ${Date.now()}` });

  await login(page, user.username);
  await page.goto("/profile");
  await page.getByText(post.content).click();

  await expect(page).toHaveURL(new RegExp(`/feed#post-${post.id}$`));
});
