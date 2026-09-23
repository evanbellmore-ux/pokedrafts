import { TERA_TYPES } from "./profiles";
import { championsRuntime, type BattleRuntime } from "./runtime";
import type { BattleBuild, BuildIssue, StatTable } from "./types";

// Preparation/configuration helpers deliberately have no engine dependency.
// This only normalizes source base-species names for explicit mechanic guards;
// it is not a resolver and never substitutes a form or imported species identity.
const sourceSpeciesId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export const HIDDEN_POWER_TYPES = [
  "Fighting", "Flying", "Poison", "Ground", "Rock", "Bug", "Ghost", "Steel",
  "Fire", "Water", "Grass", "Electric", "Psychic", "Ice", "Dragon", "Dark",
] as const;
const IV_ORDER = ["hp", "atk", "def", "spe", "spa", "spd"] as const;
const integerWithin = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

export function isMaxActive(build: BattleBuild): boolean {
  return build.mechanic === "dynamax" || build.mechanic === "gigantamax";
}

/** Fixed species gender is trustworthy; the engine's default male gender is not. */
export function getBuildGender(build: BattleBuild, runtime: BattleRuntime = championsRuntime) {
  return build.configuration?.gender ?? runtime.speciesById.get(build.speciesId)?.gender;
}

export function validateMechanic(build: BattleBuild, runtime: BattleRuntime = championsRuntime): BuildIssue[] {
  const issues: BuildIssue[] = [];
  const config = build.configuration;
  const species = runtime.speciesById.get(build.speciesId);
  if (config?.teraType !== undefined && !TERA_TYPES.some((type) => type === config.teraType)) {
    issues.push({ field: "configuration.teraType", message: "Select a valid Tera type, including Stellar." });
  }
  if (config?.hiddenPowerType !== undefined && !HIDDEN_POWER_TYPES.some((type) => type === config.hiddenPowerType)) {
    issues.push({ field: "configuration.hiddenPowerType", message: "Select one of Hidden Power's sixteen possible types." });
  }
  if (config?.happiness !== undefined && !integerWithin(config.happiness, 0, 255)) {
    issues.push({ field: "configuration.happiness", message: "Happiness must be a whole number from 0 to 255." });
  }
  if (config?.dynamaxLevel !== undefined && !integerWithin(config.dynamaxLevel, 0, 10)) {
    issues.push({ field: "configuration.dynamaxLevel", message: "Dynamax Level must be a whole number from 0 to 10." });
  }
  if (config?.gigantamax !== undefined && typeof config.gigantamax !== "boolean") {
    issues.push({ field: "configuration.gigantamax", message: "Gigantamax factor must be Yes or No." });
  }
  if (config?.gender !== undefined && !["M", "F", "N"].includes(config.gender)) {
    issues.push({ field: "configuration.gender", message: "Gender must be M, F or N." });
  } else if (config?.gender && species?.gender && config.gender !== species.gender) {
    issues.push({ field: "configuration.gender", message: `${species.name} has fixed gender ${species.gender}.` });
  }
  if (runtime.profile.dynamax && config?.gigantamax && !species?.canGigantamax) {
    issues.push({ field: "configuration.gigantamax", message: `${species?.name ?? "This Pokémon"} has no verified Gigantamax factor in ${runtime.profile.label}.` });
  }
  if (runtime.profile.tera && species?.requiredTeraType && config?.teraType && config.teraType !== species.requiredTeraType) {
    issues.push({ field: "configuration.teraType", message: `${species.name} requires Tera ${species.requiredTeraType}.` });
  }
  if (species && runtime.profile.tera && (sourceSpeciesId(species.baseSpecies) === "terapagos"
    || (sourceSpeciesId(species.baseSpecies) === "ogerpon" && species.battleForm))) {
    issues.push({ field: "mechanic", message: `${species.name}'s automatic/special Tera form, ability and stat prerequisites are not verified; selecting the form alone does not establish a supported battle state.` });
  }
  if (!build.mechanic) return issues;
  if (!["tera", "dynamax", "gigantamax"].includes(build.mechanic)) {
    issues.push({ field: "mechanic", message: "Select a supported battle mechanic." });
    return issues;
  }
  if (build.mechanic === "tera") {
    if (!runtime.profile.tera) issues.push({ field: "mechanic", message: `Terastallization is not available in ${runtime.profile.label}. Retained Tera configuration does not activate it.` });
    else if (!config?.teraType) issues.push({ field: "configuration.teraType", message: "Choose a Tera type before activating Terastallization." });
    if (species && ["ogerpon", "terapagos"].includes(sourceSpeciesId(species.baseSpecies))) {
      issues.push({ field: "mechanic", message: `${species.name}'s Tera form transition, ability and stat prerequisites are not verified; this special-form Terastallization is unsupported.` });
    }
  } else {
    if (!runtime.profile.dynamax) issues.push({ field: "mechanic", message: `Dynamax and Gigantamax are not available in ${runtime.profile.label}.` });
    // Pinned Showdown battle-actions.ts:1483–1501 chooses G-Max from the stored
    // factor; side.ts:650–653 has only one Dynamax activation, not a normal/Gmax
    // override. Never silently reinterpret a request for ordinary Dynamax.
    if (runtime.profile.dynamax && build.mechanic === "dynamax" && config?.gigantamax && species?.canGigantamax) {
      issues.push({ field: "mechanic", message: `${species.name}'s Gigantamax factor requires Gigantamax when transformed. Remove the factor to use ordinary Dynamax.` });
    }
    if (species?.cannotDynamax || (species && ["zacian", "zamazenta", "eternatus"].includes(sourceSpeciesId(species.baseSpecies)))) {
      issues.push({ field: "mechanic", message: `${species?.name ?? "This Pokémon"} cannot Dynamax or Gigantamax.` });
    }
    if (species && (species.name.includes("-Mega") || /(?:-Primal|-Ultra|-Gorging|-Gulping)$/.test(species.name))) {
      issues.push({ field: "mechanic", message: `${species.name}'s selected form is not verified for Dynamax or Gigantamax.` });
    }
    if (build.mechanic === "gigantamax" && (!config?.gigantamax || !species?.canGigantamax)) {
      issues.push({ field: "mechanic", message: "Gigantamax requires an eligible species with its Gigantamax factor explicitly enabled." });
    }
  }
  return issues;
}

/** Gen 7's innate IV parity determines type; Hyper Training does not change it. */
export function hiddenPowerType(ivs: StatTable<number | null>): string | null {
  if (IV_ORDER.some((stat) => !integerWithin(ivs[stat], 0, 31))) return null;
  const parity = IV_ORDER.reduce((sum, stat, index) => sum + (ivs[stat]! % 2) * 2 ** index, 0);
  return HIDDEN_POWER_TYPES[Math.floor(parity * 15 / 63)];
}
