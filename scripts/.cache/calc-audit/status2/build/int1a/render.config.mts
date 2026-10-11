// Runs render-2v2.test.tsx (integration 1a's static render of the 2v2 page for the Browser pane's layout check).
// npx vitest run --config scripts/.cache/calc-audit/status2/build/int1a/render.config.mts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: { include: ["scripts/.cache/calc-audit/status2/build/int1a/render-2v2.test.tsx"], exclude: [], environment: "node" },
});
