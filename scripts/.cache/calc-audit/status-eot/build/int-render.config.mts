// status-eot integration's server-render check (build/int-render.test.ts).
//   npx vitest run --config scripts/.cache/calc-audit/status-eot/build/int-render.config.mts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../../../../..");
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: { include: ["scripts/.cache/calc-audit/status-eot/build/int-render.test.ts"], environment: "node" },
});
