import type { StatusTone } from "@/app/components/ui";
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
 * True when a failed `generate_schedule` call should open the "Discard
 * reported results" confirmation instead of showing its message.
 */
export function isResultsExistError(result: { code: string | null }): boolean {
  return result.code === RESULTS_EXIST_CODE;
}

export function isCompleted(match: Pick<LeagueMatch, "status">): boolean {
  return (match.status ?? "").trim().toLowerCase() === "completed";
}

export function matchTone(match: Pick<LeagueMatch, "status">): StatusTone {
  return isCompleted(match) ? "success" : "neutral";
}

/**
 * Groups matches by round (already ordered by round and match number) and
 * works out the bye for each round: a coach who appears somewhere in the
 * schedule but not in that round.
 */
export function groupRounds(matches: LeagueMatch[]): Round[] {
  const participants = new Set<string>();
  for (const match of matches) {
    participants.add(match.home_member_id);
    participants.add(match.away_member_id);
  }

  const byRound = new Map<number, LeagueMatch[]>();
  for (const match of matches) {
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
        inRound.add(match.home_member_id);
        inRound.add(match.away_member_id);
      }
      return {
        roundNumber,
        matches: sorted,
        byeMemberIds: [...participants].filter((id) => !inRound.has(id)),
      };
    });
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
