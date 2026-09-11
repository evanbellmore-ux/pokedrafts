"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import {
  Alert,
  Button,
  ButtonLink,
  PageHeader,
  Skeleton,
  SkeletonLines,
  StatusPill,
} from "@/app/components/ui";
import { friendlyError } from "@/app/lib/errors";
import { pluralize } from "@/app/lib/league/labels";
import { createClient } from "@/app/lib/supabase/client";
import CoachesList from "./CoachesList";
import InviteCard from "./InviteCard";
import { readLeaguePool } from "./leaguePool";
import NewsFeed from "./NewsFeed";
import type { Notice } from "./notice";
import {
  INVITE_SELECT,
  MATCH_SELECT,
  MEMBER_SELECT,
  mergeNews,
  NEWS_PAGE_SIZE,
  NEWS_SELECT,
  sortCoaches,
  type OverviewInvite,
  type OverviewMatch,
  type OverviewMember,
  type OverviewNews,
} from "./overview";
import OverviewStatusCard from "./OverviewStatusCard";
import { leaguePhase, PHASE_PILL } from "./season";
import { useLeagueRealtime } from "./useLeagueRealtime";

type OverviewData = {
  members: OverviewMember[];
  invite: OverviewInvite | null;
  matches: OverviewMatch[];
  news: OverviewNews[];
  hasMoreNews: boolean;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: OverviewData };

function OverviewSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <div className="rounded-xl border border-line bg-panel p-5">
        <Skeleton className="h-6 w-48 max-w-full" />
        <SkeletonLines lines={3} className="mt-4" />
      </div>
      <div className="rounded-xl border border-line bg-panel p-5">
        <Skeleton className="h-6 w-32" />
        <SkeletonLines lines={4} className="mt-4" />
      </div>
    </div>
  );
}

/**
 * League overview: phase-aware status card, the commissioner's invite link,
 * the coaches list with membership actions, and the live news feed. The
 * league and the caller's membership come from the server-seeded context;
 * this page loads only the rows it renders.
 */
