"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Users } from "lucide-react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import {
  Alert,
  Button,
  ButtonLink,
  EmptyState,
  Field,
  Input,
  PageHeader,
} from "@/app/components/ui";
import { friendlyError } from "@/app/lib/errors";
import { pluralize, teamNameLabel } from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import type { DraftPokemon } from "@/app/types/draft";
import LiveStatusPill from "../LiveStatusPill";
import { useLeagueRealtime } from "../useLeagueRealtime";
import RosterStats from "../team/RosterStats";
import {
  ROSTER_ONLY_SELECT,
  leagueBudget,
  leaguePicksPerTeam,
  parseTeamRosters,
  pokemonKey,
  rosterPoints,
  swapsRemaining as countSwapsRemaining,
  type TeamRoster,
} from "../team/roster";
import FreeAgentList from "./FreeAgentList";
import SwapDialog, { type PendingMove } from "./SwapDialog";
import YourTeamPicker from "./YourTeamPicker";
import {
  filterFreeAgents,
  listFreeAgents,
  moveBlocker,
  ownedKeys,
  pointsAfterMove,
  readPool,
  type MoveContext,
} from "./freeAgents";

type LoadResult =
  | { status: "error"; message: string }
  | { status: "ready"; teams: TeamRoster[] };

type RosterState = { status: "loading" } | LoadResult;

type Notice = { variant: "success" | "error" | "warning"; text: string };

const NO_TEAMS: TeamRoster[] = [];

/**
 * Free Agents: the undrafted part of the league's pool, the coach's roster
 * as drop toggles, and the confirm dialog that calls `swap_free_agent`.
 * League and member rows come from `useLeague()`; rosters are read from
 * `drafted_teams` and kept fresh over realtime.
 */
