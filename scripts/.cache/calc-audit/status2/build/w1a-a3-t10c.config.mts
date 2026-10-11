// Track A3: runs the proposed tests/unit/doubles-items.test.ts T10c replacement (w1a-a3-t10c/doubles-items.test.ts, a copy
// of the test file with only T10c changed) against the real tree. From the repo root:
//   npx vitest run --config scripts/.cache/calc-audit/status2/build/w1a-a3-t10c.config.mts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(".");
export default defineConfig({
  resolve: { alias: { "@": root } },
  test: { environment: "node", include: ["scripts/.cache/calc-audit/status2/build/w1a-a3-t10c/*.test.ts"], root },
});
