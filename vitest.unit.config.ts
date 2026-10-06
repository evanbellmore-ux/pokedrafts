import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The Training tab's suites (pinned simulator battles, belief battles, the AI and its E2 engine export) run as a second
 * group after every other unit test, so their CPU load does not slow the calculator's timed suites
 * (calculator-uses-to-ko, calculator-after-use, doubles-turn-perf) past vitest's 5 s per-test limit. Workers are half
 * the logical CPUs (one per core on a two-thread-per-core CPU): on 8 cores / 16 threads the suite's wall time is the same
 * (45 s) and the slowest calculator case takes 3.0 s instead of 4.7–5.4 s.
 */
const TRAINING = ["tests/unit/training-*.test.ts", "tests/unit/doubles-outcomes.test.ts", "tests/unit/showdown-sim-package.test.ts"];

/** Pure unit tests (no DOM, no database). `npm run test`. */
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    environment: "node",
    maxWorkers: "50%",
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], exclude: [...configDefaults.exclude, ...TRAINING], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: "training", include: TRAINING, sequence: { groupOrder: 1 } } },
    ],
  },
});
