import {
  runSimulationWorkerLoop,
  runSimulationWorkerOnce
} from "@/lib/simulation/worker";

const once = process.argv.includes("--once");

async function main() {
  if (once) {
    const result = await runSimulationWorkerOnce();
    console.log(
      `[simulation-worker] comments=${result.commentsCreated}, replies=${result.repliesCreated}`
    );
    return;
  }

  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  process.on("SIGTERM", () => controller.abort());

  await runSimulationWorkerLoop({ signal: controller.signal });
}

main()
  .catch((error) => {
    console.error("[simulation-worker] fatal", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
