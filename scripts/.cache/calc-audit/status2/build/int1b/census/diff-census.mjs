// Integration 1b: the census sample's not-estimated reasons by family, main (design/census-sim.out.json, put back after each
// run), integration 1a (build/int1a/census/census-sim.after.json) and this tree (census-sim.after.json).
//   cd scripts/.cache/calc-audit/status2/build/int1b/census && node diff-census.mjs
import fs from "node:fs";
const load = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const main = load("census-sim.before.json"), int1a = load("../../int1a/census/census-sim.after.json"), now = load("census-sim.after.json");
// One family per reason: Pokémon names (with their side) replaced so a reason counts once.
const NAME = "[A-Z][A-Za-z.' -]*?(?: \\((?:yours|opponent's)(?:, \\d)?\\))?";
const fam = (r) => r
  .replace(new RegExp(`^${NAME} switches out: the replacement is not known\\.$`), "{Name} switches out: the replacement is not known.")
  .replace(new RegExp(`^(\\S+(?: \\S+)?) needs ${NAME}'s move from the last turn\\.$`), "$1 needs {Name}'s move from the last turn.")
  .replace(new RegExp(`^(\\S+(?: \\S+)?) needs ${NAME}'s moves\\.$`), "$1 needs {Name}'s moves.")
  .replace(new RegExp(`^(\\S+(?: \\S+)?) needs the moves of ${NAME}'s party\\.$`), "$1 needs the moves of {Name}'s party.")
  .replace(new RegExp(`^(\\S+(?: \\S+)?) needs ${NAME}'s item from an earlier turn\\.$`), "$1 needs {Name}'s item from an earlier turn.")
  .replace(new RegExp(`^(\\S+(?: \\S+)?) needs ${NAME}'s gender\\.$`), "$1 needs {Name}'s gender.")
  .replace(new RegExp(`^(\\S+(?: \\S+)?) needs the target of ${NAME}'s last move\\.$`), "$1 needs the target of {Name}'s last move.")
  .replace(new RegExp(`^Encore changes ${NAME}'s move: not modelled\\.$`), "Encore changes {Name}'s move: not modelled.")
  .replace(new RegExp(`^Cud Chew needs ${NAME}'s Berry from the last turn\\.$`), "Cud Chew needs {Name}'s Berry from the last turn.")
  .replace(new RegExp(`^(.*?) needs whether ${NAME} or ${NAME} came in first\\.$`), "$1 needs whether {A} or {B} came in first.")
  .replace(new RegExp(`^(\\S+(?: \\S+)?) changes ${NAME}'s type: later moves are not modelled\\.$`), "$1 changes {Name}'s type: later moves are not modelled.")
  .replace(new RegExp(`^(.*?)'s effect on ${NAME} from more than one target is not modelled\\.$`), "$1's effect on {Name} from more than one target is not modelled.")
  .replace(new RegExp(`^${NAME}'s type after (.*) is not known\\.$`), "{Name}'s type after $1 is not known.");
const out = [];
for (const [label, key] of [["Champions", "champions"], ["SV", "scarletVioletRandomBattle"]]) {
  const M = main[key], A = int1a[key], N = now[key];
  const pct = (s) => `${(s.notEstimated / s.turns * 100).toFixed(2)} %`;
  out.push(`\n== ${label} (${N.turns} turns): ready main ${M.ready} / 1a ${A.ready} / 1b ${N.ready}; not estimated ${M.notEstimated} (${pct(M)}) / ${A.notEstimated} (${pct(A)}) / ${N.notEstimated} (${pct(N)}); end not estimated ${M.endNotEstimated} / ${A.endNotEstimated} / ${N.endNotEstimated}`);
  for (const part of ["turnReasons", "endReasons"]) {
    const m = new Map();
    for (const [side, s] of [["m", M], ["a", A], ["n", N]]) for (const r of s[part]) { const k = fam(r.reason); const e = m.get(k) ?? { m: 0, a: 0, n: 0, ex: r.reason }; e[side] += r.n; m.set(k, e); }
    const rows = [...m].sort((x, y) => y[1].n - x[1].n || y[1].a - x[1].a || y[1].m - x[1].m);
    out.push(`  ${part === "turnReasons" ? "turn" : "end"} reasons (main -> 1a -> 1b):`);
    for (const [k, e] of rows) out.push(`    ${String(e.m).padStart(4)} -> ${String(e.a).padStart(4)} -> ${String(e.n).padEnd(4)} ${k}${k !== e.ex ? `   e.g. ${e.ex}` : ""}`);
  }
}
console.log(out.join("\n"));
