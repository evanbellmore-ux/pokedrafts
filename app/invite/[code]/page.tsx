"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

type Invite = {
  id: string;
  invite_code: string;
  league_id: string;
  max_uses: number;
  used_count: number;
};

type League = {
  id: string;
  name: string;
  max_coaches: number;
};

type InviteRow = Invite & {
  leagues: League | League[] | null;
};

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [invite, setInvite] = useState<Invite | null>(null);
  const [league, setLeague] = useState<League | null>(null);
  const [message, setMessage] = useState("");
  const [teamName, setTeamName] = useState("");
  async function load() {
    const { data, error } = await supabase
      .from("league_invites")
      .select("*, leagues(*)")
      .eq("invite_code", code)
      .single();

    if (error) {
      setMessage("Invalid invite.");
      return;
    }

    const inviteRow = data as InviteRow;
    const rowLeague = Array.isArray(inviteRow.leagues)
      ? inviteRow.leagues[0] ?? null
      : inviteRow.leagues;

    setInvite(inviteRow);
    setLeague(rowLeague);
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function joinLeague() {
    setMessage("");

    const cleanTeamName = teamName.trim();

    if (!cleanTeamName) {
      setMessage("Enter a team name.");
      return;
    }

    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      router.push(`/login`);
      return;
    }

    if (!invite || !league) {
      setMessage("Invalid invite.");
      return;
    }

    if (invite.used_count >= invite.max_uses) {
      setMessage("This invite has no spots left.");
      return;
    }

    const { count } = await supabase
      .from("league_members")
      .select("*", { count: "exact", head: true })
      .eq("league_id", league.id);

    if ((count ?? 0) >= league.max_coaches) {
      setMessage("This league is full.");
      return;
    }

    const { error } = await supabase.from("league_members").insert({
      league_id: league.id,
      user_id: auth.user.id,
      role: "coach",
      team_name: cleanTeamName,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    await supabase
      .from("league_invites")
      .update({ used_count: invite.used_count + 1 })
      .eq("id", invite.id);

    router.push(`/leagues/${league.id}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 p-6 text-stone-100">
      <div className="w-full max-w-md rounded-lg border border-amber-900/40 bg-stone-900 p-6">
        <p className="text-sm font-medium uppercase tracking-wide text-amber-300">
          PokeDrafts
        </p>
        <h1 className="mt-2 text-3xl font-bold">League Invite</h1>

        <p className="mt-4 text-stone-300">
          Join {league?.name ?? "this league"}?
        </p>

        <input
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="Team name"
          className="mt-4 w-full rounded-lg border border-stone-700 bg-stone-950 p-3"
        />

        <button
          onClick={joinLeague}
          className="mt-6 w-full rounded-lg bg-emerald-500 px-4 py-3 font-semibold text-stone-950 hover:bg-emerald-400"
        >
          Join League
        </button>

        {message && <p className="mt-4 text-sm text-red-300">{message}</p>}
      </div>
    </main>
  );
}
