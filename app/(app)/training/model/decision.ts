// Addendum A1.1/A1.4: usage on the Preview/Turn/Switch contexts, DecisionStats.statusOptions; A1.5: MegaPolicy, DEFAULT_MEGA_POLICY, SlotContext.canMega, TurnRecord.observedMega, DecisionStats.mega (MegaStats).
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { AiInputs, BeliefWorld } from "./ai-inputs";
import type { TurnServices } from "./ai-view";
import type { InfoView } from "./info";
import type { ObservedAction } from "./public-state";
import type { SheetView } from "./sheet";
import type { TrainingUsageData } from "./usage";
import type { DecisionReport, JointAction, TrainingDifficulty, TrainingTeam } from "./view-types";

/** Stored by the page under pokedrafts:training:habits:v1:<userId>; `data` is the AI's HabitsData (model/habits-data.ts), which the page reads only for "Your trends". */
export type HabitsRecord = { version: 1; turns: number; data: unknown };

export type WorkBudget = {
  engineCalls: number;      // calculateDoublesOutcomes calls
  rolloutSamples: number;   // simulator rollout samples
  stageASamples: number;    // per non-engine cell in stage A
  stageBSamples: number;    // target samples per support cell in stage B
  worlds: number;           // belief worlds per decision
};
export const DEFAULT_BUDGET: WorkBudget = { engineCalls: 240, rolloutSamples: 160, stageASamples: 2, stageBSamples: 8, worlds: 4 };
export const BROWSER_VALVE_MS = 900;
/**
 * Addendum A1.5: when the engine provider Mega Evolves. "per-turn" weighs Mega now (this turn's prelude), its lasting value
 * and the option value of keeping it, every turn; "first-chance" is the SPEC Q2 rule, kept for the A1.5 win-rate gate.
 */
export type MegaPolicy = "per-turn" | "first-chance";
export const DEFAULT_MEGA_POLICY: MegaPolicy = "per-turn";

export type AIRandom = { float(): number; int(n: number): number };
export type DecideOptions = {
  difficulty: TrainingDifficulty;
  budget: WorkBudget;
  /** Wall-clock valve in ms from the decision start; null in Node evaluation (deterministic). */
  deadlineMs: number | null;
  random: AIRandom;
  /** 32 hex digits for this request (seedHex(aiBase, requestId)); worlds and rollouts derive their seeds from it. */
  seedBase: string;
  signal: AbortSignal;
  /** Yields the worker (MessageChannel), so forfeit/stop are handled mid-decision. */
  yieldNow(): Promise<void>;
  now(): number;
};

export type ServicesFactory = (worlds: readonly BeliefWorld[]) => TurnServices;
/** usage (addendum A1.1/A1.4): the training usage data, public and the same for both seats: belief priors for closed categories and candidate priors. */
export type PreviewContext = { runtime: BattleRuntime; ai: TrainingTeam; sheet: SheetView; info: InfoView; usage: TrainingUsageData };
export type TurnContext = { runtime: BattleRuntime; inputs: AiInputs; services: ServicesFactory; usage: TrainingUsageData };
export type SwitchContext = { runtime: BattleRuntime; inputs: AiInputs; services: ServicesFactory; slots: DoublesSlotId[]; midTurn: boolean; usage: TrainingUsageData };

export type SituationFeatures = { hp: "high" | "mid" | "low"; threatened: boolean; protectedLast: boolean };
export type ActionClass = "protect" | "switch" | "fake-out" | "attack-ko" | "attack-best" | "attack-spread" | "attack-other" | "speed-control" | "support" | "status-other";
export type TargetClass = "threat" | "weak" | "other";
/** Everything needed to classify any action of one of your slots at this decision. */
export type SlotContext = {
  speciesId: string;
  features: SituationFeatures;
  /** slotActionKey → class and target class, for every action of the slot the AI believes legal. */
  classes: Record<string, { cls: ActionClass; target: TargetClass | null }>;
  /** Addendum A1.5: the AI believes this slot can Mega Evolve now (habits learn your Mega timing from it). */
  canMega: boolean;
};
export type PlayerOption = { id: string; action: JointAction; label: string };
export type PlayerQuestion =
  | { kind: "turn"; turn: number; options: PlayerOption[]; slots: Partial<Record<DoublesSlotId, SlotContext>>; summary?: string }
  | { kind: "preview"; options: { id: string; leads: [string, string]; label: string }[]; summary?: string };
