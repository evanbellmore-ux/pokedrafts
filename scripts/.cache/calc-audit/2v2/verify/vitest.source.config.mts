// Runs tests/source/doubles-third-party.test.ts (vitest.battle-data.config.ts includes only battle-data.test.ts).
// npx vitest run --config scripts/.cache/calc-audit/2v2/verify/vitest.source.config.mts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: { include: ["tests/source/doubles-third-party.test.ts"], environment: "node" },
});
