// Track V1: the stored cases' expected reasons (notEstimated / endNotEstimated) with counts, and the app's current
// not-estimated reasons over the stored app-results, for changed-cases.ts's classification.
import fs from "node:fs";
import path from "node:path";
import { CASES } from "../cases";
import { WAVE1A_CASES } from "../cases-wave1a";
const wave = new Set(WAVE1A_CASES.map((c) => c.id));
const count: Record<string, string[]> = {};
for (const c of CASES) {
  if (wave.has(c.id)) continue;
  for (const [kind, text] of [["ne", c.notEstimated], ["end", c.endNotEstimated]] as const) {
    if (!text) continue;
    const key = `${kind}: ${text}`;
    (count[key] ??= []).push(c.id);
  }
}
for (const [k, ids] of Object.entries(count).sort()) console.log(`${String(ids.length).padStart(3)} ${k}  [${ids.slice(0, 6).join(" ")}${ids.length > 6 ? " …" : ""}]`);
// The app's own reasons in the stored app-results for cases expected ready (none should be not-estimated).
const dir = path.resolve("scripts/.cache/calc-audit/2v2/verify/app-results");
const appEnd: Record<string, string[]> = {};
for (const c of CASES) {
  if (wave.has(c.id)) continue;
  const f = path.join(dir, `${c.id}.json`);
  if (!fs.existsSync(f)) continue;
  const r = JSON.parse(fs.readFileSync(f, "utf8")).result;
  if (r?.status === "ready" && r.endOfTurn?.status === "not-estimated" && !c.endNotEstimated) (appEnd[r.endOfTurn.reason] ??= []).push(c.id);
}
console.log("\nstored ready cases whose stored app end of turn is not estimated (no endNotEstimated in the case):");
for (const [k, ids] of Object.entries(appEnd)) console.log(`${String(ids.length).padStart(3)} ${k}  [${ids.slice(0, 8).join(" ")}]`);
