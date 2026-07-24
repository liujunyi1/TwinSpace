import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export default async function globalSetup() {
  const databaseUrl = process.env.E2E_DATABASE_URL || "file:./e2e.db";
  process.env.DATABASE_URL = databaseUrl;
  process.env.AUTH_SECRET = "twinspace-e2e-secret";
  process.env.AI_PROVIDER = "mock";

  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    rmSync(join(process.cwd(), "prisma", `e2e.db${suffix}`), {
      force: true
    });
  }

  const devDb = join(process.cwd(), "prisma", "dev.db");
  const e2eDb = join(process.cwd(), "prisma", "e2e.db");
  if (existsSync(devDb)) {
    copyFileSync(devDb, e2eDb);
    return;
  }

  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args =
    process.platform === "win32"
      ? ["/c", "npm.cmd", "run", "db:push"]
      : ["run", "db:push"];
  try {
    execFileSync(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });
  } catch (error) {
    if (!existsSync(devDb)) {
      throw error;
    }
    copyFileSync(devDb, e2eDb);
  }
}
