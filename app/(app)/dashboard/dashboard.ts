import { playoffSize } from "@/app/lib/league/bracket";
import { totalDraftPicks } from "@/app/lib/league/draft";
import { pluralize, teamNameLabel } from "@/app/lib/league/labels";
import { isLeagueCommissioner } from "@/app/lib/league/permissions";

/**
 * Pure helpers and row shapes for the dashboard (docs/release-architecture.md
 * sections 8.2 and 12.6). The page reads only the columns it renders; other
 * coaches' `user_id` is never selected.
 */

/** The `leagues` columns the dashboard embeds through `league_members`. */
export type LeagueSummary = {
  id: string;
  name: string;
  commissioner_id: string;
  max_coaches: number;
  draft_started: boolean | null;
  draft_completed: boolean | null;
  current_pick_number: number | null;
  picks_per_team: number | null;
  playoff_format: string | null;
  champion_member_id: string | null;
};

/** A member of one of the caller's leagues, as the coach stack shows it. */
export type DashboardMember = {
  id: string;
  teamName: string | null;
  draftPosition: number | null;
};

export type Phase = "live" | "setup" | "complete";

export type DashboardLeague = {
  league: LeagueSummary;
  /** The caller's own `league_members.id` in this league. */
  memberId: string;
  teamName: string | null;
  role: string | null;
  /** Every member, the caller included, in draft order (see `sortMembers`). */
  members: DashboardMember[];
  phase: Phase;
  /** The champion's team name once `champion_member_id` is set. */
  championTeamName: string | null;
  /** The caller's Pokémon: draft picks while live, the saved roster after. */
  roster: string[];
};

/** Live drafts first, then leagues still in setup, then finished drafts. */
const PHASE_ORDER: Record<Phase, number> = { live: 0, setup: 1, complete: 2 };

export function phaseOf(league: LeagueSummary): Phase {
  if (league.draft_completed) return "complete";
  if (league.draft_started) return "live";
  return "setup";
}

export function compareLeagues(a: DashboardLeague, b: DashboardLeague) {
  return (
    PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
    a.league.name.localeCompare(b.league.name)
  );
}

/** Draft position first (nulls last), then team name. */
export function sortMembers(members: DashboardMember[]): DashboardMember[] {
  return [...members].sort((a, b) => {
    const ap = a.draftPosition;
    const bp = b.draftPosition;
    if (ap != null && bp != null && ap !== bp) return ap - bp;
    if (ap != null && bp == null) return -1;
    if (ap == null && bp != null) return 1;
    return teamNameLabel(a.teamName).localeCompare(teamNameLabel(b.teamName), undefined, {
      sensitivity: "base",
    });
  });
}

/**
 * The one status line a league card shows. After the draft, a decided
 * champion replaces "In season"; a season reports its playoff size because
 * the dashboard loads no matches and cannot tell a running regular season
 * from a bracket in progress (section 12.6).
 */
export type LeagueStatus =
  | { kind: "setup" }
  | { kind: "drafting"; pick: number; totalPicks: number }
  | { kind: "season"; playoffTeams: number }
  | { kind: "champion"; teamName: string; mine: boolean };

export function leagueStatus(item: DashboardLeague): LeagueStatus {
  const { league } = item;
  switch (item.phase) {
    case "setup":
      return { kind: "setup" };
    case "live": {
      const drafting =
        item.members.filter((member) => member.draftPosition != null).length ||
        item.members.length;
      const totalPicks = totalDraftPicks(drafting, league.picks_per_team ?? 10);
      const pick = Math.min(
        Math.max(league.current_pick_number ?? 1, 1),
        Math.max(totalPicks, 1)
      );
      return { kind: "drafting", pick, totalPicks };
    }
    default:
      if (league.champion_member_id) {
        return {
          kind: "champion",
          teamName: item.championTeamName ?? "Unknown team",
          mine: league.champion_member_id === item.memberId,
        };
      }
      return { kind: "season", playoffTeams: playoffSize(league.playoff_format) };
  }
}

/** Share of the draft already made, 0..1 (pick 1 of 40 is 0). */
export function draftProgress(status: Extract<LeagueStatus, { kind: "drafting" }>) {
  if (status.totalPicks <= 0) return 0;
  return Math.min(Math.max((status.pick - 1) / status.totalPicks, 0), 1);
}

export function leagueHref(item: DashboardLeague) {
  return item.phase === "live"
    ? `/leagues/${item.league.id}/draft`
    : `/leagues/${item.league.id}`;
}

/**
 * Whether the caller sits out the draft: once the draft has started, a
 * member without a draft position has no roster to show.
 */
export function isSpectating(item: DashboardLeague): boolean {
  if (item.phase === "setup") return false;
  const me = item.members.find((member) => member.id === item.memberId);
  return me?.draftPosition == null && item.roster.length === 0;
}

/** Roster slots shown on a card; anything past the cap folds into "+N". */
export const MAX_ROSTER_SLOTS = 12;

export type RosterSlots = {
  /** A Pokémon name, or null for a slot not picked yet. */
  slots: (string | null)[];
  /** Slots folded into the trailing "+N" chip (0 when everything fits). */
  overflow: number;
};

export function rosterSlots(roster: string[], picksPerTeam: number | null): RosterSlots {
  const size = Math.max(picksPerTeam ?? 10, roster.length, 0);
  const fits = size <= MAX_ROSTER_SLOTS;
  const visible = fits ? size : MAX_ROSTER_SLOTS - 1;
  return {
    slots: Array.from({ length: visible }, (_, index) => roster[index] ?? null),
    overflow: fits ? 0 : size - visible,
  };
}

/** Coach avatars before the stack folds into "+N". */
export const MAX_COACH_AVATARS = 5;

/** Moved to the shared labels so league pages draw the same avatars. */
export { teamInitials } from "@/app/lib/league/labels";

/** "4 leagues · commissioner of 2 · 1 drafting now"; parts that are zero drop out. */
export function dashboardSummary(leagues: DashboardLeague[], userId: string): string {
  const commissioner = leagues.filter((item) =>
    isLeagueCommissioner(item.league, userId)
  ).length;
  const live = leagues.filter((item) => item.phase === "live").length;
  return [
    pluralize(leagues.length, "league"),
    commissioner > 0 ? `commissioner of ${commissioner}` : null,
    live > 0 ? `${live} drafting now` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Accepts a bare code or a pasted invite link; returns the uppercase code. */
export function normalizeInviteCode(raw: string): string {
  const match = raw.match(/invite\/([^/?#\s]+)/i);
  return (match ? match[1] : raw).replace(/\s+/g, "").toUpperCase();
}
