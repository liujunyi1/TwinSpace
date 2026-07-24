import { expect, test } from "@playwright/test";
import {
  cleanupE2eData,
  createPost,
  createReadyUser,
  expectEventually,
  login,
  prisma
} from "./helpers";

test.beforeEach(cleanupE2eData);

test("social agent settings can be enabled from the UI", async ({ page }) => {
  const user = await createReadyUser("social_settings");

  await login(page, user.username);
  await page.goto("/avatar/social");
  await page.locator('input[type="checkbox"]').first().check();
  await page.locator("button.btn-primary").last().click();

  await expectEventually(
    async () => (await prisma.socialAgentPolicy.findUnique({ where: { userId: user.id } }))?.enabled,
    true
  );
});

test("run now creates a social agent task for an eligible public post", async ({ page }) => {
  const owner = await createReadyUser("social_owner");
  const target = await createReadyUser("social_target");
  await createPost(target.id, { content: `Eligible social post ${Date.now()}` });
  await prisma.socialAgentPolicy.update({
    where: { userId: owner.id },
    data: {
      enabled: true,
      mode: "SUGGEST",
      scope: "PUBLIC",
      dailyCommentLimit: 5,
      authorCooldownHours: 1
    }
  });

  await login(page, owner.username);
  await page.goto("/avatar/social");
  await page.locator("section.bg-ink button").click();

  await expect
    .poll(() => prisma.socialAgentTask.count({ where: { ownerId: owner.id } }), { timeout: 5000 })
    .toBeGreaterThan(0);
});
