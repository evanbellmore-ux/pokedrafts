import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/** Explicit offline source gate; missing/corrupt pinned archives are failures. */
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    include: ["tests/source/battle-data.test.ts"],
    environment: "node",
  },
});
