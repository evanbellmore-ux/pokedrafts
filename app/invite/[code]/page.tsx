"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [invite, setInvite] = useState<any>(null);
  const [league, setLeague] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [teamName, setTeamName] = useState("");

  useEffect(() => {
    load();
  }, []);

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

    setInvite(data);
    setLeague(data?.leagues);
  }

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
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-3xl font-bold">League Invite</h1>

        <p className="mt-4 text-zinc-300">
          Join {league?.name ?? "this league"}?
        </p>

        <input
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="Team name"
          className="mt-4 w-full rounded-xl bg-zinc-950 border border-zinc-700 p-3"
        />

        <button
          onClick={joinLeague}
          className="mt-6 w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-zinc-950"
        >
          Join League
        </button>

        {message && <p className="mt-4 text-sm text-red-300">{message}</p>}
      </div>
    </main>
  );
}