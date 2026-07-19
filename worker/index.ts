import {
  runAgentWorkerLoop,
  runAgentWorkerOnce
} from "@/lib/agent/chat-worker";
import { prisma } from "@/lib/prisma";

async function main() {
  if (process.argv.includes("--once")) {
    await runAgentWorkerOnce();
    return;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await runAgentWorkerLoop({ signal: controller.signal, pollIntervalMs: 2000 });
}

main()
  .catch((error) => {
    console.error("[chat-worker] fatal", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
