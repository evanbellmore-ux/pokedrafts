"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Plus,
  ShieldCheck,
  Trash2,
  Trophy,
  Users,
} from "lucide-react";
import AppNav from "@/app/components/AppNav";
import { createClient } from "@/app/lib/supabase/client";

type League = {
  id: string;
  name: string;
  max_coaches: number;
  draft_started: boolean | null;
  draft_completed: boolean | null;
  current_pick_number: number | null;
  picks_per_team: number | null;
  member_count: number;
  team_name: string | null;
  role: string | null;
};

type JoinedLeague = {
  id: string;
  name: string;
  max_coaches: number;
  draft_started: boolean | null;
  draft_completed: boolean | null;
  current_pick_number: number | null;
  picks_per_team: number | null;
};

type LeagueMemberRow = {
  team_name: string | null;
  role: string | null;
  leagues: JoinedLeague | JoinedLeague[] | null;
};

function hasCommissionerRole(role: string | null | undefined) {
  const normalizedRole = role?.trim().toLowerCase();

  return normalizedRole === "commissioner" || normalizedRole === "commisioner";
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [leagueToDelete, setLeagueToDelete] = useState<League | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);

    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      router.push("/login");
      return;
    }

    setEmail(auth.user.email ?? "");

    const { data } = await supabase
      .from("league_members")
      .select(
        "team_name, role, leagues(id, name, max_coaches, draft_started, draft_completed, current_pick_number, picks_per_team)"
      )
      .eq("user_id", auth.user.id)
      .order("team_name", { ascending: true });

    const rows = (data ?? []) as LeagueMemberRow[];

    const mapped: League[] = rows.reduce<League[]>((acc, row) => {
      const league = Array.isArray(row.leagues)
        ? row.leagues[0]
        : row.leagues;

      if (!league) return acc;

      acc.push({
        id: league.id,
        name: league.name,
        max_coaches: league.max_coaches,
        draft_started: league.draft_started,
        draft_completed: league.draft_completed,
        current_pick_number: league.current_pick_number,
        picks_per_team: league.picks_per_team,
        member_count: 0,
        team_name: row.team_name,
        role: row.role,
      });

      return acc;
    }, []);

    const leagueIds = mapped.map((league) => league.id);

    if (leagueIds.length > 0) {
      const { data: memberRows } = await supabase
        .from("league_members")
        .select("league_id")
        .in("league_id", leagueIds);

      const memberCounts = new Map<string, number>();

      memberRows?.forEach((row) => {
        const leagueId = row.league_id as string;
        memberCounts.set(leagueId, (memberCounts.get(leagueId) ?? 0) + 1);
      });

      setLeagues(
        mapped.map((league) => ({
          ...league,
          member_count: memberCounts.get(league.id) ?? 0,
        }))
      );
    } else {
      setLeagues(mapped);
    }

    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function deleteLeague() {
    if (!leagueToDelete) return;

    setDeleteError("");

    if (!hasCommissionerRole(leagueToDelete.role)) {
      setDeleteError("Only the commissioner can delete this league.");
      return;
    }

    if (deleteConfirmation.trim() !== leagueToDelete.name) {
      setDeleteError("Type the league name exactly to confirm deletion.");
      return;
    }

    setDeleting(true);

    const { error } = await supabase
      .from("leagues")
      .delete()
      .eq("id", leagueToDelete.id);

    if (error) {
      setDeleteError(error.message);
      setDeleting(false);
      return;
    }

    setLeagueToDelete(null);
    setDeleteConfirmation("");
    setDeleting(false);
    await load();
  }

  function openDeleteDialog(league: League) {
    setLeagueToDelete(league);
    setDeleteConfirmation("");
    setDeleteError("");
  }

  const commissionerCount = leagues.filter(
    (league) => hasCommissionerRole(league.role)
  ).length;
  const liveDraftCount = leagues.filter(
    (league) => league.draft_started && !league.draft_completed
  ).length;

  return (
    <main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <AppNav />

        <header>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Dashboard
          </h1>
          <p className="mt-2 text-sm text-stone-400">{email}</p>
        </header>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-amber-800/40 bg-stone-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-stone-400">Active leagues</p>
              <Trophy className="h-5 w-5 text-amber-300" />
            </div>
            <p className="mt-4 text-3xl font-bold">{leagues.length}</p>
          </div>

          <div className="rounded-lg border border-emerald-800/40 bg-stone-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-stone-400">Commissioner seats</p>
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
            </div>
            <p className="mt-4 text-3xl font-bold">{commissionerCount}</p>
          </div>

          <div className="rounded-lg border border-rose-900/40 bg-stone-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-stone-400">Live drafts</p>
              <Users className="h-5 w-5 text-rose-300" />
            </div>
            <p className="mt-4 text-3xl font-bold">{liveDraftCount}</p>
          </div>
        </section>

        <section className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Your Leagues</h2>
            <p className="mt-1 text-sm text-stone-400">
              Continue a draft, manage settings, or review finalized teams.
            </p>
          </div>

          <Link
            href="/leagues/new"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-stone-950 hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4" />
            Create League
          </Link>
        </section>

        <section className="mt-5">
          {loading ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-24 animate-pulse rounded-lg border border-amber-900/30 bg-stone-900"
                />
              ))}
            </div>
          ) : leagues.length > 0 ? (
            <div className="grid gap-3">
              {leagues.map((league) => (
                <div
                  key={league.id}
                  className="group relative grid cursor-pointer gap-4 rounded-lg border border-amber-900/35 bg-stone-900 p-5 hover:border-amber-700/70 hover:bg-stone-800/80 sm:grid-cols-[1fr_auto]"
                >
                  <Link
                    href={
                      league.draft_started && !league.draft_completed
                        ? `/leagues/${league.id}/draft`
                        : `/leagues/${league.id}`
                    }
                    aria-label={`Open ${league.name}`}
                    className="absolute inset-0 z-10 rounded-lg"
                  />

                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-lg font-semibold">{league.name}</h3>
                      <span className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-2 py-1 text-xs font-medium capitalize text-emerald-200">
                        {league.role ?? "coach"}
                      </span>
                      <span className="rounded-md border border-amber-800/60 bg-amber-950/40 px-2 py-1 text-xs font-medium text-amber-200">
                        {league.draft_completed
                          ? "Draft complete"
                          : league.draft_started
                            ? `Live pick #${league.current_pick_number ?? 1}`
                            : "Setup"}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-400">
                      <span>{league.team_name || "Unnamed Team"}</span>
                      <span>
                        {league.member_count}/{league.max_coaches} coaches
                      </span>
                      <span>{league.picks_per_team ?? 10} picks per team</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:items-end">
                    <span
                      aria-hidden="true"
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-800/60 px-4 py-2 text-sm font-semibold text-amber-300 group-hover:bg-amber-950/30"
                    >
                      Open
                      <ArrowRight className="h-4 w-4" />
                    </span>

                    {hasCommissionerRole(league.role) && (
                      <button
                        onClick={() => openDeleteDialog(league)}
                        className="relative z-20 inline-flex items-center justify-center gap-2 rounded-lg border border-red-900/70 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-amber-800/60 bg-stone-900 p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-amber-950/70">
                <Trophy className="h-6 w-6 text-amber-300" />
              </div>
              <h3 className="mt-4 text-xl font-semibold">No leagues yet</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-stone-400">
                Create a league to invite coaches, configure a pool, and run a
                live draft.
              </p>
              <Link
                href="/leagues/new"
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-stone-950 hover:bg-emerald-400"
              >
                <Plus className="h-4 w-4" />
                Create League
              </Link>
            </div>
          )}
        </section>

        {leagueToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-4">
            <div className="w-full max-w-md rounded-lg border border-red-900/60 bg-stone-900 p-5 shadow-xl">
              <h2 className="text-xl font-semibold text-red-200">
                Delete League
              </h2>
              <p className="mt-2 text-sm text-stone-400">
                This permanently removes {leagueToDelete.name}, including its
                invite, draft picks, teams, chat, and matchup schedule.
              </p>

              <label className="mt-5 block text-sm font-medium text-stone-300">
                Type {leagueToDelete.name} to confirm
              </label>
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                className="mt-2 w-full rounded-lg border border-red-900/50 bg-stone-950 p-3"
                autoFocus
              />

              {deleteError && (
                <p className="mt-3 text-sm text-red-300">{deleteError}</p>
              )}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  onClick={() => {
                    setLeagueToDelete(null);
                    setDeleteConfirmation("");
                    setDeleteError("");
                  }}
                  disabled={deleting}
                  className="rounded-lg border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-300 hover:border-stone-500 hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  onClick={deleteLeague}
                  disabled={
                    deleting ||
                    deleteConfirmation.trim() !== leagueToDelete.name
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "Deleting..." : "Delete League"}
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="mt-8 rounded-lg border border-sky-900/40 bg-stone-900 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Draft Pool Tools</h2>
              <p className="mt-1 text-sm text-stone-400">
                Upload, edit, save, and export reusable league formats.
              </p>
            </div>

            <Link
              href="/builder"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-800/60 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-950/40"
            >
              Open Builder
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
