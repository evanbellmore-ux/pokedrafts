import { champions } from "@/app/lib/battle/catalog";
import { createBattleRuntime } from "@/app/lib/battle/runtime";

/**
 * Every shipped catalog now calculates every species, so the unsupported-species paths are exercised
 * through a Champions runtime whose Vivillon-Garden row carries an engine gap.
 */
export const unsupportedSpeciesRuntime = createBattleRuntime({
  ...champions,
  species: champions.species.map((row) => row.id === "vivillongarden" ? { ...row, unsupported: ["Engine species missing: Vivillon-Garden."] } : row),
}, "0".repeat(64));
