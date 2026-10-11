// Step 1 debugging aid: one case's app result summary (facts, steps, start rows), and the settle's folded builds.
import { CASE_BY_ID } from "../../2v2/verify/cases";
import { appTurn, caseInput, runtimeFor } from "../../2v2/verify/app-turn";
import { settleDoublesStart } from "@/app/lib/battle/doubles-start";
(async () => {
  const c = CASE_BY_ID.get(process.argv[2])!;
  const app = await appTurn(c);
  const r = app.result as any;
  console.log(r.status, r.reason ?? "");
  if (r.status === "ready") {
    console.log("facts", r.facts);
    for (const s of r.steps) console.log("step", s.slot, s.moveId, JSON.stringify(s.order), JSON.stringify(s.facts), JSON.stringify(s.skipped));
  }
  const runtime = await runtimeFor(c);
  const settle = settleDoublesStart(caseInput(c, runtime));
  for (const [slot, s] of Object.entries(settle.slots)) if (s) console.log(slot, s.folded.speciesId, "item", s.folded.itemId, "status", s.folded.status, "active", s.folded.abilityActive, JSON.stringify(s.items));
})();
