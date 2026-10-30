"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Alert, Button, EmptyState, PageHeader, SkeletonLines, StatusPill } from "@/app/components/ui";
import { pluralize, teamNameLabel } from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import { linkClassName } from "@/app/lib/theme";
import { platformOf, readReplayEntries, readStreamLink, streamLabel } from "@/app/lib/watch/stream-links";
import { listingState, type ListingState } from "@/app/lib/watch/watch-view";
import type { WatchRenames, WatchReviewLeague } from "@/app/types/league";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; leagues: WatchReviewLeague[] };

/** The three groups, in the order `list_watch_review` returns them. */
export const REVIEW_GROUPS: ReadonlyArray<{ state: ListingState; title: string; empty: string }> = [
  { state: "waiting", title: "Waiting for review", empty: "No public league is waiting for review." },
  { state: "listed", title: "Listed on Watch", empty: "No league is listed on Watch yet." },
  { state: "unlisted", title: "Not listed", empty: "No league has been declined or unlisted." },
];

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

function formatDate(iso: string | null): string | null {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(time) ? null : dateFormat.format(time);
}

function draftState(league: WatchReviewLeague): string {
  if (league.draft_completed) return "Draft complete";
  return league.draft_started ? "Drafting" : "Setting up";
}

/** What a listed league renamed since its review, as one line (section 16.7). */
export function renamesLine(renamed: WatchRenames): string {
  const parts: string[] = [];
  if (renamed.league) parts.push("New league name");
  if (renamed.teams.length > 0) {
    parts.push(`${renamed.teams.length === 1 ? "New team name" : "New team names"}: ${renamed.teams.join(", ")}`);
  }
  return parts.join(" · ");
}

/**
 * The admin's Watch listings: every public league, and every listed one that
 * is private now, in three groups (waiting, listed, not listed) with what it
 * would put on /watch, its stream and its replays, and the actions that move
 * it. Approval sticks when the commissioner later changes the links or a name
 * changes; a renamed league is marked with its new names until Keep listed or
 * Unlist (section 16.7).
 */
