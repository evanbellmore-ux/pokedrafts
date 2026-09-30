import { getBuildHealth as getEffectiveHealth } from "@/app/lib/battle/health";
import { specialTeraForm } from "@/app/lib/battle/mechanics";
import { validateBuild } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, MoveDamageResult } from "@/app/lib/battle/types";

export type BuildHealth = { current: number; maximum: number };
export type DamageRollMode = "low" | "average" | "high";
export type HPPreview =
  | { status: "ready"; min: number; max: number; current: number; maximum: number; damage: number; remaining: number;
    /** The same roll in the result's alternate outcome (Fickle Beam's doubled power, a Shell Side Arm tie's physical hit). */
    alternate?: { chance: number; label: string; damage: number; remaining: number } }
  | { status: "unavailable"; reason: string };

export function getBuildHealth(build: BattleBuild, runtime: BattleRuntime = championsRuntime): BuildHealth | null {
  if (validateBuild(build, runtime).length) return null;
  const health = getEffectiveHealth(build, runtime);
  if (!health || health.reason) return null;
  const { current, max: maximum } = health;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(current) || current < 1 || current > maximum) return null;
  return { current, maximum };
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

/** Preview one current result without changing the build or simulating survival effects. */
export function previewRemainingHP(defender: BattleBuild, row: MoveDamageResult | undefined, mode: DamageRollMode = "average", runtime: BattleRuntime = championsRuntime): HPPreview {
  const health = getBuildHealth(defender, runtime);
  if (!health) return { status: "unavailable", reason: getEffectiveHealth(defender, runtime)?.reason ?? "Enter a valid defender build and current HP to preview remaining HP." };
  if (!row) return { status: "unavailable", reason: "A current damage result is required to preview remaining HP." };
  if (row.kind !== "calculated") {
    const reason = row.kind === "status" ? "Status moves do not have a direct-damage HP preview."
      : row.kind === "needs-context" ? "This move needs more battle context before HP can be previewed."
        : "This move's damage is unsupported; remaining HP is unavailable.";
    return { status: "unavailable", reason: row.reason ?? reason };
  }
  const { min, max, rolls } = row;
  if (!isDamage(min) || !isDamage(max) || max < min) {
    return { status: "unavailable", reason: "The damage range is unavailable or invalid." };
  }
  if (!hasUsableRolls(rolls, min, max)) {
    return { status: "unavailable", reason: "A complete flat damage distribution is required for an HP preview." };
  }
  // Proven zero cannot trigger survival effects, even on a multi-hit move.
  if (max === 0) return { status: "ready", ...health, min: health.current, max: health.current, damage: 0, remaining: health.current };
  // False Swipe and Hold Back leave 1 HP before any survival effect could act, so none withholds.
  const floor = row.leavesOneHP ? 1 : 0;
  // The calculation's settled target (a Sturdy copied by Trace or Imposter), or the shown selections.
  const survival = floor ? null : row.survival ?? (defender.itemId === "focussash" ? "Focus Sash"
    : defender.itemId === "focusband" ? "Focus Band"
      : (() => { const form = specialTeraForm(defender, runtime); return form ? runtime.speciesById.get(form)?.abilities[0] : defender.abilityId; })() === "sturdy" ? "Sturdy" : null);
  if (survival) {
    return { status: "unavailable", reason: `Remaining HP is withheld for ${survival}; survival effects are not simulated.` };
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
