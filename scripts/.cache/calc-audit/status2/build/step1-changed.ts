// status2 Step 1 gate (SPEC2 §8.2, ADDENDUM2 §8.2): the cases each fix changes, listed, each checked against its oracle.
// Compares two app-results folders (step0a-run-app.ts output: Step 0's `base` and this tree's `new`), ms removed, and lists
// every case whose app result changed or that is new, with the fix that changes it and the paths that changed; a changed
// case with no fix below fails the gate. Each listed case is then compared with its stored oracle result (compare.ts
// compareCase, E2 included as step0a-compare.ts passes it).
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/step1-changed.ts <base dir> <new dir>
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../../2v2/verify/cases";
import { runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase, readOracle } from "../../2v2/verify/compare";
import { STEP1_CASES } from "../../2v2/verify/cases-status2-step1";

/** The stored cases a Step 1 fix changes (Step 0's app result differs), with the fix. */
const CHANGED_STORED: Record<string, string> = {
  "ER20": "#5 Ghost Curse: the cost is a loss on the user's card (the step fact moves to hp.losses)",
  "S26d": "#5 Ghost Curse: the cost is a loss on the user's card, its faint the step fact",
  "VE-F4-2": "#5 Ghost Curse: the cost is a loss on the user's card",
  "VE-M1-3": "#13 Spectral Thief: the steal's hit fact (the numbers were already Showdown's)",
  "FE-FX02b": "#9 USUM's frozen order reads the paralysis a Lum Berry cures at the first Update (the case now sets the status silently: silentStatus, oracle re-run)",
};
/** The new cases by id prefix: the fix whose oracle cases they are. */
const NEW_PREFIX: [string, string][] = [
  ["G4-ALY-", "#1"], ["G4-SFL-", "#2"], ["F2-CC", "#3"], ["G4-TRC-", "#4"], ["G4-CRS-", "#5"], ["T2P-UNB-", "#9"],
  ["FX-CR-", "#10"], ["CQ-CRS-", "#10"], ["FX-BJ-", "#12"], ["T2M-VS-01", "#12"], ["T2M-VS-03", "#12"], ["CQ-ETT-01", "#12 (#11)"],
  ["CQ-ETT-02", "#11"], ["FX-ST-", "#13"], ["T2M-VS-04", "#13"], ["IN-SW", "#14"], ["CQ-ETT-04", "#14 (#11, #12)"], ["S1-RSP-", "#7"],
];
const [baseDir, newDir] = process.argv.slice(2).map((dir) => path.resolve(dir));
if (!baseDir || !newDir) throw new Error("usage: step1-changed.ts <base dir> <new dir>");

function paths(x: unknown, y: unknown, at: string, out: string[]) {
  if (JSON.stringify(x) === JSON.stringify(y)) return;
  if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
    for (const key of new Set([...Object.keys(x as object), ...Object.keys(y as object)])) paths((x as Record<string, unknown>)[key], (y as Record<string, unknown>)[key], `${at}.${key}`, out);
    return;
  }
  out.push(at);
}
const read = (dir: string, id: string) => {
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  delete json.ms;
  return json;
};
const step1 = new Set(STEP1_CASES.map((c) => c.id));
(async () => {
  let same = 0, bad = 0;
  const listed: string[] = [];
  for (const c of CASES) {
    const before = read(baseDir, c.id), after = read(newDir, c.id);
    if (!after) { console.log(`${c.id}: MISSING in ${newDir}`); bad++; continue; }
    let fix: string | undefined;
    let what: string;
    if (!before) {
      fix = step1.has(c.id) ? NEW_PREFIX.find(([prefix]) => c.id.startsWith(prefix))?.[1] : undefined;
      what = "new case";
    } else {
      const changed: string[] = [];
      paths(before, after, "", changed);
      if (!changed.length) { same++; continue; }
      fix = CHANGED_STORED[c.id];
      const tops = [...new Set(changed.map((p) => p.split(".").slice(1, 4).join(".")))];
      what = `${changed.length} paths changed (${tops.slice(0, 6).join(", ")}${tops.length > 6 ? ", …" : ""})`;
    }
    const runtime = await runtimeFor(c);
    const mismatches = compareCase(c, readOracle(c.id), after.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status", after.outcomes);
    const oracle = c.notEstimated ? (after.result?.reason === c.notEstimated ? "not estimated as listed" : "NOT ESTIMATED REASON DIFFERS") : mismatches.length ? `${mismatches.length} MISMATCHES` : "matches the oracle";
    if (!fix || mismatches.length || oracle.startsWith("NOT")) bad++;
    listed.push(c.id);
    console.log(`${c.id}: ${fix ?? "NO FIX LISTED"}: ${what}; ${oracle}`);
  }
  console.log(`\n${CASES.length} cases: ${same} unchanged, ${listed.length} listed (${listed.filter((id) => step1.has(id)).length} new Step 1 cases), ${bad} failing the gate.`);
  if (bad) process.exitCode = 1;
})();
