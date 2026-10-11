// Track A3: runs A3's unit test (a copy in w1a-a3-itest/ reading the scratch kernel) against the scratch tree with the
// integrator lines I1-I6 applied (w1a-a3-itree.sh), so the Mat Block test skipped in the real tree runs. From the repo root:
//   bash scripts/.cache/calc-audit/status2/build/w1a-a3-itree.sh && npx vitest run --config scripts/.cache/calc-audit/status2/build/w1a-a3-itest.config.mts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(".").split(String.fromCharCode(92)).join("/");
const battle = `${root}/scripts/.cache/calc-audit/status2/build/w1a-a3-itree/app/lib/battle/`;
export default defineConfig({
  resolve: { alias: [{ find: /^@\/app\/lib\/battle\//, replacement: battle }, { find: /^@\//, replacement: `${root}/` }] },
  test: { environment: "node", include: ["scripts/.cache/calc-audit/status2/build/w1a-a3-itest/*.test.ts"], root },
});
