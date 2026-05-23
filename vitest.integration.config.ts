import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
    reporters: ["default"],
    // Integration tests do real filesystem I/O — allow up to 30s per suite.
    testTimeout: 30_000,
  },
});
