// In-process A/B timing over bench.ts's 200 fuzzed typical turns (seed 1): the working tree against a HEAD tree at argv[2];
// alternating passes after a warm-up; each side's minimum and median pass, and the ratio.
import { pathToFileURL } from "node:url";
import { doublesSets, fuzzTurn, rng } from "../../2v2/verify/bench";
import { calculateDoublesTurn as current } from "@/app/lib/battle/doubles-turn";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import type { DoublesTurnInput } from "@/app/lib/battle/doubles-types";

(async () => {
  const head = (await import(pathToFileURL(`${process.argv[2]}/app/lib/battle/doubles-turn.ts`).href)).calculateDoublesTurn as typeof current;
  const passes = Number(process.argv[3] ?? 10);
  const random = rng(1);
  const games = ["champions", "scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const;
  const inputs: DoublesTurnInput[] = [];
  for (let i = 0; i < 200; i++) {
    const runtime = await loadBattleRuntime(games[i % games.length]);
    inputs.push(fuzzTurn(runtime, doublesSets(runtime), random, { doublesTargetRule }));
  }
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
  console.log(`fuzz: head min ${h.min.toFixed(0)} median ${h.median.toFixed(0)} | current min ${c.min.toFixed(0)} median ${c.median.toFixed(0)} | ratio min ${(c.min / h.min).toFixed(3)} median ${(c.median / h.median).toFixed(3)}`);
})();
