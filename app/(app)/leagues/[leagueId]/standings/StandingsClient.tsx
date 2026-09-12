"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import {
  Alert,
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonLines,
  StatusPill,
  TableWrap,
  tableClassName,
  tdClassName,
  thClassName,
  theadClassName,
  trClassName,
} from "@/app/components/ui";
import { friendlyError } from "@/app/lib/errors";
import {
  playoffSize,
  regularSeasonComplete,
  toTiebreaker,
} from "@/app/lib/league/bracket";
import { teamNameLabel } from "@/app/lib/league/labels";
import {
  formatDifferential,
  formatWinPercentage,
  tiebreakerLegend,
} from "@/app/lib/league/standings";
import { rpc } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import type { LeagueMatch, LeagueStanding } from "@/app/types/league";
import LiveStatusPill from "../LiveStatusPill";
import { leaguePhase, PHASE_PILL } from "../season";
import { useLeagueRealtime } from "../useLeagueRealtime";
import { useMinWidthMd } from "../useMinWidthMd";

type StandingsMember = {
  id: string;
  team_name: string | null;
};

type StandingsMatchRow = Pick<LeagueMatch, "id" | "stage" | "status">;

type StandingsData = {
  members: StandingsMember[];
  matches: StandingsMatchRow[];
  standings: LeagueStanding[];
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StandingsData };

/** One standings row with the team it belongs to. */
type Row = LeagueStanding & { teamName: string };

const MEMBER_SELECT = "id, team_name";
const MATCH_SELECT = "id, stage, status";

/**
 * `league_standings` returns numerics; PostgREST hands them over as JSON
 * numbers, but a string would still render and sort correctly.
 */
function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toRows(standings: LeagueStanding[], members: StandingsMember[]): Row[] {
  return [...standings]
    .map((standing) => ({
      ...standing,
      seed: numeric(standing.seed),
      rank: numeric(standing.rank),
      wins: numeric(standing.wins),
      losses: numeric(standing.losses),
      played: numeric(standing.played),
      remaining: numeric(standing.remaining),
      win_pct: numeric(standing.win_pct),
      differential: numeric(standing.differential),
      strength_of_schedule: numeric(standing.strength_of_schedule),
      tied: Boolean(standing.tied),
      teamName: teamNameLabel(
        members.find((member) => member.id === standing.member_id)?.team_name ?? null
      ),
    }))
    .sort((a, b) => a.seed - b.seed);
}

/** "T-2" for ties, with the expansion for screen readers. */
function RankLabel({ row }: { row: Row }) {
  if (!row.tied) return <>{row.rank}</>;
  return (
    <>
      <span aria-hidden="true">T-{row.rank}</span>
      <span className="sr-only">Tied for {row.rank}</span>
    </>
  );
}

function percentage(row: Row) {
  return row.played > 0 ? formatWinPercentage(row.win_pct) : "–";
}

/** Rows plus where the "Playoff line" divider goes (after seed N), or null. */
function playoffLineAfter(rows: Row[], size: number): number | null {
  return size > 0 && size < rows.length ? size : null;
}

function PlayoffLineRow({ size, columns }: { size: number; columns: number }) {
  return (
    <tr className="border-t-2 border-accent-border">
      <td colSpan={columns} className="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-accent-text">
        Playoff line · top {size} seeds
      </td>
    </tr>
  );
}

