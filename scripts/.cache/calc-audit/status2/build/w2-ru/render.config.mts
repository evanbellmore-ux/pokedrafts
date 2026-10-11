// Runs render-ru.test.tsx (Track R-U's static renders for the Browser pane's 375 px / 1280 px check).
//   npx vitest run --config scripts/.cache/calc-audit/status2/build/w2-ru/render.config.mts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: { include: ["scripts/.cache/calc-audit/status2/build/w2-ru/render-ru.test.tsx"], exclude: [], environment: "node" },
});
