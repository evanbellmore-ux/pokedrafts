// Integration: the belief update's own cost (model.observe) on recorded AI inputs, to compare code versions on the same
// states. `record`: play N eval battles (safe vs maxdamage, pool U, open sheets) and save p2's AiInputs per turn decision.
// `time`: replay the saved inputs through createBeliefModel + observe, R times, and print the per-observe distribution.
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/int-belief-bench.ts record <file> [battles]
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/int-belief-bench.ts time <file> [repeats]
import fs from "node:fs";
import { createBeliefModel } from "@/app/(app)/training/ai/belief/model";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { runMatch } from "../../../../training/lib/match";
import { createSeat, ensureSeats } from "../../../../training/lib/providers";
import { mirroredPair, parsePools } from "../../../../training/lib/teams";

async function record(file: string, battles: number) {
  await ensureSeats(["safe", "maxdamage"]);
  const usage = loadTrainingUsage();
  const out: unknown[][] = [];
  for (let index = 0; index < battles; index++) {
    const pair = mirroredPair("int-belief-a", index, parsePools("U"), runtime);
    const turns: unknown[] = [];
    await runMatch({
      seats: { p1: createSeat("maxdamage", runtime, null), p2: createSeat("safe", runtime, null) },
      teams: { p1: pair.p1.team, p2: pair.p2.team }, info: DEFAULT_INFO, runtime, usage, seedRun: "int-belief-a", index,
      observer: { services(side, inputs) { if (side === "p2" && "active" in inputs.request) turns.push(structuredClone(inputs)); } },
    });
    out.push(turns);
  }
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`recorded ${out.reduce((n, t) => n + t.length, 0)} turn inputs from ${battles} battles`);
}

function time(file: string, repeats: number) {
  const usage = loadTrainingUsage();
  const battles = JSON.parse(fs.readFileSync(file, "utf8")) as Parameters<ReturnType<typeof createBeliefModel>["observe"]>[0][][];
  const samples: number[] = [];
  for (let r = 0; r < repeats; r++) {
    for (const turns of battles) {
      if (!turns.length) continue;
      const model = createBeliefModel(turns[0].info, { usage });
      model.start(turns[0].sheet, runtime);
      for (const inputs of turns) {
        const start = performance.now();
        model.observe(inputs, runtime);
        samples.push(performance.now() - start);
      }
    }
  }
  samples.sort((a, b) => a - b);
  const q = (p: number) => samples[Math.min(samples.length - 1, Math.ceil(p * samples.length) - 1)];
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  console.log(`${samples.length} observes: mean ${mean.toFixed(3)} ms, p50 ${q(0.5).toFixed(3)}, p95 ${q(0.95).toFixed(3)}, max ${q(1).toFixed(3)}`);
}

const [mode, file, n] = process.argv.slice(2);
if (mode === "record") void record(file, Number(n ?? 30));
else time(file, Number(n ?? 3));
