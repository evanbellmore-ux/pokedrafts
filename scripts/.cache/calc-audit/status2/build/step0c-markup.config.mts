// Runs step0c-markup.test.tsx (Step 0c's before/after markup check of BattleConditions).
// npx vitest run --config scripts/.cache/calc-audit/status2/build/step0c-markup.config.mts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: { include: ["scripts/.cache/calc-audit/status2/build/step0c-markup.test.tsx"], exclude: [], environment: "node" },
});
