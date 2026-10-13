// FINAL2 (status2 final gate): the probe for npm run check's hook timeout. vitest.unit.config.ts as it is, with the generated
// tests/unit/doubles-turn-showdown.test.ts (7.5 MB) moved to a third group that runs alone after the other two, so its
// transform never runs beside another file. Used only to test the fix before it goes into vitest.unit.config.ts.
import { configDefaults, defineConfig } from "vitest/config";

const root = "/home/user/pokedrafts";
const TRAINING = ["tests/unit/training-*.test.ts", "tests/unit/doubles-outcomes.test.ts", "tests/unit/showdown-sim-package.test.ts"];
const GENERATED = ["tests/unit/doubles-turn-showdown.test.ts"];
export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: {
    environment: "node",
    maxWorkers: "50%",
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], exclude: [...configDefaults.exclude, ...TRAINING, ...GENERATED], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: "training", include: TRAINING, sequence: { groupOrder: 1 } } },
      { extends: true, test: { name: "showdown", include: GENERATED, sequence: { groupOrder: 2 } } },
    ],
  },
});
