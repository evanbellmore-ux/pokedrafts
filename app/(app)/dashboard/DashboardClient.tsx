"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import Alert from "@/app/components/ui/Alert";
import Button, { ButtonLink } from "@/app/components/ui/Button";
import Dialog from "@/app/components/ui/Dialog";
import Skeleton from "@/app/components/ui/Skeleton";
import { getCurrentUser } from "@/app/lib/auth/current-user";
import { friendlyError } from "@/app/lib/errors";
import { teamNameLabel } from "@/app/lib/league/labels";
import { isLeagueCommissioner } from "@/app/lib/league/permissions";
import { createClient } from "@/app/lib/supabase/client";
import { parseRoster } from "@/app/(app)/leagues/[leagueId]/team/roster";
import type { SessionUser } from "@/app/types/league";
import {
  compareLeagues,
  dashboardSummary,
  phaseOf,
  sortMembers,
  type DashboardLeague,
  type DashboardMember,
  type LeagueSummary,
  type Phase,
} from "./dashboard";
import DashboardHeader from "./DashboardHeader";
import { JoinLeagueCard, ToolLinks } from "./DashboardSidebar";
import LeagueCard, { LeagueCardSkeleton, NoLeagues } from "./LeagueCard";

type MembershipRow = {
  id: string;
  league_id: string;
  team_name: string | null;
  role: string | null;
  leagues: LeagueSummary | LeagueSummary[] | null;
};

/** Member columns read across the caller's leagues: the coach stack, the draft size and the champion's name. */
type LeagueMemberRow = {
  id: string;
  league_id: string;
  team_name: string | null;
  draft_position: number | null;
};

type RosterRow = { member_id: string; pokemon: unknown };

type PickRow = { member_id: string; pokemon_name: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "signed-out" }
  | { status: "ready"; user: SessionUser; leagues: DashboardLeague[] };

/** Outcome banner after a delete (success, or a warning when nothing changed). */
type Notice = { variant: "success" | "warning"; text: string };

/** Stands in for a select there is nothing to ask for. */
const NO_ROWS = Promise.resolve({ data: [], error: null });

/**
 * Dashboard: the caller's leagues with their rosters, a join-by-code card
 * and the tools (docs/release-architecture.md sections 2, 8.2 and 8.3).
 * Deleting a league is the one direct `leagues` write the policy set
 * allows; everything else goes through the RPCs.
 */
