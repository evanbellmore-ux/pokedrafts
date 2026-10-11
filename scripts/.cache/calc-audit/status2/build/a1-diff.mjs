// Track A1: classify the stored cases whose app result differs between two app-results folders: only A1's Minimize
// assumption fact added, a case using one of A1's thirty moves, or another track's (no A1 move or fact).
//   node scripts/.cache/calc-audit/status2/build/a1-diff.mjs <base dir> <new dir>
import fs from "node:fs";
import path from "node:path";
const [a, b] = process.argv.slice(2);
const A1 = new Set("acupressure psychup powerswap guardswap heartswap speedswap powersplit guardsplit powertrick powershift topsyturvy stockpile swallow tidyup noretreat autotomize minimize geomancy gearup magneticflux flowershield rototiller skillswap roleplay entrainment simplebeam worryseed gastroacid doodle transform spitup".split(" "));
const MIN = /^Assumes .* has not used Minimize\.$/;
const strip = (o) => { delete o.ms; return o; };
const out = { minimizeOnly: [], a1Move: [], other: [] };
for (const f of fs.readdirSync(a).filter((x) => x.endsWith(".json"))) {
  const pb = path.join(b, f);
  if (!fs.existsSync(pb)) continue;
  const x = strip(JSON.parse(fs.readFileSync(path.join(a, f), "utf8"))), y = strip(JSON.parse(fs.readFileSync(pb, "utf8")));
  if (JSON.stringify(x) === JSON.stringify(y)) continue;
  const moves = Object.values(y.input?.pokemon ?? {}).map((p) => p?.action?.moveId);
  const usesA1 = JSON.stringify(y.result ?? {}).match(/"moveId":"([a-z0-9]+)"/g)?.some((m) => A1.has(m.slice(10, -1)));
  // Remove the Minimize facts from y and compare again.
  const z = JSON.parse(JSON.stringify(y));
  if (z.result?.facts) z.result.facts = z.result.facts.filter((t) => !MIN.test(t));
  if (JSON.stringify(x) === JSON.stringify(z)) out.minimizeOnly.push(f);
  else if (usesA1) out.a1Move.push(f);
  else out.other.push(f);
}
console.log(`minimize fact only: ${out.minimizeOnly.length}\nA1 moves: ${out.a1Move.length} ${out.a1Move.join(",")}\nother: ${out.other.length}`);
