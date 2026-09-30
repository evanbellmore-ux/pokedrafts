import { Generations, toID } from "@smogon/calc";
import type { BattleRuntime } from "./runtime";
import type { BattleBuild, ChampionsMove } from "./types";

/**
 * How many hits one use of a move can have, shared by the calculation and the hit-count
 * editor.
 * - "fixed": the count is known (single-hit moves, fixed multi-hit moves, Skill Link).
 * - "choose" with `defaultHits: null`: a 2–5 hit move, or Population Bomb with Loaded Dice;
 *   the user must pick a count.
 * - "choose" with `defaultHits`: a move that checks accuracy again for each hit after the
 *   first and stops at the first miss (pinned Showdown `multiaccuracy`: Triple Kick, Triple
 *   Axel, Population Bomb; sim/battle-actions.ts hitStepMoveHitLoop). Every hit landing is
 *   the default, and fewer hits can be chosen.
 */
/** Battle state that switches Loaded Dice or Skill Link off. */
export type HitCountBattle = { magicRoom?: boolean; opponentAbilityId?: string };

export type HitCountRule =
  | { kind: "fixed"; hits: number; reason: string | null }
  | { kind: "choose"; min: number; max: number; defaultHits: number | null; perHitAccuracy: boolean; loadedDice: boolean };

/** Whether the engine's move data marks the move as checking accuracy for every hit. */
export function checksAccuracyPerHit(move: ChampionsMove, runtime: BattleRuntime): boolean {
  return typeof move.multihit === "number" && move.multihit > 1
    && !!Generations.get(runtime.profile.generation).moves.get(toID(move.name))?.multiaccuracy;
}

export function hitCountRule(move: ChampionsMove, build: Pick<BattleBuild, "abilityId" | "itemId">, runtime: BattleRuntime, battle: HitCountBattle = {}): HitCountRule {
  // Showdown ignores a held item under Magic Room or Klutz (sim/pokemon.ts ignoringItem), and an
  // opposing Neutralizing Gas suppresses the ability unless an active Ability Shield protects it
  // (the engines' Neutralizing Gas handling matches). A suppressed effect counts as absent.
  const itemActive = !battle.magicRoom && build.abilityId !== "klutz";
  const loadedDiceHeld = itemActive && build.itemId === "loadeddice";
  const skillLink = build.abilityId === "skilllink"
    && !(battle.opponentAbilityId === "neutralizinggas" && !(itemActive && build.itemId === "abilityshield"));
  if (Array.isArray(move.multihit)) {
    const [minimum, maximum] = move.multihit;
    if (skillLink) return { kind: "fixed", hits: maximum, reason: `Skill Link fixes this move at ${maximum} hits.` };
    const loadedDice = loadedDiceHeld && minimum === 2 && maximum === 5;
    return { kind: "choose", min: loadedDice ? 4 : minimum, max: maximum, defaultHits: null, perHitAccuracy: false, loadedDice };
  }
  const hits = move.multihit ?? 1;
  if (!checksAccuracyPerHit(move, runtime)) return { kind: "fixed", hits, reason: null };
  // Skill Link and Loaded Dice delete `multiaccuracy` (data/abilities.ts, data/items.ts), so
  // only the first hit checks accuracy. Loaded Dice also makes a 10-hit move hit 4–10 times
  // at random (battle-actions.ts hitStepMoveHitLoop: targetHits -= random(7)).
  // The Loaded Dice 10-hit roll applies with or without Skill Link.
  if (loadedDiceHeld && hits === 10) return { kind: "choose", min: 4, max: 10, defaultHits: null, perHitAccuracy: false, loadedDice: true };
  if (skillLink) return { kind: "fixed", hits, reason: `Skill Link checks accuracy once, so all ${hits} hits land.` };
  if (loadedDiceHeld) return { kind: "fixed", hits, reason: `Loaded Dice checks accuracy once, so all ${hits} hits land.` };
  return { kind: "choose", min: 1, max: hits, defaultHits: hits, perHitAccuracy: true, loadedDice: false };
}
