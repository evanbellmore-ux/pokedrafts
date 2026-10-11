// The app's after-turn status for the FX cases (E2 outcomes and the end-of-turn residual facts).
import { caseInput, runtimeFor } from "../../2v2/verify/app-turn";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { FIX_CASES } from "./fix-eot-cases";
(async () => {
  for (const c of FIX_CASES.filter((each) => !process.argv[2] || each.id === process.argv[2])) {
    const input = caseInput(c, await runtimeFor(c));
    const turn = calculateDoublesTurn(input);
    const e2 = calculateDoublesOutcomes(input);
    const residuals = turn.status === "ready" && turn.endOfTurn.status === "ready" ? turn.endOfTurn.residuals.map((r) => `${r.slot} ${r.effect} ${r.facts.map((f) => f.text).join(" ")}`) : [];
    const statuses = e2.status === "ready" ? e2.outcomes.map((o) => Object.entries(o.mons).map(([slot, m]) => `${slot}:${(m as { build?: { status?: string } })?.build?.status ?? ""}`).join(" ")) : [e2.status];
    console.log(c.id, "| residuals:", residuals.join(" ; ") || "none", "| E2 statuses:", statuses.join(" / "), "| facts:", turn.status === "ready" ? turn.facts.join(" | ") : "");
  }
})();
