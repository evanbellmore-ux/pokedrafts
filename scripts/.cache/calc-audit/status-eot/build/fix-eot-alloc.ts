// EOT-6 follow-up: where the garbage of Training's decisions comes from. Plays `battles` of the reviewer's gc-belief scenario
// (Plays safe vs MaxDamage, pool U, open sheets) under V8's sampling heap profiler with collected objects included
// (HeapProfiler.startSampling includeObjectsCollectedByMajorGC/MinorGC), then sums the sampled bytes by call-stack frame.
//   npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/fix-eot-alloc.ts [battles] [run]
import { Session } from "node:inspector/promises";
import { basename } from "node:path";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import type { HabitsRecord } from "@/app/(app)/training/model/decision";
import type { SideID } from "@/app/(app)/training/model/showdown-types";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { runMatch } from "../../../../training/lib/match";
import { createSeat, ensureSeats } from "../../../../training/lib/providers";
import { mirroredPair, parsePools } from "../../../../training/lib/teams";

type Node = { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: Node[] };
const [battlesArg = "20", run = "integration"] = process.argv.slice(2);
(async () => {
  await ensureSeats(["safe", "maxdamage"]);
  const usage = loadTrainingUsage();
  const pools = parsePools("U");
  const session = new Session();
  session.connect();
  await session.post("HeapProfiler.enable");
  await session.post("HeapProfiler.startSampling", { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const habits: Record<SideID, HabitsRecord | null> = { p1: null, p2: null };
  for (let index = 0; index < Number(battlesArg); index++) {
    const pair = mirroredPair(run, index, pools, runtime);
    const seats = { p1: createSeat("maxdamage", runtime, habits.p1), p2: createSeat("safe", runtime, habits.p2) };
    const result = await runMatch({ seats, teams: { p1: pair.p1.team, p2: pair.p2.team }, info: DEFAULT_INFO, runtime, usage, seedRun: run, index });
    habits.p1 = result.habits.p1; habits.p2 = result.habits.p2;
  }
  const { profile } = await session.post("HeapProfiler.stopSampling") as { profile: { head: Node } };
  const inclusive = new Map<string, number>();
  let total = 0;
  const walk = (node: Node, stack: string[]) => {
    const file = basename(node.callFrame.url.replace(/^file:[/][/][/]?/, ""));
    const label = `${node.callFrame.functionName || "(anon)"} ${file}`;
    const here = [...stack, label];
    if (node.selfSize) {
      total += node.selfSize;
      for (const each of new Set(here)) inclusive.set(each, (inclusive.get(each) ?? 0) + node.selfSize);
    }
    for (const child of node.children) walk(child, here);
  };
  const under = new Map<string, number>();
  const walkUnder = (node: Node, inside: boolean) => {
    const file = basename(node.callFrame.url.replace(/^file:[/][/][/]?/, ""));
    const label = `${node.callFrame.functionName || "(anon)"} ${file}:${node.callFrame.lineNumber + 1}`;
    const now = inside || (node.callFrame.functionName === "endOfTurn" && file === "doubles-eot.ts");
    if (now && node.selfSize) under.set(label, (under.get(label) ?? 0) + node.selfSize);
    for (const child of node.children) walkUnder(child, now);
  };
  walkUnder(profile.head, false);
  walk(profile.head, []);
  const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(0)} MB (${(bytes / total * 100).toFixed(1)}%)`;
  console.log(`sampled allocation over ${battlesArg} battles: ${mb(total)}`);
  const pick = /^(endOfTurn|calculateDoublesOutcomes|calculateDoublesTurn|runRollout|rollout|buildBeliefBattle|observe|update|createTurnServices|evaluateCells|decide|engineWorlds|bridgeTurn|splitWorlds|run|collect|runGroup|weatherHandler|mergeWorlds|discreteKey|speedOf|moveInfo|cloneWorld|walk|step|turnWalk) /;
  console.log("self allocation inside endOfTurn:");
  for (const [label, bytes] of [...under].sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`  ${mb(bytes)} ${label}`);
  for (const [label, bytes] of [...inclusive].filter(([label]) => pick.test(label)).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${mb(bytes)} ${label}`);
})();
