import { Generations, toID } from "@smogon/calc";
import type { BattleRuntime } from "./runtime";
import type { BattleBuild, ChampionsMove } from "./types";

/**
 * How many hits one use of a move can have, shared by the calculation and the hit-count
 * editor.
 * - "fixed": the count is known (single-hit moves, fixed multi-hit moves, Skill Link).
 * - "choose" with `defaultHits: null`: a 2–5 hit move, or Population Bomb with Loaded Dice; the
 *   count is random, with `chances` (randomHitChances), unless one is chosen.
 * - "choose" with `defaultHits`: a move that checks accuracy again for each hit after the
 *   first and stops at the first miss (pinned Showdown `multiaccuracy`: Triple Kick, Triple
 *   Axel, Population Bomb; sim/battle-actions.ts hitStepMoveHitLoop). Every hit landing is
 *   the default, and fewer hits can be chosen.
 */
/** Battle state that switches Loaded Dice or Skill Link off. */
export type HitCountBattle = { magicRoom?: boolean; opponentAbilityId?: string };

/** One count of hits with its chance (0–1). */
export type HitChance = { hits: number; chance: number };

export type HitCountRule =
  | { kind: "fixed"; hits: number; reason: string | null }
  | {
    kind: "choose"; min: number; max: number; defaultHits: number | null; perHitAccuracy: boolean; loadedDice: boolean;
    /** Each count's chance when none is chosen, ascending by hits; set exactly when defaultHits is null. */
    chances: HitChance[] | null;
  };

/**
 * The chances of a random hit count (pinned Showdown sim/battle-actions.ts hitStepMoveHitLoop, gen 5 on,
 * which every supported game is): a 2–5 hit move samples [2 x7, 3 x7, 4 x3, 5 x3] out of 20, so 2 and 3
 * hits 35% each, 4 and 5 hits 15% each, and with Loaded Dice a 2 or 3 becomes 4 or 5 (`5 - random(2)`), so
 * 4 and 5 hits 50% each; any other [min, max] is random(min, max + 1), each count alike; a 10-hit move with
 * Loaded Dice hits `10 - random(7)` times, 4 to 10 at 1/7 each.
 */
export function randomHitChances(multihit: number | [number, number], loadedDice: boolean): HitChance[] {
  const range = (low: number, high: number, chance: (hits: number) => number) =>
    Array.from({ length: high - low + 1 }, (_, index) => ({ hits: low + index, chance: chance(low + index) }));
  if (!Array.isArray(multihit)) return multihit === 10 && loadedDice ? range(4, 10, () => 1 / 7) : [{ hits: multihit, chance: 1 }];
  const [minimum, maximum] = multihit;
  if (minimum === 2 && maximum === 5) return loadedDice ? range(4, 5, () => 1 / 2) : range(2, 5, (hits) => hits < 4 ? 7 / 20 : 3 / 20);
  return range(minimum, maximum, () => 1 / (maximum - minimum + 1));
}

/** Hit counts from `fewest` to `most` as the results state them: "5", "4 or 5", "2–5". */
export function hitCountsText(fewest: number, most: number): string {
  return fewest >= most ? `${most}` : most - fewest === 1 ? `${fewest} or ${most}` : `${fewest}–${most}`;
}

/** Whether the engine's move data marks the move as checking accuracy for every hit. */
export function checksAccuracyPerHit(move: ChampionsMove, runtime: BattleRuntime): boolean {
  return typeof move.multihit === "number" && move.multihit > 1
    && !!Generations.get(runtime.profile.generation).moves.get(toID(move.name))?.multiaccuracy;
}

export function hitCountRule(move: ChampionsMove, build: Pick<BattleBuild, "abilityId" | "itemId"> & Partial<Pick<BattleBuild, "speciesId" | "transformedFrom">>, runtime: BattleRuntime, battle: HitCountBattle = {}): HitCountRule {
  // Battle Bond makes Greninja-Ash's own Water Shuriken hit 3 times (pinned Showdown battlebond
  // onModifyMove; it cannot be suppressed, and a transformed copy keeps 2-5).
  if (move.id === "watershuriken" && build.speciesId === "greninjaash" && build.abilityId === "battlebond" && !build.transformedFrom) {
    return { kind: "fixed", hits: 3, reason: "Battle Bond: 3 hits." };
  }
  // Showdown ignores a held item under Magic Room or an active Klutz (sim/pokemon.ts hasItem ->
  // ignoringItem), and an opposing Neutralizing Gas suppresses an ability unless an active Ability
  // Shield protects it (ignoringAbility; the engines' Neutralizing Gas handling matches), Klutz
  // included. A suppressed effect counts as absent.
  const gas = battle.opponentAbilityId === "neutralizinggas";
  const klutz = build.abilityId === "klutz" && !(gas && build.itemId !== "abilityshield");
  const itemActive = !battle.magicRoom && !klutz;
  const loadedDiceHeld = itemActive && build.itemId === "loadeddice";
  const skillLink = build.abilityId === "skilllink" && !(gas && !(itemActive && build.itemId === "abilityshield"));
  if (Array.isArray(move.multihit)) {
    const [minimum, maximum] = move.multihit;
    if (skillLink) return { kind: "fixed", hits: maximum, reason: `Skill Link: ${maximum} hits.` };
    const loadedDice = loadedDiceHeld && minimum === 2 && maximum === 5;
    return { kind: "choose", min: loadedDice ? 4 : minimum, max: maximum, defaultHits: null, perHitAccuracy: false, loadedDice, chances: randomHitChances(move.multihit, loadedDice) };
  }
  const hits = move.multihit ?? 1;
  if (!checksAccuracyPerHit(move, runtime)) return { kind: "fixed", hits, reason: null };
  // Skill Link and Loaded Dice delete `multiaccuracy` (data/abilities.ts, data/items.ts), so
  // only the first hit checks accuracy. Loaded Dice also makes a 10-hit move hit 4–10 times
  // at random (battle-actions.ts hitStepMoveHitLoop: targetHits -= random(7)).
  // The Loaded Dice 10-hit roll applies with or without Skill Link.
  if (loadedDiceHeld && hits === 10) return { kind: "choose", min: 4, max: 10, defaultHits: null, perHitAccuracy: false, loadedDice: true, chances: randomHitChances(hits, true) };
  if (skillLink) return { kind: "fixed", hits, reason: `Skill Link: all ${hits} hits land.` };
  if (loadedDiceHeld) return { kind: "fixed", hits, reason: `Loaded Dice: all ${hits} hits land.` };
  return { kind: "choose", min: 1, max: hits, defaultHits: hits, perHitAccuracy: true, loadedDice: false, chances: null };
}
