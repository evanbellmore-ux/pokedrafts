// status2 Track E1: the stored cases whose end-of-turn reason this track removes (Harvest, Pickup, Opportunist copying a
// rise at the end of turn, Liquid Ooze, Starf Berry in E2), re-run in pinned Showdown c23d2e94 without the stored reason and
// compared with the app (V1 re-runs and stores them at integration: status2/build/changed-cases.ts). Read-only on results/.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/e1-stored.ts [ID ...] > scripts/.cache/calc-audit/status2/build/e1-stored.out
import { oracle } from "../../2v2/verify/sim-dfs";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase } from "../../2v2/verify/compare";
import { CASES } from "../../2v2/verify/cases";
import { SLOTS } from "../../2v2/verify/case-types";

const REASONS = /^(Harvest|Pickup|Liquid Ooze|Starf Berry) is not modelled in 2v2\.$|copying a stat rise/;

(async () => {
  const want = process.argv.slice(2);
  const picked = CASES.filter((c) => want.length ? want.some((id) => c.id === id) : REASONS.test(c.endNotEstimated ?? ""));
  let agree = 0;
  for (const stored of picked) {
    const c = { ...stored };
    delete c.endNotEstimated;
    console.log(`\n### ${c.id}: ${c.title} (stored: ${stored.endNotEstimated ?? stored.notEstimated ?? "-"})`);
    const o = oracle(c);
    for (const r of o.residuals) console.log(`  oracle residual ${r.slot} ${r.effect}${r.other ? ` (${r.other})` : ""}: ${+r.chance.toFixed(9)} ${r.min}..${r.max} ${JSON.stringify(r.facts ?? {})}`);
    for (const slot of SLOTS) {
      const s = o.walks.all.afterTurn?.slots[slot];
      if (s) console.log(`  oracle ${slot} ${s.species}: [${s.min}–${s.max}] avg ${s.average.toFixed(3)} items ${JSON.stringify(s.item ?? {})} lastItem ${JSON.stringify(s.lastItem ?? {})}`);
    }
    const app = await appTurn({ ...c, outcomes: true });
    const r = app.result;
    if (r?.status === "ready" && r.endOfTurn.status === "ready") for (const each of r.endOfTurn.residuals) console.log(`  app residual ${each.slot} ${each.effect}${each.other ? ` (${each.other})` : ""}: ${+each.chance.toFixed(9)} ${each.min}..${each.max} ${JSON.stringify(each.facts)}`);
    else console.log(`  app: ${r?.status} ${r?.status === "ready" ? r.endOfTurn.status === "not-estimated" ? r.endOfTurn.reason : "" : r && "reason" in r ? r.reason : app.error ?? ""}`);
    const runtime = await runtimeFor(c);
    const mismatches = compareCase({ ...c, outcomes: true }, o, r, (moveId) => runtime.movesById.get(moveId)?.category === "Status", app.outcomes);
    if (!mismatches.length) agree++;
    console.log(`  mismatches: ${mismatches.length}`);
    for (const m of mismatches) console.log(`    ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}${m.note ? ` (${m.note})` : ""}`);
  }
  console.log(`\n${agree}/${picked.length} agree.`);
})();
