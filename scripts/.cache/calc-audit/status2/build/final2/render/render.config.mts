// Runs render-2.test.tsx (integration 2's static 2v2 pages for the 375 px / 1280 px Playwright check, check-layout.mjs).
//   npx vitest run --config scripts/.cache/calc-audit/status2/build/int2/render/render.config.mts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: { include: ["scripts/.cache/calc-audit/status2/build/final2/render/render-3.test.tsx"], exclude: [], environment: "node" },
});
