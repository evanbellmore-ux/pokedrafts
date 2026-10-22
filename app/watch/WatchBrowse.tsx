"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Alert, Button, EmptyState, PageHeader } from "@/app/components/ui";
import { pluralize, teamNameLabel } from "@/app/lib/league/labels";
import { linkClassName } from "@/app/lib/theme";
import {
  platformOf,
  replayEmbedUrl,
  streamEmbedUrl,
  streamLabel,
} from "@/app/lib/watch/stream-links";
import {
  buildBrowseView,
  leagueStatus,
  totalPicks,
  type BrowseLeague,
  type BrowseReplay,
  type StreamStatus,
} from "@/app/lib/watch/watch-view";
import type { PublicLeagueSummary } from "@/app/types/league";
import StreamPlayer from "./StreamPlayer";
import { useAutoRefresh } from "./useAutoRefresh";
import WatchStatusLine from "./WatchStatusLine";

/** The list and the live checks are re-read this often while the tab is open. */
const REFRESH_MS = 60_000;

type WatchBrowseProps = {
  leagues: PublicLeagueSummary[] | null;
  error: string | null;
  statuses: Record<string, StreamStatus>;
};

/**
 * The Watch page: the public leagues that are live (stream on air or draft
 * running) with their players, the newest replays when nothing is, and every
 * other public league as a list. Server-rendered; `router.refresh()` re-reads
 * the list and the live checks every minute.
 */
