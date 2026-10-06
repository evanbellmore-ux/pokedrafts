// SPEC 10.1.1 Abilities, when closed (addendum A1.4: usage first, the rule-based prior as the fallback).
import { usualAbility } from "@/app/lib/battle/move-defaults";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { SheetMember } from "../../model/sheet";
import type { UsageSource } from "./usage";

export type Weighted = { id: string; weight: number };
/** The usage share of an ability prior; the rest keeps the rule-based prior, so a rare ability is never impossible. */
const USAGE_SHARE = 0.9;

/** usualAbility(speciesId, "Doubles") 0.7; the species' other catalog abilities share 0.3 (SPEC 10.1.1). */
export function ruleAbilities(speciesId: string, runtime: BattleRuntime): Weighted[] {
  const abilities = runtime.speciesById.get(speciesId)?.abilities ?? [];
  if (!abilities.length) return [{ id: "", weight: 1 }];
  const usual = usualAbility(speciesId, "Doubles", runtime) ?? abilities[0];
  const others = abilities.filter((id) => id !== usual);
  return others.length ? [{ id: usual, weight: 0.7 }, ...others.map((id) => ({ id, weight: 0.3 / others.length }))] : [{ id: usual, weight: 1 }];
}

/**
 * Open: the sheet's. Closed: the base form's usage abilities that the species has (A1.4) for 0.9 of the mass, the rule-based
 * prior for the rest; the rule-based prior alone without a usage row. Normalised, heaviest first.
 */
export function abilityPrior(member: SheetMember, source: UsageSource, runtime: BattleRuntime): Weighted[] {
  if (member.abilityId !== null) return [{ id: member.abilityId, weight: 1 }];
  const species = runtime.speciesById.get(member.speciesId);
  const rule = ruleAbilities(member.speciesId, runtime);
  const used = (source.abilities ?? []).filter((entry) => species?.abilities.includes(entry.id));
  const total = used.reduce((sum, entry) => sum + entry.weight, 0);
  const weights = new Map<string, number>();
  const usageShare = total > 0 ? USAGE_SHARE : 0;
  for (const entry of used) weights.set(entry.id, (weights.get(entry.id) ?? 0) + usageShare * entry.weight / total);
  for (const entry of rule) weights.set(entry.id, (weights.get(entry.id) ?? 0) + (1 - usageShare) * entry.weight);
  return [...weights].map(([id, weight]) => ({ id, weight })).sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1));
}
