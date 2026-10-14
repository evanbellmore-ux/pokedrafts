import type { LeagueMatch } from "@/app/types/league";

/**
 * A coach's next scheduled match and its opponent, shared by the league
 * overview's status card and Training's default opponent. Pure: the callers
 * read `league_matches` themselves.
 */

/** The `league_matches` columns the next match needs (the overview reads more). */
export const NEXT_MATCH_SELECT =
  "round_number, match_number, home_member_id, away_member_id, status";

export type ScheduledMatch = Pick<
  LeagueMatch,
  "round_number" | "match_number" | "home_member_id" | "away_member_id" | "status"
>;

/**
 * The earliest upcoming match this coach plays in, or null. Regular and
 * playoff matches are ordered by round, so a waiting playoff slot the coach
 * already holds is returned too.
 */
export function nextMatchFor<M extends ScheduledMatch>(
  matches: readonly M[],
  memberId: string
): M | null {
  const upcoming = matches.filter(
    (match) =>
      match.status !== "completed" &&
      (match.home_member_id === memberId || match.away_member_id === memberId)
  );
  upcoming.sort(
    (a, b) =>
      a.round_number - b.round_number || a.match_number - b.match_number
  );
  return upcoming[0] ?? null;
}

/** The other side of a match; null while a playoff slot is undecided. */
export function opponentId(
  match: Pick<ScheduledMatch, "home_member_id" | "away_member_id">,
  memberId: string
): string | null {
  return match.home_member_id === memberId
    ? match.away_member_id
    : match.home_member_id;
}

/**
 * The opponent of this coach's next match; null with no schedule, every
 * match played or the next one's other slot undecided.
 */
export function nextOpponentId(
  matches: readonly ScheduledMatch[],
  memberId: string
): string | null {
  const next = nextMatchFor(matches, memberId);
  return next ? opponentId(next, memberId) : null;
}

function isNullableId(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

/** `league_matches` rows as read from the client; rows of another shape are left out. */
export function parseScheduledMatches(rows: unknown): ScheduledMatch[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): ScheduledMatch[] => {
    if (typeof row !== "object" || row === null) return [];
    const { round_number, match_number, home_member_id, away_member_id, status } = row as Record<string, unknown>;
    if (
      typeof round_number !== "number" ||
      !Number.isFinite(round_number) ||
      typeof match_number !== "number" ||
      !Number.isFinite(match_number) ||
      !isNullableId(home_member_id) ||
      !isNullableId(away_member_id) ||
      typeof status !== "string"
    ) {
      return [];
    }
    return [{ round_number, match_number, home_member_id, away_member_id, status }];
  });
}
