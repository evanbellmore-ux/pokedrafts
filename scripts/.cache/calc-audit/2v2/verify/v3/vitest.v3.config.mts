// Track R-V's harness regression tests: npx vitest run --config scripts/.cache/calc-audit/2v2/verify/v3/vitest.v3.config.mts
// RV_ENGINE_ROOT (optional): the tree "@/" resolves to (the Step 2 engine tree while R-E's files are in progress).
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": process.env.RV_ENGINE_ROOT ?? root } },
  test: {
    include: ["scripts/.cache/calc-audit/2v2/verify/v3/harness.test.ts"], environment: "node", testTimeout: 180_000,
    setupFiles: ["scripts/.cache/calc-audit/2v2/verify/v1/vitest.setup.ts"],
  },
});
