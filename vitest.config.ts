import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src-web/src/**/*.test.ts", "scripts/web/**/*.test.mjs"],
    environment: "node",
    testTimeout: 10_000,
    restoreMocks: true,
  },
});