export default function FreeAgentsClient() {
  const { league, member, refresh } = useLeague();
  const leagueId = league.id;
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<RosterState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [search, setSearch] = useState("");
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [move, setMove] = useState<PendingMove | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (): Promise<LoadResult> => {
    try {
      const { data, error } = await supabase
        .from("drafted_teams")
        .select(ROSTER_ONLY_SELECT)
        .eq("league_id", leagueId);

      if (error) return { status: "error", message: friendlyError(error) };
      return { status: "ready", teams: parseTeamRosters(data) };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [supabase, leagueId]);

  /**
   * Reloads and applies the result unless a newer reload started in the
   * meantime: realtime events, the Refresh button and an Add click can
   * overlap, and the most recent request must win.
   */
  const reload = useCallback(async (): Promise<LoadResult> => {
    generation.current += 1;
    const current = generation.current;
    const next = await load();
    if (generation.current === current) setState(next);
    return next;
  }, [load]);

  useEffect(() => {
    let active = true;
    generation.current += 1;
    const current = generation.current;
    void load().then((next) => {
      if (!active || generation.current !== current) return;
      setState(next);
    });
    return () => {
      active = false;
    };
  }, [load]);

  // A swap or an undo changes drafted_teams, league_news and the member's
  // swap count together, so both the rosters and the league context reload.
  // The league row is watched as well: a new swap limit or a draft reset
  // (which also empties drafted_teams, whose delete events do not carry the
  // league filter column) shows up without a manual refresh. The hook gives
  // every subscription a topic of its own (a reused topic would attach to
  // the channel the previous cleanup is still leaving and never report
  // "Live") and calls back with `null` after a reconnect so anything missed
  // while the socket was down is read again.
  const liveStatus = useLeagueRealtime({
    supabase,
    leagueId,
    name: "free-agents",
    tables: ["leagues", "drafted_teams", "league_news"],
    onChange: () => {
      void reload();
      void refresh();
    },
  });

  const draftCompleted = Boolean(league.draft_completed);
  const loading = state.status === "loading";
  const failed = state.status === "error";
  const teams = state.status === "ready" ? state.teams : NO_TEAMS;
  const myTeam = teams.find((team) => team.member_id === member.id) ?? null;
  const myRoster = useMemo(() => myTeam?.pokemon ?? [], [myTeam]);

  const budget = leagueBudget(league);
  const picksPerTeam = leaguePicksPerTeam(league);
  const swapLimit = league.free_agent_swap_limit;
  const swapsRemaining = countSwapsRemaining(league, member);
  const pointsUsed = myTeam ? myTeam.total_points : rosterPoints(myRoster);
  const hasOpenSlot = myRoster.length < picksPerTeam;
  const drop =
    dropKey === null
      ? null
      : (myRoster.find((entry) => pokemonKey(entry.name) === dropKey) ?? null);

  // The selected Pokémon left the roster under us (a commissioner undo, a
  // move from another tab): clear the selection so the toggles tell the
  // truth. React's "adjusting state when a prop changes" pattern.
  if (state.status === "ready" && dropKey !== null && drop === null) {
    setDropKey(null);
  }

  const pool = useMemo(() => readPool(league), [league]);
  const freeAgents = useMemo(() => listFreeAgents(pool, teams), [pool, teams]);
  const visible = useMemo(
    () => filterFreeAgents(freeAgents, search),
    [freeAgents, search]
  );

  const busy = preparing !== null || submitting;
  const canAct =
    draftCompleted && myTeam !== null && swapsRemaining > 0 && !busy;

  const context: MoveContext = {
    draftCompleted,
    hasTeam: myTeam !== null,
    swapsRemaining,
    rosterSize: myRoster.length,
    picksPerTeam,
    pointsUsed,
    budget,
    drop,
  };

  const draftHref = `/leagues/${leagueId}/draft`;

  function handleRetry() {
    setState({ status: "loading" });
    void reload();
  }

  async function handleRefresh() {
    if (reloading) return;
    setReloading(true);
    const [, refreshError] = await Promise.all([reload(), refresh()]);
    setReloading(false);
    // A roster read error is shown by the list; a failed league-context
    // refresh (swap count, draft flag) would otherwise pass silently.
    if (refreshError) setNotice({ variant: "error", text: refreshError });
  }

  /**
   * Re-reads every roster (and the league context) right before the dialog
   * opens so the availability it shows is current, then checks the move
   * against the fresh rows.
   */
  async function handleAdd(add: DraftPokemon) {
    if (busy) return;
    setPreparing(add.name);
    setNotice(null);

    const [fresh, refreshError] = await Promise.all([reload(), refresh()]);
    setPreparing(null);

    if (fresh.status === "error") {
      setNotice({ variant: "error", text: fresh.message });
      return;
    }
    if (refreshError) {
      setNotice({ variant: "error", text: refreshError });
      return;
    }

    const mine =
      fresh.teams.find((team) => team.member_id === member.id) ?? null;
    if (!mine) {
      setNotice({
        variant: "error",
        text: "You do not have a roster in this league.",
      });
      return;
    }

    if (ownedKeys(fresh.teams).has(pokemonKey(add.name))) {
      setNotice({
        variant: "warning",
        text: `${add.name} was just picked up by another team.`,
      });
      return;
    }

    // Check the move the coach sees on screen against the fresh rows.
    const wantedKey = drop ? pokemonKey(drop.name) : null;
    const freshDrop =
      wantedKey === null
        ? null
        : (mine.pokemon.find((entry) => pokemonKey(entry.name) === wantedKey) ??
          null);

    if (wantedKey !== null && !freshDrop) {
      setDropKey(null);
      setNotice({
        variant: "warning",
        text: "Your roster changed. Pick a Pokémon to drop again.",
      });
      return;
    }

    if (!freshDrop && mine.pokemon.length >= picksPerTeam) {
      setNotice({
        variant: "warning",
        text: "Your roster is full. Pick a Pokémon to drop first.",
      });
      return;
    }

    setMove({
      add,
      drop: freshDrop,
      pointsAfter: pointsAfterMove(
        { pointsUsed: mine.total_points, drop: freshDrop },
        add
      ),
    });
  }

  async function confirmMove() {
    if (!move || submitting) return;
    setSubmitting(true);

    const { data, error } = await rpc.swapFreeAgent(
      leagueId,
      move.drop?.name ?? null,
      move.add.name
    );

    setMove(null);
    setSubmitting(false);

    if (error) {
      // The function refused (someone else took the Pokémon, no swaps left,
      // over budget...): show why and bring the page up to date.
      setNotice({ variant: "error", text: error });
      await Promise.all([reload(), refresh()]);
      return;
    }

    setDropKey(null);
    const [, refreshError] = await Promise.all([reload(), refresh()]);
    const message =
      typeof data?.message === "string" && data.message.trim()
        ? data.message
        : `${move.add.name} joined your team.`;

    setNotice(
      refreshError
        ? {
            variant: "warning",
            text: `${message} Your swap count could not be reloaded: ${refreshError}`,
          }
        : { variant: "success", text: message }
    );
  }

  const searching = search.trim().length > 0;
  const emptyList = pool.length === 0
    ? {
        title: "This league has no draft pool",
        description:
          "Ask the Commissioner to choose a draft format or set a pool on the Pool page.",
      }
    : freeAgents.length === 0
      ? {
          title: "No free agents left",
          description: "Every Pokémon in the draft pool is on a team.",
        }
      : {
          title: "No free agents match your search",
          description: "Try a shorter name or clear the search.",
        };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Free Agents"
        description="Swap undrafted Pokémon onto your team. Every move uses one of your free agent swaps for the season."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LiveStatusPill status={liveStatus} />
            <Button
              variant="secondary"
              onClick={handleRefresh}
              pending={reloading}
              pendingText="Refreshing..."
              disabled={loading || busy}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* With no rosters the slot and point numbers would be made up, so the
          strip waits for a successful load. */}
      {!failed && (
        <RosterStats
          loading={loading}
          items={[
            {
              label: "Swaps remaining",
              value: `${swapsRemaining} / ${swapLimit}`,
              hint:
                swapsRemaining === 0
                  ? "No swaps left this season"
                  : `${pluralize(member.free_agent_swaps_used, "swap")} used`,
            },
            {
              label: "Roster slots",
              value: `${myRoster.length} / ${picksPerTeam}`,
              hint: hasOpenSlot
                ? pluralize(picksPerTeam - myRoster.length, "open slot")
                : "Roster full",
            },
            {
              label: "Points used",
              value: `${pointsUsed} / ${budget}`,
              hint: `${Math.max(0, budget - pointsUsed)} left in the budget`,
            },
          ]}
        />
      )}

      {!draftCompleted && (
        <Alert
          variant="warning"
          action={
            <ButtonLink href={draftHref} size="sm" variant="secondary">
              Draft room
            </ButtonLink>
          }
        >
          Free agent moves open after the draft is complete.
        </Alert>
      )}

      {liveStatus === "reconnecting" && (
        <Alert
          variant="info"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRefresh}
              disabled={reloading || busy}
            >
              Refresh
            </Button>
          }
        >
          Live updates are paused. Refresh to see the latest moves.
        </Alert>
      )}

      {notice && (
        <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {state.status === "error" && (
        <Alert
          variant="error"
          action={
            <Button size="sm" variant="secondary" onClick={handleRetry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      )}

      <section aria-labelledby="your-team-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="your-team-heading" className="text-xl font-bold text-text">
            Your team
          </h2>
          <p className="min-w-0 truncate text-sm text-muted">
            {teamNameLabel(member.team_name)}
          </p>
        </div>

        {state.status === "error" ? null : !draftCompleted ? (
          <p className="text-sm text-muted">
            Your roster appears here after the draft.
          </p>
        ) : !loading && !myTeam ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No roster for your team"
            description="You were not in the draft order for this league, so there is no team to change."
          />
        ) : (
          <YourTeamPicker
            roster={myRoster}
            selectedKey={drop ? pokemonKey(drop.name) : null}
            onSelect={setDropKey}
            disabled={!canAct}
            hasOpenSlot={hasOpenSlot}
            loading={loading}
          />
        )}
      </section>

      <section
        aria-labelledby="free-agents-heading"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="free-agents-heading" className="text-xl font-bold text-text">
              Free agents
            </h2>
            {!failed && (
              <p className="mt-1 text-sm text-muted" aria-live="polite">
                {loading
                  ? "Loading the draft pool..."
                  : searching
                    ? `${visible.length} of ${freeAgents.length} match your search`
                    : pluralize(freeAgents.length, "Pokémon available", "Pokémon available")}
              </p>
            )}
          </div>
          <Field label="Search free agents" hideLabel className="w-full sm:max-w-xs">
            <Input
              type="search"
              name="search"
              autoComplete="off"
              placeholder="Search by name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
        </div>

        {state.status === "error" ? null : (
          <FreeAgentList
            items={visible}
            resetKey={search}
            blockerFor={(entry) => moveBlocker(context, entry)}
            onAdd={handleAdd}
            preparing={preparing}
            busy={busy}
            loading={loading}
            emptyTitle={emptyList.title}
            emptyDescription={emptyList.description}
            emptyIcon={<ArrowLeftRight className="h-5 w-5" />}
          />
        )}
      </section>

      <SwapDialog
        move={move}
        budget={budget}
        swapsRemaining={swapsRemaining}
        swapLimit={swapLimit}
        pending={submitting}
        onClose={() => {
          if (!submitting) setMove(null);
        }}
        onConfirm={confirmMove}
      />
    </div>
  );
}
