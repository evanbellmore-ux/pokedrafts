// Track N: runs tests against a scratch copy of app/lib/battle with Track N's proposed integrator changes applied (the
// path in N_INT_BATTLE, made by the scratch patch-int.cjs). The repo's own files are untouched. From the repo root:
//   N_INT_BATTLE=<copy>/app/lib/battle npx vitest run --config scripts/.cache/calc-audit/status2/build/W1A-N-int.config.mts tests/unit/doubles-history.test.ts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(".");
const battle = process.env.N_INT_BATTLE;
if (!battle) throw new Error("N_INT_BATTLE is not set");

export default defineConfig({
  resolve: { alias: [{ find: /^@\/app\/lib\/battle\//, replacement: `${battle.replace(/\\/g, "/")}/` }, { find: /^@\//, replacement: `${root.replace(/\\/g, "/")}/` }] },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"], root },
});
