// SPEC 10.1.2 soft likelihoods: speed order and damage, each floored at ε so a modelling gap never removes the truth.
import { calculateTurnMove, turnPriority, turnSpeed } from "@/app/lib/battle/calculate";
import { createConditions, getBuildStats } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveDamageResult } from "@/app/lib/battle/types";
import type { DamageObservation, ExactHP, HitSnapshot, OrderObservation, ShownHP, SpeedSnapshot } from "../../model/public-state";
import { bandMidpoint, hpBand, sameShown, shownHP, terrainOf, weatherOf } from "../battle-facts";

/** SPEC I4: every soft likelihood is (1 − ε)·P + ε. */
export const EPSILON = 0.05;
const floored = (p: number) => (1 - EPSILON) * Math.min(1, Math.max(0, p)) + EPSILON;

export const isShown = (hp: ShownHP | ExactHP): hp is ShownHP => "percent" in hp;

/** A build at a snapshot: its Speed or all stages, its status, and (for damage) its HP. */
export function atSpeedSnapshot(build: BattleBuild, snapshot: SpeedSnapshot): BattleBuild {
  return { ...build, boosts: { ...build.boosts, spe: snapshot.speStage }, status: snapshot.status };
}
export function atHitSnapshot(build: BattleBuild, snapshot: HitSnapshot, runtime: BattleRuntime): BattleBuild {
  const boosts = { atk: snapshot.boosts.atk, def: snapshot.boosts.def, spa: snapshot.boosts.spa, spd: snapshot.boosts.spd, spe: snapshot.boosts.spe };
  const maxhp = getBuildStats(build, runtime)?.hp ?? 0;
  const hp = isShown(snapshot.hp) ? bandMidpoint(snapshot.hp, maxhp) : snapshot.hp.hp;
  // An item the log showed gone before the hit no longer acts (a knocked-off Life Orb, an eaten resist Berry).
  return { ...build, boosts, status: snapshot.status, currentHP: hp >= maxhp ? null : Math.max(1, hp), ...(snapshot.itemGone ? { itemId: "" } : {}) };
}

function orderConditions(observation: OrderObservation): BattleConditions {
  return { ...createConditions(), gameType: "Doubles", weather: weatherOf(observation.weather), terrain: terrainOf(observation.terrain), trickRoom: observation.trickRoom };
}

/**
 * P(observed order) for one pair (SPEC 10.1.2 Speed order): priorities by turnPriority and action speeds by turnSpeed (Champions
 * negates under Trick Room: calculate.ts turnSpeed) for both, 1 when the order agrees (higher priority first, else higher
 * action speed first), 0.5 on a tie, else 0; floored. null when it cannot be read (an unknown move, a priority not known, or
 * Quick Claw: the pair is skipped).
 */
export function orderLikelihood(observation: OrderObservation, first: BattleBuild, second: BattleBuild, runtime: BattleRuntime): number | null {
  if (observation.first.quickClaw || observation.second.quickClaw) return null;
  const conditions = orderConditions(observation);
  const key = (build: BattleBuild, snapshot: SpeedSnapshot) => {
    const move = runtime.movesById.get(snapshot.moveId);
    if (!move) return null;
    const priority = turnPriority(move, build, conditions, undefined, runtime);
    if (typeof priority !== "number") return null;
    return { priority, speed: turnSpeed(build, snapshot.tailwind, conditions, runtime) };
  };
  const a = key(atSpeedSnapshot(first, observation.first), observation.first);
  const b = key(atSpeedSnapshot(second, observation.second), observation.second);
  if (!a || !b) return null;
  const p = a.priority !== b.priority ? (a.priority > b.priority ? 1 : 0) : a.speed !== b.speed ? (a.speed > b.speed ? 1 : 0) : 0.5;
  return floored(p);
}

function damageConditions(observation: DamageObservation): BattleConditions {
  const base = createConditions();
  return {
    ...base, gameType: "Doubles", weather: weatherOf(observation.weather), terrain: terrainOf(observation.terrain), critical: observation.crit,
    multipleTargets: observation.spread, gravity: observation.gravity, magicRoom: observation.magicRoom, wonderRoom: observation.wonderRoom,
    attackerSide: { ...base.attackerSide, helpingHand: observation.helpingHand },
    defenderSide: { ...base.defenderSide, reflect: observation.defenderScreens.reflect, lightScreen: observation.defenderScreens.lightScreen, auroraVeil: observation.defenderScreens.auroraVeil },
  };
}

/** A row's single-hit roll sets with their chances (the main case and an `alternate`), or null for multi-hit and other shapes. */
function rollSets(row: MoveDamageResult): { rolls: number[]; chance: number }[] | null {
  if (row.kind !== "calculated" || row.rolls === null || row.hitChances) return null;
  const flat = typeof row.rolls === "number" ? [row.rolls] : row.rolls;
  if (!flat.length || flat.some((roll) => typeof roll !== "number")) return null;
  const main = flat as number[];
  if (!row.alternate) return [{ rolls: main, chance: 1 }];
  return [{ rolls: main, chance: 1 - row.alternate.chance }, { rolls: row.alternate.rolls, chance: row.alternate.chance }];
}

export type DamageMemo = Map<string, { rolls: number[]; chance: number }[] | null>;
function rollsFor(observation: DamageObservation, attacker: BattleBuild, defender: BattleBuild, runtime: BattleRuntime, memo: DamageMemo) {
  const move = runtime.movesById.get(observation.moveId);
  if (!move || move.category === "Status") return null;
  const conditions = damageConditions(observation);
  const key = JSON.stringify([observation.moveId, attacker, defender, conditions]);
  if (memo.has(key)) return memo.get(key)!;
  let sets: { rolls: number[]; chance: number }[] | null;
  try {
    sets = rollSets(calculateTurnMove(move, attacker, defender, conditions, undefined, runtime));
  } catch {
    sets = null;
  }
  memo.set(key, sets);
  return sets;
}

/**
 * P(observed damage) for one hit between a player Pokémon (one candidate's build) and an AI Pokémon (exact), SPEC 10.1.2:
 * - the player attacks: the share of rolls equal to the exact HP lost, or at least the HP before when censored;
 * - the AI attacks: the mean, over the HP inside the shown band of `before` for the candidate's maximum HP, of the share of
 *   rolls that leave the shown `after` (or reach the HP when censored).
 * Builds are at the hit's snapshots (atHitSnapshot). null when the calculation is not a plain single-hit result (skipped).
 */
export function damageLikelihood(observation: DamageObservation, attacker: BattleBuild, defender: BattleBuild, runtime: BattleRuntime, memo: DamageMemo): number | null {
  const sets = rollsFor(observation, attacker, defender, runtime, memo);
  if (!sets) return null;
  const share = (test: (roll: number) => boolean) => sets.reduce((sum, set) => sum + set.chance * set.rolls.filter(test).length / set.rolls.length, 0);
  const before = observation.defender.hp, after = observation.after;
  if (!isShown(before)) {
    const lost = before.hp - (isShown(after) ? NaN : after.hp);
    return floored(observation.censored ? share((roll) => roll >= before.hp) : Number.isFinite(lost) ? share((roll) => roll === lost) : 0);
  }
  const maxhp = getBuildStats(defender, runtime)?.hp ?? 0;
  const band = hpBand(before, maxhp);
  if (!band.length) return null;
  let total = 0;
  for (const hp of band) {
    total += observation.censored ? share((roll) => roll >= hp)
      : share((roll) => isShown(after) ? sameShown(shownHP(hp - roll, maxhp), after) : hp - roll === after.hp);
  }
  return floored(total / band.length);
}
