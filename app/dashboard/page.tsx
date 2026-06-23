"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

type League = {
  id: string;
  name: string;
  max_coaches: number;
};

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [leagues, setLeagues] = useState<League[]>([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      router.push("/login");
      return;
    }

    setEmail(auth.user.email ?? "");

    const { data } = await supabase
      .from("league_members")
      .select("leagues(id, name, max_coaches)")
      .eq("user_id", auth.user.id);

    const mapped =
      data?.map((row: any) => row.leagues).filter(Boolean) ?? [];

    setLeagues(mapped);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold">Dashboard</h1>
            <p className="text-zinc-400">{email}</p>
          </div>

          <button onClick={logout} className="text-zinc-400 hover:text-white">
            Log out
          </button>
        </header>

        <Link
          href="/leagues/new"
          className="mt-8 inline-block rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950"
        >
          Create League
        </Link>

        <section className="mt-8 space-y-3">
          {leagues.map((league) => (
            <Link
              key={league.id}
              href={`/leagues/${league.id}`}
              className="block rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:bg-zinc-800"
            >
              <h2 className="text-xl font-semibold">{league.name}</h2>
              <p className="text-sm text-zinc-400">
                Max coaches: {league.max_coaches}
              </p>
            </Link>
          ))}

          {leagues.length === 0 && (
            <p className="text-zinc-500">You are not in any leagues yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}