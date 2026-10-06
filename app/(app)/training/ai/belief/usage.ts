// Addendum A1.1/A1.4: the usage rows a sheet member's sets come from. Smogon's Champions statistics keep each Mega form apart
// (a "Charizard-Mega-Y" row whose item is its stone and whose ability is the Mega's), so a base species' sets are its own
// row plus one row per Mega form it can hold the stone of; a Mega form sheet entry reads its own row.
import { getMegaOptions } from "@/app/lib/battle/mega-forms";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { SpeciesUsage, SpeciesUsageLookup, TrainingUsageData } from "../../model/usage";
import { speciesUsage } from "../../usage/species-usage";
import { outOfBattleForm } from "../battle-facts";

/** Each row's sets with the stone (Mega rows) and its share among the member's rows. */
export type UsageRow = { row: SpeciesUsage; share: number; stone: string | null };
export type UsageSource = {
  rows: UsageRow[];
  /** The base form's row: the set's own ability (a Mega row's ability is the Mega form's). */
  abilities: SpeciesUsage["abilities"] | null;
};
export type UsageOptions = { usage: TrainingUsageData | null; lookup?: SpeciesUsageLookup };

/** A row's size: the importer's `sets` (the species' summed ability weight); a row without a positive one counts once. */
function rowSize(row: SpeciesUsage): number {
  const sets: unknown = row.sets;
  return typeof sets === "number" && Number.isFinite(sets) && sets > 0 ? sets : 1;
}

/** The usage rows for one sheet species, shares summing to 1; empty without usage data or rows. */
export function usageSource(speciesId: string, options: UsageOptions, runtime: BattleRuntime): UsageSource {
  const { usage } = options;
  if (!usage) return { rows: [], abilities: null };
  const lookup = options.lookup ?? speciesUsage;
  const base = outOfBattleForm(speciesId, runtime);
  const entries: { row: SpeciesUsage; stone: string | null }[] = [];
  if (base.stone) {
    const own = lookup(usage, speciesId, runtime);
    if (own) entries.push({ row: own, stone: base.stone });
  } else {
    const own = lookup(usage, speciesId, runtime);
    if (own) entries.push({ row: own, stone: null });
    for (const option of getMegaOptions(speciesId, runtime)) {
      if (option.baseSpeciesId !== speciesId) continue;
      const mega = lookup(usage, option.formId, runtime);
      if (mega) entries.push({ row: mega, stone: option.itemId });
    }
  }
  const total = entries.reduce((sum, entry) => sum + rowSize(entry.row), 0);
  const baseRow = lookup(usage, base.speciesId, runtime);
  return {
    rows: entries.map((entry) => ({ row: entry.row, stone: entry.stone, share: total > 0 ? rowSize(entry.row) / total : 0 })),
    abilities: baseRow?.abilities ?? null,
  };
}

/** Move weights over the member's rows (share-weighted), heaviest first, ids breaking ties. */
export function usageMoveWeights(source: UsageSource): { id: string; weight: number }[] {
  const weights = new Map<string, number>();
  for (const { row, share } of source.rows) for (const move of row.moves) weights.set(move.id, (weights.get(move.id) ?? 0) + share * move.weight);
  return [...weights].map(([id, weight]) => ({ id, weight })).sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
