import { defineConfig, devices } from "@playwright/test";

/**
 * The smoke test (test/e2e): the app in headless Chromium at phone, tablet
 * and desktop widths, light and dark, with screenshots saved for review.
 * It runs against `pnpm dev` (the real Worker proxy and live feeds), or an
 * already running server at SCORELINE_URL.
 *
 *     pnpm test:e2e
 *     SCORELINE_SCREENSHOTS=/some/dir pnpm test:e2e
 */
const url = process.env.SCORELINE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: url,
    ...devices["Desktop Chrome"],
    headless: true,
  },
  webServer: process.env.SCORELINE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
