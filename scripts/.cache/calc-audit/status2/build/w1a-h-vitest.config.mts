// Track H: tests/unit/doubles-hidden.test.ts against the wired copy (w1a-h-wire.mjs's h-wired: the battle engine with
// integration 1a's kernel lines), everything else from the repo. Run from the repo root:
//   node scripts/.cache/calc-audit/status2/build/w1a-h-wire.mjs
//   npx --no-install vitest run --config scripts/.cache/calc-audit/status2/build/w1a-h-vitest.config.mts
import path from "node:path";
import { defineConfig } from "vitest/config";

const slash = (text: string) => text.split(path.sep).join("/");
const root = slash(path.resolve("."));
const wired = slash(path.resolve("scripts/.cache/calc-audit/status2/build/h-wired/app/lib/battle"));
export default defineConfig({
  resolve: { alias: [{ find: /^@\/app\/lib\/battle\//, replacement: `${wired}/` }, { find: /^@\//, replacement: `${root}/` }] },
  test: { environment: "node", include: ["tests/unit/doubles-hidden.test.ts"], root },
});