export default function WatchBrowse({ leagues, error, statuses }: WatchBrowseProps) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useAutoRefresh(refresh, REFRESH_MS);

  const view = useMemo(() => buildBrowseView(leagues ?? [], statuses), [leagues, statuses]);
  const total = leagues?.length ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Watch"
        description={
          total > 0 ? `${pluralize(total, "public league")} · ${view.live.length} live now` : undefined
        }
      />

      {error !== null && (
        <Alert
          variant="error"
          title="Could not load the public leagues"
          action={
            <Button size="sm" variant="secondary" onClick={refresh}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {leagues && total === 0 && (
        <EmptyState
          title="No public leagues yet"
          description="A commissioner can make a league public in its Settings, with its Twitch or YouTube stream."
        />
      )}

      {view.live.length > 0 && (
        <section aria-labelledby="watch-live-heading">
          <h2 id="watch-live-heading" className="text-base font-semibold text-text">
            Live now
          </h2>
          <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
            {view.live.map((row) => (
              <LiveCard key={row.id} row={row} />
            ))}
          </ul>
        </section>
      )}

      {leagues && total > 0 && view.live.length === 0 && (
        <section aria-labelledby="watch-replays-heading">
          <h2 id="watch-replays-heading" className="text-base font-semibold text-text">
            Replays
          </h2>
          <p className="mt-1 text-sm text-muted">Nothing is live right now.</p>
          {view.replays.length > 0 ? (
            <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
              {view.replays.map((replay) => (
                <ReplayCard key={`${replay.leagueId}:${replay.url}`} replay={replay} />
              ))}
            </ul>
          ) : (
            <EmptyState className="mt-3" title="No replays yet" description="Leagues list their past streams in Settings." />
          )}
        </section>
      )}

      {view.others.length > 0 && (
        <section aria-labelledby="watch-leagues-heading">
          <h2 id="watch-leagues-heading" className="text-base font-semibold text-text">
            {view.live.length > 0 ? "More public leagues" : "Public leagues"}
          </h2>
          <ul className="mt-3 divide-y divide-hairline rounded-xl border border-hairline bg-panel/60">
            {view.others.map((row) => (
              <LeagueRow key={row.id} row={row} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function watchHref(leagueId: string) {
  return `/watch/${leagueId}`;
}

/** A stretched link over the card, like the dashboard's league cards; the player sits above it. */
const stretchedLink =
  "after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus";

/**
 * The cards' frame: the player runs edge to edge at the top (as large as the
 * column allows) and the text sits below it. The top is rounded on the
 * player itself, not clipped by the card, so the stretched link's focus ring
 * still shows around the whole card.
 */
const cardClass =
  "group relative flex flex-col rounded-xl border bg-panel/60 transition-colors hover:bg-panel";
const cardTop = "overflow-hidden rounded-t-[11px] border-b border-hairline";

function LiveCard({ row }: { row: BrowseLeague }) {
  const status = leagueStatus(row, row);
  const stream = row.stream;

  return (
    <li className={`${cardClass} border-accent-border`}>
      {stream ? (
        // The player takes clicks itself, so it sits above the card's link.
        <div className={`relative z-10 ${cardTop}`}>
          <StreamPlayer
            bare
            title={`${row.name} on ${platformOf(stream)}`}
            src={(host) =>
              streamEmbedUrl(stream, {
                host,
                liveVideoId: row.status.liveVideoId,
                channelId: row.status.channelId,
              })
            }
            fallback={<NoEmbed url={stream.url} label={streamLabel(stream)} />}
          />
        </div>
      ) : (
        <DraftTile row={row} />
      )}
      <div className="flex flex-col p-4">
        <WatchStatusLine status={status} />
        <h3 className="wrap-anywhere mt-1.5 text-base font-semibold tracking-tight text-text">
          <Link href={watchHref(row.id)} className={stretchedLink}>
            {row.name}
          </Link>
        </h3>
        {row.status.title && <p className="mt-0.5 truncate text-sm text-muted">{row.status.title}</p>}
        <span
          aria-hidden="true"
          className="mt-2 inline-flex items-center gap-1 self-start text-sm font-medium text-accent-text"
        >
          Watch the draft board and standings
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </span>
      </div>
    </li>
  );
}

/** Stands in for a player when a running draft has no stream: where the draft is. */
function DraftTile({ row }: { row: BrowseLeague }) {
  const total = totalPicks(row.drafting_count, row.picks_per_team);
  const pick = Math.min(Math.max(1, row.current_pick_number ?? 1), Math.max(1, total));
  return (
    <div className={`flex aspect-video w-full flex-col items-center justify-center gap-1 bg-bg/60 p-4 text-center ${cardTop}`}>
      <p className="text-3xl font-semibold tabular-nums tracking-tight text-text">
        Pick {pick}
        <span className="text-lg font-medium text-muted"> of {total}</span>
      </p>
      {row.on_clock && (
        <p className="wrap-anywhere text-sm text-muted">
          {teamNameLabel(row.on_clock.team_name)} is on the clock
        </p>
      )}
      {row.last_pick && (
        <p className="wrap-anywhere text-xs text-faint">
          Last pick: {row.last_pick.pokemon_name} to {teamNameLabel(row.last_pick.team_name)}
        </p>
      )}
    </div>
  );
}

function ReplayCard({ replay }: { replay: BrowseReplay }) {
  return (
    <li className={`${cardClass} border-hairline hover:border-hairline-strong`}>
      <div className={`relative z-10 ${cardTop}`}>
        <StreamPlayer
          bare
          title={`${replay.title}, ${replay.leagueName}`}
          src={(host) => replayEmbedUrl(replay.link, { host })}
        />
      </div>
      <div className="p-4">
        <p className="wrap-anywhere text-sm font-semibold text-text">{replay.title}</p>
        <p className="wrap-anywhere mt-0.5 text-sm text-muted">
          <Link href={watchHref(replay.leagueId)} className={stretchedLink}>
            {replay.leagueName}
          </Link>
          <span className="text-faint"> · {platformOf(replay.link)}</span>
        </p>
      </div>
    </li>
  );
}

function LeagueRow({ row }: { row: BrowseLeague }) {
  return (
    <li className="group relative flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-panel">
      <div className="min-w-0 flex-1">
        <p className="wrap-anywhere text-sm font-semibold text-text">
          <Link href={watchHref(row.id)} className={stretchedLink}>
            {row.name}
          </Link>
        </p>
        <WatchStatusLine status={leagueStatus(row, row)} className="mt-1" />
      </div>
      {row.stream && (
        <span className="hidden shrink-0 text-xs text-muted sm:inline">{platformOf(row.stream)}</span>
      )}
      <ArrowRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-text motion-reduce:transition-none"
      />
    </li>
  );
}

/** In the player's frame when the stream cannot be embedded (a YouTube @handle the server could not look up). */
export function NoEmbed({ url, label }: { url: string; label: string }) {
  return (
    <>
      <p className="text-sm text-muted">This stream plays on YouTube.</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${linkClassName} relative z-10 text-sm font-medium text-accent-text hover:underline`}
      >
        Open {label}
      </a>
    </>
  );
}
