import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  use: {
    baseURL: "http://127.0.0.1:5340",
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ["--no-sandbox", "--enable-unsafe-swiftshader"] },
  },
  webServer: [
    { command: "node tests/e2e/fixture-server.mjs", url: "http://127.0.0.1:5341/test/intents", reuseExistingServer: false },
    { command: "node scripts/web/serve.mjs", url: "http://127.0.0.1:5340", env: { PORT: "5340", HOST: "127.0.0.1", SCREEPS_ALLOWED_SERVERS: "http://127.0.0.1:5341" }, reuseExistingServer: false },
  ],
});
