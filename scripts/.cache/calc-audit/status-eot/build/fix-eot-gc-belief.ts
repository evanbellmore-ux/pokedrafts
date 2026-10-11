// status-eot review (eot-training): is the eval's "Belief update per turn" p95 (open, worst run safe-maxdamage-usage) the
// belief code's cost or garbage-collection pauses the turn decisions' allocation leaves for the next observe?
// Plays the same battles as eval's safe-maxdamage-usage shard loop (pool U, open sheets, habits carried), in one process,
// and reads each AI turn decision's stats.beliefMs (engine-provider.ts: model.observe wall time). Mode "gc" forces a full
// collection (global.gc) in observer.inputs, right before each AI turn decision; the decisions are deterministic, so the
// two modes play identical battles (checked by the choice-log hashes).
//   NODE_OPTIONS=--expose-gc npx --no-install tsx scripts/.cache/calc-audit/status-eot/review/eot-training/gc-belief.ts <plain|gc> [battles] [run]
import fs from "node:fs";
import { createHash } from "node:crypto";
import { PerformanceObserver } from "node:perf_hooks";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import type { HabitsRecord } from "@/app/(app)/training/model/decision";
import type { SideID } from "@/app/(app)/training/model/showdown-types";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { runMatch } from "../../../../training/lib/match";
import { createSeat, ensureSeats } from "../../../../training/lib/providers";
import { mirroredPair, parsePools } from "../../../../training/lib/teams";

const [mode = "plain", battlesArg = "100", run = "integration"] = process.argv.slice(2);
const battles = Number(battlesArg);
const gc = (globalThis as { gc?: () => void }).gc;
if (mode === "gc" && !gc) throw new Error("run with NODE_OPTIONS=--expose-gc");

const gcEvents: { start: number; duration: number; kind: number }[] = [];
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) gcEvents.push({ start: entry.startTime, duration: entry.duration, kind: (entry as unknown as { detail?: { kind?: number } }).detail?.kind ?? 0 });
}).observe({ entryTypes: ["gc"] });

(async () => {
  await ensureSeats(["safe", "maxdamage"]);
  const usage = loadTrainingUsage();
  const pools = parsePools("U");
  const habits: Record<SideID, HabitsRecord | null> = { p1: null, p2: null };
  const belief: number[] = [], decide: number[] = [];
  const hashes: string[] = [];
  let turns = 0;
  const t0 = performance.now();
  for (let index = 0; index < battles; index++) {
    const pair = mirroredPair(run, index, pools, runtime);
    const seats = { p1: createSeat("maxdamage", runtime, habits.p1), p2: createSeat("safe", runtime, habits.p2) };
    const result = await runMatch({
      seats, teams: { p1: pair.p1.team, p2: pair.p2.team }, info: DEFAULT_INFO, runtime, usage, seedRun: run, index,
      observer: { inputs(side, kind) { if (mode === "gc" && side === "p2" && kind === "turn") gc!(); } },
    });
    habits.p1 = result.habits.p1; habits.p2 = result.habits.p2;
    hashes.push(result.choiceLogHash);
    turns += result.turns;
    for (const d of result.decisions) if (d.side === "p2" && d.kind === "turn" && d.stats) { belief.push(d.stats.beliefMs); decide.push(d.ms); }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; };
  const major = gcEvents.filter((e) => e.kind === 4 || e.kind === 2), minor = gcEvents.filter((e) => e.kind === 1);
  const line = `${mode} run=${run} battles=${battles} turns=${turns} decisions=${belief.length} wall=${((performance.now() - t0) / 1000).toFixed(0)}s | belief p50 ${q(belief, 0.5).toFixed(2)} p95 ${q(belief, 0.95).toFixed(2)} max ${q(belief, 1).toFixed(2)} ms | decision p50 ${q(decide, 0.5).toFixed(0)} p95 ${q(decide, 0.95).toFixed(0)} | gc: minor ${minor.length} (${minor.reduce((s, e) => s + e.duration, 0).toFixed(0)} ms), major ${major.length} (${major.reduce((s, e) => s + e.duration, 0).toFixed(0)} ms) | hash ${hashes.join("").length ? createHash("sha256").update(hashes.join(",")).digest("hex").slice(0, 16) : ""}`;
  console.log(line);
  fs.appendFileSync("scripts/.cache/calc-audit/status-eot/build/fix-eot-results/gc-belief.out", line + "\n");
  fs.writeFileSync(`scripts/.cache/calc-audit/status-eot/build/fix-eot-results/gc-belief-${mode}-${run}.json`, JSON.stringify({ belief, decide }));
})();
