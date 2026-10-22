"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { EmptyState, PageHeader } from "@/app/components/ui";
import { teamNameLabel } from "@/app/lib/league/labels";
import { getDraftRound } from "@/app/lib/league/draft";
import { rpc } from "@/app/lib/rpc";
import { linkClassName } from "@/app/lib/theme";
import {
  platformOf,
  readReplayEntries,
  readStreamLink,
  replayEmbedUrl,
  streamEmbedUrl,
  streamLabel,
} from "@/app/lib/watch/stream-links";
import {
  clockSecondsLeft,
  defaultSource,
  formatClock,
  leagueStatus,
  publicPhase,
  totalPicks,
  type StreamStatus,
} from "@/app/lib/watch/watch-view";
import type { PublicLeague, PublicLeagueSummary } from "@/app/types/league";
import DraftBoard from "@/app/(app)/leagues/[leagueId]/draft/DraftBoard";
import { buildBoard } from "@/app/(app)/leagues/[leagueId]/draft/draft-room";
import StreamPlayer from "../StreamPlayer";
import { useAutoRefresh } from "../useAutoRefresh";
import { NoEmbed } from "../WatchBrowse";
import WatchStatusLine from "../WatchStatusLine";
import PublicStandings from "./PublicStandings";

/** A running draft is re-read this often; anything else once a minute. */
const DRAFT_POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;
/** The page itself (and so the stream's live check) is re-rendered this often. */
const STATUS_REFRESH_MS = 120_000;

type Source = "stream" | number;
type Panel = "board" | "standings";

type WatchLeagueClientProps = {
  initial: PublicLeague;
  status: StreamStatus;
};

/** `get_public_league`'s row in the shape the Watch list's status line reads. */
function asSummary(league: PublicLeague): PublicLeagueSummary {
  const drafting = league.coaches.filter((coach) => coach.draft_position !== null);
  const names = new Map(league.coaches.map((coach) => [coach.id, coach.team_name]));
  const regular = league.matches.filter((match) => match.stage === "regular");
  const lastPick = league.picks.at(-1);
  return {
    id: league.id,
    name: league.name,
    coach_count: league.coaches.length,
    drafting_count: drafting.length,
    max_coaches: league.max_coaches,
    picks_per_team: league.picks_per_team,
    current_pick_number: league.current_pick_number,
    draft_started: league.draft_started,
    draft_completed: league.draft_completed,
    draft_paused: Boolean(league.draft_paused_at),
    pick_deadline: null,
    on_clock: league.on_clock_member_id ? { team_name: names.get(league.on_clock_member_id) ?? null } : null,
    last_pick: lastPick
      ? { pick_number: lastPick.pick_number, pokemon_name: lastPick.pokemon_name, team_name: names.get(lastPick.member_id) ?? null }
      : null,
    regular_played: regular.filter((match) => match.status === "completed").length,
    regular_total: regular.length,
    champion: league.champion_member_id ? { team_name: names.get(league.champion_member_id) ?? null } : null,
    stream_url: league.stream_url,
    replay_links: league.replay_links,
    last_activity: null,
  };
}

/**
 * One public league: its stream (or a replay) next to a read-only draft
 * board and, once the draft is done, the standings. A signed-out visitor
 * cannot subscribe to the league's tables, so the page polls
 * `get_public_league`: every 10 s while the draft runs, else every minute.
 * The stream's live status comes from the server render, refreshed every
 * two minutes.
 */
