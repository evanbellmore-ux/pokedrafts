// Track B timing: E2 (calculateDoublesOutcomes) on Training's own engine inputs from real matches, total and per call.
//   node --cpu-prof --cpu-prof-dir=<dir> --import tsx scripts/.cache/calc-audit/status-eot/build/trackb-e2time.ts [battles]
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { createRandom, seedHex } from "@/app/(app)/training/model/random";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { runMatch } from "../../../../training/lib/match";
import { createSeat, ensureSeats } from "../../../../training/lib/providers";
import { mirroredPair, parsePools } from "../../../../training/lib/teams";

async function main() {
  const battles = Number(process.argv[2] ?? 10);
  await ensureSeats(["safe", "maxdamage"]);
  const usage = loadTrainingUsage();
  const inputs: DoublesTurnInput[] = [];
  for (let index = 0; index < battles; index++) {
    const pair = mirroredPair("trackb-time", index, parsePools("S,V"), runtime);
    const adapted = { p1: toShowdownTeam(pair.p1.team.members, runtime), p2: toShowdownTeam(pair.p2.team.members, runtime) };
    const keys = memberKeys(adapted.p1, adapted.p2);
    const random = createRandom("trackb-time", index);
    await runMatch({
      seats: { p1: createSeat("maxdamage", runtime, null), p2: createSeat("safe", runtime, null) },
      teams: { p1: pair.p1.team, p2: pair.p2.team }, info: DEFAULT_INFO, runtime, usage, seedRun: "trackb-time", index,
      observer: {
        services(side, aiInputs, worlds) {
          if (side !== "p2" || !worlds.length || !("active" in aiInputs.request)) return;
          const services = createTurnServices(aiInputs, worlds, { runtime, keys, seedBase: seedHex("trackb-time", index, aiInputs.requestId) });
          const { own, opponent } = services.view.legal;
          for (let n = 0; n < 30 && own.length && opponent.length; n++) {
            const engine = services.engineWorlds({ own: own[random.int(own.length)], opponent: opponent[random.int(opponent.length)] });
            if (engine.kind === "engine") for (const world of engine.worlds) inputs.push(world.input);
          }
        },
      },
    });
  }
  const times: number[] = [];
  let applied = 0;
  for (const input of inputs) {
    const start = performance.now();
    const result = calculateDoublesOutcomes(input);
    times.push(performance.now() - start);
    if (result.status === "ready" && result.endOfTurn === "applied") applied++;
  }
  times.sort((a, b) => a - b);
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(2);
  console.log(`${inputs.length} E2 calls, applied ${applied}; total ${times.reduce((a, b) => a + b, 0).toFixed(0)} ms; p50 ${q(0.5)} p95 ${q(0.95)} max ${q(1)} ms`);
}
void main();
