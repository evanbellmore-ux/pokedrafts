"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

function makeInviteCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

type DraftFormatOption = {
  id: string;
  name: string;
};

export default function NewLeaguePage() {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [maxCoaches, setMaxCoaches] = useState(8);
  const [draftFormatId, setDraftFormatId] = useState("");
  const [formats, setFormats] = useState<DraftFormatOption[]>([]);
  const [error, setError] = useState("");
  async function loadFormats() {
    const { data, error } = await supabase
      .from("draft_formats")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      setError(error.message);
      return;
    }

    setFormats(data ?? []);
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadFormats());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createLeague() {
    setError("");

    if (!name.trim()) {
      setError("Enter a league name.");
      return;
    }

    if (!teamName.trim()) {
      setError("Enter a team name.");
      return;
    }

    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      router.push("/login");
      return;
    }

    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .insert({
        name: name.trim(),
        max_coaches: maxCoaches,
        commissioner_id: auth.user.id,
        draft_format_id: draftFormatId || null,
      })
      .select()
      .single();

    if (leagueError) {
      setError(leagueError.message);
      return;
    }

    const { error: memberError } = await supabase.from("league_members").insert({
      league_id: league.id,
      user_id: auth.user.id,
      role: "commissioner",
      team_name: teamName.trim(),
    });

    if (memberError) {
      setError(memberError.message);
      return;
    }

    const { error: inviteError } = await supabase.from("league_invites").insert({
      league_id: league.id,
      invite_code: makeInviteCode(),
      max_uses: maxCoaches - 1,
      used_count: 0,
    });

    if (inviteError) {
      setError(inviteError.message);
      return;
    }

    router.push(`/leagues/${league.id}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 p-6 text-stone-100">
      <div className="w-full max-w-md rounded-lg border border-amber-900/40 bg-stone-900 p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-amber-300">
          League setup
        </p>
        <h1 className="mt-2 text-3xl font-bold">Create League</h1>

        <input
          className="mt-6 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
          placeholder="League name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <input
          className="mt-3 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
          placeholder="Your team name"
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
        />

        <select
          className="mt-3 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
          value={draftFormatId}
          onChange={(e) => setDraftFormatId(e.target.value)}
        >
          <option value="">No draft format selected</option>

          {formats.map((format) => (
            <option key={format.id} value={format.id}>
              {format.name}
            </option>
          ))}
        </select>

        <input
          className="mt-3 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
          type="number"
          min={2}
          max={24}
          value={maxCoaches}
          onChange={(e) => setMaxCoaches(Number(e.target.value))}
        />

        <button
          onClick={createLeague}
          className="mt-5 w-full rounded-lg bg-emerald-500 px-4 py-3 font-semibold text-stone-950 hover:bg-emerald-400"
        >
          Create
        </button>

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      </div>
    </main>
  );
}