export default function WatchLeagueClient({ initial, status }: WatchLeagueClientProps) {
  const router = useRouter();
  const [league, setLeague] = useState(initial);
  const [seed, setSeed] = useState(initial);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const offsetRef = useRef(0);

  // A server re-render brings a newer snapshot; take it unless the page's
  // own poll already has a newer one.
  if (seed !== initial) {
    setSeed(initial);
    if (Date.parse(initial.server_time) >= Date.parse(league.server_time)) setLeague(initial);
  }

  const fetchLeague = useCallback(async () => {
    const sentAt = Date.now();
    const result = await rpc.getPublicLeague(initial.id);
    return { result, sentAt, receivedAt: Date.now() };
  }, [initial.id]);

  /** Re-reads the league and applies it unless a newer read has started. */
  const poll = useCallback(() => {
    const generation = ++generationRef.current;
    return fetchLeague().then(({ result, sentAt, receivedAt }) => {
      if (generation !== generationRef.current) return;
      if (result.error !== null) {
        setRefreshError(result.error);
        return;
      }
      setRefreshError(null);
      if (!result.data) {
        // Made private or deleted: the server render shows the 404.
        router.refresh();
        return;
      }
      offsetRef.current = Date.parse(result.data.server_time) - (sentAt + receivedAt) / 2;
      setLeague(result.data);
    });
  }, [fetchLeague, router]);

  const phase = publicPhase(league);
  useAutoRefresh(poll, phase === "live" ? DRAFT_POLL_MS : IDLE_POLL_MS);
  const refreshPage = useCallback(() => router.refresh(), [router]);
  useAutoRefresh(refreshPage, STATUS_REFRESH_MS);

  // A running draft needs the server's clock for its countdown, which the
  // server-rendered snapshot cannot give: read it once from here.
  useEffect(() => {
    if (publicPhase(initial) === "live") void poll();
  }, [initial, poll]);

  const stream = readStreamLink(league.stream_url);
  const replays = useMemo(() => readReplayEntries(league.replay_links), [league.replay_links]);
  const [picked, setPicked] = useState<Source | null>(null);
  const fallbackSource = defaultSource(league, status);
  const source: Source | null =
    picked === "stream" && stream ? "stream" : typeof picked === "number" && replays[picked] ? picked : fallbackSource;

  const [panel, setPanel] = useState<Panel | null>(null);
  const shownPanel: Panel = league.draft_completed ? (panel ?? "standings") : "board";

  const board = useMemo(() => {
    const coaches = league.coaches.filter((coach) => coach.draft_position !== null);
    const membersById = new Map(league.coaches.map((coach) => [coach.id, coach] as const));
    const last = league.draft_completed
      ? totalPicks(coaches.length, league.picks_per_team)
      : (league.current_pick_number ?? 1) - 1;
    return buildBoard(league.picks, coaches, membersById, last);
  }, [league]);

  const statusLine = leagueStatus(asSummary(league), {
    stream,
    status,
    streamLive: Boolean(stream) && status.live,
  });

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="-mb-3 text-sm text-muted">
        <ol className="flex min-w-0 items-center gap-1.5">
          <li>
            <Link href="/watch" className={`${linkClassName} hover:text-text`}>
              Watch
            </Link>
          </li>
          <li aria-hidden="true" className="text-faint">
            /
          </li>
          <li className="min-w-0 truncate" aria-current="page">
            {league.name}
          </li>
        </ol>
      </nav>

      <PageHeader
        title={league.name}
        description={<WatchStatusLine status={statusLine} size="sm" />}
        actions={
          stream && (
            <a
              href={stream.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${linkClassName} inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-text`}
            >
              Open on {platformOf(stream)}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )
        }
      />

      {refreshError && (
        <p role="status" className="text-sm text-warning">
          Could not refresh the league. {refreshError}
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {source === "stream" && stream ? (
            <StreamPlayer
              title={`${league.name} on ${platformOf(stream)}`}
              src={(host) =>
                streamEmbedUrl(stream, {
                  host,
                  autoplay: status.live,
                  liveVideoId: status.liveVideoId,
                  channelId: status.channelId,
                })
              }
              fallback={<NoEmbed url={stream.url} label={streamLabel(stream)} />}
            />
          ) : typeof source === "number" && replays[source] ? (
            <StreamPlayer
              title={`${replays[source].title}, ${league.name}`}
              src={(host) => replayEmbedUrl(replays[source].link, { host })}
            />
          ) : (
            <EmptyState
              title="No stream or replays"
              description="This league has not attached a stream. Its draft board and standings update here as it plays."
            />
          )}
          {status.live && status.title && source === "stream" && (
            <p className="-mt-1 wrap-anywhere text-sm text-muted">{status.title}</p>
          )}

          {replays.length > 0 && (
            <section aria-labelledby="watch-sources-heading">
              <h2 id="watch-sources-heading" className="text-sm font-semibold text-text">
                {stream ? "Stream and replays" : "Replays"}
              </h2>
              <ul className="mt-2 flex flex-col gap-1">
                {stream && (
                  <li>
                    <SourceButton
                      pressed={source === "stream"}
                      onClick={() => setPicked("stream")}
                      title={status.live ? "Live now" : "Stream"}
                      detail={streamLabel(stream)}
                    />
                  </li>
                )}
                {replays.map((replay, index) => (
                  <li key={replay.url}>
                    <SourceButton
                      pressed={source === index}
                      onClick={() => setPicked(index)}
                      title={replay.title}
                      detail={platformOf(replay.link)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {(phase === "live" || phase === "paused") && <DraftClock league={league} offsetRef={offsetRef} />}

          {league.draft_completed && (
            <div
              role="group"
              aria-label="Show"
              className="flex self-start rounded-lg border border-line bg-bg/40 p-1"
            >
              {(
                [
                  ["standings", "Standings"],
                  ["board", "Draft board"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={shownPanel === value}
                  onClick={() => setPanel(value)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    shownPanel === value ? "bg-panel-hover text-text shadow-sm" : "text-muted hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {shownPanel === "standings" ? (
            <PublicStandings league={league} />
          ) : (
            <DraftBoard board={board} loading={false} pokemon={league.pokemon} />
          )}
        </div>
      </div>
    </div>
  );
}

function SourceButton({
  pressed,
  onClick,
  title,
  detail,
}: {
  pressed: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
        pressed ? "border-accent-border bg-accent-soft text-text" : "border-hairline text-muted hover:bg-panel hover:text-text"
      }`}
    >
      <span className="min-w-0 truncate font-medium">{title}</span>
      <span className="shrink-0 text-xs text-muted">{detail}</span>
    </button>
  );
}

/** Round, pick and the coach on the clock, with the clock counting down from the server's time. */
function DraftClock({
  league,
  offsetRef,
}: {
  league: PublicLeague;
  offsetRef: React.RefObject<number>;
}) {
  const [now, setNow] = useState<number | null>(null);
  const paused = Boolean(league.draft_paused_at);

  useEffect(() => {
    if (paused) return;
    const tick = () => setNow(Date.now() + offsetRef.current);
    const timer = window.setInterval(tick, 1000);
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [paused, offsetRef]);

  const drafting = league.coaches.filter((coach) => coach.draft_position !== null).length;
  const total = totalPicks(drafting, league.picks_per_team);
  const pick = Math.min(Math.max(1, league.current_pick_number ?? 1), Math.max(1, total));
  const round = drafting > 0 ? getDraftRound(pick, drafting) : 1;
  const onClock = league.coaches.find((coach) => coach.id === league.on_clock_member_id);
  const left = now === null ? null : clockSecondsLeft(league, now);

  return (
    <section aria-labelledby="watch-clock-heading" className="rounded-xl border border-accent-border bg-panel p-4">
      <h2 id="watch-clock-heading" className="text-xs font-medium text-muted">
        Round {round} · Pick {pick} of {total}
      </h2>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="wrap-anywhere text-base font-semibold text-text">
          {onClock ? `${teamNameLabel(onClock.team_name)} is on the clock` : "Waiting for the next pick"}
        </p>
        <p className="shrink-0 text-lg font-semibold tabular-nums text-text" aria-live="off">
          {paused ? "Paused" : left === null ? "" : formatClock(left)}
        </p>
      </div>
    </section>
  );
}
