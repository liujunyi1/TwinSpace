import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  cleanupE2eData,
  createDirectConversation,
  createPost,
  createReadyUser,
  ensureSimulatedUser,
  expectEventually,
  login,
  prisma
} from "./helpers";

test.beforeEach(cleanupE2eData);

function runSimulationOnce() {
  execFileSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), "worker/simulation.ts", "--once"],
    {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AI_PROVIDER: "mock",
      DATABASE_URL: process.env.E2E_DATABASE_URL || "file:./e2e.db",
      SIMULATION_ENABLED: "true"
    },
    stdio: "pipe"
    }
  );
}

test("simulation worker comments on a new public post", async ({ page }) => {
  await ensureSimulatedUser();
  const author = await createReadyUser("simulation_author");
  const post = await createPost(author.id, {
    content: `Simulation target post ${Date.now()}`
  });

  runSimulationOnce();

  await expect
    .poll(
      () =>
      prisma.comment.count({
        where: {
          postId: post.id,
          generatedByAvatar: true,
          author: { username: { startsWith: "sim_" } }
        }
      }),
      { timeout: 5000 }
    )
    .toBeGreaterThan(0);
  await login(page, author.username);
  await page.goto("/feed");
  await expect(page.locator(`#post-${post.id}`)).toContainText("AI");
});

test("simulation worker replies to a real user's latest direct message", async () => {
  const simulated = await ensureSimulatedUser();
  const real = await createReadyUser("simulation_dm");
  const conversation = await createDirectConversation(real.id, simulated.id);
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: real.id,
      content: `Ping simulated user ${Date.now()}`
    }
  });

  runSimulationOnce();

  await expectEventually(
    () =>
      prisma.message.count({
        where: {
          conversationId: conversation.id,
          senderId: simulated.id,
          senderMode: "AI_PROXY"
        }
      }),
    1
  );
});
