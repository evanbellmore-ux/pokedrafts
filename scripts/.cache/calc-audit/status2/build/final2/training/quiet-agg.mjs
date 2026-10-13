// FINAL2 quiet paired check, aggregated over rounds: each tree plays the same battles in every round (hashes checked), so
// each AI turn decision is the same decision in every round; per decision take the median (and the minimum) of its times
// over the rounds, then p50 / p95 / max with eval-ai.ts's quantile. This damps the machine's drift between rounds.
// Also: battles whose choice log is the same in main and now (the same game in both trees), decision by decision.
//   node quiet-agg.mjs <quiet dir> <run,run,...> <rounds e.g. 1,2,3>
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [dir, runsArg, roundsArg] = process.argv.slice(2);
const runs = runsArg.split(","), rounds = roundsArg.split(",").map(Number);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; };
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const load = (tree, round, run) => Array.from({ length: 8 }, (_, k) => JSON.parse(readFileSync(join(dir, `r${round}-${tree}`, `${run}.shard-${k}.json`), "utf8"))).flat().sort((a, b) => a.index - b.index);
const turnTimes = (battle) => battle.decisions.filter((d) => d.side === "p2" && d.kind === "turn").map((d) => d.ms);
const f0 = (x) => x.toFixed(0), f3 = (x) => x.toFixed(3);
const out = [], worst = { main: { median: [], min: [] }, now: { median: [], min: [] } };
for (const run of runs) {
  out.push(`== ${run}`);
  const per = {};
  for (const tree of ["main", "now"]) {
    const sets = rounds.map((round) => load(tree, round, run));
    for (const s of sets) if (s.some((b, i) => b.hash !== sets[0][i].hash)) throw new Error(`${tree} ${run}: battles differ between rounds`);
    const median = [], min = [];
    sets[0].forEach((battle, i) => {
      const each = sets.map((s) => turnTimes(s[i]));
      if (each.some((t) => t.length !== each[0].length)) throw new Error("decision counts differ");
      each[0].forEach((_, j) => { const xs = each.map((t) => t[j]); median.push(med(xs)); min.push(Math.min(...xs)); });
    });
    per[tree] = { sets, median, min };
    for (const kind of ["median", "min"]) {
      const xs = kind === "median" ? median : min;
      const st = { p50: q(xs, 0.5), p95: q(xs, 0.95), max: Math.max(...xs) };
      worst[tree][kind].push(st);
      out.push(`  ${tree} per-decision ${kind} over r${rounds.join(",r")}: n ${xs.length} p50 ${f0(st.p50)} p95 ${f0(st.p95)} max ${f0(st.max)} ms`);
    }
  }
  for (const kind of ["median", "min"]) {
    const m = worst.main[kind].at(-1), n = worst.now[kind].at(-1);
    out.push(`  now/main (${kind}): p50 ×${f3(n.p50 / m.p50)} p95 ×${f3(n.p95 / m.p95)} max ×${f3(n.max / m.max)}`);
  }
  // The same game in both trees: battles whose choice-log hash is equal in main and now.
  const mainB = per.main.sets[0], nowB = per.now.sets[0];
  const same = mainB.flatMap((b, i) => b.hash === nowB[i].hash ? [i] : []);
  if (same.length) {
    const ratios = [], mt = [], nt = [];
    for (const i of same) {
      const mt_i = rounds.map((_, r) => turnTimes(per.main.sets[r][i])), nt_i = rounds.map((_, r) => turnTimes(per.now.sets[r][i]));
      if (mt_i[0].length !== nt_i[0].length) continue;
      mt_i[0].forEach((_, j) => { const a = med(mt_i.map((t) => t[j])), b = med(nt_i.map((t) => t[j])); ratios.push(b / a); mt.push(a); nt.push(b); });
    }
    out.push(`  the same game in both trees: ${same.length}/${mainB.length} battles, ${ratios.length} decisions; per-decision now/main (medians over rounds) median ×${f3(med(ratios))} p90 ×${f3(q(ratios, 0.9))}; on those decisions main p50 ${f0(q(mt, 0.5))} p95 ${f0(q(mt, 0.95))} | now p50 ${f0(q(nt, 0.5))} p95 ${f0(q(nt, 0.95))}`);
  }
}
const REF = { p50: 274, p95: 577, max: 1181 };
for (const kind of ["median", "min"]) {
  const m = { p50: Math.max(...worst.main[kind].map((s) => s.p50)), p95: Math.max(...worst.main[kind].map((s) => s.p95)), max: Math.max(...worst.main[kind].map((s) => s.max)) };
  const n = { p50: Math.max(...worst.now[kind].map((s) => s.p50)), p95: Math.max(...worst.now[kind].map((s) => s.p95)), max: Math.max(...worst.now[kind].map((s) => s.max)) };
  const r = { p50: n.p50 / m.p50, p95: n.p95 / m.p95, max: n.max / m.max };
  out.push(`== worst run, per-decision ${kind} over rounds: main p50 ${f0(m.p50)} p95 ${f0(m.p95)} max ${f0(m.max)} | now p50 ${f0(n.p50)} p95 ${f0(n.p95)} max ${f0(n.max)} | now/main p50 ×${f3(r.p50)} p95 ×${f3(r.p95)} max ×${f3(r.max)} | scaled (main ${REF.p50} / ${REF.p95} / ${REF.max}): p50 ${f0(REF.p50 * r.p50)} p95 ${f0(REF.p95 * r.p95)} max ${f0(REF.max * r.max)}`);
}
process.stdout.write(`${out.join("\n")}\n`);
