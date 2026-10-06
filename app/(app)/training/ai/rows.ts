// SPEC 10.2 damage rows and worth: every known living Pokémon's damaging moves into every known living foe, at the decision's
// start (calculateTurnMove, the 1v1 row of a doubles hit). The player's builds are belief world 0's (AiView.mons).
import { calculateTurnMove } from "@/app/lib/battle/calculate";
import type { DoublesSideId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveDamageResult } from "@/app/lib/battle/types";
import type { AiView, MonKey, MonView } from "../model/ai-view";
import { effectiveAccuracy } from "./accuracy";
import { DEFAULT_WEIGHTS, type Weights } from "./value-weights";

export type DamageRow = { attacker: MonKey; target: MonKey; moveId: string; min: number; max: number; mean: number; koChance: number; fraction: number };
export type RowTable = { get(attacker: MonKey, target: MonKey, moveId: string): DamageRow | null; best(attacker: MonKey, target: MonKey): DamageRow | null };

/** Dex target types that hit both foes, and the ally too (allAdjacent: Earthquake), PS/sim/pokemon.ts getMoveTargets. */
export const SPREAD_TARGETS: ReadonlySet<string> = new Set(["allAdjacentFoes", "allAdjacent"]);

/** The build a calculation reads: its HP as currentHP (null at full). */
export function calcBuild(mon: MonView): BattleBuild {
  return { ...mon.build, currentHP: mon.hp >= mon.maxHp ? null : Math.max(1, mon.hp) };
}
const living = (mon: MonView) => !mon.fainted && mon.hp > 0;
const actives = (view: AiView, side: DoublesSideId) => view.mons.filter((mon) => mon.side === side && mon.slot !== null && living(mon));

/**
 * The field oriented to the attacker (AiView.field: attackerSide = own, the player): the attacker's side flags as
 * attackerSide; Friend Guard when the target's active partner has it; multipleTargets for a spread move with two foes in.
 */
export function conditionsFor(view: AiView, attacker: MonView, target: MonView, spread: boolean): BattleConditions {
  const field = view.field;
  const sides = attacker.side === "own" ? { attackerSide: field.attackerSide, defenderSide: field.defenderSide } : { attackerSide: field.defenderSide, defenderSide: field.attackerSide };
  const partner = view.mons.find((mon) => mon.side === target.side && mon.key !== target.key && mon.slot !== null && living(mon));
  const friendGuard = target.slot !== null && partner?.build.abilityId === "friendguard";
  return {
    ...field, gameType: "Doubles", multipleTargets: spread,
    attackerSide: { ...sides.attackerSide, helpingHand: false, protect: false },
    defenderSide: { ...sides.defenderSide, helpingHand: false, protect: false, friendGuard },
  };
}

/** Mean damage of one use of a row (fixed or chosen hits summed; a random count weighted by its hitChances). */
export function rowMean(row: MoveDamageResult): number {
  const rolls = row.rolls;
  if (rolls === null) return row.min !== null && row.max !== null ? (row.min + row.max) / 2 : 0;
  if (typeof rolls === "number") return rolls;
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  if (!rolls.length) return 0;
  if (typeof rolls[0] === "number") return mean(rolls as number[]);
  const perHit = (rolls as number[][]).map(mean);
  if (row.hitChances?.length) return row.hitChances.reduce((sum, entry) => sum + entry.chance * perHit.slice(0, entry.hits).reduce((a, b) => a + b, 0), 0);
  return perHit.reduce((a, b) => a + b, 0);
}
/** KO chance of one use from the target's HP: afterUse when exact, else the share of single-hit rolls at least the HP, else ohkoChance. */
export function rowKO(row: MoveDamageResult, hp: number): number {
  if (row.afterUse) return row.afterUse.koChance;
  const rolls = row.rolls;
  if (Array.isArray(rolls) && rolls.length && typeof rolls[0] === "number") return (rolls as number[]).filter((roll) => roll >= hp).length / rolls.length;
  if (typeof rolls === "number") return rolls >= hp ? 1 : 0;
  return row.ohkoChance ?? 0;
}

/** One row (null when not a calculated hit). */
export function damageRow(view: AiView, attacker: MonView, target: MonView, moveId: string, runtime: BattleRuntime, attackerBuild = calcBuild(attacker), targetBuild = calcBuild(target)): DamageRow | null {
  const move = runtime.movesById.get(moveId);
  if (!move || move.category === "Status") return null;
  const spread = SPREAD_TARGETS.has(move.target) && actives(view, target.side).length > 1;
  let row: MoveDamageResult;
  try {
    row = calculateTurnMove(move, attackerBuild, targetBuild, conditionsFor(view, attacker, target, spread), undefined, runtime);
  } catch {
    return null;
  }
  if (row.kind !== "calculated" || row.min === null || row.max === null) return null;
  const mean = rowMean(row);
  const hp = Math.max(1, target.hp);
  return { attacker: attacker.key, target: target.key, moveId, min: row.min, max: row.max, mean, koChance: rowKO(row, hp), fraction: Math.min(1, mean / hp) };
}

/**
 * Rows for each known living Pokémon (actives and bench) and each damaging move of its (believed) set into each known living
 * foe, and, for an allAdjacent move of an active, into its active partner (the spread's own side). Calculated lazily, once.
 */
