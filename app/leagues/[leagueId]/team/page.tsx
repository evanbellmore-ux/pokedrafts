"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";
import PokemonSprite from "@/app/components/PokemonSprite";

type DraftedPokemon = {
  name: string;
  points: number;
  tier: number;
  pick_number: number;
};

export default function TeamPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [teamName, setTeamName] = useState("");
  const [pokemon, setPokemon] = useState<DraftedPokemon[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadTeam();
  }, []);

  async function loadTeam() {
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("You must be logged in to view your team.");
      return;
    }

    const { data: member, error: memberError } = await supabase
      .from("league_members")
      .select("id, team_name")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .single();

    if (memberError || !member) {
      setMessage("You are not a member of this league.");
      return;
    }

    setTeamName(member.team_name ?? "Unnamed Team");

    const { data: draftedTeam, error: teamError } = await supabase
      .from("drafted_teams")
      .select("pokemon, total_points")
      .eq("league_id", leagueId)
      .eq("member_id", member.id)
      .maybeSingle();

    if (teamError) {
      setMessage(teamError.message);
      return;
    }

    if (!draftedTeam) {
      setMessage("Your finalized team will appear here after the draft is complete.");
      return;
    }

    setPokemon(Array.isArray(draftedTeam.pokemon) ? draftedTeam.pokemon : []);
    setTotalPoints(draftedTeam.total_points ?? 0);
  }

  return (
    <>
      <h1 className="text-4xl font-bold">Team</h1>

      <p className="mt-2 text-zinc-400">
        {teamName || "Loading team..."}
      </p>

      {message && (
        <p className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-zinc-300">
          {message}
        </p>
      )}

      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Drafted Roster</h2>
          <p className="text-sm text-zinc-400">{totalPoints} points spent</p>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
          <table className="w-full">
            <thead className="bg-zinc-900 text-sm text-zinc-400">
              <tr>
                <th className="p-3 text-left">Pick</th>
                <th className="p-3 text-left">Pokémon</th>
                <th className="p-3 text-left">Points</th>
                <th className="p-3 text-left">Tier</th>
              </tr>
            </thead>

            <tbody>
              {pokemon.map((mon) => (
                <tr key={mon.name} className="border-t border-zinc-800">
                  <td className="p-3">#{mon.pick_number}</td>
                  <td className="p-3">
  <div className="flex items-center gap-3">
    <PokemonSprite name={mon.name} />
    <span className="font-semibold">{mon.name}</span>
  </div>
</td>
                  <td className="p-3">{mon.points}</td>
                  <td className="p-3">{mon.tier}</td>
                </tr>
              ))}

              {pokemon.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-500">
                    No drafted team saved yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}