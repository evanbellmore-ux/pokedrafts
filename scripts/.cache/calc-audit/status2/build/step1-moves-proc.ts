// status2 Step 1 bench check: the moves pane (calculateDoublesMoves) in one process for one tree (run it with
// TSX_TSCONFIG_PATH at the HEAD tree for main), as bench.ts times it (the first 12 estimated cases, own-left into
// opponent-left and opponent-right into own-right), after warming the engine on every case's turn: the cold pass (bench.ts's
// one run per job) and five warm passes; prints the pass totals.
//   npx --no-install tsx scripts/.cache/calc-audit/status2/build/step1-moves-proc.ts
import { calculateDoublesMoves, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { CASES } from "../../2v2/verify/cases";
import { caseInput, runtimeFor } from "../../2v2/verify/app-turn";

(async () => {
  const t0 = performance.now();
  for (const c of CASES) calculateDoublesTurn(caseInput(c, await runtimeFor(c)));
  const turns = performance.now() - t0;
  const jobs: { input: DoublesTurnInput; slot: DoublesSlotId; into: DoublesSlotId }[] = [];
  for (const c of CASES.filter((x) => !x.notEstimated).slice(0, 12)) {
    const input = caseInput(c, await runtimeFor(c));
    for (const slot of ["own-left", "opponent-right"] as const) {
      const into: DoublesSlotId = slot === "own-left" ? "opponent-left" : "own-right";
      if (input.pokemon[slot] && input.pokemon[into]) jobs.push({ input, slot, into });
    }
  }
  const pass = () => {
    const ms: number[] = [];
    for (const job of jobs) { const s = performance.now(); calculateDoublesMoves({ ...job.input }, job.slot, job.into); ms.push(performance.now() - s); }
    const sorted = [...ms].sort((a, b) => a - b);
    return { total: ms.reduce((a, b) => a + b, 0), p50: sorted[Math.floor(sorted.length / 2)] };
  };
  const cold = pass();
  const warm = Array.from({ length: 5 }, pass);
  console.log(`turns ${turns.toFixed(0)} ms | moves cold total ${cold.total.toFixed(1)} p50 ${cold.p50.toFixed(2)} | warm totals ${warm.map((w) => w.total.toFixed(1)).join(" ")} | warm p50s ${warm.map((w) => w.p50.toFixed(2)).join(" ")}`);
})();