export function damageRows(view: AiView, runtime: BattleRuntime): RowTable {
  const byKey = new Map(view.mons.map((mon) => [mon.key, mon]));
  const memo = new Map<string, DamageRow | null>();
  const get = (attacker: MonKey, target: MonKey, moveId: string): DamageRow | null => {
    const key = `${attacker}>${target}>${moveId}`;
    if (memo.has(key)) return memo.get(key)!;
    const a = byKey.get(attacker), t = byKey.get(target);
    let row: DamageRow | null = null;
    if (a && t && living(a) && living(t) && a.key !== t.key && a.moves.includes(moveId)) {
      const move = runtime.movesById.get(moveId);
      const allyHit = a.side === t.side && move?.target === "allAdjacent" && a.slot !== null && t.slot !== null;
      if (a.side !== t.side || allyHit) row = damageRow(view, a, t, moveId, runtime);
    }
    memo.set(key, row);
    return row;
  };
  const bestMemo = new Map<string, DamageRow | null>();
  const best = (attacker: MonKey, target: MonKey): DamageRow | null => {
    const key = `${attacker}>${target}`;
    if (bestMemo.has(key)) return bestMemo.get(key)!;
    const a = byKey.get(attacker);
    let top: DamageRow | null = null, score = -1;
    for (const moveId of a?.moves ?? []) {
      const row = get(attacker, target, moveId);
      if (!row) continue;
      const value = row.fraction * effectiveAccuracy(view, attacker, moveId, target, runtime);
      if (value > score) { top = row; score = value; }
    }
    bestMemo.set(key, top);
    return top;
  };
  return { get, best };
}

/** Known living foes of a Pokémon. */
export function foesOfMon(view: AiView, mon: MonView): MonView[] {
  return view.mons.filter((other) => other.side !== mon.side && living(other));
}

/**
 * Worth (SPEC 10.2): off = max over living known foes of the best row's fraction × accuracy; bulk = 1 − max over them of their
 * best fraction into it; worth = clamp(worthBase + worthOffense·off + worthBulk·bulk, worthMin, worthMax). Unseen members are
 * scored at unknownWorth by the value function.
 */
export function worthOf(view: AiView, rows: RowTable, runtime?: BattleRuntime, weights: Pick<Weights, "worthBase" | "worthOffense" | "worthBulk" | "worthMin" | "worthMax"> = DEFAULT_WEIGHTS): Record<MonKey, number> {
  const out: Record<MonKey, number> = {};
  for (const mon of view.mons) {
    if (!living(mon)) { out[mon.key] = weights.worthMin; continue; }
    let off = 0, threat = 0;
    for (const foe of foesOfMon(view, mon)) {
      const mine = rows.best(mon.key, foe.key);
      if (mine) off = Math.max(off, mine.fraction * (runtime ? effectiveAccuracy(view, mon.key, mine.moveId, foe.key, runtime) : 1));
      const theirs = rows.best(foe.key, mon.key);
      if (theirs) threat = Math.max(threat, theirs.fraction);
    }
    out[mon.key] = Math.max(weights.worthMin, Math.min(weights.worthMax, weights.worthBase + weights.worthOffense * off + weights.worthBulk * (1 - threat)));
  }
  return out;
}

/** κ of the damage prior (SPEC 10.4): the KO chance's share against the HP fraction. */
export const KAPPA = 0.35;
/** The threat one attacker poses to one target: its best move's acc × ((1−κ)·fraction + κ·koChance). */
export function threatOf(view: AiView, rows: RowTable, attacker: MonKey, target: MonKey, runtime?: BattleRuntime): number {
  const a = view.mons.find((mon) => mon.key === attacker);
  let best = 0;
  for (const moveId of a?.moves ?? []) {
    const row = rows.get(attacker, target, moveId);
    if (!row) continue;
    const acc = runtime ? effectiveAccuracy(view, attacker, moveId, target, runtime) : 1;
    best = Math.max(best, acc * ((1 - KAPPA) * row.fraction + KAPPA * row.koChance));
  }
  return best;
}

/**
 * threatInto (SPEC 10.4 Protect and switch priors): worth of `target` × the sum, over its living active foes, of each one's
 * threat into it. A benched `target` reads its own rows (as if in the slot).
 */
export function threatInto(view: AiView, rows: RowTable, worth: Record<MonKey, number>, target: MonKey, runtime?: BattleRuntime): number {
  const mon = view.mons.find((each) => each.key === target);
  if (!mon) return 0;
  const foes = actives(view, mon.side === "own" ? "opponent" : "own");
  return (worth[target] ?? 1) * foes.reduce((sum, foe) => sum + threatOf(view, rows, foe.key, target, runtime), 0);
}
/** The threat an attacker poses to the other side's actives, each weighed by its worth (SPEC 10.4 Fake Out prior). */
export function threatFrom(view: AiView, rows: RowTable, worth: Record<MonKey, number>, attacker: MonKey, runtime?: BattleRuntime): number {
  const mon = view.mons.find((each) => each.key === attacker);
  if (!mon) return 0;
  return actives(view, mon.side === "own" ? "opponent" : "own").reduce((sum, foe) => sum + (worth[foe.key] ?? 1) * threatOf(view, rows, attacker, foe.key, runtime), 0);
}
