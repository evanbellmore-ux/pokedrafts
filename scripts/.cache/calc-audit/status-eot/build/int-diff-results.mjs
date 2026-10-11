// Integration: every oracle result rerun now (build/int-results) against the stored one (verify/results), whole files with
// each walk's ms stripped. Usage: node scripts/.cache/calc-audit/status-eot/build/int-diff-results.mjs [newDir] [oldDir]
import fs from "node:fs";
import path from "node:path";

const [newDir = "scripts/.cache/calc-audit/status-eot/build/int-results", oldDir = "scripts/.cache/calc-audit/2v2/verify/results"] = process.argv.slice(2);
const strip = (r) => {
  const out = structuredClone(r);
  for (const walk of Object.values(out.walks ?? {})) { delete walk.ms; if (walk.afterTurn) delete walk.afterTurn.ms; }
  out.warnings = (out.warnings ?? []).filter((w) => !w.startsWith("validate "));
  return JSON.stringify(out);
};
const files = fs.readdirSync(newDir).filter((f) => f.endsWith(".json"));
let equal = 0;
const differ = [], fresh = [];
for (const file of files) {
  const old = path.join(oldDir, file);
  if (!fs.existsSync(old)) { fresh.push(file); continue; }
  const a = strip(JSON.parse(fs.readFileSync(old, "utf8"))), b = strip(JSON.parse(fs.readFileSync(path.join(newDir, file), "utf8")));
  if (a === b) { equal++; continue; }
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  differ.push({ file, at: i, old: a.slice(Math.max(0, i - 100), i + 100), new: b.slice(Math.max(0, i - 100), i + 100) });
}
console.log(`${equal}/${files.length - fresh.length} rerun results equal to the stored ones (ms stripped); differ: ${differ.length}; new: ${fresh.length}${fresh.length ? ` (${fresh.join(" ")})` : ""}`);
for (const d of differ) console.log(`DIFFER ${d.file} at ${d.at}\n  stored …${d.old}…\n  rerun  …${d.new}…`);
