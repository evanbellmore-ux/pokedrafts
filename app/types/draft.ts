import type { FormatRules } from "@/app/types/pokemon";

export type DraftPokemon = {
  name: string;
  points: number;
  tier: number;
};

export type DraftFormat = {
  version: string;
  leagueName: string;
  pokemon: DraftPokemon[];
  /**
   * The recipe the Pool Builder used (docs/release-architecture.md 13.5).
   * Absent on formats built by hand; `_validate_pool` only checks `pokemon`.
   */
  rules?: FormatRules;
};

export function pointsToTier(points: number) {
  return 21 - points;
}

/**
 * A well-formed pool entry: a non-blank name and finite points and tier.
 * Extra keys are ignored so a format saved by a newer client still loads.
 */
export function isDraftPokemon(value: unknown): value is DraftPokemon {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    entry.name.trim().length > 0 &&
    typeof entry.points === "number" &&
    Number.isFinite(entry.points) &&
    typeof entry.tier === "number" &&
    Number.isFinite(entry.tier)
  );
}

/**
 * A draft format document: string `version` and `leagueName` plus a
 * `pokemon` list whose every entry passes `isDraftPokemon`. Unknown keys
 * (including `rules`, which is validated separately) are ignored.
 */
export function isDraftFormat(value: unknown): value is DraftFormat {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const format = value as Record<string, unknown>;
  return (
    typeof format.version === "string" &&
    typeof format.leagueName === "string" &&
    Array.isArray(format.pokemon) &&
    format.pokemon.every(isDraftPokemon)
  );
}
