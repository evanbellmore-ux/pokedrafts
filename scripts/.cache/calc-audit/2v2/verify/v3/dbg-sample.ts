// Track R-V debug: who calls battle.sample in a case's first whole-turn replay.
import { CASES } from "../cases";
import { prepare } from "../sim-dfs";
const c = CASES.find((x) => x.id === process.argv[2])!;
const p = prepare(c);
const b = p.b;
const orig = b.sample.bind(b);
b.sample = (items: any[]) => { console.log("sample", items.length, (new Error().stack ?? "").split("\n").slice(2, 7).map((s) => s.trim()).join(" | ")); return orig(items); };
for (const [i, t] of p.choices.entries()) b.sides[i].choose(t);
b.commitChoices();
console.log("requestState", b.requestState);
