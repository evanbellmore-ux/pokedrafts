"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  LogOut,
  Plus,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/client";

type League = {
  id: string;
  name: string;
  max_coaches: number;
  team_name: string | null;
  role: string | null;
};

type LeagueMemberRow = {
  team_name: string | null;
  role: string | null;
  leagues:
    | {
        id: string;
        name: string;
        max_coaches: number;
      }
    | {
        id: string;
        name: string;
        max_coaches: number;
      }[]
    | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

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
      .select("team_name, role, leagues(id, name, max_coaches)")
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
        team_name: row.team_name,
        role: row.role,
      });

      return acc;
    }, []);

    setLeagues(mapped);
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const commissionerCount = leagues.filter(
    (league) => league.role === "commissioner"
  ).length;
  const coachCount = leagues.length - commissionerCount;

  return (
    <main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 border-b border-amber-900/40 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-amber-300">
              PokeDrafts
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
              Dashboard
            </h1>
            <p className="mt-2 text-sm text-stone-400">{email}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/builder"
              className="inline-flex items-center justify-center rounded-lg border border-amber-800/50 bg-stone-900 px-4 py-2.5 text-sm font-semibold text-stone-200 hover:border-amber-600/70 hover:bg-stone-800"
            >
              Pool Builder
            </Link>

            <button
              onClick={logout}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-700 px-4 py-2.5 text-sm font-semibold text-stone-300 hover:border-stone-500 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
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
              <p className="text-sm text-stone-400">Coach seats</p>
              <Users className="h-5 w-5 text-rose-300" />
            </div>
            <p className="mt-4 text-3xl font-bold">{coachCount}</p>
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
                <Link
                  key={league.id}
                  href={`/leagues/${league.id}`}
                  className="group grid gap-4 rounded-lg border border-amber-900/35 bg-stone-900 p-5 hover:border-amber-700/70 hover:bg-stone-800/80 sm:grid-cols-[1fr_auto]"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-lg font-semibold">{league.name}</h3>
                      <span className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-2 py-1 text-xs font-medium capitalize text-emerald-200">
                        {league.role ?? "coach"}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-400">
                      <span>{league.team_name || "Unnamed Team"}</span>
                      <span>{league.max_coaches} coach limit</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                    Open
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </div>
                </Link>
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
