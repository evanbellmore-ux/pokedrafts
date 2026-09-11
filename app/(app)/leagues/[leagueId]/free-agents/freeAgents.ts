import { normalizePokemonName } from "@/app/lib/pokemon";
import type { DraftPokemon } from "@/app/types/draft";
import type { League, RosterPokemon } from "@/app/types/league";
import { isDraftPokemon, pokemonKey, type TeamRoster } from "../team/roster";

/**
 * Pure helpers for the Free Agents page. The database function
 * `swap_free_agent` is the authority on every rule here; these exist so the
 * page can explain up front why a move is not possible.
 */

/**
 * The league's draft pool is always `leagues.custom_pool` (docs/schema.md);
 * `draft_formats` is never consulted. Malformed entries are dropped.
 */
export function readPool(league: Pick<League, "custom_pool">): DraftPokemon[] {
  const list: unknown = league.custom_pool?.pokemon;
  return Array.isArray(list) ? list.filter(isDraftPokemon) : [];
}

/** Every Pokémon on any roster in the league, keyed like the function does. */
export function ownedKeys(teams: TeamRoster[]): Set<string> {
  const keys = new Set<string>();
  for (const team of teams) {
    for (const entry of team.pokemon) keys.add(pokemonKey(entry.name));
  }
  return keys;
}

/**
 * Pool minus every rostered Pokémon, most expensive first then by name.
 * Duplicate pool names (only possible in a hand-edited pool) collapse to
 * the first entry so the list never repeats a row.
 */
export function listFreeAgents(
  pool: DraftPokemon[],
  teams: TeamRoster[]
): DraftPokemon[] {
  const owned = ownedKeys(teams);
  const seen = new Set<string>();
  const available: DraftPokemon[] = [];

  for (const entry of pool) {
    const key = pokemonKey(entry.name);
    if (owned.has(key) || seen.has(key)) continue;
    seen.add(key);
    available.push(entry);
  }

  return available.sort(
    (a, b) =>
      b.points - a.points ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/** Case-insensitive substring match that also ignores punctuation ("mr mime"). */
export function matchesSearch(name: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  if (name.toLowerCase().includes(trimmed.toLowerCase())) return true;
  const normalized = normalizePokemonName(trimmed);
  return normalized.length > 0 && normalizePokemonName(name).includes(normalized);
}

export function filterFreeAgents(
  list: DraftPokemon[],
  query: string
): DraftPokemon[] {
  return list.filter((entry) => matchesSearch(entry.name, query));
}

export type MoveContext = {
  draftCompleted: boolean;
  /** The coach has a `drafted_teams` row (spectators do not). */
  hasTeam: boolean;
  swapsRemaining: number;
  rosterSize: number;
  picksPerTeam: number;
  pointsUsed: number;
  budget: number;
  /** The roster entry selected to drop, or null for an add-only move. */
  drop: RosterPokemon | null;
};

export function pointsAfterMove(
  context: Pick<MoveContext, "pointsUsed" | "drop">,
  add: Pick<DraftPokemon, "points">
): number {
  return context.pointsUsed - (context.drop?.points ?? 0) + add.points;
}

/** Reasons shown next to a disabled Add button. */
export const MOVE_BLOCKERS = {
  draft: "Draft not complete",
  noTeam: "No roster",
  swaps: "No swaps left",
  drop: "Pick a Pokémon to drop",
  budget: "Over budget",
} as const;

/**
 * Why `add` cannot be picked up right now, or null when the move is
 * allowed. Mirrors the checks in `swap_free_agent` (`draft_not_completed`,
 * `no_team`, `no_swaps_left`, `roster_full`, `over_budget`); ownership is
 * handled by leaving owned Pokémon out of the list.
 */
export function moveBlocker(
  context: MoveContext,
  add: DraftPokemon
): string | null {
  if (!context.draftCompleted) return MOVE_BLOCKERS.draft;
  if (!context.hasTeam) return MOVE_BLOCKERS.noTeam;
  if (context.swapsRemaining <= 0) return MOVE_BLOCKERS.swaps;
  if (!context.drop && context.rosterSize >= context.picksPerTeam) {
    return MOVE_BLOCKERS.drop;
  }
  if (pointsAfterMove(context, add) > context.budget) {
    return MOVE_BLOCKERS.budget;
  }
  return null;
}
