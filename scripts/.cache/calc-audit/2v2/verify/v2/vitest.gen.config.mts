// Track V2: runs a generated doubles-turn-showdown test written by gen-tests.ts --out= to v2/tmp/gen (before it replaces the real one).
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: { include: ["scripts/.cache/calc-audit/2v2/verify/v2/tmp/gen/*.test.ts"], environment: "node", testTimeout: 120_000 },
});
