// Integration 2 (cloud session): vitest.battle-data.config.ts (tests/source/**) with the pinned source cache read from
// SOURCE_CACHE (sources-overlay.mjs) instead of node_modules/.cache/champions, which this session may not write. The test files
// are the tree's, unchanged.
//   SOURCE_CACHE=<dir> npx vitest run --config scripts/.cache/calc-audit/status2/build/int2/vitest.source-overlay.config.mts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const ROOT = "/home/user/pokedrafts";
const OVERLAY = fileURLToPath(new URL("./sources-overlay.mjs", import.meta.url));

export default defineConfig({
  root: ROOT,
  resolve: {
    alias: [
      { find: /^(\.\.\/)+scripts\/lib\/champions-data\/sources\.mjs$/, replacement: OVERLAY },
      { find: /^\.\.\/champions-data\/sources\.mjs$/, replacement: OVERLAY },
      { find: "@", replacement: ROOT },
    ],
  },
  test: {
    include: ["tests/source/**/*.test.ts"],
    environment: "node",
  },
});
