import { getSnakeDraftIndex, totalDraftPicks } from "@/app/lib/league/draft";
import { teamNameLabel } from "@/app/lib/league/labels";
import type {
  League,
  LeagueInvite,
  LeagueMatch,
  LeagueMember,
  LeagueNews,
} from "@/app/types/league";

/**
 * Pure helpers and row shapes for the league overview. Every select string
 * names only the columns the page renders; other coaches' `user_id` never
 * leaves the server (the "You" marker compares member ids).
 */

export const NEWS_PAGE_SIZE = 20;

export const MEMBER_SELECT = "id, role, team_name, draft_position";
export const MATCH_SELECT =
  "id, round_number, match_number, home_member_id, away_member_id, status, winner_member_id, stage, winner_remaining, home_seed, away_seed, feeds_match_id, feeds_slot";
export const NEWS_SELECT =
  "id, member_id, news_type, message, metadata, created_at";
export const INVITE_SELECT =
  "id, invite_code, max_uses, used_count, expires_at";

export type OverviewMember = Pick<
  LeagueMember,
  "id" | "role" | "team_name" | "draft_position"
>;

export type OverviewMatch = Pick<
  LeagueMatch,
  | "id"
  | "round_number"
  | "match_number"
  | "home_member_id"
  | "away_member_id"
  | "status"
  | "winner_member_id"
  | "stage"
  | "winner_remaining"
  | "home_seed"
  | "away_seed"
  | "feeds_match_id"
  | "feeds_slot"
>;

export type OverviewNews = Pick<
  LeagueNews,
  "id" | "member_id" | "news_type" | "message" | "metadata" | "created_at"
>;

export type OverviewInvite = Pick<
  LeagueInvite,
  "id" | "invite_code" | "max_uses" | "used_count" | "expires_at"
>;

/** Draft position first (nulls last), then team name. */
export function sortCoaches<M extends OverviewMember>(members: M[]): M[] {
  return [...members].sort((a, b) => {
    const ap = a.draft_position;
    const bp = b.draft_position;
    if (ap != null && bp != null && ap !== bp) return ap - bp;
    if (ap != null && bp == null) return -1;
    if (ap == null && bp != null) return 1;
    return teamNameLabel(a.team_name).localeCompare(
      teamNameLabel(b.team_name),
      undefined,
      { sensitivity: "base" }
    );
  });
}

/** The coach whose turn it is, from the snake order in section 5. */
export function onClockMember<M>(
  league: Pick<League, "current_pick_number" | "picks_per_team">,
  drafting: M[]
): M | null {
  const pick = league.current_pick_number ?? 1;
  const total = totalDraftPicks(drafting.length, league.picks_per_team ?? 0);
  if (drafting.length === 0 || pick < 1 || pick > total) return null;
  return drafting[getSnakeDraftIndex(pick, drafting.length)] ?? null;
}

/**
 * The earliest upcoming match this coach plays in, or null. Regular and
 * playoff matches are ordered by round, so a waiting playoff slot the coach
 * already holds is returned too.
 */
export function nextMatchFor<M extends OverviewMatch>(
  matches: M[],
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
  match: Pick<OverviewMatch, "home_member_id" | "away_member_id">,
  memberId: string
): string | null {
  return match.home_member_id === memberId
    ? match.away_member_id
    : match.home_member_id;
}

export type NewsKind = "free_agent" | "match_result" | "season" | "other";

/** `league_news.news_type` is never rendered raw (section 2). */
export function newsKind(type: string | null | undefined): NewsKind {
  const normalized = (type ?? "").trim().toLowerCase();
  if (normalized === "free_agent") return "free_agent";
  if (normalized === "match_result") return "match_result";
  if (normalized === "season") return "season";
  return "other";
}

export const NEWS_LABEL: Record<NewsKind, string> = {
  free_agent: "Free agent",
  match_result: "Match result",
  season: "Season",
  other: "Update",
};

export type FreeAgentMove = { added: string | null; dropped: string | null };

function metadataName(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** The Pokémon a free-agent news row added and dropped, or null for other rows. */
export function freeAgentMove(
  item: Pick<OverviewNews, "news_type" | "metadata">
): FreeAgentMove | null {
  if (newsKind(item.news_type) !== "free_agent") return null;
  const metadata = item.metadata ?? {};
  return {
    added: metadataName(metadata.added),
    dropped: metadataName(metadata.dropped),
  };
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Date and time in the viewer's locale; the raw value when unparsable. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}

/** Absolute invite link for the current origin (only called in the browser). */
export function inviteUrl(code: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/invite/${encodeURIComponent(code)}`;
}

/** Appends a page of older news, skipping rows the feed already shows. */
export function mergeNews(
  current: OverviewNews[],
  page: OverviewNews[]
): OverviewNews[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...page.filter((item) => !seen.has(item.id))];
}
