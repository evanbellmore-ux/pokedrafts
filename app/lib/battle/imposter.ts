import type { BattleBuild } from "./types";

/** Abilities Trace cannot copy (pinned Showdown data/abilities.ts flags notrace). */
export const NO_TRACE_ABILITIES = new Set([
  "asoneglastrier", "asonespectrier", "battlebond", "comatose", "commander", "disguise", "embodyaspectcornerstone",
  "embodyaspecthearthflame", "embodyaspectteal", "embodyaspectwellspring", "flowergift", "forecast", "hungerswitch",
  "iceface", "illusion", "imposter", "multitype", "neutralizinggas", "poisonpuppeteer", "powerconstruct", "powerofalchemy",
  "protosynthesis", "quarkdrive", "receiver", "rkssystem", "schooling", "shieldsdown", "stancechange", "teraformzero",
  "terashell", "terashift", "trace", "zenmode", "zerotohero",
]);

/**
 * Abilities that do nothing on a transformed Pokémon (pinned Showdown flags notransform; sim/pokemon.ts
 * ignoringAbility). A transformed Pokémon's Neutralizing Gas does not suppress anything either.
 */
export const NO_TRANSFORM_ABILITIES = new Set([
  "disguise", "embodyaspectcornerstone", "embodyaspecthearthflame", "embodyaspectteal", "embodyaspectwellspring",
  "gulpmissile", "hungerswitch", "iceface", "neutralizinggas", "protosynthesis", "quarkdrive", "terashift", "zerotohero",
]);

/**
 * Form abilities whose effects pinned Showdown switches off for a transformed Pokémon (each checks
 * `pokemon.transformed`): Stance Change, Forecast, Flower Gift, Battle Bond, Power Construct,
 * Schooling, Shields Down and Zen Mode. Mimicry still acts (and without terrain gives the Pokémon its
 * own original types).
 */
export const TRANSFORM_LOCKED_ABILITIES = new Set(["battlebond", "flowergift", "forecast", "powerconstruct", "schooling", "shieldsdown", "stancechange", "zenmode"]);

const neutralized = (build: BattleBuild, other: BattleBuild, magicRoom: boolean) =>
  other.abilityId === "neutralizinggas" && !(build.itemId === "abilityshield" && !magicRoom);

/**
 * Whether Imposter has transformed `build` into `other` on entry (its condition, ticked by default):
 * not under the other battler's Neutralizing Gas, and not into another Imposter user.
 */
export function imposterTransforms(build: BattleBuild, other: BattleBuild | undefined, magicRoom = false): boolean {
  return !!other && build.abilityId === "imposter" && build.abilityActive && other.abilityId !== "imposter" && !neutralized(build, other, magicRoom);
}

/** The Pokémon whose moves an attacker uses: a transformed Imposter user has its target's moves. */
export function movesSpeciesId(build: BattleBuild, other: BattleBuild | undefined, magicRoom = false): string {
  return other && imposterTransforms(build, other, magicRoom) ? other.speciesId : build.speciesId;
}

/**
 * The ability Trace copied: the choice in Build settings, or else the other shown Pokémon's ability
 * when Trace can copy it. Null when Trace copies nothing: its own Ability Shield (pinned Showdown
 * trace onStart; not under Magic Room), the other battler's Neutralizing Gas, or an ability it cannot copy.
 */
export function tracedAbility(build: BattleBuild, other: BattleBuild, magicRoom = false): { abilityId: string | null; chosen: boolean; blockedBy?: "Ability Shield" | "Neutralizing Gas" } {
  if (build.itemId === "abilityshield" && !magicRoom) return { abilityId: null, chosen: false, blockedBy: "Ability Shield" };
  if (neutralized(build, other, magicRoom)) return { abilityId: null, chosen: false, blockedBy: "Neutralizing Gas" };
  if (build.tracedAbility) return { abilityId: build.tracedAbility, chosen: true };
  return { abilityId: NO_TRACE_ABILITIES.has(other.abilityId) ? null : other.abilityId, chosen: false };
}
