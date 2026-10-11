// Integration 1a: the census sample's not-estimated reasons, before (design/census-sim.out.json as it stood) and after (this tree).
import fs from "node:fs";
const b = JSON.parse(fs.readFileSync("census-sim.before.json", "utf8")), a = JSON.parse(fs.readFileSync("census-sim.after.json", "utf8"));
// One family per reason: Pokémon names replaced so "Protean changes X's type" counts once.
const fam = (r) => r.replace(/^.*? switches out: the replacement is not known\.$/, "{Name} switches out: the replacement is not known.")
  .replace(/^Encore needs .*'s move from the last turn\.$/, "Encore needs {Name}'s move from the last turn.")
  .replace(/^Protean changes .*'s type: later moves are not modelled\.$/, "Protean changes {Name}'s type: later moves are not modelled.")
  .replace(/^Libero changes .*'s type: later moves are not modelled\.$/, "Libero changes {Name}'s type: later moves are not modelled.")
  .replace(/^(\S+(?: \S+)?) changes .*'s type: later moves are not modelled\.$/, "$1 changes {Name}'s type: later moves are not modelled.")
  .replace(/^Imprison needs .*'s moves\.$/, "Imprison needs {Name}'s moves.")
  .replace(/^(.*?)'s effect on .* from more than one target is not modelled\.$/, "$1's effect on {Name} from more than one target is not modelled.");
for (const [label, key] of [["Champions", "champions"], ["SV", "scarletVioletRandomBattle"]]) {
  const B = b[key], A = a[key];
  console.log(`\n== ${label}: before ready ${B.ready}, not estimated ${B.notEstimated} (${(B.notEstimated / B.turns * 100).toFixed(2)} %), end not estimated ${B.endNotEstimated}; after ready ${A.ready}, not estimated ${A.notEstimated} (${(A.notEstimated / A.turns * 100).toFixed(2)} %), end not estimated ${A.endNotEstimated}`);
  for (const part of ["turnReasons", "endReasons"]) {
    const m = new Map();
    for (const [side, s] of [["b", B], ["a", A]]) for (const r of s[part]) { const k = fam(r.reason); const e = m.get(k) ?? { b: 0, a: 0, ex: r.examples[0] }; e[side] += r.n; m.set(k, e); }
    const rows = [...m].filter(([, e]) => e.a !== e.b).sort((x, y) => (y[1].b - y[1].a) - (x[1].b - x[1].a));
    console.log(`  ${part === "turnReasons" ? "turn" : "end"} reasons that changed (${rows.length}):`);
    for (const [k, e] of rows) console.log(`    ${String(e.b).padStart(4)} -> ${String(e.a).padEnd(4)} ${k}`);
  }
}