function StandingsTable({
  rows,
  myId,
  showSeeds,
  playoffLine,
}: {
  rows: Row[];
  myId: string;
  showSeeds: boolean;
  playoffLine: number | null;
}) {
  const columns = 7;
  return (
    <TableWrap>
      <table className={tableClassName}>
        <caption className="sr-only">League standings</caption>
        <thead className={theadClassName}>
          <tr>
            <th scope="col" className={thClassName}>
              Rank
            </th>
            <th scope="col" className={thClassName}>
              Team
            </th>
            <th scope="col" className={`${thClassName} text-right`}>
              <abbr title="Wins">W</abbr>
            </th>
            <th scope="col" className={`${thClassName} text-right`}>
              <abbr title="Losses">L</abbr>
            </th>
            <th scope="col" className={`${thClassName} text-right`}>
              <abbr title="Win percentage">Pct</abbr>
            </th>
            <th scope="col" className={`${thClassName} text-right`}>
              <abbr title="Differential">Diff</abbr>
            </th>
            <th scope="col" className={`${thClassName} text-right`}>
              Remaining
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const mine = row.member_id === myId;
            return (
              <Fragment key={row.member_id}>
                <tr className={`${trClassName} ${mine ? "bg-accent-soft" : ""}`.trim()}>
                  <td className={`${tdClassName} font-semibold text-text`}>
                    <RankLabel row={row} />
                  </td>
                  <td className={tdClassName}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-text">{row.teamName}</span>
                      {showSeeds && <StatusPill>Seed {row.seed}</StatusPill>}
                      {mine && <StatusPill tone="accent">You</StatusPill>}
                    </div>
                  </td>
                  <td className={`${tdClassName} text-right tabular-nums`}>{row.wins}</td>
                  <td className={`${tdClassName} text-right tabular-nums`}>{row.losses}</td>
                  <td className={`${tdClassName} text-right tabular-nums`}>
                    {percentage(row)}
                  </td>
                  <td className={`${tdClassName} text-right tabular-nums`}>
                    {formatDifferential(row.differential)}
                  </td>
                  <td className={`${tdClassName} text-right tabular-nums`}>
                    {row.remaining}
                  </td>
                </tr>
                {playoffLine === row.seed && (
                  <PlayoffLineRow size={playoffLine} columns={columns} />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

function StandingsCards({
  rows,
  myId,
  showSeeds,
  playoffLine,
}: {
  rows: Row[];
  myId: string;
  showSeeds: boolean;
  playoffLine: number | null;
}) {
  return (
    <ul aria-label="League standings" className="flex flex-col gap-3">
      {rows.map((row) => {
        const mine = row.member_id === myId;
        return (
          <Fragment key={row.member_id}>
            <li
              className={`flex items-center gap-3 rounded-xl border p-4 ${
                mine
                  ? "border-accent-border bg-accent-soft"
                  : "border-line bg-panel"
              }`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel-hover text-sm font-bold text-text">
                <RankLabel row={row} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold text-text">{row.teamName}</p>
                  {showSeeds && <StatusPill>Seed {row.seed}</StatusPill>}
                  {mine && <StatusPill tone="accent">You</StatusPill>}
                </div>
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  <div>
                    <dt className="sr-only">Record</dt>
                    <dd className="font-semibold text-text tabular-nums">
                      {row.wins}-{row.losses}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">Win percentage</dt>
                    <dd className="tabular-nums">{percentage(row)}</dd>
                  </div>
                  <div>
                    <dt className="sr-only">Differential</dt>
                    <dd className="tabular-nums">Diff {formatDifferential(row.differential)}</dd>
                  </div>
                  <div>
                    <dt className="sr-only">Remaining</dt>
                    <dd className="tabular-nums">{row.remaining} remaining</dd>
                  </div>
                </dl>
              </div>
            </li>
            {playoffLine === row.seed && (
              <li
                aria-label={`Playoff line: top ${playoffLine} seeds`}
                className="border-t-2 border-accent-border px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-accent-text"
              >
                Playoff line · top {playoffLine} seeds
              </li>
            )}
          </Fragment>
        );
      })}
    </ul>
  );
}

function StandingsSkeleton() {
  return (
    <div aria-busy="true" className="rounded-xl border border-line bg-panel p-5">
      <Skeleton className="h-5 w-40" />
      <SkeletonLines lines={5} className="mt-4" />
    </div>
  );
}

/**
 * Standings straight from `league_standings` (docs/release-architecture.md
 * section 12.3): win percentage, wins, then the league's tiebreakers; ties
 * left to the coin flip share a rank. Seeds appear once the regular season
 * is complete and the playoff line marks the bracket cut. Live on
 * `league_matches` and `leagues` (a tiebreaker change reorders the table).
 */
export default function StandingsClient() {
  const { league, member, isCommissioner, refresh } = useLeague();
  const supabase = useMemo(() => createClient(), []);
  const leagueId = league.id;
  const wide = useMinWidthMd();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadError, setReloadError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (): Promise<LoadState> => {
    try {
      const [membersResult, matchesResult, standingsResult] = await Promise.all([
        supabase
          .from("league_members")
          .select(MEMBER_SELECT)
          .eq("league_id", leagueId),
        supabase
          .from("league_matches")
          .select(MATCH_SELECT)
          .eq("league_id", leagueId),
        rpc.leagueStandings(leagueId),
      ]);

      if (membersResult.error) {
        return { status: "error", message: friendlyError(membersResult.error) };
      }
      if (matchesResult.error) {
        return { status: "error", message: friendlyError(matchesResult.error) };
      }
      if (standingsResult.error !== null) {
        return { status: "error", message: standingsResult.error };
      }

      return {
        status: "ready",
        data: {
          members: (membersResult.data ?? []) as StandingsMember[],
          matches: (matchesResult.data ?? []) as StandingsMatchRow[],
          standings: standingsResult.data ?? [],
        },
      };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [supabase, leagueId]);

  useEffect(() => {
    let active = true;
    const current = generation.current + 1;
    generation.current = current;
    void load().then((next) => {
      if (active && current === generation.current) setState(next);
    });
    return () => {
      active = false;
      // A reload that started before this cleanup must not apply either.
      generation.current += 1;
    };
  }, [load]);

  const reload = useCallback(async () => {
    const current = generation.current + 1;
    generation.current = current;
    const next = await load();
    if (current !== generation.current) return;

    if (next.status === "error") {
      setReloadError(next.message);
      setState((previous) => (previous.status === "ready" ? previous : next));
      return;
    }
    setReloadError(null);
    setState(next);
  }, [load]);

  const liveStatus = useLeagueRealtime({
    supabase,
    leagueId,
    name: "standings",
    tables: ["league_matches", "leagues", "league_members"],
    onChange: (table) => {
      // The league row carries the tiebreaker, playoff format and champion.
      if (table === "leagues" || table === null) void refresh();
      void reload();
    },
  });

  function retry() {
    setState({ status: "loading" });
    setReloadError(null);
    void reload();
  }

  const ready = state.status === "ready" ? state.data : null;
  const rows = useMemo<Row[]>(
    () => (ready ? toRows(ready.standings, ready.members) : []),
    [ready]
  );
  const phase = ready ? leaguePhase(league, ready.matches) : null;
  const pill = phase ? PHASE_PILL[phase] : null;
  const showSeeds = ready ? regularSeasonComplete(ready.matches) : false;
  const playoffLine = playoffLineAfter(rows, playoffSize(league.playoff_format));
  const legend = tiebreakerLegend(toTiebreaker(league.tiebreaker));
  const base = `/leagues/${leagueId}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Standings"
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {pill && <StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
            <span>
              Win percentage first, then wins, then the tiebreakers. Tied
              teams share a rank.
            </span>
          </span>
        }
        actions={<LiveStatusPill status={liveStatus} />}
      />

      {reloadError && (
        <Alert
          variant="error"
          title="Could not refresh the standings"
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
          title="Could not load the standings"
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      ) : !ready ? (
        <StandingsSkeleton />
      ) : ready.matches.length === 0 || rows.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-5 w-5" />}
          title="No schedule yet"
          description={
            !league.draft_completed
              ? "Standings appear once the draft is complete and the schedule has been generated."
              : isCommissioner
                ? "Generate the schedule on the Matches page to start the season."
                : "The commissioner has not generated the schedule yet."
          }
          action={
            league.draft_completed ? (
              <ButtonLink href={`${base}/matches`} variant="secondary">
                Go to Matches
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <>
          {wide ? (
            <StandingsTable
              rows={rows}
              myId={member.id}
              showSeeds={showSeeds}
              playoffLine={playoffLine}
            />
          ) : (
            <StandingsCards
              rows={rows}
              myId={member.id}
              showSeeds={showSeeds}
              playoffLine={playoffLine}
            />
          )}
          <p className="text-sm text-muted">
            {legend}. Diff is the winner&apos;s Pokémon left standing, added
            for wins and taken away for losses.
            {showSeeds
              ? " The regular season is complete; seeds are final."
              : " Seeds are shown once every regular-season match is final."}
          </p>
        </>
      )}
    </div>
  );
}