export default function LeagueOverviewClient() {
  const { league, isCommissioner, refresh } = useLeague();
  const supabase = useMemo(() => createClient(), []);
  const leagueId = league.id;
  const canManageInvite = isCommissioner && !league.draft_started;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the newest request may apply its result (stale responses from an
  // earlier reload are dropped).
  const generation = useRef(0);

  const load = useCallback(
    async (newsLimit: number): Promise<LoadState> => {
      try {
        const invitePromise = canManageInvite
          ? supabase
              .from("league_invites")
              .select(INVITE_SELECT)
              .eq("league_id", leagueId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : null;

        const [membersResult, matchesResult, newsResult] = await Promise.all([
          supabase
            .from("league_members")
            .select(MEMBER_SELECT)
            .eq("league_id", leagueId),
          supabase
            .from("league_matches")
            .select(MATCH_SELECT)
            .eq("league_id", leagueId)
            .order("round_number", { ascending: true })
            .order("match_number", { ascending: true }),
          supabase
            .from("league_news")
            .select(NEWS_SELECT)
            .eq("league_id", leagueId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(newsLimit),
        ]);
        const inviteResult = invitePromise ? await invitePromise : null;

        if (membersResult.error) {
          return { status: "error", message: friendlyError(membersResult.error) };
        }
        if (matchesResult.error) {
          return { status: "error", message: friendlyError(matchesResult.error) };
        }
        if (newsResult.error) {
          return { status: "error", message: friendlyError(newsResult.error) };
        }
        if (inviteResult?.error) {
          return { status: "error", message: friendlyError(inviteResult.error) };
        }

        const news = (newsResult.data ?? []) as OverviewNews[];
        return {
          status: "ready",
          data: {
            members: sortCoaches((membersResult.data ?? []) as OverviewMember[]),
            invite: (inviteResult?.data ?? null) as OverviewInvite | null,
            matches: (matchesResult.data ?? []) as OverviewMatch[],
            news,
            hasMoreNews: news.length >= newsLimit,
          },
        };
      } catch (caught) {
        return { status: "error", message: friendlyError(caught) };
      }
    },
    [supabase, leagueId, canManageInvite]
  );

  useEffect(() => {
    let active = true;
    const current = generation.current + 1;
    generation.current = current;
    void load(NEWS_PAGE_SIZE).then((next) => {
      if (active && current === generation.current) setState(next);
    });
    return () => {
      active = false;
      // A reload that started before this cleanup must not apply either.
      generation.current += 1;
    };
  }, [load]);

  const newsCount = state.status === "ready" ? state.data.news.length : 0;

  /** Refetches everything, keeping as many news rows as are on screen. */
  const reload = useCallback(async () => {
    const current = generation.current + 1;
    generation.current = current;
    const next = await load(Math.max(NEWS_PAGE_SIZE, newsCount));
    if (current !== generation.current) return;

    if (next.status === "error") {
      // Keep what is on screen; the banner offers a retry.
      setReloadError(next.message);
      setState((previous) => (previous.status === "ready" ? previous : next));
      return;
    }
    setReloadError(null);
    setState(next);
  }, [load, newsCount]);

  const liveStatus = useLeagueRealtime({
    supabase,
    leagueId,
    name: "overview",
    tables: ["leagues", "league_members", "league_matches", "league_news"],
    onChange: (table) => {
      if (table === "leagues" || table === null) void refresh();
      if (table !== "leagues") void reload();
    },
  });

  function retry() {
    setState({ status: "loading" });
    setReloadError(null);
    void reload();
  }

  /** After an RPC changed the league or a coach: reload, then announce. */
  async function handleMutated(message: string) {
    const refreshError = await refresh();
    await reload();
    setNotice(
      refreshError
        ? {
            variant: "warning",
            text: `${message} The league could not be reloaded: ${refreshError}`,
          }
        : { variant: "success", text: message }
    );
  }

  async function loadMoreNews() {
    if (state.status !== "ready" || loadingMore) return;
    const oldest = state.data.news[state.data.news.length - 1];
    if (!oldest) return;

    setLoadingMore(true);
    try {
      const { data, error } = await supabase
        .from("league_news")
        .select(NEWS_SELECT)
        .eq("league_id", leagueId)
        .lt("created_at", oldest.created_at)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(NEWS_PAGE_SIZE);

      if (error) {
        setReloadError(friendlyError(error));
        return;
      }

      const page = (data ?? []) as OverviewNews[];
      setState((previous) =>
        previous.status !== "ready"
          ? previous
          : {
              status: "ready",
              data: {
                ...previous.data,
                news: mergeNews(previous.data.news, page),
                hasMoreNews: page.length >= NEWS_PAGE_SIZE,
              },
            }
      );
    } catch (caught) {
      setReloadError(friendlyError(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  const ready = state.status === "ready" ? state.data : null;
  const loading = state.status === "loading";
  const pool = readLeaguePool(league);
  const picks = league.picks_per_team ?? 10;
  const budget = league.point_budget ?? 100;
  // The season / complete split needs the matches, so the pill waits for
  // them; setup and drafting are known from the league row alone.
  const phase = leaguePhase(league, ready?.matches ?? []);
  const showPhase = ready !== null || !league.draft_completed;
  const pill = PHASE_PILL[phase];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="League overview"
        title={league.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {showPhase && <StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
            <span>
              {ready ? `${ready.members.length} of ` : ""}
              {pluralize(league.max_coaches, "coach", "coaches")}
            </span>
            <span aria-hidden="true">·</span>
            <span>{pool.pokemon.length} Pokémon in the draft pool</span>
            <span aria-hidden="true">·</span>
            <span>{pluralize(picks, "pick")} per team</span>
            <span aria-hidden="true">·</span>
            <span>{pluralize(budget, "point")} to spend</span>
          </span>
        }
        actions={
          isCommissioner ? (
            <ButtonLink href={`/leagues/${leagueId}/settings`} variant="secondary">
              Settings
            </ButtonLink>
          ) : undefined
        }
      />

      {notice && (
        <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {reloadError && (
        <Alert
          variant="error"
          title="Could not refresh the overview"
          action={
            <Button size="sm" variant="secondary" onClick={() => void reload()}>
              Retry
            </Button>
          }
        >
          {reloadError}
        </Alert>
      )}

      {state.status === "error" ? (
        <Alert
          variant="error"
          title="Could not load the league overview"
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            {ready ? (
              <>
                <OverviewStatusCard
                  members={ready.members}
                  matches={ready.matches}
                />
                {canManageInvite && (
                  <InviteCard
                    invite={ready.invite}
                    coachCount={ready.members.length}
                    onRegenerated={handleMutated}
                  />
                )}
                <CoachesList members={ready.members} onChanged={handleMutated} />
              </>
            ) : (
              <OverviewSkeleton />
            )}
          </div>
          <NewsFeed
            loading={loading}
            news={ready?.news ?? []}
            hasMore={ready?.hasMoreNews ?? false}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMoreNews()}
            onUndone={handleMutated}
            liveStatus={liveStatus}
          />
        </div>
      )}
    </div>
  );
}
