import { CREATE_LEAGUE_DEFAULTS } from "@/app/lib/league/limits";
import { isDraftPokemon, type DraftFormat, type DraftPokemon } from "@/app/types/draft";
import type { League } from "@/app/types/league";

// The entry guard lives with the type; re-exported so existing imports keep working.
export { isDraftPokemon };

/**
 * `leagues.custom_pool` is the only pool a league drafts from
 * (docs/schema.md, `leagues.custom_pool`): it is copied from the chosen draft
 * format by `create_league` / `update_league_settings` (`source: "format"`),
 * replaced by `update_league_pool` (no `source`), copied again by
 * `reset_league_pool`, and null only when no format was ever chosen.
 * `draft_formats` is never read to find a league's pool.
 */
export type LeaguePool = DraftFormat & {
  source?: string | null;
  draft_format_id?: string | null;
};

export type LeaguePoolInfo = {
  pool: LeaguePool | null;
  /** Well-formed entries of `pool.pokemon` (empty when there is no pool). */
  pokemon: DraftPokemon[];
  /** True when the pool is an untouched copy of a draft format. */
  mirrorsFormat: boolean;
};

export function readLeaguePool(
  league: Pick<League, "custom_pool">
): LeaguePoolInfo {
  const raw = league.custom_pool as LeaguePool | null | undefined;
  if (!raw || typeof raw !== "object") {
    return { pool: null, pokemon: [], mirrorsFormat: false };
  }
  const list: unknown = raw.pokemon;
  const pokemon = Array.isArray(list) ? list.filter(isDraftPokemon) : [];
  return { pool: raw, pokemon, mirrorsFormat: raw.source === "format" };
}

/** Coaches that will draft: those in the order, or `max_coaches` before an order exists. */
export function draftingSeats(
  league: Pick<League, "max_coaches">,
  draftingCoaches: number
): number {
  return draftingCoaches > 0 ? draftingCoaches : league.max_coaches;
}

export function picksPerTeam(league: Pick<League, "picks_per_team">): number {
  return league.picks_per_team ?? CREATE_LEAGUE_DEFAULTS.picksPerTeam;
}

export function pointBudget(league: Pick<League, "point_budget">): number {
  return league.point_budget ?? CREATE_LEAGUE_DEFAULTS.pointBudget;
}

/** Pool size `start_draft` requires: drafting coaches times picks per team. */
export function requiredPoolSize(
  league: Pick<League, "max_coaches" | "picks_per_team">,
  draftingCoaches: number
): number {
  return draftingSeats(league, draftingCoaches) * picksPerTeam(league);
}

/** Cost of a full roster made of the cheapest Pokémon, or null for an empty pool. */
export function cheapestFullTeam(
  pokemon: Pick<DraftPokemon, "points">[],
  picks: number
): number | null {
  if (pokemon.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  for (const entry of pokemon) {
    if (entry.points < min) min = entry.points;
  }
  return min * picks;
}
