// The AI's belief about the other side's hidden sets (SPEC 10.1; addendum A1.4: usage priors). Types only.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";
import type { AiInputs, BeliefWorld } from "../../model/ai-inputs";
import type { AIRandom } from "../../model/decision";
import type { StatPoints } from "../../model/sheet";
import type { SheetView } from "../../model/sheet";

export type Archetype = "fast-attacker" | "bulky-attacker" | "fast-support" | "physical-wall" | "special-wall" | "mixed-wall" | "trick-room" | "uninvested";
/** Where a candidate's spread came from: an archetype of the rule-based prior, the open sheet, or a usage spread (A1.4). */
export type SpreadSource = Archetype | "sheet" | "usage";
/** One possible set for one of the player's members (named apart from ai/candidates.ts Candidate, which is an action). */
export type SetCandidate = {
  /** `${points}|${nature}|${itemId}|${abilityId}`: equal ids are the same set. */
  id: string;
  archetype: SpreadSource;
  points: StatPoints; nature: string; itemId: string; abilityId: string;
  /** Prior log weight plus every log likelihood applied (unnormalised). */
  logWeight: number;
};
export type MemberBelief = {
  key: string; speciesId: string;
  /** Heaviest first. */
  candidates: SetCandidate[];
  /** The point belief of its four moves (SPEC 10.1.1 Moves): seen moves first. */
  moves: string[];
  /** The battle showed its item gone (consumed or removed). */
  itemGone: boolean;
};
export type Belief = {
  members: Record<string, MemberBelief>;
  /** Chance each SheetMember key was brought (the four sum to 4). */
  bring: Record<string, number>;
  /** TurnObservations records applied. */
  seenTurns: number;
  /** Observations left out by the per-turn cost cap (SPEC 10.1.2), in total. */
  skippedObservations: number;
};

export interface BeliefModel {
  /** At team preview: candidates from the sheet and InfoView (SPEC 10.1.1). */
  start(sheet: SheetView, runtime: BattleRuntime): void;
  /** The most likely build of each of the player's six (team preview's matchup scores). */
  mapBuilds(runtime: BattleRuntime): Record<string, BattleBuild>;
  /** The preview model's bring chances (P_bring), before the first turn. */
  setBring(bring: Record<string, number>): void;
  /** Applies every TurnObservations record newer than the last one seen; reveals, entries, order, damage. */
  observe(inputs: AiInputs, runtime: BattleRuntime): void;
  /** World 0 = MAP; worlds 1..k-1 sampled from the posterior; set weights 1/k. */
  worlds(k: number, inputs: AiInputs, random: AIRandom, seedBase: string): BeliefWorld[];
  /** For DecisionReport.assumed: the MAP spread of each of the player's actives with its chance. */
  assumed(inputs: AiInputs, runtime: BattleRuntime): string[];
  snapshot(): Belief;
}