export default function DashboardClient() {
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DashboardLeague | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<LoadState> => {
    try {
      // A failed session check must not read as "logged out": the session
      // is kept and the error is shown with Retry (app/lib/auth/current-user.ts).
      const current = await getCurrentUser(supabase.auth);
      if (current.status === "error") {
        return { status: "error", message: current.message };
      }
      if (current.status === "signed-out") return { status: "signed-out" };
      const { user } = current;

      const { data, error } = await supabase
        .from("league_members")
        .select(
          "id, league_id, team_name, role, leagues!league_id(id, name, commissioner_id, max_coaches, draft_started, draft_completed, current_pick_number, picks_per_team, playoff_format, champion_member_id)"
        )
        .eq("user_id", user.id);
      if (error) return { status: "error", message: friendlyError(error) };

      const memberships = ((data ?? []) as MembershipRow[]).flatMap((row) => {
        const league = Array.isArray(row.leagues) ? row.leagues[0] : row.leagues;
        return league ? [{ row, league, phase: phaseOf(league) }] : [];
      });

      // The caller's own Pokémon: the saved roster once the draft is final,
      // their picks so far while it is live.
      const memberIdsIn = (phase: Phase) =>
        memberships.filter((item) => item.phase === phase).map(({ row }) => row.id);
      const leagueIds = memberships.map(({ league }) => league.id);
      const finishedIds = memberIdsIn("complete");
      const draftingIds = memberIdsIn("live");

      const [members, rosters, picks] = await Promise.all([
        leagueIds.length > 0
          ? supabase
              .from("league_members")
              .select("id, league_id, team_name, draft_position")
              .in("league_id", leagueIds)
          : NO_ROWS,
        finishedIds.length > 0
          ? supabase
              .from("drafted_teams")
              .select("member_id, pokemon")
              .in("member_id", finishedIds)
          : NO_ROWS,
        draftingIds.length > 0
          ? supabase
              .from("draft_picks")
              .select("member_id, pokemon_name")
              .in("member_id", draftingIds)
              .order("pick_number")
          : NO_ROWS,
      ]);
      const failed = members.error ?? rosters.error ?? picks.error;
      if (failed) return { status: "error", message: friendlyError(failed) };

      const membersByLeague = new Map<string, DashboardMember[]>();
      const teamNames = new Map<string, string | null>();
      for (const member of (members.data ?? []) as LeagueMemberRow[]) {
        const list = membersByLeague.get(member.league_id) ?? [];
        list.push({
          id: member.id,
          teamName: member.team_name,
          draftPosition: member.draft_position,
        });
        membersByLeague.set(member.league_id, list);
        teamNames.set(member.id, member.team_name);
      }

      const rosterByMember = new Map<string, string[]>();
      for (const row of (rosters.data ?? []) as RosterRow[]) {
        rosterByMember.set(
          row.member_id,
          parseRoster(row.pokemon).map((pokemon) => pokemon.name)
        );
      }
      for (const pick of (picks.data ?? []) as PickRow[]) {
        rosterByMember.set(pick.member_id, [
          ...(rosterByMember.get(pick.member_id) ?? []),
          pick.pokemon_name,
        ]);
      }

      const leagues = memberships
        .map(
          ({ row, league, phase }): DashboardLeague => ({
            league,
            memberId: row.id,
            teamName: row.team_name,
            role: row.role,
            members: sortMembers(membersByLeague.get(league.id) ?? []),
            phase,
            championTeamName: league.champion_member_id
              ? teamNameLabel(teamNames.get(league.champion_member_id) ?? null)
              : null,
            roster: rosterByMember.get(row.id) ?? [],
          })
        )
        .sort(compareLeagues);

      return { status: "ready", user, leagues };
    } catch (caught) {
      return { status: "error", message: friendlyError(caught) };
    }
  }, [supabase]);

  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [load]);

  function retry() {
    setState({ status: "loading" });
    void load().then(setState);
  }

  function openDelete(item: DashboardLeague) {
    setDeleteError(null);
    setPendingDelete(item);
  }

  function closeDelete() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  async function deleteLeague() {
    if (!pendingDelete || deleting) return;
    const { league } = pendingDelete;

    setDeleting(true);
    setDeleteError(null);
    try {
      // PostgREST reports a delete the policy filtered out as a success with
      // zero rows, so the returned ids are what proves it happened.
      const { data, error } = await supabase
        .from("leagues")
        .delete()
        .eq("id", league.id)
        .select("id");
      if (error) {
        setDeleteError(friendlyError(error));
        return;
      }
      if (!data || data.length === 0) {
        // The league is already gone or the caller is no longer its
        // commissioner: there is nothing left to confirm, so close the
        // dialog and show the list as it is now.
        setPendingDelete(null);
        setState(await load());
        setNotice({
          variant: "warning",
          text: "Nothing was deleted. Only the commissioner can delete a league, and it may already be gone.",
        });
        return;
      }

      setPendingDelete(null);
      setState(await load());
      setNotice({ variant: "success", text: `Deleted ${league.name}.` });
    } catch (caught) {
      setDeleteError(friendlyError(caught));
    } finally {
      setDeleting(false);
    }
  }

  const loading = state.status === "loading";
  const ready = state.status === "ready" ? state : null;
  const leagues = ready?.leagues ?? [];

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <DashboardHeader
        summary={
          loading ? (
            <Skeleton className="mt-2 h-4 w-44" />
          ) : ready ? (
            <p className="mt-1 text-sm text-muted">
              {dashboardSummary(leagues, ready.user.id)}
            </p>
          ) : null
        }
      />

      {notice && (
        <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {state.status === "error" && (
        <Alert
          variant="error"
          title="Could not load your leagues"
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        >
          {state.message}
        </Alert>
      )}

      {state.status === "signed-out" && (
        <Alert
          variant="warning"
          title="You are not logged in"
          action={
            <ButtonLink size="sm" variant="secondary" href="/login?next=/dashboard">
              Log in
            </ButtonLink>
          }
        >
          Log in to see your leagues.
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <section aria-labelledby="leagues-heading">
          {loading ? (
            <ul aria-busy="true" className="flex flex-col gap-3">
              {Array.from({ length: 3 }, (_, index) => (
                <LeagueCardSkeleton key={index} />
              ))}
            </ul>
          ) : leagues.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {leagues.map((item) => (
                <LeagueCard
                  key={item.league.id}
                  item={item}
                  canDelete={
                    ready !== null &&
                    isLeagueCommissioner(item.league, ready.user.id)
                  }
                  onDelete={openDelete}
                />
              ))}
            </ul>
          ) : ready ? (
            <NoLeagues
              action={
                <ButtonLink href="/leagues/new">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Create League
                </ButtonLink>
              }
            />
          ) : null}
        </section>

        <aside
          aria-label="Join a league and tools"
          className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--app-nav-height,3.5rem)+1.5rem)]"
        >
          <JoinLeagueCard />
          <ToolLinks />
        </aside>
      </div>

      <Dialog
        open={pendingDelete !== null}
        onClose={closeDelete}
        title="Delete league"
        description={
          pendingDelete
            ? `This permanently removes ${pendingDelete.league.name}, including its invite, draft picks, teams, matches and news.`
            : undefined
        }
        danger
        confirmText={pendingDelete?.league.name}
        confirmLabel="Delete league"
        onConfirm={deleteLeague}
        pending={deleting}
        error={deleteError}
      />
    </div>
  );
}
