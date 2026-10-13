// Integration 2: microbench-ab.ts (in-process A/B, alternating passes) over the cases without a bench (every loaded case but
// wave 2's, so both engines calculate the same turns), against an engine tree at argv[2] (step2/pre: integration 1b's engine
// at Step 2's start). Times calculateDoublesTurn per pass and, with argv[4] = "moves", calculateDoublesMoves for the first 40
// estimated cases (own-left into opponent-left, opponent-right into own-right).
import { CASES } from "../../../2v2/verify/cases";
import { WAVE2_CASES } from "../../../2v2/verify/cases-wave2";
import { caseInput, runtimeFor } from "../../../2v2/verify/app-turn";
import { calculateDoublesMoves as currentMoves, calculateDoublesTurn as current } from "@/app/lib/battle/doubles-turn";
import type { DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { pathToFileURL } from "node:url";

(async () => {
  const mod = await import(pathToFileURL(`${process.argv[2]}/app/lib/battle/doubles-turn.ts`).href);
  const head = mod.calculateDoublesTurn as typeof current;
  const headMoves = mod.calculateDoublesMoves as typeof currentMoves;
  const passes = Number(process.argv[3] ?? 8);
  const moves = process.argv[4] === "moves";
  const wave2 = new Set(WAVE2_CASES.map((c) => c.id));
  const inputs: DoublesTurnInput[] = [];
  for (const c of CASES) { if (wave2.has(c.id)) continue; try { inputs.push(caseInput(c, await runtimeFor(c))); } catch { /* skipped */ } }
  const paneInputs = CASES.filter((c) => !wave2.has(c.id) && !c.notEstimated).slice(0, 40).map((c) => inputs.find((_, i) => i >= 0) && c).filter(Boolean);
  void paneInputs;
  const pane: DoublesTurnInput[] = [];
  for (const c of CASES.filter((x) => !wave2.has(x.id) && !x.notEstimated).slice(0, 40)) pane.push(caseInput(c, await runtimeFor(c)));
  const pass = (engine: typeof current, engineMoves: typeof currentMoves) => {
    const start = performance.now();
    if (moves) {
      for (const input of pane) for (const [slot, into] of [["own-left", "opponent-left"], ["opponent-right", "own-right"]] as const) {
        if (!input.pokemon[slot] || !input.pokemon[into]) continue;
        try { engineMoves({ ...input }, slot, into); } catch { /* timed as it is */ }
      }
    } else for (const input of inputs) { try { engine({ ...input }); } catch { /* timed as it is */ } }
    return performance.now() - start;
  };
  pass(head, headMoves); pass(current, currentMoves); pass(head, headMoves); pass(current, currentMoves);
  const times = { head: [] as number[], current: [] as number[] };
  for (let i = 0; i < passes; i++) { times.head.push(pass(head, headMoves)); times.current.push(pass(current, currentMoves)); }
  const stat = (list: number[]) => { const s = [...list].sort((a, b) => a - b); return { min: s[0], median: s[Math.floor(s.length / 2)] }; };
  const h = stat(times.head), c = stat(times.current);
  console.log(`${moves ? "moves pane" : "turns"} (${moves ? pane.length : inputs.length} inputs): head min ${h.min.toFixed(0)} median ${h.median.toFixed(0)} | current min ${c.min.toFixed(0)} median ${c.median.toFixed(0)} | ratio min ${(c.min / h.min).toFixed(3)} median ${(c.median / h.median).toFixed(3)}`);
})();
