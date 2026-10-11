// Track R-U: runs a test against a consistent engine tree while R-E's files are in progress: RU_BATTLE is a copy of
// app/lib/battle at Step 2's end (step2/pre with step2/step2.diff applied). The repo's own files are untouched. From the repo root:
//   RU_BATTLE=<copy>/app/lib/battle npx vitest run --config scripts/.cache/calc-audit/status2/build/w2-ru/engine.config.mts tests/unit/calculator-doubles-bench.test.ts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(".");
const battle = process.env.RU_BATTLE;
if (!battle) throw new Error("RU_BATTLE is not set");

export default defineConfig({
  resolve: { alias: [{ find: /^@\/app\/lib\/battle\//, replacement: `${battle.replace(/\\/g, "/")}/` }, { find: /^@\//, replacement: `${root.replace(/\\/g, "/")}/` }] },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"], root },
});
