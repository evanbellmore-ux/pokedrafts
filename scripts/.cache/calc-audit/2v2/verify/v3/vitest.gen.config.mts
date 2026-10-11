// Track R-V: runs a generated doubles-turn-showdown test written by gen-tests.ts --out= to v3/gen. RV_ENGINE_ROOT (optional) is
// the tree "@/" resolves to (the Step 2 engine tree in the scratchpad while R-E's files are in progress); default the repo.
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": process.env.RV_ENGINE_ROOT ?? root } },
  test: { include: ["scripts/.cache/calc-audit/2v2/verify/v3/gen/*.test.ts"], environment: "node", testTimeout: 120_000 },
});
