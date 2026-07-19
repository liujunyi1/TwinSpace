import {
  runAgentWorkerOnce
} from "@/lib/agent/chat-worker";
import { runSocialAgentWorkerOnce } from "@/lib/agent/social-worker";
import { prisma } from "@/lib/prisma";

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

async function runAllWorkersOnce(signal?: AbortSignal) {
  await runAgentWorkerOnce();
  await runSocialAgentWorkerOnce({ signal });
}

async function main() {
  if (process.argv.includes("--once")) {
    await runAllWorkersOnce();
    return;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  while (!controller.signal.aborted) {
    await runAllWorkersOnce(controller.signal);
    await wait(2000, controller.signal);
  }
}

main()
  .catch((error) => {
    console.error("[agent-worker] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
