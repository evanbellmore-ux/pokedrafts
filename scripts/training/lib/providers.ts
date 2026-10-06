// Seat factories for the Training evaluation: the engine provider at either difficulty and Mega policy (A1.5), the
// ai/baselines.ts providers (RandomLegal, MaxDamage, HabitBot), and VAL's own random seat.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { HabitsRecord, MegaPolicy } from "@/app/(app)/training/model/decision";
import type { TrainingDifficulty } from "@/app/(app)/training/model/view-types";
import { createHabitBotProvider, createMaxDamageProvider, createRandomLegalProvider } from "@/app/(app)/training/ai/baselines";
import { createEngineProvider } from "@/app/(app)/training/ai/engine-provider";
import { createRandomSeat } from "./random-provider";
import type { Seat } from "./match";

export const SEAT_NAMES = ["safe", "reads", "safe-first", "reads-first", "random", "maxdamage", "habitbot", "val-random"] as const;
export type SeatName = (typeof SEAT_NAMES)[number];
export function isSeatName(name: string): name is SeatName { return (SEAT_NAMES as readonly string[]).includes(name); }

/** Kept for the scripts' start-up order; every factory is a static import. */
export async function ensureSeats(names: readonly string[]): Promise<void> {
  for (const name of names) if (!isSeatName(name)) throw new Error(`Unknown seat ${name} (${SEAT_NAMES.join(", ")}).`);
}

/** A fresh seat; `habits` is the record the previous battle of this shard left (habits carry over, SPEC §14.2). */
export function createSeat(name: SeatName, runtime: BattleRuntime, habits: HabitsRecord | null): Seat {
  const engine = (difficulty: TrainingDifficulty, megaPolicy: MegaPolicy): Seat => ({ provider: createEngineProvider({ runtime, habits, megaPolicy }), difficulty });
  switch (name) {
    case "safe": return engine("safe", "per-turn");
    case "reads": return engine("reads", "per-turn");
    case "safe-first": return engine("safe", "first-chance");
    case "reads-first": return engine("reads", "first-chance");
    case "random": return { provider: createRandomLegalProvider({ runtime }), difficulty: "safe" };
    case "maxdamage": return { provider: createMaxDamageProvider({ runtime }), difficulty: "safe" };
    case "habitbot": return { provider: createHabitBotProvider({ runtime }), difficulty: "safe" };
    case "val-random": return { provider: createRandomSeat(), difficulty: "safe" };
  }
}