export default function WatchReviewClient() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  /** The league being moved, and which way. */
  const [pending, setPending] = useState<{ id: string; listed: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const load = useCallback(async (): Promise<LoadState> => {
    const { data, error } = await rpc.listWatchReview();
    return error !== null ? { status: "error", message: error } : { status: "ready", leagues: data.leagues ?? [] };
  }, []);

  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [load]);

  async function review(league: WatchReviewLeague, listed: boolean) {
    if (pending) return;
    setPending({ id: league.id, listed });
    setActionError(null);
    const result = await rpc.setWatchListing(league.id, listed);
    if (result.error !== null) {
      setActionError(result.error);
    } else {
      setAnnouncement(`${league.name} ${listed ? "is listed on Watch" : "is not listed on Watch"}.`);
      setState(await load());
    }
    setPending(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Watch listings"
        description="Public leagues appear on the Watch page only once you approve them. Their own watch links work either way."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load().then(setState)} disabled={pending !== null}>
            Refresh
          </Button>
        }
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {actionError && (
        <Alert variant="error" title="Could not change the listing" onDismiss={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {state.status === "loading" ? (
        <SkeletonLines lines={4} />
      ) : state.status === "error" ? (
        <EmptyState
          title="Could not load the public leagues"
          description={state.message}
          action={
            <Button variant="secondary" onClick={() => void load().then(setState)}>
              Try again
            </Button>
          }
        />
      ) : (
        REVIEW_GROUPS.map((group) => {
          const leagues = state.leagues.filter((league) => listingState(league) === group.state);
          const headingId = `review-${group.state}-heading`;
          return (
            <section key={group.state} aria-labelledby={headingId} className="flex flex-col gap-3">
              <h2 id={headingId} className="text-base font-semibold text-text">
                {group.title} <span className="font-normal text-muted">({leagues.length})</span>
              </h2>
              {leagues.length === 0 ? (
                <p className="text-sm text-muted">{group.empty}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {leagues.map((league) => (
                    <ReviewRow
                      key={league.id}
                      league={league}
                      state={group.state}
                      busy={pending !== null}
                      pending={pending?.id === league.id ? pending.listed : null}
                      onReview={(listed) => void review(league, listed)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

export function ReviewRow({
  league,
  state,
  busy,
  pending,
  onReview,
}: {
  league: WatchReviewLeague;
  state: ListingState;
  /** Any league is being moved: every action waits. */
  busy: boolean;
  /** This league is being moved: listed (true) or not (false); null otherwise. */
  pending: boolean | null;
  onReview: (listed: boolean) => void;
}) {
  const stream = readStreamLink(league.stream_url);
  const replays = readReplayEntries(league.replay_links);
  const created = formatDate(league.created_at);
  const reviewed = formatDate(league.watch_reviewed_at);
  /** Only a listed league carries renames: marked until Keep listed or Unlist. */
  const renamed = state === "listed" ? (league.renamed ?? null) : null;
  /** Listed, but private now: off the Watch list until it is public again. */
  const offWatch = state === "listed" && league.is_public === false;
  const facts = [
    `${teamNameLabel(league.commissioner_team)} runs it`,
    `${league.coach_count} of ${pluralize(league.max_coaches, "coach", "coaches")}`,
    draftState(league),
    created ? `made ${created}` : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/watch/${league.id}`} className={`${linkClassName} min-w-0 wrap-anywhere font-semibold text-text hover:underline`}>
            {league.name}
          </Link>
          {renamed && <StatusPill tone="warning">Renamed since approval</StatusPill>}
          {offWatch && <StatusPill>Private</StatusPill>}
        </div>
        {renamed && <p className="wrap-anywhere text-sm text-muted">{renamesLine(renamed)}</p>}
        {offWatch && <p className="text-sm text-muted">Off Watch until it is public again.</p>}
        <p className="text-sm text-muted">{facts.join(" · ")}</p>
        <p className="min-w-0 text-sm text-muted">
          {stream ? (
            <>
              Stream:{" "}
              <a href={stream.url} target="_blank" rel="noopener noreferrer" className={`${linkClassName} inline-flex items-center gap-1 text-text hover:underline`}>
                <span className="wrap-anywhere">{streamLabel(stream)}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">(opens {platformOf(stream)} in a new tab)</span>
              </a>
            </>
          ) : (
            "No stream"
          )}
        </p>
        {replays.length > 0 ? (
          <details className="text-sm text-muted">
            <summary className="cursor-pointer">{pluralize(replays.length, "replay", "replays")}</summary>
            <ul className="mt-1.5 flex flex-col gap-1 pl-4">
              {replays.map((replay) => (
                <li key={replay.url} className="min-w-0">
                  <a href={replay.url} target="_blank" rel="noopener noreferrer" className={`${linkClassName} wrap-anywhere text-text hover:underline`}>
                    {replay.title}
                  </a>{" "}
                  · {platformOf(replay.link)}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="text-sm text-muted">No replays</p>
        )}
        {state !== "waiting" && reviewed && (
          <p className="text-xs text-faint">
            {state === "listed" ? "Approved" : "Unlisted"} {reviewed}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {state === "listed" ? (
          <>
            {renamed && (
              <Button size="sm" onClick={() => onReview(true)} disabled={busy} pending={pending === true} pendingText="Keeping..." aria-label={`Keep ${league.name} listed`}>
                Keep listed
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => onReview(false)} disabled={busy} pending={pending === false} pendingText="Unlisting..." aria-label={`Unlist ${league.name}`}>
              Unlist
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => onReview(true)} disabled={busy} pending={pending === true} pendingText="Approving..." aria-label={`Approve ${league.name}`}>
            Approve
          </Button>
        )}
        {state === "waiting" && (
          <Button variant="secondary" size="sm" onClick={() => onReview(false)} disabled={busy} pending={pending === false} pendingText="Declining..." aria-label={`Decline ${league.name}`}>
            Decline
          </Button>
        )}
      </div>
    </li>
  );
}
