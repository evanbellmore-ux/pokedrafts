// Track V1's harness regression tests: npx vitest run --config scripts/.cache/calc-audit/2v2/verify/v1/vitest.v1.config.mts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: {
    include: ["scripts/.cache/calc-audit/2v2/verify/v1/harness.test.ts"], environment: "node", testTimeout: 120_000,
    setupFiles: ["scripts/.cache/calc-audit/2v2/verify/v1/vitest.setup.ts"],
  },
});
