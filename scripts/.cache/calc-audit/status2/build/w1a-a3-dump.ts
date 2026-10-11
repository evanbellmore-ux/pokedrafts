// Track A3 helper: the app's hits, HP and E2 outcome summaries of chosen verification cases (all agree with the oracle).
import { appTurn } from "../../2v2/verify/app-turn";
import { A3_CASES } from "./w1a-a3-cases";
const ids = process.argv.slice(2);
(async () => {
  for (const c of A3_CASES) {
    if (!ids.some((id) => c.id === id)) continue;
    const app = await appTurn(c);
    const r = app.result;
    if (!r || r.status !== "ready") { console.log(c.id, r?.status, (r as any)?.reason); continue; }
    console.log(`== ${c.id}`);
    for (const step of r.steps) for (const hit of step.hits) if (hit.kind === "calculated") console.log(`  ${step.slot} ${step.moveId} -> ${hit.slot}: ${hit.min}-${hit.max} ko ${hit.koChance}`);
    for (const [slot, hp] of Object.entries(r.hp)) console.log(`  hp ${slot}: start ${hp!.start} ${hp!.min}-${hp!.max} heals ${JSON.stringify(hp!.heals)}`);
    if (app.outcomes?.status === "ready") {
      for (const o of app.outcomes.outcomes.slice(0, 3)) console.log(`  outcome ${o.chance.toFixed(4)} sides ${JSON.stringify(o.sides)} field ${JSON.stringify(o.field)} fieldSet ${JSON.stringify(o.fieldSet ?? null)} items ${Object.entries(o.mons).map(([s, m]) => `${s}:${m!.build.itemId}/${m!.build.status}/${JSON.stringify(m!.build.boosts)}`).join(" ")}`);
    }
  }
})();
