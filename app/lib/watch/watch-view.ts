import { pluralize, teamNameLabel } from "@/app/lib/league/labels";
import {
  platformOf,
  readReplayEntries,
  readStreamLink,
  type ReplayLink,
  type StreamLink,
} from "@/app/lib/watch/stream-links";
import type { PublicLeague, PublicLeagueSummary } from "@/app/types/league";

/**
 * What the Watch pages show (docs/release-architecture.md section 15): which
 * public leagues are live, in what order, and the one-line status of each.
 * Pure, so the server page and the client refresh agree.
 */

/** What a platform says about a stream right now (app/lib/watch/live-status.ts). */
export type StreamStatus = {
  /** The platform was asked and answered; false without its API keys or on an error. */
  checked: boolean;
  live: boolean;
  /** The broadcast's title. */
  title: string | null;
  viewers: number | null;
  startedAt: string | null;
  /** YouTube: the live video to embed. */
  liveVideoId: string | null;
  /** YouTube: the channel ID behind an @handle, for its live player. */
  channelId: string | null;
};

/** Not live, as far as anyone knows: the platform was not asked or did not answer. */
export const NOT_LIVE: StreamStatus = {
  checked: false,
  live: false,
  title: null,
  viewers: null,
  startedAt: null,
  liveVideoId: null,
  channelId: null,
};

/** A draft that is started, not complete and not paused. */
export function draftRunning(league: {
  draft_started: boolean;
  draft_completed: boolean;
  draft_paused?: boolean;
  draft_paused_at?: string | null;
}): boolean {
  return (
    league.draft_started &&
    !league.draft_completed &&
    !league.draft_paused &&
    !league.draft_paused_at
  );
}

export type BrowseLeague = PublicLeagueSummary & {
  stream: StreamLink | null;
  status: StreamStatus;
  /** The stream is on air (needs the platform's API keys on the server). */
  streamLive: boolean;
  draftLive: boolean;
};

export type BrowseReplay = {
  leagueId: string;
  leagueName: string;
  title: string;
  url: string;
  link: ReplayLink;
  addedAt: string | null;
};

export type BrowseView = {
  /** Stream on air or draft running: on-air streams first, most viewers first. */
  live: BrowseLeague[];
  /** Every other public league, in the list's order (most recent activity first). */
  others: BrowseLeague[];
  /** The newest replays across the public leagues, for when nothing is live. */
  replays: BrowseReplay[];
};

export const BROWSE_REPLAY_LIMIT = 6;

function time(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function buildBrowseView(
  leagues: PublicLeagueSummary[],
  statuses: Readonly<Record<string, StreamStatus>>,
  replayLimit = BROWSE_REPLAY_LIMIT
): BrowseView {
  const rows: BrowseLeague[] = leagues.map((league) => {
    const stream = readStreamLink(league.stream_url);
    const status = (stream && statuses[stream.url]) || NOT_LIVE;
    return {
      ...league,
      stream,
      status,
      streamLive: Boolean(stream) && status.live,
      draftLive: draftRunning(league),
    };
  });

  const live = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.streamLive || row.draftLive)
    .sort(
      (a, b) =>
        Number(b.row.streamLive) - Number(a.row.streamLive) ||
        (b.row.status.viewers ?? 0) - (a.row.status.viewers ?? 0) ||
        a.index - b.index
    )
    .map(({ row }) => row);
  const liveIds = new Set(live.map((row) => row.id));

  const replays = rows
    .flatMap((row) =>
      readReplayEntries(row.replay_links).map((entry) => ({
        leagueId: row.id,
        leagueName: row.name,
        title: entry.title,
        url: entry.url,
        link: entry.link,
        addedAt: entry.added_at ?? null,
      }))
    )
    .map((replay, index) => ({ replay, index }))
    .sort((a, b) => time(b.replay.addedAt) - time(a.replay.addedAt) || a.index - b.index)
    .slice(0, replayLimit)
    .map(({ replay }) => replay);

  return { live, others: rows.filter((row) => !liveIds.has(row.id)), replays };
}

/** Picks in the whole draft: drafting coaches times picks per team. */
export function totalPicks(draftingCount: number, picksPerTeam: number | null): number {
  return Math.max(0, draftingCount) * Math.max(0, picksPerTeam ?? 0);
}

