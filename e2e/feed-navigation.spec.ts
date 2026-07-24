import { expect, test } from "@playwright/test";
import {
  cleanupE2eData,
  createPost,
  createReadyUser,
  login,
  prisma
} from "./helpers";

test.beforeEach(cleanupE2eData);

test("clicking a feed post author opens that user's profile", async ({ page }) => {
  const author = await createReadyUser("feed_author", { nickname: `Author ${Date.now()}` });
  const viewer = await createReadyUser("feed_viewer");
  const post = await createPost(author.id, { content: `Author link post ${Date.now()}` });

  await login(page, viewer.username);
  await page.goto("/feed");
  await page.locator(`#post-${post.id} a[href="/users/${author.id}"]`).first().click();

  await expect(page).toHaveURL(new RegExp(`/users/${author.id}$`));
});

test("clicking a feed comment avatar opens the comment author's profile", async ({ page }) => {
  const author = await createReadyUser("post_author");
  const commenter = await createReadyUser("commenter", { nickname: `Commenter ${Date.now()}` });
  const viewer = await createReadyUser("comment_viewer");
  const post = await createPost(author.id, { content: `Comment avatar post ${Date.now()}` });
  await prisma.comment.create({
    data: {
      postId: post.id,
      authorId: commenter.id,
      content: `Comment avatar content ${Date.now()}`
    }
  });

  await login(page, viewer.username);
  await page.goto("/feed");
  await page.locator(`#post-${post.id} a[href="/users/${commenter.id}"]`).first().click();

  await expect(page).toHaveURL(new RegExp(`/users/${commenter.id}$`));
});
