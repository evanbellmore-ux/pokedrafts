"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

export default function LeaguePage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [league, setLeague] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [invite, setInvite] = useState<any>(null);
  const [picksPerTeam, setPicksPerTeam] = useState(10);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: leagueData } = await supabase
      .from("leagues")
      .select(`
        *,
        draft_format:draft_formats (
          id,
          name,
          json
        )
      `)
      .eq("id", leagueId)
      .single();

    setLeague(leagueData);

    const { data: memberData } = await supabase
      .from("league_members")
      .select("*")
      .eq("league_id", leagueId);

    setMembers(memberData ?? []);

    const { data: inviteData } = await supabase
      .from("league_invites")
      .select("*")
      .eq("league_id", leagueId)
      .limit(1)
      .single();

    setInvite(inviteData);
  }

  const inviteLink =
    invite && typeof window !== "undefined"
      ? `${window.location.origin}/invite/${invite.invite_code}`
      : "";

  const pokemonCount =
    league?.draft_format?.json?.pokemon &&
    Array.isArray(league.draft_format.json.pokemon)
      ? league.draft_format.json.pokemon.length
      : null;

  return (
  <>
    <h1 className="text-4xl font-bold">{league?.name ?? "League"}</h1>

    <p className="mt-2 text-zinc-400">
      Format: {league?.draft_format?.name ?? "No format selected"}
      {pokemonCount !== null ? ` • ${pokemonCount} Pokémon` : ""}
    </p>

    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-xl font-semibold">Invite Link</h2>

      {inviteLink ? (
        <input
          readOnly
          value={inviteLink}
          className="mt-3 w-full rounded-xl bg-zinc-950 border border-zinc-700 p-3"
        />
      ) : (
        <p className="mt-3 text-zinc-500">No invite found.</p>
      )}
    </section>

    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-xl font-semibold">
        Coaches {members.length}/{league?.max_coaches ?? "?"}
      </h2>

      <div className="mt-4 space-y-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"
          >
            <p className="font-semibold">
              {member.team_name || "Unnamed Team"}
            </p>
            <p className="text-sm text-zinc-500">{member.role}</p>
          </div>
        ))}
      </div>
    </section>
  </>
);
}