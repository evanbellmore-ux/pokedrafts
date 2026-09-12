import type { StatusTone } from "@/app/components/ui";
import {
  isMatchCompleted,
  isPlayoffMatch,
  playoffMatchLabel,
} from "@/app/lib/league/bracket";
import { teamNameLabel } from "@/app/lib/league/labels";
import type { LeagueMatch, ScheduleFormat } from "@/app/types/league";

/** Columns the matches page reads from `league_members`. */
export type MatchMember = {
  id: string;
  user_id: string;
  team_name: string | null;
  draft_position: number | null;
};

export type Round = {
  roundNumber: number;
  matches: LeagueMatch[];
  /** Coaches in the schedule who have no match this round (odd-sized leagues). */
  byeMemberIds: string[];
};

export const SCHEDULE_FORMATS: readonly ScheduleFormat[] = [
  "round_robin",
  "double_round_robin",
];

export function toScheduleFormat(value: string): ScheduleFormat {
  return value === "double_round_robin" ? "double_round_robin" : "round_robin";
}

/**
 * Detail code `generate_schedule` raises once a result has been reported
 * (docs/schema.md). `rpc.*` surfaces it as `code`, so the Schedule card
 * branches on the code, never on the wording of the message.
 */
export const RESULTS_EXIST_CODE = "results_exist";

/**
 * Detail codes the result functions raise around the playoffs
 * (docs/release-architecture.md section 12.5). The pages branch on these,
 * never on the wording of the message.
 */
export const PLAYOFFS_STARTED_CODE = "playoffs_started";
export const LATER_ROUND_DECIDED_CODE = "later_round_decided";
export const MATCH_NOT_READY_CODE = "match_not_ready";

/**
 * True when a failed `generate_schedule` call should open the "Discard
 * reported results" confirmation instead of showing its message.
 */
export function isResultsExistError(result: { code: string | null }): boolean {
  return result.code === RESULTS_EXIST_CODE;
}

/**
 * The next step for a refused result action, keyed by the function's detail
 * code. The function's own message is shown as it is; this adds what the
 * commissioner can do about it. Null for every other failure.
 */
export function resultErrorHint(code: string | null): string | null {
  switch (code) {
    case PLAYOFFS_STARTED_CODE:
      return "Playoff results have been recorded. Edit or clear those first, or clear the bracket.";
    case LATER_ROUND_DECIDED_CODE:
      return "The next round has already been decided. Clear that result first.";
    case MATCH_NOT_READY_CODE:
      return "Both coaches must be decided before a result can be recorded.";
    default:
      return null;
  }
}

/**
 * True when the failure means the bracket on screen is behind the server
 * (someone else recorded or cleared a playoff result), so the page reloads.
 */
export function isStaleBracketError(code: string | null): boolean {
  return (
    code === PLAYOFFS_STARTED_CODE ||
    code === LATER_ROUND_DECIDED_CODE ||
    code === MATCH_NOT_READY_CODE
  );
}

export function isCompleted(match: Pick<LeagueMatch, "status">): boolean {
  return isMatchCompleted(match);
}

export function matchTone(match: Pick<LeagueMatch, "status">): StatusTone {
  return isCompleted(match) ? "success" : "neutral";
}

/** Both sides of a match, or null while a playoff slot is undecided. */
export function participants(
  match: Pick<LeagueMatch, "home_member_id" | "away_member_id">
): { home: string; away: string } | null {
  return match.home_member_id && match.away_member_id
    ? { home: match.home_member_id, away: match.away_member_id }
    : null;
}

/**
 * Groups the regular-season matches by round (already ordered by round and
 * match number) and works out the bye for each round: a coach who appears
 * somewhere in the schedule but not in that round. Playoff matches are
 * left out; the bracket helpers group those.
 */
export function groupRounds(matches: LeagueMatch[]): Round[] {
  const regular = matches.filter((match) => !isPlayoffMatch(match));
  const participantIds = new Set<string>();
  for (const match of regular) {
    if (match.home_member_id) participantIds.add(match.home_member_id);
    if (match.away_member_id) participantIds.add(match.away_member_id);
  }

  const byRound = new Map<number, LeagueMatch[]>();
  for (const match of regular) {
    const list = byRound.get(match.round_number) ?? [];
    list.push(match);
    byRound.set(match.round_number, list);
  }

  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([roundNumber, roundMatches]) => {
      const sorted = [...roundMatches].sort(
        (a, b) => a.match_number - b.match_number
      );
      const inRound = new Set<string>();
      for (const match of sorted) {
        if (match.home_member_id) inRound.add(match.home_member_id);
        if (match.away_member_id) inRound.add(match.away_member_id);
      }
      return {
        roundNumber,
        matches: sorted,
        byeMemberIds: [...participantIds].filter((id) => !inRound.has(id)),
      };
    });
}

/**
 * "Round 3" for a regular match, "Semifinal 1" or "Final" for a playoff
 * match (section 12.1: never "Round 7" for a playoff round).
 */
export function matchLabel(
  match: Pick<LeagueMatch, "round_number" | "match_number" | "stage">,
  matches: Pick<LeagueMatch, "round_number" | "stage">[]
): string {
  return isPlayoffMatch(match)
    ? playoffMatchLabel(match, matches)
    : `Round ${match.round_number}`;
}

/**
 * Team name for a member id. Matches cascade away with their members, so a
 * missing member only happens between a reload and a realtime event.
 */
export function memberTeamName(
  members: Pick<MatchMember, "id" | "team_name">[],
  memberId: string | null | undefined
): string {
  if (!memberId) return "Unknown team";
  const member = members.find((candidate) => candidate.id === memberId);
  return member ? teamNameLabel(member.team_name) : "Unknown team";
}
