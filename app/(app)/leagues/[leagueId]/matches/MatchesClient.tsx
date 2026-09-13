"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CalendarDays, Trophy } from "lucide-react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonLines,
} from "@/app/components/ui";
import { friendlyError } from "@/app/lib/errors";
import {
  playoffMatches,
  playoffResultsExist,
  playoffSize,
  regularMatches,
  regularSeasonComplete,
  toPlayoffFormat,
} from "@/app/lib/league/bracket";
import {
  playoffFormatLabel,
  pluralize,
  scheduleFormatLabel,
} from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import type { LeagueMatch, ScheduleFormat } from "@/app/types/league";
import LiveStatusPill from "../LiveStatusPill";
import { playingMembers } from "../season";
import { useLeagueRealtime } from "../useLeagueRealtime";
import {
  groupRounds,
  isCompleted,
  memberTeamName,
  type MatchMember,
} from "./helpers";
import PlayoffBracket from "./PlayoffBracket";
import ResultDialog, { type ResultAction } from "./ResultDialog";
import RoundCard from "./RoundCard";
import ScheduleCard from "./ScheduleCard";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; members: MatchMember[]; matches: LeagueMatch[] };

type Notice = { variant: "success" | "warning"; text: string };

/** The commissioner's bracket controls: both confirm in a dialog. */
type BracketAction = "generate" | "clear";

const NO_PLAYOFFS_NOTE =
  "This league has no playoffs; the top seed at the end of the regular season is the champion.";

/**
 * Matches page: the regular season by round and the playoff bracket, live
 * through the shared `useLeagueRealtime` channel over `league_matches` and
 * `leagues` (the functions fill the bracket and set the champion on the
 * server, docs section 12.5). The commissioner records, edits and clears
 * results, regenerates the schedule and generates or clears the bracket
 * through the RPCs; everyone else reads.
 */
