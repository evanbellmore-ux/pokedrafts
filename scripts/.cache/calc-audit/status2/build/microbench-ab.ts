// In-process A/B timing of calculateDoublesTurn: the working tree against a HEAD tree extracted at argv[2] (git archive),
// alternating passes over every stored case after a warm-up of each; prints each side's minimum and median pass.
import { CASES } from "../../2v2/verify/cases";
import { caseInput, runtimeFor } from "../../2v2/verify/app-turn";
import { calculateDoublesTurn as current } from "@/app/lib/battle/doubles-turn";
import type { DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { pathToFileURL } from "node:url";

(async () => {
  const head = (await import(pathToFileURL(`${process.argv[2]}/app/lib/battle/doubles-turn.ts`).href)).calculateDoublesTurn as typeof current;
  const passes = Number(process.argv[3] ?? 8);
  const inputs: DoublesTurnInput[] = [];
  for (const c of CASES) { try { inputs.push(caseInput(c, await runtimeFor(c))); } catch { /* skipped */ } }
  const pass = (engine: typeof current) => {
    const start = performance.now();
    for (const input of inputs) { try { engine({ ...input }); } catch { /* timed as it is */ } }
    return performance.now() - start;
  };
  pass(head); pass(current); pass(head); pass(current);
  const times = { head: [] as number[], current: [] as number[] };
  for (let i = 0; i < passes; i++) { times.head.push(pass(head)); times.current.push(pass(current)); }
  const stat = (list: number[]) => { const s = [...list].sort((a, b) => a - b); return { min: s[0], median: s[Math.floor(s.length / 2)] }; };
  const h = stat(times.head), c = stat(times.current);
  console.log(`head min ${h.min.toFixed(0)} median ${h.median.toFixed(0)} | current min ${c.min.toFixed(0)} median ${c.median.toFixed(0)} | ratio min ${(c.min / h.min).toFixed(3)} median ${(c.median / h.median).toFixed(3)}`);
})();
