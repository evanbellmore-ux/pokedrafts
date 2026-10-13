// Integration 2: row-by-row diff of two golden-1v1.full.json.gz dumps (main's and this tree's).
// node golden-rowdiff.mjs <main full.json.gz> <now full.json.gz> [out.json]
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
const [a, b, out] = process.argv.slice(2);
const read = (f) => JSON.parse(gunzipSync(fs.readFileSync(f)).toString("utf8"));
const A = read(a), B = read(b);
const rows = [], other = [];
let cases = 0, rowsTotal = 0;
for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
  cases++;
  if (!(id in A) || !(id in B)) { other.push(`${id}: only in ${id in A ? "main" : "now"}`); continue; }
  if (A[id] === B[id]) { rowsTotal += JSON.parse(A[id]).results.length; continue; }
  const x = JSON.parse(A[id]), y = JSON.parse(B[id]);
  const rx = { ...x, results: undefined }, ry = { ...y, results: undefined };
  if (JSON.stringify(rx) !== JSON.stringify(ry)) other.push(`${id}: matchup fields differ`);
  if (x.results.length !== y.results.length) other.push(`${id}: ${x.results.length} -> ${y.results.length} rows`);
  for (let i = 0; i < Math.max(x.results.length, y.results.length); i++) {
    rowsTotal++;
    const p = JSON.stringify(x.results[i]), q = JSON.stringify(y.results[i]);
    if (p === q) continue;
    const moveId = x.results[i]?.moveId ?? y.results[i]?.moveId;
    rows.push({ id, row: i, moveId });
  }
}
const fling = rows.filter((r) => r.moveId === "fling");
const notFling = rows.filter((r) => r.moveId !== "fling");
console.log(`${cases} cases, ${rowsTotal} rows compared: ${rows.length} rows differ (${fling.length} Fling rows, ${notFling.length} other rows); ${other.length} other differences`);
for (const r of notFling) console.log(`  NOT FLING: ${r.id} row ${r.row} (${r.moveId})`);
for (const o of other) console.log(`  OTHER: ${o}`);
if (out) fs.writeFileSync(out, JSON.stringify({ rows, other }, null, 1));
if (notFling.length || other.length) process.exitCode = 1;
