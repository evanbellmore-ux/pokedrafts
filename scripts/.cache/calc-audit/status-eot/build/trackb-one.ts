// One case: after-the-moves and after-the-turn values, app vs oracle.  npx --no-install tsx …/trackb-one.ts <id>
import { oracle } from "../../2v2/verify/sim-dfs";
import { caseInput, runtimeFor } from "../../2v2/verify/app-turn";
import { SLOTS } from "../../2v2/verify/case-types";
import { STATUS_EOT_CASES } from "../../2v2/verify/cases-se";
import { ER_CASES } from "../../2v2/verify/cases-er";
import { E_CASES } from "../../2v2/verify/cases-e";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
async function main() {
  const c = [...STATUS_EOT_CASES, ...ER_CASES, ...E_CASES].find((each) => each.id === process.argv[2])!;
  const result = calculateDoublesTurn(caseInput(c, await runtimeFor(c)));
  const r = oracle(c);
  if (result.status !== "ready") { console.log(result); return; }
  for (const slot of SLOTS) {
    const a = result.hp[slot], o = r.expected[slot];
    console.log(slot, "moves app", a?.low, a?.average, a?.high, "orc", o.low, o.average, o.high);
    const t = result.endOfTurn.status === "ready" ? result.endOfTurn.hp[slot] : null, ot = r.afterTurn?.[slot];
    console.log(slot, "turn  app", t?.low, t?.average, t?.high, "orc", ot?.low, ot?.average, ot?.high);
  }
  console.log(JSON.stringify(result.endOfTurn.status === "ready" ? result.endOfTurn.residuals : result.endOfTurn));
  console.log(JSON.stringify(r.residuals));
}
void main();
