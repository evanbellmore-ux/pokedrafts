// Addendum A1.1: which training usage row a catalog form reads, and the shape check the loader applies. No JSON import here,
// so tests and the AI can pass their own TrainingUsageData; usage/training-usage.ts is the one module that loads the file.
import { cosmeticFamily, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { SpeciesUsage, SpeciesUsageLookup, TrainingUsageData, UsageEntry, UsageSpread } from "../model/usage";

/**
 * move-defaults.ts USAGE_ROWS: Smogon's Champions usage has one Maushold row and no Maushold-Four row; Family of Four has the
 * same learnset, stats, types and abilities.
 */
const USAGE_ROWS: Readonly<Record<string, string>> = { mausholdfour: "maushold" };

/**
 * The row id a form reads, by move-usage's identity rules (move-defaults.ts usageRow): Smogon's statistics count cosmetic forms
 * under their family (Vivillon-Jungle reads Vivillon), Maushold-Four reads Maushold, every other form its own row.
 */
export function usageRowId(speciesId: string, runtime: BattleRuntime): string {
  return USAGE_ROWS[speciesId] ?? cosmeticFamily(runtime, speciesId)?.id ?? speciesId;
}

/** The usage row a form reads, or null when the archive has none for it (a Reg M-C newcomer). */
export const speciesUsage: SpeciesUsageLookup = (usage, speciesId, runtime) => {
  const row = usageRowId(speciesId, runtime);
  return Object.hasOwn(usage.species, row) ? usage.species[row] : null;
};

const STATS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isWeight = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const isEntry = (value: unknown): value is UsageEntry => isRecord(value) && typeof value.id === "string" && isWeight(value.weight);
const isSpread = (value: unknown): value is UsageSpread => isRecord(value) && typeof value.nature === "string" && isWeight(value.weight)
  && isRecord(value.points) && STATS.every((stat) => Number.isSafeInteger((value.points as Record<string, unknown>)[stat]));
/** `sets`: the importer's weighted set count, read by ai/belief/usage.ts to mix a base form's row with its Megas'. */
const isSpecies = (value: unknown): value is SpeciesUsage => isRecord(value)
  && isWeight(value.sets)
  && Array.isArray(value.moves) && value.moves.every(isEntry)
  && Array.isArray(value.items) && value.items.every(isEntry)
  && Array.isArray(value.spreads) && value.spreads.every(isSpread)
  && Array.isArray(value.abilities) && value.abilities.every(isEntry);

/** The generated file as TrainingUsageData, or a thrown fact when its shape is not the importer's (a stale or edited file). */
export function parseTrainingUsage(value: unknown): TrainingUsageData {
  if (!isRecord(value) || value.version !== 1 || value.game !== "champions" || typeof value.catalogSha256 !== "string"
    || !isRecord(value.attribution) || !isRecord(value.policy) || !isRecord(value.source) || !isRecord(value.coverage)
    || !isRecord(value.species) || !Object.values(value.species).every(isSpecies)) {
    throw new Error("Training usage data has an unexpected shape.");
  }
  return value as unknown as TrainingUsageData;
}
