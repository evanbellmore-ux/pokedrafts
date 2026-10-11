// A steadier timing than bench.ts for comparing two trees (run one with TSX_TSCONFIG_PATH pointing "@/" at the other):
// calculateDoublesTurn over every stored case, a warm-up pass, then PASSES timed passes; prints the total and per-pass ms.
import { CASES } from "../../2v2/verify/cases";
import { caseInput, runtimeFor } from "../../2v2/verify/app-turn";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesTurnInput } from "@/app/lib/battle/doubles-types";

const PASSES = Number(process.argv[2] ?? 5);
(async () => {
  const inputs: DoublesTurnInput[] = [];
  for (const c of CASES) {
    try { inputs.push(caseInput(c, await runtimeFor(c))); } catch { /* a case whose input does not build is skipped */ }
  }
  for (const input of inputs) { try { calculateDoublesTurn({ ...input }); } catch { /* timed as it is */ } }
  const times: number[] = [];
  for (let pass = 0; pass < PASSES; pass++) {
    const start = performance.now();
    for (const input of inputs) { try { calculateDoublesTurn({ ...input }); } catch { /* timed as it is */ } }
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(`${inputs.length} inputs; passes (ms, sorted): ${times.map((t) => t.toFixed(0)).join(" ")}; median ${times[Math.floor(times.length / 2)].toFixed(0)}`);
})();
