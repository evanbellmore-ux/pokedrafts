"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useLeague } from "@/app/components/league/LeagueProvider";
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  SkeletonLines,
} from "@/app/components/ui";
import { friendlyError } from "@/app/lib/errors";
import { pluralize, scheduleFormatLabel } from "@/app/lib/league/labels";
import { rpc } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import type { LeagueMatch, ScheduleFormat } from "@/app/types/league";
import LiveStatusPill from "../LiveStatusPill";
import { useLeagueRealtime } from "../useLeagueRealtime";
import {
  groupRounds,
  isCompleted,
  memberTeamName,
  type MatchMember,
} from "./helpers";
import RoundCard from "./RoundCard";
import ScheduleCard from "./ScheduleCard";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; members: MatchMember[]; matches: LeagueMatch[] };

type Notice = { variant: "success" | "warning"; text: string };

/** A result dialog: record a winner for an upcoming match, or edit a final. */
type ResultAction =
  | { kind: "report"; match: LeagueMatch; winnerMemberId: string }
  | { kind: "edit"; match: LeagueMatch };

/**
 * Matches page: the schedule by round with results, live through the shared
 * `useLeagueRealtime` channel over `league_matches` (docs section 7). The
 * commissioner records, edits and clears results and regenerates the
 * schedule through the RPCs; everyone else reads.
 */
export default function MatchesClient() {
  const { league, member, isCommissioner, refresh } = useLeague();
  const leagueId = league.id;
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [action, setAction] = useState<ResultAction | null>(null);
  const [editWinnerId, setEditWinnerId] = useState("");
  const [actionPending, setActionPending] = useState<"save" | "clear" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const generationRef = useRef(0);

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
  // through `onChange(null)` when the channel comes back after a drop.
  const liveStatus = useLeagueRealtime({
    supabase,
    leagueId,
    name: "matches",
    tables: ["league_matches"],
    onChange: () => void reload(),
  });

  function retry() {
    setState({ status: "loading" });
    void reload();
  }

  const ready = state.status === "ready" ? state : null;
  const members = ready?.members ?? [];
  const rounds = useMemo(
    () => (state.status === "ready" ? groupRounds(state.matches) : []),
    [state]
  );
  const matchCount = ready?.matches.length ?? 0;
  const resultCount = ready ? ready.matches.filter(isCompleted).length : 0;

  function openReport(match: LeagueMatch, winnerMemberId: string) {
    setActionError(null);
    setAction({ kind: "report", match, winnerMemberId });
  }

  function openEdit(match: LeagueMatch) {
    setActionError(null);
    setEditWinnerId(match.winner_member_id ?? match.home_member_id);
    setAction({ kind: "edit", match });
  }

  function closeAction() {
    if (actionPending) return;
    setAction(null);
    setActionError(null);
  }

  async function confirmResult() {
    if (!action || actionPending) return;
    const winnerMemberId =
      action.kind === "report" ? action.winnerMemberId : editWinnerId;
    if (!winnerMemberId) {
      setActionError("Choose the winner.");
      return;
    }

    setActionError(null);
    setActionPending("save");
    const { error } = await rpc.reportMatchResult(action.match.id, winnerMemberId);
    if (error !== null) {
      setActionError(error);
      setActionPending(null);
      return;
    }

    const next = await reload();
    setActionPending(null);
    setAction(null);
    setNotice(
      next.status === "error"
        ? {
            variant: "warning",
            text: `Result saved, but the schedule could not be refreshed: ${next.message}`,
          }
        : {
            variant: "success",
            text: `Recorded ${memberTeamName(members, winnerMemberId)} as the winner of Round ${action.match.round_number}.`,
          }
    );
  }

  async function clearResult() {
    if (!action || action.kind !== "edit" || actionPending) return;

    setActionError(null);
    setActionPending("clear");
    const { error } = await rpc.clearMatchResult(action.match.id);
    if (error !== null) {
      setActionError(error);
      setActionPending(null);
      return;
    }

    const next = await reload();
    setActionPending(null);
    setAction(null);
    setNotice(
      next.status === "error"
        ? {
            variant: "warning",
            text: `Result cleared, but the schedule could not be refreshed: ${next.message}`,
          }
        : {
            variant: "success",
            text: `Cleared the Round ${action.match.round_number} result for ${memberTeamName(members, action.match.home_member_id)} vs ${memberTeamName(members, action.match.away_member_id)}.`,
          }
    );
  }

  async function handleGenerated(count: number, format: ScheduleFormat) {
    // The league row changed too (schedule_format), so refresh the context.
    const [next, refreshError] = await Promise.all([reload(), refresh()]);
    const problem = next.status === "error" ? next.message : refreshError;
    setNotice(
      problem
        ? {
            variant: "warning",
            text: `Schedule generated, but the page could not be refreshed: ${problem}`,
          }
        : {
            variant: "success",
            text: `Generated ${pluralize(count, "match", "matches")} (${scheduleFormatLabel(format)}).`,
          }
    );
  }

  const actionMatch = action?.match ?? null;
  const actionHome = actionMatch
    ? memberTeamName(members, actionMatch.home_member_id)
    : "";
  const actionAway = actionMatch
    ? memberTeamName(members, actionMatch.away_member_id)
    : "";

  const emptyDescription = !league.draft_completed
    ? "The schedule is created automatically when the draft finishes."
    : isCommissioner
      ? "Generate a schedule above to start the season."
      : "The commissioner has not generated the schedule yet.";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Matches"
        description="The season schedule, round by round. The commissioner records who won each match."
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
          matchCount={matchCount}
          resultCount={resultCount}
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
        <div className="flex flex-col gap-4">
          {rounds.map((round) => (
            <RoundCard
              key={round.roundNumber}
              round={round}
              members={members}
              currentMemberId={member.id}
              isCommissioner={isCommissioner}
              busy={actionPending !== null}
              onReport={openReport}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      <Dialog
        open={action !== null}
        onClose={closeAction}
        title={
          action?.kind === "report"
            ? `Record ${memberTeamName(members, action.winnerMemberId)} as the winner of Round ${action.match.round_number}?`
            : "Edit result"
        }
        description={
          actionMatch
            ? action?.kind === "report"
              ? `${actionHome} vs ${actionAway}, match ${actionMatch.match_number}. The result is posted to the league news.`
              : `Round ${actionMatch.round_number}, match ${actionMatch.match_number}: ${actionHome} vs ${actionAway}.`
            : undefined
        }
        onConfirm={confirmResult}
        confirmLabel={action?.kind === "edit" ? "Save result" : "Record result"}
        pending={actionPending === "save"}
        error={actionError}
      >
        {action?.kind === "edit" && actionMatch && (
          <div className="flex flex-col gap-4">
            <Field label="Winner">
              <Select
                value={editWinnerId}
                onChange={(event) => setEditWinnerId(event.target.value)}
                disabled={actionPending !== null}
              >
                <option value={actionMatch.home_member_id}>{actionHome}</option>
                <option value={actionMatch.away_member_id}>{actionAway}</option>
              </Select>
            </Field>
            <div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={clearResult}
                pending={actionPending === "clear"}
                pendingText="Clearing..."
                disabled={actionPending === "save"}
              >
                Clear result
              </Button>
              <p className="mt-1.5 text-xs text-muted">
                Clearing sets the match back to Upcoming and removes its news
                item.
              </p>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
