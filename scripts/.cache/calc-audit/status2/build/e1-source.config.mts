// Runs status2/build/e1-residuals-classes.test.ts: tests/source/doubles-residuals.test.ts with Track E1's CLASSES rows (the
// integrator's change). npx vitest run --config scripts/.cache/calc-audit/status2/build/e1-source.config.mts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: { include: ["scripts/.cache/calc-audit/status2/build/e1-residuals-classes.test.ts"], environment: "node" },
});
