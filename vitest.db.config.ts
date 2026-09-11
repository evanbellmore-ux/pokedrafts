import { defineConfig } from "vitest/config";

// Database tests run the migrations against an embedded Postgres that is
// started once in tests/db/global-setup.ts. Files run one at a time on a single
// worker because they share that server.
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    sequence: { concurrent: false },
    reporters: ["default"],
  },
});
