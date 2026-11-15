import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./storybook-tests",
  outputDir: "../.cache/playwright-storybook-results",
  // Python http.server はシングルスレッドのため、並列接続での拒否やフォーカス競合を防ぐ
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:6007",
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      "pnpm -C ../backend exec python -B -m http.server 6007 --bind 127.0.0.1 --directory ../.cache/storybook-static",
    url: "http://127.0.0.1:6007/index.json",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