/** "Pick 9 of 64", clamped to the last pick. */
function pickProgress(current: number | null, total: number): string {
  const pick = Math.min(Math.max(1, current ?? 1), Math.max(1, total));
  return total > 0 ? `pick ${pick} of ${total}` : `pick ${pick}`;
}

export type StatusTone = "live" | "paused" | "season" | "champion" | "idle";

/** A league's one status line: a dot (or trophy) by tone, a label, and a muted detail. */
export type LeagueStatus = { tone: StatusTone; label: string; detail: string | null };

function draftDetail(league: PublicLeagueSummary): string {
  const total = totalPicks(league.drafting_count, league.picks_per_team);
  const progress = pickProgress(league.current_pick_number, total);
  const onClock = league.on_clock ? ` · ${teamNameLabel(league.on_clock.team_name)} on the clock` : "";
  return `${progress.charAt(0).toUpperCase()}${progress.slice(1)}${onClock}`;
}

/**
 * The league's status on Watch: the stream while it is on air, then the
 * draft's progress, then the season's, then the champion.
 */
export function leagueStatus(
  league: PublicLeagueSummary,
  stream?: Pick<BrowseLeague, "stream" | "status" | "streamLive">
): LeagueStatus {
  const drafting = league.draft_started && !league.draft_completed;

  if (stream?.streamLive && stream.stream) {
    const viewers =
      stream.status.viewers !== null ? `${stream.status.viewers.toLocaleString("en-US")} watching` : null;
    const draft = drafting && !league.draft_paused ? draftDetail(league) : null;
    return {
      tone: "live",
      label: `Live on ${platformOf(stream.stream)}`,
      detail: [viewers, draft].filter(Boolean).join(" · ") || null,
    };
  }
  if (drafting) {
    if (league.draft_paused) {
      const total = totalPicks(league.drafting_count, league.picks_per_team);
      const progress = pickProgress(league.current_pick_number, total);
      return { tone: "paused", label: "Draft paused", detail: `${progress.charAt(0).toUpperCase()}${progress.slice(1)}` };
    }
    return { tone: "live", label: "Drafting now", detail: draftDetail(league) };
  }
  if (!league.draft_started) {
    return {
      tone: "idle",
      label: "Setting up",
      detail: `${league.coach_count} of ${pluralize(league.max_coaches, "coach", "coaches")}`,
    };
  }
  if (league.champion) {
    return { tone: "champion", label: "Champion", detail: teamNameLabel(league.champion.team_name) };
  }
  if (league.regular_total > 0) {
    return {
      tone: "season",
      label: "In season",
      detail: `${league.regular_played} of ${pluralize(league.regular_total, "match", "matches")} played`,
    };
  }
  return { tone: "season", label: "Draft complete", detail: null };
}

export type WatchPhase = "setup" | "live" | "paused" | "completed";

export function publicPhase(league: Pick<PublicLeague, "draft_started" | "draft_completed" | "draft_paused_at">): WatchPhase {
  if (league.draft_completed) return "completed";
  if (!league.draft_started) return "setup";
  return league.draft_paused_at ? "paused" : "live";
}

/** Seconds left on the clock of the coach on it, from the server's time; null outside a running draft. */
export function clockSecondsLeft(
  league: Pick<PublicLeague, "draft_started" | "draft_completed" | "draft_paused_at" | "pick_started_at" | "pick_timer_seconds">,
  serverNowMs: number
): number | null {
  if (publicPhase(league) !== "live" || !league.pick_started_at) return null;
  const deadline = time(league.pick_started_at) + league.pick_timer_seconds * 1000;
  return Math.max(0, Math.ceil((deadline - serverNowMs) / 1000));
}

/** 83 -> "1:23". */
export function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * What the watch page plays first: the stream while it is on air, while the
 * draft runs, or when nobody could check it (no API keys; the platform's own
 * player says whether it is live); otherwise the newest replay. Null when
 * the league has neither.
 */
export function defaultSource(
  league: Pick<PublicLeague, "stream_url" | "replay_links" | "draft_started" | "draft_completed" | "draft_paused_at">,
  status: StreamStatus
): "stream" | number | null {
  const stream = readStreamLink(league.stream_url);
  const replays = readReplayEntries(league.replay_links);
  if (stream && (status.live || !status.checked || draftRunning(league) || replays.length === 0)) return "stream";
  return replays.length > 0 ? 0 : null;
}
