// FINAL2 quiet paired check: per run, tree and round, the AI's (p2) turn decision time p50 / p95 / max with eval-ai.ts's own
// quantile (lib/report.ts: sorted[ceil(p * n) - 1]), the now / main ratios in each round, the worst run per round (as eval's
// "Turn decision time (Node, worst run)" row takes it), and the battles' choice-log hashes against the reference runs.
//   node quiet-stats.mjs <quiet dir> <run,run,...> [rounds]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const [dir, runsArg, roundsArg] = process.argv.slice(2);
const runs = runsArg.split(",");
const SP = "/tmp/claude-0/-home-user-pokedrafts/1fff6e15-9f52-5b3b-bbb9-2b51ed040eae/scratchpad";
const REF = {
  now: (run) => `/home/user/pokedrafts/scripts/.cache/training/eval/final2-s1seeds/${run}.json`,
  main: (run) => [1, 2].map((r) => `${SP}/maintree/scripts/.cache/training/eval/int2-paired-main-r${r}/${run}.json`).find(existsSync) ?? "",
};
const q = (xs, p) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; };
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f0 = (x) => Number.isFinite(x) ? x.toFixed(0) : String(x);
const f3 = (x) => x.toFixed(3);
const rounds = roundsArg ? roundsArg.split(",").map(Number) : [...new Set(readdirSync(dir).flatMap((n) => /^r(\d+)-(main|now)$/.test(n) ? [Number(n.match(/^r(\d+)/)[1])] : []))].sort((a, b) => a - b);
const load = (tree, round, run) => {
  const battles = [];
  for (let k = 0; k < 8; k++) {
    const file = join(dir, `r${round}-${tree}`, `${run}.shard-${k}.json`);
    if (!existsSync(file)) return null;
    battles.push(...JSON.parse(readFileSync(file, "utf8")));
  }
  return battles.sort((a, b) => a.index - b.index);
};
const stats = (battles) => {
  const ai = battles.flatMap((b) => b.decisions.filter((d) => d.side === "p2"));
  const turns = ai.filter((d) => d.kind === "turn").map((d) => d.ms);
  return {
    battles: battles.length, n: turns.length, p50: q(turns, 0.5), p95: q(turns, 0.95), max: Math.max(...turns),
    preview: q(ai.filter((d) => d.kind === "preview").map((d) => d.ms), 0.95), switch: q(ai.filter((d) => d.kind === "switch").map((d) => d.ms), 0.95),
    belief: q(ai.filter((d) => d.kind === "turn" && d.stats).map((d) => d.stats.beliefMs), 0.95),
    hashes: battles.map((b) => b.hash),
  };
};
const table = {};
for (const run of runs) for (const tree of ["main", "now"]) for (const round of rounds) {
  const battles = load(tree, round, run);
  if (battles) (table[run] ??= {})[`${tree}-${round}`] = stats(battles);
}
const lines = [];
for (const run of runs) {
  lines.push(`== ${run}`);
  for (const tree of ["main", "now"]) {
    const ref = REF[tree](run);
    const refHashes = ref && existsSync(ref) ? JSON.parse(readFileSync(ref, "utf8")).map((b) => b.hash) : null;
    for (const round of rounds) {
      const s = table[run]?.[`${tree}-${round}`];
      if (!s) { lines.push(`  ${tree} r${round}: missing`); continue; }
      const same = refHashes ? `${s.hashes.filter((h, i) => h === refHashes[i]).length}/${s.hashes.length} hashes = ${ref.split("/").slice(-2).join("/")}` : "no reference";
      const first = table[run][`${tree}-${rounds[0]}`];
      const rr = `${s.hashes.filter((h, i) => h === first.hashes[i]).length}/${s.hashes.length} = r${rounds[0]}`;
      lines.push(`  ${tree} r${round}: battles ${s.battles} decisions ${s.n} | p50 ${f0(s.p50)} p95 ${f0(s.p95)} max ${f0(s.max)} ms | preview p95 ${f0(s.preview)} switch p95 ${f0(s.switch)} belief p95 ${s.belief.toFixed(2)} | ${same}; ${rr}`);
    }
  }
  const ratios = rounds.flatMap((round) => { const m = table[run]?.[`main-${round}`], n = table[run]?.[`now-${round}`]; return m && n ? [{ round, p50: n.p50 / m.p50, p95: n.p95 / m.p95, max: n.max / m.max }] : []; });
  for (const r of ratios) lines.push(`  now/main r${r.round}: p50 ×${f3(r.p50)} p95 ×${f3(r.p95)} max ×${f3(r.max)}`);
  if (ratios.length) lines.push(`  now/main median: p50 ×${f3(med(ratios.map((r) => r.p50)))} p95 ×${f3(med(ratios.map((r) => r.p95)))} max ×${f3(med(ratios.map((r) => r.max)))}`);
}
lines.push("== worst run per round (max over the runs above of each statistic, as eval's time row)");
const worst = {};
for (const round of rounds) for (const tree of ["main", "now"]) {
  const all = runs.map((run) => table[run]?.[`${tree}-${round}`]).filter(Boolean);
  if (all.length !== runs.length) continue;
  worst[`${tree}-${round}`] = { p50: Math.max(...all.map((s) => s.p50)), p95: Math.max(...all.map((s) => s.p95)), max: Math.max(...all.map((s) => s.max)) };
}
const REF_MAIN = { p50: 274, p95: 577, max: 1181 }; // main on 1b's reference machine (INTEGRATION-1A/1B), worst run
const scaled = [];
for (const round of rounds) {
  const m = worst[`main-${round}`], n = worst[`now-${round}`];
  if (!m || !n) continue;
  const r = { p50: n.p50 / m.p50, p95: n.p95 / m.p95, max: n.max / m.max };
  scaled.push(r);
  lines.push(`  r${round}: main p50 ${f0(m.p50)} p95 ${f0(m.p95)} max ${f0(m.max)} | now p50 ${f0(n.p50)} p95 ${f0(n.p95)} max ${f0(n.max)} | now/main p50 ×${f3(r.p50)} p95 ×${f3(r.p95)} max ×${f3(r.max)} | scaled to the reference machine (main ${REF_MAIN.p50} / ${REF_MAIN.p95} / ${REF_MAIN.max}): p50 ${f0(REF_MAIN.p50 * r.p50)} p95 ${f0(REF_MAIN.p95 * r.p95)} max ${f0(REF_MAIN.max * r.max)}`);
}
if (scaled.length) {
  const m = (k) => med(scaled.map((r) => r[k]));
  lines.push(`  median over rounds: now/main p50 ×${f3(m("p50"))} p95 ×${f3(m("p95"))} max ×${f3(m("max"))} → scaled p50 ${f0(REF_MAIN.p50 * m("p50"))} (gate 400) p95 ${f0(REF_MAIN.p95 * m("p95"))} (SPEC2 634, gate 800) max ${f0(REF_MAIN.max * m("max"))} (gate 2000)`);
  lines.push(`  range over rounds: p95 ×${f3(Math.min(...scaled.map((r) => r.p95)))}–×${f3(Math.max(...scaled.map((r) => r.p95)))} → ${f0(REF_MAIN.p95 * Math.min(...scaled.map((r) => r.p95)))}–${f0(REF_MAIN.p95 * Math.max(...scaled.map((r) => r.p95)))} ms`);
}
process.stdout.write(`${lines.join("\n")}\n`);
