import { getBuildHealth as getEffectiveHealth } from "@/app/lib/battle/health";
import { specialTeraForm } from "@/app/lib/battle/mechanics";
import { validateBuild } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { AfterUse, AfterUsePath, BattleBuild, MoveDamageResult, SettledHP } from "@/app/lib/battle/types";

export type BuildHealth = { current: number; maximum: number };
export type DamageRollMode = "low" | "average" | "high";
export type HPPreview =
  | { status: "ready";
    /** The least and the most HP left. */
    min: number; max: number;
    /** The HP when the move starts (after any berry eaten before it), and the maximum. */
    current: number; maximum: number;
    /**
     * The damage the selected roll's hits deal: the HP they take off, with any HP the target regains during them
     * added back. Null when it is not known (an average over sequences that can heal).
     */
    damage: number | null;
    remaining: number;
    /** The same roll in the result's alternate outcome (Fickle Beam's doubled power, a Shell Side Arm tie's physical hit). */
    alternate?: { chance: number; label: string; damage: number; remaining: number };
    /** HP the target regains during or right after the hits: on the selected roll's path, or that can occur (AfterUse heals). */
    heals?: string[] }
  | { status: "unavailable"; reason: string };

export function getBuildHealth(build: BattleBuild, runtime: BattleRuntime = championsRuntime): BuildHealth | null {
  if (validateBuild(build, runtime).length) return null;
  const health = getEffectiveHealth(build, runtime);
  if (!health || health.reason) return null;
  const { current, max: maximum } = health;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(current) || current < 1 || current > maximum) return null;
  return { current, maximum };
}

/**
 * The HP a side starts the move with after the item it ate or drank before the move (MatchupResult
 * settledHP), in the HP the bar shows (Dynamax HP for a Dynamaxed side). Null without one, or when it is for
 * another entered HP or maximum (a result calculated before the HP was edited).
 */
export function getSettledHealth(build: BattleBuild, settled: SettledHP | undefined, runtime: BattleRuntime = championsRuntime): BuildHealth | null {
  if (!settled) return null;
  const entered = getEffectiveHealth(build, runtime);
  if (!entered || entered.reason || settled.entered !== entered.baseCurrent || settled.maxHP !== entered.baseMax) return null;
  if (!Number.isSafeInteger(settled.hp) || settled.hp < 1 || settled.hp > settled.maxHP || settled.hp === settled.entered) return null;
  return getBuildHealth({ ...build, currentHP: settled.hp }, runtime);
}

/** "Sitrus Berry: 60 → 105 HP", in the HP as entered. */
export function settledText(settled: SettledHP) {
  return `${settled.item}: ${settled.entered} → ${settled.hp} HP`;
}

function isDamage(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasUsableRolls(rolls: MoveDamageResult["rolls"], min: number, max: number): rolls is number | number[] {
  if (typeof rolls === "number") return isDamage(rolls) && rolls === min && rolls === max;
  if (!Array.isArray(rolls) || rolls.length !== 16) return false;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const roll of rolls) {
    if (!isDamage(roll)) return false;
    lowest = Math.min(lowest, roll);
    highest = Math.max(highest, roll);
  }
  return lowest === min && highest === max;
}

const isFacts = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** The row's one use from `start` HP (types.ts AfterUse), when it is for that HP and every value is in range. */
function usableAfterUse(afterUse: AfterUse | undefined, start: number, maximum: number): AfterUse | null {
  if (!afterUse || afterUse.start !== start) return null;
  const { low, high, average, min, max, koChance, heals } = afterUse;
  const inRange = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  if (![low, high, min, max].every(inRange) || min > max || [low, high].some((value) => value < min || value > max)) return null;
  if (!Number.isFinite(average) || average < min || average > max) return null;
  if (!Number.isFinite(koChance) || koChance < 0 || koChance > 1) return null;
  return isFacts(heals) ? afterUse : null;
}

/** The low or high roll's path (AfterUse paths), when its damage dealt is a whole HP and its healing facts are text. */
function usablePath(afterUse: AfterUse, mode: DamageRollMode): AfterUsePath | null {
  const path = mode === "average" ? undefined : afterUse.paths?.[mode];
  return path && isDamage(path.dealt) && isFacts(path.heals) ? path : null;
}

/**
 * Preview one current result without changing the build. `settled` is the target's HP when the move starts
 * after an item it ate or drank before the move (MatchupResult settledHP.defender).
 */
