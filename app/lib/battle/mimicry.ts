import type { BattleBuild, BattleConditions } from "./types";

const MIMICRY_TYPES: Record<Exclude<BattleConditions["terrain"], "">, "Electric" | "Grass" | "Fairy" | "Psychic"> = {
  Electric: "Electric", Grassy: "Grass", Misty: "Fairy", Psychic: "Psychic",
};

export type MimicryState = { type: "Electric" | "Grass" | "Fairy" | "Psychic"; terrain: string } | { type: null; terrain: string; suppressedBy: "Neutralizing Gas" };

/**
 * Mimicry (pinned Showdown data/abilities.ts onTerrainChange / setType) makes its holder the
 * terrain's type: Electric, Grass, Fairy or Psychic, for what hits it and its own STAB. The other
 * battler's Neutralizing Gas suppresses it unless Ability Shield (not under Magic Room) keeps it;
 * a Terastallized Pokémon keeps its type (no game with Mimicry has Tera). Null when it does not apply.
 */
export function mimicryState(build: BattleBuild, other: BattleBuild, conditions: Pick<BattleConditions, "terrain" | "magicRoom">): MimicryState | null {
  if (build.abilityId !== "mimicry" || !conditions.terrain || build.mechanic === "tera") return null;
  if (other.abilityId === "neutralizinggas" && !(build.itemId === "abilityshield" && !conditions.magicRoom)) {
    return { type: null, terrain: conditions.terrain, suppressedBy: "Neutralizing Gas" };
  }
  return { type: MIMICRY_TYPES[conditions.terrain], terrain: conditions.terrain };
}

/** The line shown beside the type badges while Mimicry changes (or would change) the types. */
export function mimicryNote(state: MimicryState, originalTypes: readonly string[]): string {
  return state.type
    ? `Mimicry: ${state.type} type on ${state.terrain} Terrain (original types ${originalTypes.join(" / ")}).`
    : `Neutralizing Gas suppresses Mimicry, so it keeps its original types (${originalTypes.join(" / ")}).`;
}
