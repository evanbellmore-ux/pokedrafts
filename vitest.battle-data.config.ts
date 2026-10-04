import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Explicit offline source gate; missing/corrupt pinned archives are failures. `npm run test:battle-data:source`.
 * tests/source/battle-data.test.ts checks the generated battle data; tests/source/doubles-third-party.test.ts checks
 * the 2v2 engine's tables against the pinned Showdown dex.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    include: ["tests/source/**/*.test.ts"],
    environment: "node",
  },
});