export function previewRemainingHP(defender: BattleBuild, row: MoveDamageResult | undefined, mode: DamageRollMode = "average", runtime: BattleRuntime = championsRuntime, settled?: SettledHP): HPPreview {
  const entered = getBuildHealth(defender, runtime);
  if (!entered) return { status: "unavailable", reason: getEffectiveHealth(defender, runtime)?.reason ?? "Remaining HP needs a valid target build and current HP." };
  const settledHealth = getSettledHealth(defender, settled, runtime);
  const health = settledHealth ?? entered;
  // A settled HP for another entered HP marks a result calculated before the HP was edited: its one-use outcome
  // is for that start, which the new entry can equal (the HP typed in is the old healed HP).
  const stale = !!settled && !settledHealth;
  if (!row) return { status: "unavailable", reason: "A current damage result is required to preview remaining HP." };
  if (row.kind !== "calculated") {
    const reason = row.kind === "status" ? "Status moves do not have a direct-damage HP preview."
      : row.kind === "needs-context" ? "This move needs more battle context before HP can be previewed."
        : "This move's damage is unsupported; remaining HP is unavailable.";
    return { status: "unavailable", reason: row.reason ?? reason };
  }
  // The use's exact outcome walks every hit, survival effect and berry. A row with an alternate outcome
  // keeps the per-case preview below, as AfterUse does not separate the two cases.
  const use = row.alternate || stale ? null : usableAfterUse(row.afterUse, health.current, health.maximum);
  if (use) {
    // The average rounds the HP taken off, so a half rounds the damage up as the per-roll preview below does.
    const remaining = mode === "low" ? use.low : mode === "high" ? use.high : use.start - Math.round(use.start - use.average);
    // The damage is the damage dealt: the HP when the move starts minus the HP left, plus the HP regained during
    // the hits. The low and high rolls are one sequence each (AfterUse paths), with that sequence's healing; the
    // average lists the healing that can occur, not what a sequence regains, so with any listed it is not known.
    const path = usablePath(use, mode);
    const heals = path ? path.heals : use.heals;
    const damage = path ? path.dealt : use.heals.length ? null : use.start - remaining;
    return {
      status: "ready", current: use.start, maximum: health.maximum, min: use.min, max: use.max, damage, remaining,
      ...(heals.length ? { heals: [...heals] } : {}),
    };
  }
  const { min, max, rolls } = row;
  if (!isDamage(min) || !isDamage(max) || max < min) {
    return { status: "unavailable", reason: "The damage range is unavailable or invalid." };
  }
  // False Swipe and Hold Back leave 1 HP before any survival effect could act, so none withholds.
  const floor = row.leavesOneHP ? 1 : 0;
  // The calculation's settled target (a Sturdy copied by Trace or Imposter), or the shown selections.
  const survival = floor ? null : row.survival ?? (defender.itemId === "focussash" ? "Focus Sash"
    : defender.itemId === "focusband" ? "Focus Band"
      : (() => { const form = specialTeraForm(defender, runtime); return form ? runtime.speciesById.get(form)?.abilities[0] : defender.abilityId; })() === "sturdy" ? "Sturdy" : null);
  if (!hasUsableRolls(rolls, min, max)) {
    return { status: "unavailable", reason: survival && max > 0 ? `Remaining HP is withheld for ${survival}.` : "A complete flat damage distribution is required for an HP preview." };
  }
  // Proven zero cannot trigger survival effects, even on a multi-hit move.
  if (max === 0) return { status: "ready", ...health, min: health.current, max: health.current, damage: 0, remaining: health.current };
  if (survival) {
    return { status: "unavailable", reason: `Remaining HP is withheld for ${survival}.` };
  }
  if (row.hits !== 1) {
    return { status: "unavailable", reason: "Multi-hit or unresolved hit counts do not have an HP preview." };
  }
  if (row.ohkoChance === null || !Number.isFinite(row.ohkoChance) || row.ohkoChance < 0 || row.ohkoChance > 1) {
    return { status: "unavailable", reason: "Remaining HP is unavailable when single-hit KO rules are unresolved." };
  }
  // Each entry has equal weight, including duplicates. Round damage once, before subtraction.
  const damage = mode === "low" ? min : mode === "high" ? max
    : typeof rolls === "number" ? rolls : Math.round(rolls.reduce((sum, roll) => sum + roll / rolls.length, 0));
  if (!isDamage(damage) || damage < min || damage > max) {
    return { status: "unavailable", reason: "The selected damage roll is unavailable or invalid." };
  }
  return {
    status: "ready", ...health,
    min: Math.max(floor, health.current - max),
    max: Math.max(floor, health.current - min),
    damage, remaining: Math.max(floor, health.current - damage),
    ...(row.alternate ? { alternate: alternatePreview(row.alternate, mode, health.current, floor) } : {}),
  };
}

function alternatePreview(alternate: NonNullable<MoveDamageResult["alternate"]>, mode: DamageRollMode, current: number, floor: number) {
  const { rolls } = alternate;
  const damage = mode === "low" ? alternate.min : mode === "high" ? alternate.max : Math.round(rolls.reduce((sum, roll) => sum + roll / rolls.length, 0));
  return { chance: alternate.chance, label: alternate.label, damage, remaining: Math.max(floor, current - damage) };
}
