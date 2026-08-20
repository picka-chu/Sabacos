import { defineConfig } from "@playwright/test";

const executablePath = process.env.BROWSER_PATH;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1600, height: 900 },
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: "npm.cmd run dev -w @motion/web -- --port 5198 --strictPort",
    port: 5198,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
