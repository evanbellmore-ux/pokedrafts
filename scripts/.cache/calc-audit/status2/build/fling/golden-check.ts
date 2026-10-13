// Track F (SPEC2 §4.7): every golden-1v1 Fling row (the rows the fix changes) against the exact oracle (check.ts).
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/fling/golden-check.ts [filter]
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { corpus } from "./golden-corpus";
import { checkRow } from "./check";
(async () => {
  const filter = process.argv[2];
  const cases = await corpus();
  let ok = 0, bad = 0, skipped = 0;
  for (const c of cases) {
    if (filter && !c.id.includes(filter)) continue;
    const R = await loadBattleRuntime(c.game);
    const out = calculateMatchup(c.attacker, c.defender, c.field, c.contexts, R);
    const row = out.results.find((r) => r.moveId === "fling");
    if (!row) continue;
    const check = checkRow(c.id, c.game as never, c.attacker, c.defender, c.field, R, row);
    if (check.skipped) { skipped++; console.log(`SKIP ${c.id}: ${check.skipped}`); continue; }
    if (check.ok) ok++; else bad++;
    console.log(`${check.ok ? "OK  " : "DIFF"} ${c.id}\n     app    ${check.app}\n     oracle ${check.oracle}${check.diffs.map((d) => `\n     ! ${d}`).join("")}`);
  }
  console.log(`golden Fling rows: ${ok} agree, ${bad} differ, ${skipped} not calculated`);
})();
