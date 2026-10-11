// Track A: the stored 2v2 app results (before status-eot) against a fresh run (step0-run-app.ts <dir>), in their
// after-the-moves fields: the result's status and reason, start, startRows, steps and hp, with the status-eot additions
// (hp[*].conditions, hp[*].losses, endOfTurn, swapped) removed and the turn facts compared without the end-of-turn ones.
// Run from the repo root: node scripts/.cache/calc-audit/status-eot/build/track-a-regress.mjs <new dir> [<old dir>]
import fs from "node:fs";
import path from "node:path";

const [newDir, oldDir = "scripts/.cache/calc-audit/2v2/verify/before-status-eot/app-results"] = process.argv.slice(2);
const END_FACTS = /^(End-of-turn effects are not applied\.|Assumes the .* does not end this turn\.|Assumes this is .*'s first turn of bad poison damage\.|Assumes Dynamax started this turn\.|Moody raises one stat and lowers another\.)$/;
function strip(o) {
  const r = structuredClone(o.result ?? {});
  delete r.endOfTurn; delete r.swapped;
  for (const hp of Object.values(r.hp ?? {})) if (hp) { delete hp.conditions; delete hp.losses; }
  if (r.facts) r.facts = r.facts.filter((f) => !END_FACTS.test(f));
  return JSON.stringify({ result: r, error: o.error ?? null }, null, 1);
}
const files = fs.readdirSync(oldDir).filter((f) => f.endsWith(".json")).sort();
let same = 0;
const differ = [];
for (const f of files) {
  const pb = path.join(newDir, f);
  if (!fs.existsSync(pb)) continue;
  const a = strip(JSON.parse(fs.readFileSync(path.join(oldDir, f), "utf8")));
  const b = strip(JSON.parse(fs.readFileSync(pb, "utf8")));
  if (a === b) { same++; continue; }
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  differ.push({ f, old: a.slice(Math.max(0, i - 200), i + 160).replace(/\s+/g, " "), new: b.slice(Math.max(0, i - 200), i + 160).replace(/\s+/g, " ") });
}
console.log(`${same}/${files.length} equal after the moves; differ ${differ.length}`);
for (const d of differ) console.log(`DIFFER ${d.f}\n  old …${d.old}…\n  new …${d.new}…`);
