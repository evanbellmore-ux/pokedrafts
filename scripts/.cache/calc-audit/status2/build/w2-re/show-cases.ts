// Prints the app's turn (kit.show) and E2 outcomes (kit.showOutcomes) for stored cases (verify/cases) or R-E's cases-re.ts,
// by exact id: the numbers the unit tests (tests/unit/doubles-switch.test.ts) pin, for cases that agree with the oracle.
// Optional: --ally-moves gives a slot with exactMoves and no moves its action move (the Assist cases).
import { CASES } from "../../../2v2/verify/cases";
import { caseInput, runtimeFor } from "../../../2v2/verify/app-turn";
import { RE_CASES } from "./cases-re";
import { show, showOutcomes } from "./kit";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
(async () => {
  const args = process.argv.slice(2);
  for (const id of args.filter((a) => !a.startsWith("--"))) {
    const base = [...CASES, ...RE_CASES].find((each) => each.id === id);
    if (!base) { console.log(`${id}: no such case`); continue; }
    const c = JSON.parse(JSON.stringify(base));
    if (args.includes("--ally-moves")) for (const m of Object.values(c.slots) as any[]) if (m.exactMoves && !m.moves && m.action?.move) m.moves = [m.action.move];
    const input = caseInput(c, await runtimeFor(c));
    console.log(`=== ${id}`);
    console.log(show(calculateDoublesTurn(input)));
    console.log(showOutcomes(caseInput(c, await runtimeFor(c))));
  }
})();
