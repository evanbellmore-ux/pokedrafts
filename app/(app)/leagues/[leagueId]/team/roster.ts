import { teamNameLabel } from "@/app/lib/league/labels";
import { CREATE_LEAGUE_DEFAULTS } from "@/app/lib/league/limits";
import { isDraftPokemon } from "@/app/types/draft";
import type { League, RosterPokemon } from "@/app/types/league";

// The entry guard lives with the type; re-exported so existing imports keep working.
export { isDraftPokemon };

/**
 * Pure helpers for reading `drafted_teams` rows on the My Team and Free
 * Agents pages. Rosters are jsonb written only by the Postgres functions
 * (`_finalize_draft`, `swap_free_agent`, `undo_free_agent_move`), so every
 * entry is validated before it reaches the UI.
 */

/**
 * Columns the My Team page reads. Other coaches' `user_id` is never
 * selected; `role` is display-only and kept in sync by the functions, which
 * is exactly what the Commissioner pill needs.
 */
export const TEAM_ROSTER_SELECT =
  "id, member_id, pokemon, total_points, league_members(team_name, role)";

/** Columns the Free Agents page reads (no member embed needed). */
export const ROSTER_ONLY_SELECT = "id, member_id, pokemon, total_points";

export type TeamRoster = {
  id: string;
  member_id: string;
  pokemon: RosterPokemon[];
  total_points: number;
  team_name: string | null;
  role: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validates a `drafted_teams.pokemon` array, keeping the stored order. */
export function parseRoster(value: unknown): RosterPokemon[] {
  if (!Array.isArray(value)) return [];

  const roster: RosterPokemon[] = [];
  for (const entry of value) {
    if (!isDraftPokemon(entry)) continue;
    const raw = entry as Record<string, unknown>;
    roster.push({
      name: entry.name,
      points: entry.points,
      tier: entry.tier,
      pick_number:
        typeof raw.pick_number === "number" && Number.isFinite(raw.pick_number)
          ? raw.pick_number
          : null,
      acquired:
        raw.acquired === "free_agent"
          ? "free_agent"
          : raw.acquired === "draft"
            ? "draft"
            : undefined,
    });
  }
  return roster;
}

/**
 * Normalizes the rows returned by a `drafted_teams` select (with or without
 * the `league_members` embed, which PostgREST may return as an object or a
 * one-element array).
 */
export function parseTeamRosters(rows: unknown): TeamRoster[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row): TeamRoster[] => {
    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      typeof row.member_id !== "string"
    ) {
      return [];
    }

    const embed = Array.isArray(row.league_members)
      ? (row.league_members[0] ?? null)
      : row.league_members;
    const member = isRecord(embed) ? embed : null;

    return [
      {
        id: row.id,
        member_id: row.member_id,
        pokemon: parseRoster(row.pokemon),
        total_points:
          typeof row.total_points === "number" &&
          Number.isFinite(row.total_points)
            ? row.total_points
            : 0,
        team_name:
          typeof member?.team_name === "string" ? member.team_name : null,
        role: typeof member?.role === "string" ? member.role : null,
      },
    ];
  });
}

/**
 * The comparison `swap_free_agent` uses for ownership and roster lookups:
 * `lower(trim(name))`. Using the same key keeps the availability shown on
 * the page in step with what the function will accept.
 */
export function pokemonKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Free-agent pickups carry `acquired: 'free_agent'` and no pick number. */
export function isFreeAgentPickup(entry: RosterPokemon): boolean {
  return entry.acquired === "free_agent" || entry.pick_number == null;
}

/** Sum of roster points (what `_roster_total` computes server-side). */
export function rosterPoints(roster: RosterPokemon[]): number {
  return roster.reduce((total, entry) => total + entry.points, 0);
}

/** Teams ordered by their display name. */
export function sortTeamsByName(teams: TeamRoster[]): TeamRoster[] {
  return [...teams].sort((a, b) =>
    teamNameLabel(a.team_name).localeCompare(teamNameLabel(b.team_name), undefined, {
      sensitivity: "base",
    })
  );
}

/** The league's point budget (the column is nullable; the default matches section 4). */
export function leagueBudget(league: Pick<League, "point_budget">): number {
  return league.point_budget ?? CREATE_LEAGUE_DEFAULTS.pointBudget;
}

/** Roster size every team drafts to. */
export function leaguePicksPerTeam(
  league: Pick<League, "picks_per_team">
): number {
  return league.picks_per_team ?? CREATE_LEAGUE_DEFAULTS.picksPerTeam;
}

/** Free-agent swaps a coach can still make this season. */
export function swapsRemaining(
  league: Pick<League, "free_agent_swap_limit">,
  member: { free_agent_swaps_used: number }
): number {
  return Math.max(0, league.free_agent_swap_limit - member.free_agent_swaps_used);
}
