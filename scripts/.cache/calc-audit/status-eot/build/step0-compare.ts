// compare.ts's report without writing into the verify folder (app-results/ stays as stored): every case's app result
// (app-turn.ts appTurn) against the oracle's results/<id>.json (compare.ts compareCase).
import { CASES } from "../../2v2/verify/cases";
import { appTurn, runtimeFor } from "../../2v2/verify/app-turn";
import { compareCase, readOracle } from "../../2v2/verify/compare";

(async () => {
  let bad = 0, total = 0;
  for (const c of CASES) {
    total++;
    const app = await appTurn(c);
    if (app.error) { bad++; console.log(`${c.id}: ERROR ${app.error.split("\n")[0]}`); continue; }
    const runtime = await runtimeFor(c);
    const mismatches = compareCase(c, readOracle(c.id), app.result, (moveId) => runtime.movesById.get(moveId)?.category === "Status");
    if (mismatches.length) { bad++; console.log(`${c.id}: ${mismatches.length} mismatches`); for (const m of mismatches) console.log(`   ${m.where} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}`); }
  }
  console.log(`\n${total - bad}/${total} cases match.`);
})();