export default function MatchesClient() {
  const { league, member, isCommissioner, refresh } = useLeague();
  const leagueId = league.id;
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [action, setAction] = useState<ResultAction | null>(null);
  const [bracketAction, setBracketAction] = useState<BracketAction | null>(null);
  const [bracketPending, setBracketPending] = useState(false);
  const [bracketError, setBracketError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const hashHandledRef = useRef(false);

  const load = useCallback(async (): Promise<LoadState> => {
    try {
      const [membersResult, matchesResult] = await Promise.all([
        supabase
          .from("league_members")
          .select("id, user_id, team_name, draft_position")
          .eq("league_id", leagueId)
          .order("draft_position", { ascending: true, nullsFirst: false })
          .order("team_name", { ascending: true }),
        supabase
          .from("league_matches")
          .select("*")
          .eq("league_id", leagueId)
          .order("round_number", { ascending: true })
          .order("match_number", { ascending: true }),
      ]);

      if (membersResult.error) {
        return { status: "error", message: friendlyError(membersResult.error) };
      }
      if (matchesResult.error) {
        return { status: "error", message: friendlyError(matchesResult.error) };
      }

      return {
        status: "ready",
        members: (membersResult.data ?? []) as MatchMember[],
        matches: (matchesResult.data ?? []) as LeagueMatch[],
      };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [supabase, leagueId]);

  /**
   * Re-reads and applies the result unless a newer request started in the
   * meantime (realtime events and actions overlap) or the page unmounted.
   */
  const reload = useCallback(() => {
    const generation = ++generationRef.current;
    return load().then((next) => {
      if (generation === generationRef.current) setState(next);
      return next;
    });
  }, [load]);

  useEffect(() => {
    void reload();
    return () => {
      generationRef.current += 1;
    };
  }, [reload]);

  // One channel with a topic of its own (docs section 7); the hook refetches
  // through `onChange(null)` when the channel comes back after a drop. The
  // league row carries the champion and the playoff format.
  const liveStatus = useLeagueRealtime({
    supabase,
    leagueId,
    name: "matches",
    tables: ["league_matches", "leagues"],
    onChange: (table) => {
      if (table === "leagues" || table === null) void refresh();
      void reload();
    },
  });

  function retry() {
    setState({ status: "loading" });
    void reload();
  }

  const ready = state.status === "ready" ? state : null;

  // "View bracket" on the overview links here with `#playoffs`, but the app
  // router resolves a hash once, when the navigation commits, and the
  // Playoffs section is still behind the skeleton then (docs section 12.6).
  // Scroll to it and move focus there ourselves once the first load lands,
  // before paint; the ref keeps realtime reloads from scrolling again.
  useLayoutEffect(() => {
    if (!ready || hashHandledRef.current) return;
    hashHandledRef.current = true;
    if (window.location.hash !== "#playoffs") return;
    const target = document.getElementById("playoffs");
    if (!target) return;
    target.scrollIntoView();
    target.focus({ preventScroll: true });
  }, [ready]);

  const members = ready?.members ?? [];
  const matches = useMemo(() => ready?.matches ?? [], [ready]);
  const regular = useMemo(() => regularMatches(matches), [matches]);
  const playoff = useMemo(() => playoffMatches(matches), [matches]);
  const rounds = useMemo(() => groupRounds(matches), [matches]);
  const regularResultCount = regular.filter(isCompleted).length;
  const playoffLocked = playoffResultsExist(matches);
  const seasonComplete = regularSeasonComplete(matches);
  const playoffFormat = toPlayoffFormat(league.playoff_format);
  const hasPlayoffs = playoffFormat !== "none";
  // `report_match_result` leaves a finished season without a bracket when the
  // format needs more coaches than play (docs/schema.md); say so instead of
  // offering a Generate button that `not_enough_coaches` would refuse.
  const playingCount = playingMembers(members, regular).length;
  const shortOfCoaches =
    hasPlayoffs && regular.length > 0 && playingCount < playoffSize(playoffFormat);
  const championName = league.champion_member_id
    ? memberTeamName(members, league.champion_member_id)
    : null;
  const youAreChampion = league.champion_member_id === member.id;
  const canGenerate =
    isCommissioner &&
    hasPlayoffs &&
    playoff.length === 0 &&
    Boolean(league.draft_completed) &&
    seasonComplete &&
    !shortOfCoaches;
  const busy = action !== null || bracketPending;

  function openReport(match: LeagueMatch, winnerMemberId: string) {
    setAction({ kind: "report", match, winnerMemberId });
  }

  function openEdit(match: LeagueMatch) {
    setAction({ kind: "edit", match });
  }

  /** After a mutation: reload the matches and the league row, then report. */
  async function settle(message: string) {
    const [next, refreshError] = await Promise.all([reload(), refresh()]);
    const problem = next.status === "error" ? next.message : refreshError;
    setNotice(
      problem
        ? {
            variant: "warning",
            text: `${message} The page could not be refreshed: ${problem}`,
          }
        : { variant: "success", text: message }
    );
  }

  async function handleResultDone(message: string) {
    setAction(null);
    await settle(message);
  }

  async function handleGenerated(count: number, format: ScheduleFormat) {
    await settle(
      `Generated ${pluralize(count, "match", "matches")} (${scheduleFormatLabel(format)}).`
    );
  }

  function openBracketAction(next: BracketAction) {
    setBracketError(null);
    setBracketAction(next);
  }

  function closeBracketAction() {
    if (bracketPending) return;
    setBracketAction(null);
    setBracketError(null);
  }

  async function confirmBracketAction() {
    if (!bracketAction || bracketPending) return;

    setBracketError(null);
    setBracketPending(true);
    const result =
      bracketAction === "generate"
        ? await rpc.generatePlayoffs(leagueId)
        : await rpc.clearPlayoffs(leagueId);
    if (result.error !== null) {
      setBracketError(result.error);
      setBracketPending(false);
      // The refusal may mean the bracket changed under us (another
      // commissioner session); show the current state behind the dialog.
      void reload();
      return;
    }

    const message =
      bracketAction === "generate"
        ? `Playoff bracket generated: ${pluralize(Number(result.data ?? 0), "match", "matches")}, ${playoffFormatLabel(playoffFormat)}.`
        : "Playoff bracket cleared. It is created again when a regular-season result is recorded, or with Generate playoff bracket.";
    setBracketAction(null);
    setBracketPending(false);
    await settle(message);
  }

  const emptyDescription = !league.draft_completed
    ? "The schedule is created automatically when the draft finishes."
    : isCommissioner
      ? "Generate a schedule above to start the season."
      : "The commissioner has not generated the schedule yet.";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Matches"
        description="The regular season round by round, then the playoff bracket. The commissioner records who won each match."
        actions={<LiveStatusPill status={liveStatus} />}
      />

      {notice && (
        <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {isCommissioner && (
        <ScheduleCard
          leagueId={leagueId}
          defaultFormat={league.schedule_format}
          draftCompleted={Boolean(league.draft_completed)}
          matchCount={regular.length}
          resultCount={regularResultCount}
          playoffMatchCount={playoff.length}
          onGenerated={handleGenerated}
        />
      )}

      {state.status === "loading" && (
        <div aria-busy="true" aria-label="Loading matches" className="flex flex-col gap-4">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="rounded-xl border border-line bg-panel p-5">
              <Skeleton className="h-6 w-28" />
              <div className="mt-4 flex flex-col gap-3">
                <div className="rounded-lg border border-line bg-bg p-4">
                  <SkeletonLines lines={2} />
                </div>
                <div className="rounded-lg border border-line bg-bg p-4">
                  <SkeletonLines lines={2} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {state.status === "error" && (
        <Alert
          variant="error"
          title="Could not load the matches"
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      )}

      {ready && rounds.length === 0 && (
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title="No matches yet"
          description={emptyDescription}
        />
      )}

      {ready && rounds.length > 0 && (
        <section aria-labelledby="regular-season-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="regular-season-heading" className="text-2xl font-bold tracking-tight text-text">
              Regular season
            </h2>
            <p className="text-sm text-muted">
              {regularResultCount} of {regular.length} final
            </p>
          </div>
          {isCommissioner && playoffLocked && (
            <Alert variant="info">
              Regular-season results are locked while playoff results exist.
              Edit or clear the playoff results first, or clear the bracket.
            </Alert>
          )}
          {rounds.map((round) => (
            <RoundCard
              key={round.roundNumber}
              round={round}
              members={members}
              currentMemberId={member.id}
              isCommissioner={isCommissioner}
              busy={busy}
              locked={playoffLocked}
              onReport={openReport}
              onEdit={openEdit}
            />
          ))}
        </section>
      )}

      {ready && Boolean(league.draft_completed) && rounds.length > 0 && (
        <section
          id="playoffs"
          aria-labelledby="playoffs-heading"
          tabIndex={-1}
          className="flex scroll-mt-24 flex-col gap-4 rounded-xl border border-line bg-panel p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="playoffs-heading" className="text-2xl font-bold tracking-tight text-text">
              Playoffs
            </h2>
            {hasPlayoffs && (
              <p className="text-sm text-muted">{playoffFormatLabel(playoffFormat)}</p>
            )}
          </div>

          {championName && (
            <Alert
              variant="success"
              title={`Champion: ${championName}`}
              className="text-base"
            >
              {youAreChampion
                ? "You won the championship!"
                : hasPlayoffs
                  ? `${championName} won the Final.`
                  : `${championName} finished the regular season as the top seed.`}
            </Alert>
          )}

          {!hasPlayoffs ? (
            <Alert variant="info">{NO_PLAYOFFS_NOTE}</Alert>
          ) : playoff.length > 0 ? (
            <PlayoffBracket
              matches={matches}
              members={members}
              currentMemberId={member.id}
              isCommissioner={isCommissioner}
              busy={busy}
              onReport={openReport}
              onEdit={openEdit}
            />
          ) : (
            <EmptyState
              icon={<Trophy className="h-5 w-5" />}
              title="No bracket yet"
              description={
                shortOfCoaches
                  ? `${playoffFormatLabel(playoffFormat)} needs ${playoffSize(playoffFormat)} coaches, but ${pluralize(playingCount, "coach plays", "coaches play")}. ${
                      isCommissioner
                        ? "Choose a smaller playoff format in Settings."
                        : "The commissioner can choose a smaller playoff format in Settings."
                    }`
                  : seasonComplete
                    ? isCommissioner
                      ? "The regular season is complete. Generate the bracket to seed the playoffs from the standings."
                      : "The regular season is complete. The commissioner has not generated the bracket yet."
                    : "The bracket is created automatically when the last regular-season result is recorded."
              }
              action={
                canGenerate ? (
                  <Button onClick={() => openBracketAction("generate")} disabled={busy}>
                    Generate playoff bracket
                  </Button>
                ) : undefined
              }
            />
          )}

          {isCommissioner && hasPlayoffs && playoff.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-sm text-muted">
                Clearing the bracket removes every playoff match and result,
                the bracket news and the champion.
              </p>
              <Button
                variant="danger"
                size="sm"
                onClick={() => openBracketAction("clear")}
                disabled={busy}
              >
                Clear bracket
              </Button>
            </div>
          )}
        </section>
      )}

      <ResultDialog
        action={action}
        members={members}
        matches={matches}
        onClose={() => setAction(null)}
        onDone={handleResultDone}
        onStale={() => void reload()}
      />

      <Dialog
        open={bracketAction === "generate"}
        onClose={closeBracketAction}
        title="Generate the playoff bracket?"
        description={`The top seeds from the standings (${playoffFormatLabel(playoffFormat)}) are placed in a single-elimination bracket. Changing the tiebreaker or playoff format in Settings reseeds it until a playoff result is recorded.`}
        confirmLabel="Generate bracket"
        onConfirm={confirmBracketAction}
        pending={bracketPending}
        error={bracketError}
      />

      <Dialog
        open={bracketAction === "clear"}
        onClose={closeBracketAction}
        title="Clear the playoff bracket?"
        description={`Every playoff match is deleted${
          playoffLocked ? ", including the playoff results already recorded," : ""
        } and the champion and bracket news are removed. Regular-season results are kept. The bracket is created again when a regular-season result is recorded, or with Generate playoff bracket.`}
        danger
        confirmLabel="Clear bracket"
        onConfirm={confirmBracketAction}
        pending={bracketPending}
        error={bracketError}
      />
    </div>
  );
}
