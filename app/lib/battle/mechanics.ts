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

/** Forms that exist only while Terastallized. */
const TERA_ONLY_FORMS: ReadonlySet<string> = new Set(["ogerpontealtera", "ogerponwellspringtera", "ogerponhearthflametera", "ogerponcornerstonetera", "terapagosstellar"]);

/**
 * The form a Pokémon battles in because of Terastallization or its entry ability (pinned Showdown
 * terastallize and Tera Shift): a Terastallized Ogerpon takes its mask's Tera form (Teal for plain
 * Ogerpon), Terapagos is Terastal from entry, and Stellar once Terastallized. Null otherwise.
 */
export function specialTeraForm(build: BattleBuild, runtime: BattleRuntime = championsRuntime): string | null {
  if (!runtime.profile.tera) return null;
  const species = runtime.speciesById.get(build.speciesId);
  if (!species) return null;
  const tera = build.mechanic === "tera";
  const base = sourceSpeciesId(species.baseSpecies);
  const form = base === "ogerpon" && tera && !TERA_ONLY_FORMS.has(species.id) ? (species.id === "ogerpon" ? "ogerpontealtera" : `${species.id}tera`)
    : base === "terapagos" && species.id !== "terapagosstellar" ? (tera ? "terapagosstellar" : species.id === "terapagos" ? "terapagosterastal" : null)
      : null;
  return form && runtime.speciesById.has(form) ? form : null;
}

/**
 * Whether a Stellar Tera boost can be used up for a type. Terapagos-Stellar keeps it for every type
 * (pinned Showdown never records its boosted types), and any Terastallized Terapagos is that form.
 */
export function stellarBoostUsedUp(build: BattleBuild, runtime: BattleRuntime = championsRuntime): boolean {
  const species = runtime.speciesById.get(build.speciesId);
  return !(species && sourceSpeciesId(species.baseSpecies) === "terapagos");
}

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
  // A transformed Imposter user keeps its own gender, already checked against its own species.
  const genderChecked = !build.transformedFrom;
  if (genderChecked && config?.gender !== undefined && !["M", "F", "N"].includes(config.gender)) {
    issues.push({ field: "configuration.gender", message: "Gender must be M, F or N." });
  } else if (genderChecked && config?.gender && species?.gender && config.gender !== species.gender) {
    issues.push({ field: "configuration.gender", message: `${species.name} has fixed gender ${species.gender}.` });
  } else if (genderChecked && config?.gender === "N" && species && !species.gender) {
    // Showdown's team validator turns any gender but M or F into a random one for these species.
    issues.push({ field: "configuration.gender", message: `${species.name} is always male or female, never genderless.` });
  }
  if (runtime.profile.dynamax && config?.gigantamax && !species?.canGigantamax) {
    issues.push({ field: "configuration.gigantamax", message: `${species?.name ?? "This Pokémon"} has no verified Gigantamax factor in ${runtime.profile.label}.` });
  }
  if (runtime.profile.tera && species?.requiredTeraType && config?.teraType && config.teraType !== species.requiredTeraType) {
    issues.push({ field: "configuration.teraType", message: `${species.name} requires Tera ${species.requiredTeraType}.` });
  }
  // Ogerpon's Tera forms and Terapagos-Stellar exist only while Terastallized (pinned Showdown
  // terastallize); the calculation takes them from Terastallization itself (settleAbilities).
  if (species && runtime.profile.tera && TERA_ONLY_FORMS.has(species.id) && build.mechanic !== "tera") {
    issues.push({ field: "mechanic", message: `${species.name} exists only while Terastallized.` });
  }
  if (!build.mechanic) return issues;
  if (!["tera", "dynamax", "gigantamax"].includes(build.mechanic)) {
    issues.push({ field: "mechanic", message: "Select a supported battle mechanic." });
    return issues;
  }
  if (build.mechanic === "tera") {
    if (!runtime.profile.tera) issues.push({ field: "mechanic", message: `Terastallization is not available in ${runtime.profile.label}.` });
    else if (!config?.teraType) issues.push({ field: "configuration.teraType", message: "Choose a Tera type before activating Terastallization." });
  } else {
    if (!runtime.profile.dynamax) issues.push({ field: "mechanic", message: `Dynamax and Gigantamax are not available in ${runtime.profile.label}.` });
    // Pinned Showdown battle-actions.ts:1483–1501 chooses G-Max from the stored
    // factor; side.ts:650–653 has only one Dynamax activation, not a normal/Gmax
    // override. Never silently reinterpret a request for ordinary Dynamax.
    if (runtime.profile.dynamax && build.mechanic === "dynamax" && config?.gigantamax && species?.canGigantamax) {
      issues.push({ field: "mechanic", message: `${species.name}'s Gigantamax factor requires Gigantamax, not Dynamax.` });
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

/**
 * Each type's usual Hidden Power IVs: the listed stats are 30 and the rest 31 (pinned Showdown
 * data/typechart.ts HPivs). Showdown's team validator (sim/team-validator.ts) fills them in for a set with
 * that typed Hidden Power and all-31 IVs below level 100, where Hyper Training cannot keep the 31s. (Its gen
 * 7 Random Battle generator gives them only to sets with a physical attack; the rest get 0 Attack.)
 */
export const HIDDEN_POWER_IVS: Readonly<Record<(typeof HIDDEN_POWER_TYPES)[number], Partial<StatTable>>> = {
  Fighting: { def: 30, spa: 30, spd: 30, spe: 30 }, Flying: { hp: 30, atk: 30, def: 30, spa: 30, spd: 30 },
  Poison: { def: 30, spa: 30, spd: 30 }, Ground: { spa: 30, spd: 30 }, Rock: { def: 30, spd: 30, spe: 30 },
  Bug: { atk: 30, def: 30, spd: 30 }, Ghost: { def: 30, spd: 30 }, Steel: { spd: 30 },
  Fire: { atk: 30, spa: 30, spe: 30 }, Water: { atk: 30, def: 30, spa: 30 }, Grass: { atk: 30, spa: 30 },
  Electric: { spa: 30 }, Psychic: { atk: 30, spe: 30 }, Ice: { atk: 30, def: 30 }, Dragon: { atk: 30 }, Dark: {},
};

/**
 * Hero-form Zacian and Zamazenta holding their Rusted item battle as the Crowned form (pinned Showdown
 * data/conditions.ts zacian / zamazenta onBattleStart), which also replaces an Iron Head with Behemoth
 * Blade / Behemoth Bash.
 */
export const CROWNED_FORMS: Readonly<Record<string, { form: string; item: string; move: string }>> = {
  zacian: { form: "zaciancrowned", item: "rustedsword", move: "behemothblade" },
  zamazenta: { form: "zamazentacrowned", item: "rustedshield", move: "behemothbash" },
};

/** Gen 7's innate IV parity determines type; Hyper Training does not change it. */
export function hiddenPowerType(ivs: StatTable<number | null>): string | null {
  if (IV_ORDER.some((stat) => !integerWithin(ivs[stat], 0, 31))) return null;
  const parity = IV_ORDER.reduce((sum, stat, index) => sum + (ivs[stat]! % 2) * 2 ** index, 0);
  return HIDDEN_POWER_TYPES[Math.floor(parity * 15 / 63)];
}
