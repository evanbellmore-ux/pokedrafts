// Track R-V: the wave 2 cases by id family and game, and which have a stored oracle result.
import fs from "node:fs";
import { WAVE2_CASES } from "../cases-wave2";
const fam = new Map<string, string[]>();
for (const c of WAVE2_CASES) {
  const key = c.id.replace(/-(sv|swsh|usum|champions)$/, "");
  fam.set(key, [...(fam.get(key) ?? []), c.game + (c.notEstimated ? "*" : "")]);
}
for (const [k, g] of fam) console.log(`${k}: ${g.join(", ")}`);
const missing = WAVE2_CASES.filter((c) => !fs.existsSync(`scripts/.cache/calc-audit/2v2/verify/results/${c.id}.json`)).map((c) => c.id);
console.log(`${WAVE2_CASES.length} cases in ${fam.size} families; ${WAVE2_CASES.filter((c) => c.notEstimated).length} not estimated (*); oracle results missing: ${missing.join(", ") || "none"}`);
