// Track D: the oracle numbers of w1a-d-results/<id>.json the unit tests pin (expected per slot; step hit ranges).
import fs from "node:fs";
import path from "node:path";
const DIR = path.resolve("scripts/.cache/calc-audit/status2/build/w1a-d-results");
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
  if (process.argv[2] && !file.startsWith(process.argv[2])) continue;
  const r = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  console.log(`== ${r.id}`);
  for (const [slot, e] of Object.entries<any>(r.expected)) console.log(`  ${slot}: start ${e.start} min ${e.min} max ${e.max} avg ${(+e.average).toFixed(4)} ko ${(+e.koChance).toFixed(6)}`);
  for (const [slot, step] of Object.entries<any>(r.walks.all.steps)) for (const [t, h] of Object.entries<any>(step.hits)) if (h.dmgMin !== null) console.log(`  hit ${slot}->${t} ${step.moveId}: ${h.dmgMin}-${h.dmgMax} ko ${(+h.ko).toFixed(6)}`);
  if (r.afterTurn) for (const [slot, e] of Object.entries<any>(r.afterTurn)) if (e) console.log(`  end ${slot}: min ${e.min} max ${e.max} avg ${(+e.average).toFixed(4)}`);
  const at = r.walks.all.afterTurn?.slots;
  if (at) for (const [slot, s] of Object.entries<any>(at)) if (s.boosts && Object.keys(s.boosts).length) console.log(`  boosts ${slot}: ${JSON.stringify(s.boosts)}`);
  const ms = r.walks.all.slots;
  for (const [slot, s] of Object.entries<any>(ms)) if (s.boosts && Object.keys(s.boosts).length) console.log(`  moves-boosts ${slot}: ${JSON.stringify(s.boosts)}`);
}
