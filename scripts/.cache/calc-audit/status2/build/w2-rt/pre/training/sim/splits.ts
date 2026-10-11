// Exact weighted mixtures of engine inputs for public random events at the start of a move (SPEC §9.4 "Splits"). None is
// left: sleep and freeze are the engine's own BeforeMove (status-eot SPEC §4.2: carried.sleep and carried.freeze from the
// public counts, sim/bridge.ts), and so is the stall roll of a protecting move in a row (status2 T2, ADDENDUM2 §6:
// carried.stall from the public streak; the engine's guards roll 1/counter after the whole BeforeMove, T2E §4.8.1), so
// splitWorlds is the identity, kept for its callers. wakeChance and thawChance stay as Champions' rates (conformance, tests).
import type { DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { MonKey } from "../model/ai-view";
import type { PublicMon } from "../model/public-state";

export type SplitWorld = { weight: number; input: DoublesTurnInput; notes: string[] };
export type SplitResult = { kind: "worlds"; worlds: SplitWorld[] } | { kind: "rollout"; reasons: string[] };

const third = 1 / 3;
/** P(wakes at this attempt | still asleep after `elapsed` attempts); Early Bird counts 2 per attempt. */
export function wakeChance(elapsed: number, earlyBird: boolean): number {
  if (earlyBird) return elapsed <= 0 ? third : 1;
  return elapsed <= 0 ? 0 : elapsed === 1 ? third : 1;
}
/** P(thaws at this attempt): a defrost move or the third attempt always; else 1/4. */
export function thawChance(elapsed: number, defrost: boolean): number {
  return defrost || elapsed + 1 >= 3 ? 1 : 0.25;
}

/** The one world of `base` (status2 T2: the Protect fork is the engine's stall roll now). */
export function splitWorlds(base: DoublesTurnInput, ctx: { runtime: BattleRuntime; slotKeys: Record<DoublesSlotId, MonKey | null>; publicOf: (key: MonKey) => PublicMon | null }): SplitResult {
  void ctx;
  return { kind: "worlds", worlds: [{ weight: 1, input: base, notes: [] }] };
}
