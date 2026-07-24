import { expect, test } from "@playwright/test";
import {
  cleanupE2eData,
  createDirectConversation,
  createReadyUser,
  expectEventually,
  login,
  prisma
} from "./helpers";

test.beforeEach(cleanupE2eData);

test("the conversation list opens a direct conversation", async ({ page }) => {
  const owner = await createReadyUser("message_owner");
  const other = await createReadyUser("message_other");
  const conversation = await createDirectConversation(owner.id, other.id);
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: other.id,
      content: `Conversation list message ${Date.now()}`
    }
  });

  await login(page, owner.username);
  await page.goto("/messages");
  await page.locator(`a[href="/messages/${conversation.id}"]`).click();

  await expect(page).toHaveURL(new RegExp(`/messages/${conversation.id}$`));
});

test("sending a direct message persists it and clears the composer", async ({ page }) => {
  const owner = await createReadyUser("send_owner");
  const other = await createReadyUser("send_other");
  const conversation = await createDirectConversation(owner.id, other.id);
  const content = `Direct E2E message ${Date.now()}`;

  await login(page, owner.username);
  await page.goto(`/messages/${conversation.id}`);
  await page.locator("textarea").fill(content);
  await page.locator("form").last().locator('button[type="submit"]').click();

  await expect(page.getByText(content)).toBeVisible();
  await expect(page.locator("textarea")).toHaveValue("");
  await expectEventually(
    () =>
      prisma.message.count({
        where: { conversationId: conversation.id, senderId: owner.id, content }
      }),
    1
  );
});
