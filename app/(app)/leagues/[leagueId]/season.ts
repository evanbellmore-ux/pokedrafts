import type { StatusTone } from "@/app/components/ui";
import { isPlayoffMatch } from "@/app/lib/league/bracket";
import type { League, LeagueMatch, LeagueMember } from "@/app/types/league";

/**
 * Where a league is in its life cycle, derived from the league row and its
 * matches (docs/release-architecture.md section 12.6). Shared by the
 * overview status card, the overview header and the standings page.
 *
 * - `complete` once `champion_member_id` is set: the final was decided, or
 *   the last regular result was recorded in a league without playoffs (the
 *   function sets the top seed as champion then).
 * - `playoffs` while a bracket exists and no champion yet.
 * - `season` otherwise after the draft, including a finished regular season
 *   that is still waiting for its bracket.
 */
export type LeaguePhase = "setup" | "drafting" | "season" | "playoffs" | "complete";

export function leaguePhase(
  league: Pick<League, "draft_started" | "draft_completed" | "champion_member_id">,
  matches: Pick<LeagueMatch, "status" | "stage">[]
): LeaguePhase {
  if (!league.draft_started) return "setup";
  if (!league.draft_completed) return "drafting";
  if (league.champion_member_id) return "complete";
  if (matches.some(isPlayoffMatch)) return "playoffs";
  return "season";
}

export const PHASE_PILL: Record<LeaguePhase, { tone: StatusTone; label: string }> =
  {
    setup: { tone: "neutral", label: "Setting up" },
    drafting: { tone: "warning", label: "Draft in progress" },
    season: { tone: "accent", label: "Season underway" },
    playoffs: { tone: "accent", label: "Playoffs underway" },
    complete: { tone: "success", label: "Season complete" },
  };

/** Members in the draft order, sorted by position. */
export function draftingMembers<M extends Pick<LeagueMember, "draft_position">>(
  members: M[]
): M[] {
  return members
    .filter((m) => m.draft_position != null)
    .sort((a, b) => (a.draft_position ?? 0) - (b.draft_position ?? 0));
}

/**
 * Members that take part in the season: everyone in the draft order plus
 * anyone named in a match. Falls back to every member when no order exists,
 * so a league is never shown with an empty table.
 */
export function playingMembers<
  M extends { id: string; draft_position?: number | null },
>(
  members: M[],
  matches: Pick<LeagueMatch, "home_member_id" | "away_member_id">[]
): M[] {
  const inMatches = new Set<string>();
  for (const match of matches) {
    if (match.home_member_id) inMatches.add(match.home_member_id);
    if (match.away_member_id) inMatches.add(match.away_member_id);
  }
  const playing = members.filter(
    (m) => m.draft_position != null || inMatches.has(m.id)
  );
  return playing.length > 0 ? playing : members;
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th". */
export function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/** "3rd" or "tied for 3rd". */
export function rankPhrase(rank: number, tied: boolean): string {
  return tied ? `tied for ${ordinal(rank)}` : ordinal(rank);
}
