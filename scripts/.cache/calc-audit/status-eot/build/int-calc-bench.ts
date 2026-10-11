// Integration: calculateTurnMove's cost in Champions (the belief update's likelihoods call it per candidate), for timing
// the certain-crit change. npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/int-calc-bench.ts
import { calculateTurnMove } from "@/app/lib/battle/calculate";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";

const pairs = [["garchomp", "charizard"], ["incineroar", "rillaboom"], ["kingambit", "sneasler"], ["gengar", "dragapult"], ["snorlax", "venusaur"]] as const;
const conditions = { ...createConditions(), gameType: "Doubles" as const };
const jobs = pairs.flatMap(([a, b]) => {
  const attacker = createBuild(a, runtime), defender = createBuild(b, runtime);
  const species = runtime.speciesById.get(a)!;
  return species.moves.slice(0, 40).map((id) => runtime.movesById.get(id)!).filter((move) => move && move.category !== "Status").map((move) => ({ move, attacker, defender }));
});
for (let warm = 0; warm < 3; warm++) for (const job of jobs) calculateTurnMove(job.move, job.attacker, job.defender, conditions, undefined, runtime, {});
const rounds = Number(process.env.ROUNDS ?? 20);
const times: number[] = [];
for (let round = 0; round < rounds; round++) {
  const start = performance.now();
  for (const job of jobs) calculateTurnMove(job.move, job.attacker, job.defender, conditions, undefined, runtime, {});
  times.push((performance.now() - start) / jobs.length);
}
times.sort((a, b) => a - b);
console.log(`${jobs.length} calculations × ${rounds}: median ${(times[rounds >> 1] * 1000).toFixed(1)} µs per calculation, min ${(times[0] * 1000).toFixed(1)} µs`);
