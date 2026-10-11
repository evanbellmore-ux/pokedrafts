// Step 0b: the moves pane (calculateDoublesMoves, as verify/bench.ts times it: the first 12 estimated cases, own-left into
// opponent-left and opponent-right into own-right) in one process, `passes` passes after a warm-up; prints the minimum and
// median pass. Run under HEAD's tree with TSX_TSCONFIG_PATH (scratchpad tsconfig.head.json) and under this tree, alternating.
import { CASES } from "../../2v2/verify/cases";
import { caseInput, runtimeFor } from "../../2v2/verify/app-turn";
import { calculateDoublesMoves } from "@/app/lib/battle/doubles-turn";
import type { DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";

(async () => {
  const passes = Number(process.argv[2] ?? 8);
  const jobs: { input: DoublesTurnInput; slot: DoublesSlotId; into: DoublesSlotId }[] = [];
  for (const c of CASES.filter((x) => !x.notEstimated).slice(0, 12)) {
    const input = caseInput(c, await runtimeFor(c));
    for (const slot of ["own-left", "opponent-right"] as const) {
      const into: DoublesSlotId = slot === "own-left" ? "opponent-left" : "own-right";
      if (input.pokemon[slot] && input.pokemon[into]) jobs.push({ input, slot, into });
    }
  }
  const pass = () => { const start = performance.now(); for (const job of jobs) calculateDoublesMoves({ ...job.input }, job.slot, job.into); return performance.now() - start; };
  const first = pass();
  for (let i = 0; i < 2; i++) pass();
  const times = Array.from({ length: passes }, pass).sort((a, b) => a - b);
  console.log(`first ${first.toFixed(1)} min ${times[0].toFixed(1)} median ${times[Math.floor(times.length / 2)].toFixed(1)}`);
})();
