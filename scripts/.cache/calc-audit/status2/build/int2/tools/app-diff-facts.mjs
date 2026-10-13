// Integration 2: which app results changed between two app-results folders, and how (changed-cases.ts diff counts the wave 2
// cases as new and does not print them): per id the changed paths, grouped by what changed (a removed/added fact text).
//   node scripts/.cache/calc-audit/status2/build/int2/tools/app-diff-facts.mjs <before dir> <after dir>
import fs from "node:fs";
import path from "node:path";
const [a, b] = process.argv.slice(2).map((d) => path.resolve(d));
const ids = new Set([...fs.readdirSync(a), ...fs.readdirSync(b)].filter((f) => f.endsWith(".json") && f !== "compare.json"));
const diffs = [];
function walk(x, y, p, out) {
  if (JSON.stringify(x) === JSON.stringify(y)) return;
  if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x) && !Array.isArray(y)) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${p}.${k}`, out);
    return;
  }
  if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.some((e) => e && typeof e === "object" && !e.text)) {
    x.forEach((e, i) => walk(e, y[i], `${p}[${i}]`, out));
    return;
  }
  if (Array.isArray(x) && Array.isArray(y) && x.every((e) => typeof e !== "object" || e?.text) && y.every((e) => typeof e !== "object" || e?.text)) {
    const t = (e) => typeof e === "object" ? `${e.text}@${e.chance}` : String(e);
    const xs = x.map(t), ys = y.map(t);
    for (const r of xs.filter((e) => !ys.includes(e))) out.push(`${p} − ${r}`);
    for (const r of ys.filter((e) => !xs.includes(e))) out.push(`${p} + ${r}`);
    if (!xs.filter((e) => !ys.includes(e)).length && !ys.filter((e) => !xs.includes(e)).length) out.push(`${p} reordered`);
    return;
  }
  out.push(`${p}: ${JSON.stringify(x)?.slice(0, 80)} → ${JSON.stringify(y)?.slice(0, 80)}`);
}
const kinds = new Map();
let changed = 0, added = 0;
for (const f of [...ids].sort()) {
  const pa = path.join(a, f), pb = path.join(b, f);
  if (!fs.existsSync(pa)) { added++; console.log(`${f.replace(/\.json$/, "")}: new`); continue; }
  if (!fs.existsSync(pb)) { console.log(`${f.replace(/\.json$/, "")}: MISSING after`); continue; }
  const out = [];
  walk(JSON.parse(fs.readFileSync(pa, "utf8")), JSON.parse(fs.readFileSync(pb, "utf8")), "", out);
  const relevant = out.filter((l) => !/\.ms[:.]|^\.ms/.test(l));
  if (!relevant.length) continue;
  changed++;
  console.log(`${f.replace(/\.json$/, "")}: ${relevant.join(" | ")}`);
  for (const l of relevant) { const k = l.replace(/^[^ ]+ /, "").replace(/@[0-9.e-]+$/, "").replace(/\b(?:[A-Z][a-z]+(?:-[A-Za-z]+)*)(?: \((?:yours|opponent's)(?:, \d)?\)| \(\d\))?/g, "{N}"); kinds.set(k, (kinds.get(k) ?? 0) + 1); }
}
console.log(`\n${ids.size} files: ${changed} changed, ${added} new`);
for (const [k, n] of [...kinds].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
