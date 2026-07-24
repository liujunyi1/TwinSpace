import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL || "file:./e2e.db";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm.cmd run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      AI_PROVIDER: "mock",
      AUTH_SECRET: "twinspace-e2e-secret",
      DATABASE_URL: e2eDatabaseUrl,
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port)
    },
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" }
    }
  ]
});
