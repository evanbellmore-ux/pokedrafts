// status-eot SPEC §7 step 7 / ADDENDUM §7.1 step 6: the 556 stored oracle results must stay byte-equal in their
// after-the-moves fields when sim-dfs.ts runs the residual. Strips the status-eot additions (and each walk's ms) from both
// sides and compares the JSON text. The allowed differences (cases whose app expectation changed by design) are listed.
//
// Run from the repo root:
//   node scripts/.cache/calc-audit/2v2/verify/regress.mjs <new results dir> [<old results dir>]
// Default old dir: scripts/.cache/calc-audit/2v2/verify/before-status-eot/results (the results before status-eot).
import fs from "node:fs";
import path from "node:path";

const [newDir, oldDir = "scripts/.cache/calc-audit/2v2/verify/before-status-eot/results"] = process.argv.slice(2);
if (!newDir) throw new Error("usage: regress.mjs <new results dir> [<old results dir>]");
const SLOT_EXTRA = ["status", "volatiles", "boosts", "item", "sub", "timesAttacked", "perish", "sleepTime", "toxicStage", "swapped", "switchFlag",
  // status2 wave 1a (SPEC2 §7.1): the new state mixtures.
  "types", "ability", "forme", "stored", "weight", "stockpile", "lastItem", "durations", "pendingCopy", "berryLocked"];
const STEP_EXTRA = ["effects", "change", "sides", "moveChange", "selfHit"];
const WALK_EXTRA = ["ms", "afterTurn", "swapped", "sideConditions", "noMove"];
const TOP_EXTRA = ["afterTurn", "residuals", "hidden"];

/** The walk bookkeeping (runs, classes, decision counts): not results; compared apart (metadata). */
const WALK_META = ["runs", "classes", "decisions"];
function strip(r, meta = false) {
  const out = structuredClone(r);
  for (const key of TOP_EXTRA) delete out[key];
  // --validate lines depend on how the case was run, not on its results (compareWalks reruns them).
  out.warnings = (out.warnings ?? []).filter((w) => !w.startsWith("validate "));
  for (const walk of Object.values(out.walks ?? {})) {
    for (const key of WALK_EXTRA) delete walk[key];
    if (!meta) for (const key of WALK_META) delete walk[key];
    for (const slot of Object.values(walk.slots ?? {})) for (const key of SLOT_EXTRA) delete slot[key];
    for (const step of Object.values(walk.steps ?? {})) {
      for (const key of STEP_EXTRA) delete step[key];
      for (const hit of Object.values(step.hits ?? {})) delete hit.sub;
    }
  }
  return JSON.stringify(out);
}

const oldFiles = fs.readdirSync(oldDir).filter((f) => /\.json$/.test(f) && !["bench.json", "compare.json", "reference-diffs.json"].includes(f));
let equal = 0, metaEqual = 0;
const differ = [], missing = [], metaDiffer = [];
for (const file of oldFiles) {
  const target = path.join(newDir, file);
  if (!fs.existsSync(target)) { missing.push(file); continue; }
  const oldR = JSON.parse(fs.readFileSync(path.join(oldDir, file), "utf8")), newR = JSON.parse(fs.readFileSync(target, "utf8"));
  const a = strip(oldR), b = strip(newR);
  if (strip(oldR, true) === strip(newR, true)) metaEqual++;
  else metaDiffer.push(file);
  if (a === b) { equal++; continue; }
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  differ.push({ file, at: i, old: a.slice(Math.max(0, i - 120), i + 120), new: b.slice(Math.max(0, i - 120), i + 120) });
}
console.log(`${equal}/${oldFiles.length} byte-equal after the moves (status-eot fields, ms and the walk bookkeeping stripped); differ: ${differ.length}; missing: ${missing.length}`);
console.log(`walk bookkeeping (runs, classes, decisions) also equal: ${metaEqual}/${oldFiles.length - missing.length}${metaDiffer.length ? `; differs in ${metaDiffer.map((x) => x.replace(/.json$/, "")).join(" ")}` : ""}`);
for (const d of differ) console.log(`DIFFER ${d.file} at ${d.at}\n  old …${d.old}…\n  new …${d.new}…`);
if (missing.length) console.log(`MISSING ${missing.length}: ${missing.slice(0, 20).join(" ")}${missing.length > 20 ? " …" : ""}`);
process.exitCode = differ.length || missing.length ? 1 : 0;