export type PlayerPrediction = { probabilities: Record<string, number>; weight: number };
/** observed: what the AI's log showed each of your slots do (never your choice string). opponent: the AI's own action. */
export type TurnRecord = {
  turn: number;
  question: Extract<PlayerQuestion, { kind: "turn" }>;
  observed: Partial<Record<DoublesSlotId, ObservedAction>>;
  /** Addendum A1.5: your slot the AI's log showed Mega Evolving this turn (a -mega reveal; shown even when it then could not move), else null. */
  observedMega: DoublesSlotId | null;
  opponent: JointAction;
};
/** At battle end: your leads and every member of yours the AI saw. */
export type BattleRecord = { leads: [string, string] | null; revealed: string[] };

export interface PlayerModel {
  readonly id: "habits" | "jev";
  predict(question: PlayerQuestion, signal: AbortSignal): Promise<PlayerPrediction | null>;
  observeTurn(record: TurnRecord): void;
  observeBattle(record: BattleRecord): void;
}
export interface TieBreaker {
  pick(question: { options: PlayerOption[]; summary?: string }, signal: AbortSignal): Promise<string | null>;
}

export type CellMethod = "engine" | "prelude" | "rollout" | "dropped";
/** Addendum A1.5: the turn's Mega decision, for evaluation and tuning. */
export type MegaStats = {
  /** The AI's active slots that could Mega Evolve this turn (engine orientation: opponent-left / opponent-right). */
  eligible: DoublesSlotId[];
  /** The slot the played action Mega Evolves, or null (kept). */
  chosen: DoublesSlotId | null;
  /** The purified strategy's chance on options with a Mega Evolution. */
  share: number;
  /**
   * The best kept Mega option minus the best kept non-Mega option, by term: this turn (matrix value, the prelude's types,
   * ability and Speed), the lasting value of the Mega form for the rest of the battle, and the option value of keeping it
   * (counted against Mega now).
   */
  terms: { thisTurn: number; lasting: number; keep: number };
};
export type DecisionStats = {
  options: { its: number; yours: number };
  /** Addendum A1.4: kept joint options with at least one status move. */
  statusOptions: { its: number; yours: number };
  byMethod: Record<CellMethod, number>;
  engineCalls: number; rolloutSamples: number; preludes: number; builds: number;
  beliefMs: number; elapsedMs: number; valveFired: boolean;
  /** max_a (M y*)_a − min_b (x*ᵀ M)_b over the matrix spread. */
  exploitability: number;
  approximations: string[];
  /** Addendum A1.5: null when the AI had no Mega Evolution available this turn. */
  mega: MegaStats | null;
};
export type PreviewDecision = { order: number[]; report: DecisionReport };   // 1-based into ai.members, 4 entries, leads first
export type TurnDecision = { action: JointAction; report: DecisionReport; stats: DecisionStats; question: Extract<PlayerQuestion, { kind: "turn" }> };
export type SwitchDecision = { action: JointAction };

export interface DecisionProvider {
  readonly id: "engine" | "jev";
  teamPreview(context: PreviewContext, options: DecideOptions): Promise<PreviewDecision>;
  chooseTurn(context: TurnContext, options: DecideOptions): Promise<TurnDecision>;
  chooseReplacements(context: SwitchContext, options: DecideOptions): Promise<SwitchDecision>;
  observeTurn(record: TurnRecord): void;
  observeBattle(record: BattleRecord): void;
  habits(): HabitsRecord;
}
