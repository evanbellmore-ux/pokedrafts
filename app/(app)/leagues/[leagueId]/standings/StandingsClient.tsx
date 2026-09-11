"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { teamNameLabel } from "@/app/lib/league/labels";
import {
  computeStandings,
  formatWinPercentage,
  type Standing,
} from "@/app/lib/league/standings";
import { createClient } from "@/app/lib/supabase/client";
import LiveStatusPill from "../LiveStatusPill";
import { leaguePhase, PHASE_PILL, playingMembers } from "../season";
import { useLeagueRealtime } from "../useLeagueRealtime";
import { useMinWidthMd } from "../useMinWidthMd";

type StandingsMember = {
  id: string;
  team_name: string | null;
  draft_position: number | null;
};

type StandingsMatchRow = {
  id: string;
  home_member_id: string;
  away_member_id: string;
  status: string;
  winner_member_id: string | null;
};

type StandingsData = {
  members: StandingsMember[];
  matches: StandingsMatchRow[];
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StandingsData };

type Row = Standing<StandingsMember>;

const MEMBER_SELECT = "id, team_name, draft_position";
const MATCH_SELECT =
  "id, home_member_id, away_member_id, status, winner_member_id";

/** "T-2" for ties, with the expansion for screen readers. */
function RankLabel({ standing }: { standing: Row }) {
  if (!standing.tied) return <>{standing.rankLabel}</>;
  return (
    <>
      <span aria-hidden="true">{standing.rankLabel}</span>
      <span className="sr-only">Tied for {standing.rank}</span>
    </>
  );
}

function percentage(standing: Row) {
  return standing.played > 0 ? formatWinPercentage(standing.winPercentage) : "–";
}

function StandingsTable({ rows, myId }: { rows: Row[]; myId: string }) {
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
              Remaining
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((standing) => {
            const mine = standing.member.id === myId;
            return (
              <tr
                key={standing.member.id}
                className={`${trClassName} ${mine ? "bg-accent-soft" : ""}`.trim()}
              >
                <td className={`${tdClassName} font-semibold text-text`}>
                  <RankLabel standing={standing} />
                </td>
                <td className={tdClassName}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-text">
                      {teamNameLabel(standing.member.team_name)}
                    </span>
                    {mine && <StatusPill tone="accent">You</StatusPill>}
                  </div>
                </td>
                <td className={`${tdClassName} text-right tabular-nums`}>
                  {standing.wins}
                </td>
                <td className={`${tdClassName} text-right tabular-nums`}>
                  {standing.losses}
                </td>
                <td className={`${tdClassName} text-right tabular-nums`}>
                  {percentage(standing)}
                </td>
                <td className={`${tdClassName} text-right tabular-nums`}>
                  {standing.remaining}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

function StandingsCards({ rows, myId }: { rows: Row[]; myId: string }) {
  return (
    <ul aria-label="League standings" className="flex flex-col gap-3">
      {rows.map((standing) => {
        const mine = standing.member.id === myId;
        return (
          <li
            key={standing.member.id}
            className={`flex items-center gap-3 rounded-xl border p-4 ${
              mine
                ? "border-accent-border bg-accent-soft"
                : "border-line bg-panel"
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel-hover text-sm font-bold text-text">
              <RankLabel standing={standing} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-semibold text-text">
                  {teamNameLabel(standing.member.team_name)}
                </p>
                {mine && <StatusPill tone="accent">You</StatusPill>}
              </div>
              <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <div>
                  <dt className="sr-only">Record</dt>
                  <dd className="font-semibold text-text tabular-nums">
                    {standing.wins}-{standing.losses}
                  </dd>
                </div>
                <div>
                  <dt className="sr-only">Win percentage</dt>
                  <dd className="tabular-nums">{percentage(standing)}</dd>
                </div>
                <div>
                  <dt className="sr-only">Remaining</dt>
                  <dd className="tabular-nums">{standing.remaining} remaining</dd>
                </div>
              </dl>
            </div>
          </li>
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
 * Standings from `computeStandings` (win percentage, wins, head-to-head,
 * name; ties share a rank). Live on `league_matches` for this league.
 */
export default function StandingsClient() {
  const { league, member, isCommissioner } = useLeague();
  const supabase = useMemo(() => createClient(), []);
  const leagueId = league.id;
  const wide = useMinWidthMd();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadError, setReloadError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (): Promise<LoadState> => {
    try {
      const [membersResult, matchesResult] = await Promise.all([
        supabase
          .from("league_members")
          .select(MEMBER_SELECT)
          .eq("league_id", leagueId),
        supabase
          .from("league_matches")
          .select(MATCH_SELECT)
          .eq("league_id", leagueId),
      ]);

      if (membersResult.error) {
        return { status: "error", message: friendlyError(membersResult.error) };
      }
      if (matchesResult.error) {
        return { status: "error", message: friendlyError(matchesResult.error) };
      }

      return {
        status: "ready",
        data: {
          members: (membersResult.data ?? []) as StandingsMember[],
          matches: (matchesResult.data ?? []) as StandingsMatchRow[],
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
    tables: ["league_matches", "league_members"],
    onChange: () => void reload(),
  });

  function retry() {
    setState({ status: "loading" });
    setReloadError(null);
    void reload();
  }

  const ready = state.status === "ready" ? state.data : null;
  const rows = useMemo<Row[]>(
    () =>
      ready
        ? computeStandings(playingMembers(ready.members, ready.matches), ready.matches)
        : [],
    [ready]
  );
  const phase = ready ? leaguePhase(league, ready.matches) : null;
  const pill = phase ? PHASE_PILL[phase] : null;
  const base = `/leagues/${leagueId}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Standings"
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {pill && <StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
            <span>
              Win percentage first, then wins and head-to-head results. Tied
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
      ) : ready.matches.length === 0 ? (
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
      ) : wide ? (
        <StandingsTable rows={rows} myId={member.id} />
      ) : (
        <StandingsCards rows={rows} myId={member.id} />
      )}
    </div>
  );
}
