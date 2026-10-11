// Step 0c: rebuilds the pre-move BattleConditions.tsx (HEAD's file plus Step 0's two hunks, the working tree's state before
// Step 0c) as step0c-old/BattleConditions.tsx, with its relative imports pointed at the calculator folder, for
// step0c-markup.test.tsx. Run from the repo root: node scripts/.cache/calc-audit/status2/build/step0c-make-old.cjs
const fs = require("fs");
const dir = "scripts/.cache/calc-audit/status2/build/step0c-old/";
let s = fs.readFileSync(dir + "BattleConditions.head.tsx", "utf8").split("\r\n").join("\n");
const swap = (from, to, count = 1) => {
  const parts = s.split(from);
  if (parts.length - 1 !== count) throw new Error(`expected ${count} of ${from}, found ${parts.length - 1}`);
  s = parts.join(to);
};
// Step 0's hunks (git diff of the working tree before Step 0c).
swap("const sideOptions: { key: keyof SideConditions; label: string | ((runtime: BattleRuntime) => string) }[] = [",
  "/** The side conditions that are on/off toggles (status2 adds non-boolean 2v2-only keys: protectName, gmaxResidual). */\n"
  + "type SideToggleKey = { [K in keyof SideConditions]-?: NonNullable<SideConditions[K]> extends boolean ? K : never }[keyof SideConditions];\n"
  + "const sideOptions: { key: SideToggleKey; label: string | ((runtime: BattleRuntime) => string) }[] = [");
swap(".filter(([key, on]) => counts(key, on)).length", ".filter(([key, on]) => counts(key, on === true)).length", 2);
// Imports from the calculator folder.
swap('from "./doubles-prep";', 'from "@/app/(app)/calculator/doubles-prep";');
swap('from "./calculator.module.css";', 'from "@/app/(app)/calculator/calculator.module.css";');
fs.writeFileSync(dir + "BattleConditions.tsx", s);
console.log("wrote", dir + "BattleConditions.tsx", s.split("\n").length, "lines");
