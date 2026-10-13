// FINAL2 (status2 final gate): a copy of int2/census/bench-report.ts reading build/final2/census (census-sim.final.json); nothing else changed.
// Integration 2: census-bench.json's report: per run (plain, bench, hazards) and game, the counts, the reasons by family
// ({Name} folded with the runtimes' species names), the transitions plain → bench, throws, and position words.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/final2/census/bench-report.ts [census-bench.json] [census-sim.final.json]
import fs from "node:fs";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";

type Res = { s: string; r?: string; e?: string; ms: number; replaced?: number };
type Row = { actions: string; bench: string; plain: Res; bench1: Res; hazards: Res };
const DIR = "scripts/.cache/calc-audit/status2/build/final2/census";
(async () => {
  const data = JSON.parse(fs.readFileSync(process.argv[2] ?? `${DIR}/census-bench.json`, "utf8")) as { champions: Row[]; sv: Row[]; ms: number; seed: number; benchSeed: number };
  const sim = JSON.parse(fs.readFileSync(process.argv[3] ?? `${DIR}/census-sim.final.json`, "utf8"));
  const names = new Set<string>();
  for (const game of ["champions", "scarlet_violet"] as const) for (const s of (await loadBattleRuntime(game)).speciesById.values()) names.add((s as unknown as { name: string }).name);
  const sorted = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const nameRe = new RegExp(`(?:${sorted.join("|")})(?: \\((?:yours|opponent's|\\d)(?:, \\d)?\\)| \\d)?(?=['’ .,:;)]|$)`, "g");
  const family = (r: string) => r.replace(nameRe, "{Name}");
  const POSITION = /\b(left(?! to switch in)|right|slot|position)s?\b/i;
  console.log(`census-bench: seed ${data.seed}, bench seed ${data.benchSeed}, ${data.ms} ms`);
  for (const [label, rows, simKey] of [["Champions", data.champions, "champions"], ["SV", data.sv, "scarletVioletRandomBattle"]] as const) {
    const s = sim[simKey];
    for (const run of ["plain", "bench1", "hazards"] as const) {
      const list = rows.map((r) => r[run]);
      const ready = list.filter((r) => r.s === "ready");
      const ne = list.filter((r) => r.s === "not-estimated"), issues = list.filter((r) => r.s === "issues"), throws = list.filter((r) => r.s === "throw");
      const endNE = ready.filter((r) => r.e !== "ready");
      const ms = list.map((r) => r.ms).sort((a, b) => a - b);
      const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
      console.log(`\n== ${label} ${run === "bench1" ? "bench" : run}: ${list.length} turns, ready ${ready.length}, not estimated ${ne.length} (${(ne.length / list.length * 100).toFixed(2)} %), end not estimated ${endNE.length}, issues ${issues.length}, throws ${throws.length}; turns with a switch ${ready.filter((r) => (r.replaced ?? 0) > 0).length}; ms p50 ${q(0.5)} p95 ${q(0.95)} max ${ms[ms.length - 1]}`);
      if (run === "plain") console.log(`   census-sim.final.json: ready ${s.ready}, not estimated ${s.notEstimated}, end not estimated ${s.endNotEstimated}, issues ${s.issues} → ${s.ready === ready.length && s.notEstimated === ne.length && s.endNotEstimated === endNE.length && s.issues === issues.length ? "equal" : "DIFFERENT"}`);
      const fold = (items: { reason: string }[]) => { const m = new Map<string, number>(); for (const i of items) m.set(family(i.reason), (m.get(family(i.reason)) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
      console.log(`   turn reasons by family:`);
      for (const [r, n] of fold(ne.map((x) => ({ reason: x.r! })))) console.log(`     ${String(n).padStart(5)}  ${r}`);
      console.log(`   end reasons by family:`);
      for (const [r, n] of fold(endNE.map((x) => ({ reason: x.e! })))) console.log(`     ${String(n).padStart(5)}  ${r}`);
      if (issues.length) { console.log(`   issues by text:`); for (const [r, n] of fold(issues.map((x) => ({ reason: x.r ?? "" })))) console.log(`     ${String(n).padStart(5)}  ${r.slice(0, 160)}`); }
      for (const t of throws.slice(0, 5)) console.log(`   THROW ${t.r}`);
      const pos = list.flatMap((r) => [r.r, r.e].filter((x): x is string => !!x && r.s !== "issues" && POSITION.test(x)));
      console.log(`   reasons naming a position: ${pos.length ? [...new Set(pos)].join(" | ") : "none"}`);
    }
    // Transitions plain → bench
    const trans = new Map<string, number>();
    const examples = new Map<string, string[]>();
    for (const row of rows) {
      const a = row.plain.s === "ready" ? (row.plain.e === "ready" ? "ready" : `end: ${family(row.plain.e!)}`) : `${row.plain.s}: ${family(row.plain.r ?? "")}`;
      const b = row.bench1.s === "ready" ? (row.bench1.e === "ready" ? "ready" : `end: ${family(row.bench1.e!)}`) : `${row.bench1.s}: ${family(row.bench1.r ?? "")}`;
      if (a === b) continue;
      const key = `${a}  =>  ${b}`;
      trans.set(key, (trans.get(key) ?? 0) + 1);
      const ex = examples.get(key) ?? []; if (ex.length < 2) ex.push(`${row.actions} || ${row.bench}`); examples.set(key, ex);
    }
    console.log(`\n== ${label}: plain → bench transitions (${[...trans.values()].reduce((x, y) => x + y, 0)} turns)`);
    for (const [k, n] of [...trans].sort((x, y) => y[1] - x[1])) { console.log(`   ${String(n).padStart(5)}  ${k}`); if (!/=>  ready$/.test(k)) for (const ex of examples.get(k)!) console.log(`            e.g. ${ex}`); }
  }
})();
