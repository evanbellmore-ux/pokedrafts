// Situations for the evaluation scripts and tests (conformance gates 1-7 and 9d, the leak test's situation slice): a
// position for a team pair, dealt by the worker's own dealer (worker/situation-deal.ts) from (run, index) alone. Each index
// takes the next request in turn: every named situation at both levels, a custom one and a fully random one.
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { createRandom } from "@/app/(app)/training/model/random";
import { SITUATION_LEVELS, SITUATION_SPOTS, type SituationRequest, type TrainingSituation } from "@/app/(app)/training/model/situation";
import { dealPosition } from "@/app/(app)/training/worker/situation-deal";
import type { TeamPair } from "./teams";

/** The requests a run cycles through. */
export const SITUATION_REQUESTS: readonly SituationRequest[] = [
  ...SITUATION_SPOTS.flatMap((spot) => SITUATION_LEVELS.map((level): SituationRequest => ({ kind: "spot", spot, level }))),
  { kind: "custom", custom: { own: { left: 3, hp: 50, leads: [{ atk: -1 }, {}] }, opponent: { left: 4, hp: 75, leads: [{ atk: 2, spe: 1 }, {}] } } },
  { kind: "random", level: "hard" },
];

export function situationFor(pair: TeamPair, run: string, index: number): TrainingSituation {
  const request = SITUATION_REQUESTS[index % SITUATION_REQUESTS.length];
  const concrete = request.kind === "any" ? { kind: "random" as const, level: request.level } : request;
  return dealPosition(concrete, request, { own: pair.p1.team, opponent: pair.p2.team }, createRandom(run, index, "situation"), runtime);
}
