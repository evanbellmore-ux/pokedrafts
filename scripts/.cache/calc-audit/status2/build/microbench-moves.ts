// In-process A/B timing of the moves pane (calculateDoublesMoves) as bench.ts times it: the working tree against a HEAD tree
// at argv[2], over the first 12 estimated cases, own-left into opponent-left and opponent-right into own-right; alternating
// passes after a warm-up, each side's minimum and median pass, and the ratio. argv[4] "cold": one pass each, no warm-up.
import { pathToFileURL } from "node:url";
import { CASES } from "../../2v2/verify/cases";
import { caseInput, runtimeFor } from "../../2v2/verify/app-turn";
import { calculateDoublesMoves as current } from "@/app/lib/battle/doubles-turn";
import type { DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";

(async () => {
  const head = (await import(pathToFileURL(`${process.argv[2]}/app/lib/battle/doubles-turn.ts`).href)).calculateDoublesMoves as typeof current;
  const passes = Number(process.argv[3] ?? 10);
  const jobs: { input: DoublesTurnInput; slot: DoublesSlotId; into: DoublesSlotId }[] = [];
  for (const c of CASES.filter((x) => !x.notEstimated).slice(0, 12)) {
    const input = caseInput(c, await runtimeFor(c));
    for (const slot of ["own-left", "opponent-right"] as const) {
      const into: DoublesSlotId = slot === "own-left" ? "opponent-left" : "own-right";
      if (input.pokemon[slot] && input.pokemon[into]) jobs.push({ input, slot, into });
    }
  }
  const pass = (engine: typeof current) => {
    const start = performance.now();
    for (const job of jobs) engine({ ...job.input }, job.slot, job.into);
    return performance.now() - start;
  };
  for (let i = 0; i < 3; i++) { pass(head); pass(current); }
  const times = { head: [] as number[], current: [] as number[] };
  for (let i = 0; i < passes; i++) { times.head.push(pass(head)); times.current.push(pass(current)); }
  const stat = (list: number[]) => { const s = [...list].sort((a, b) => a - b); return { min: s[0], median: s[Math.floor(s.length / 2)] }; };
  const h = stat(times.head), c = stat(times.current);
  console.log(`moves: ${jobs.length} jobs; head min ${h.min.toFixed(1)} median ${h.median.toFixed(1)} | current min ${c.min.toFixed(1)} median ${c.median.toFixed(1)} | ratio min ${(c.min / h.min).toFixed(3)} median ${(c.median / h.median).toFixed(3)}`);
})();
