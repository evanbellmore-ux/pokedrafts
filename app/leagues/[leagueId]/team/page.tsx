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

type DraftedTeam = {
  id: string;
  member_id: string;
  total_points: number;
  pokemon: DraftedPokemon[];
  league_members?: {
    team_name: string | null;
    user_id: string;
  } | null;
};

type DraftedTeamRow = {
  id: string;
  member_id: string;
  total_points: number | null;
  pokemon: unknown;
  league_members:
    | {
        team_name: string | null;
        user_id: string;
      }
    | {
        team_name: string | null;
        user_id: string;
      }[]
    | null;
};

function RosterTable({ pokemon }: { pokemon: DraftedPokemon[] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-amber-900/30 bg-stone-950">
      <table className="w-full">
        <thead className="bg-stone-900 text-sm text-stone-400">
          <tr>
            <th className="p-3 text-left">Pick</th>
            <th className="p-3 text-left">Pokémon</th>
            <th className="p-3 text-left">Points</th>
            <th className="p-3 text-left">Tier</th>
          </tr>
        </thead>

        <tbody>
          {pokemon.map((mon) => (
            <tr key={`${mon.pick_number}-${mon.name}`} className="border-t border-amber-900/25">
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
              <td colSpan={4} className="p-8 text-center text-stone-500">
                No drafted team saved yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function TeamPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [myMemberId, setMyMemberId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamNameInput, setTeamNameInput] = useState("");
  const [editingTeamName, setEditingTeamName] = useState(false);
  const [savingTeamName, setSavingTeamName] = useState(false);
  const [myTeam, setMyTeam] = useState<DraftedTeam | null>(null);
  const [allTeams, setAllTeams] = useState<DraftedTeam[]>([]);
  const [message, setMessage] = useState("");
  async function loadTeams() {
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("You must be logged in to view teams.");
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

    setMyMemberId(member.id);
    setTeamName(member.team_name ?? "Unnamed Team");
    setTeamNameInput(member.team_name ?? "");

    const { data: teamData, error: teamError } = await supabase
      .from("drafted_teams")
      .select(`
        id,
        member_id,
        pokemon,
        total_points,
        league_members (
          team_name,
          user_id
        )
      `)
      .eq("league_id", leagueId);

    if (teamError) {
      setMessage(teamError.message);
      return;
    }

    const cleanedTeams: DraftedTeam[] =
      ((teamData ?? []) as DraftedTeamRow[]).map((team) => ({
        id: team.id,
        member_id: team.member_id,
        total_points: team.total_points ?? 0,
        pokemon: Array.isArray(team.pokemon) ? team.pokemon as DraftedPokemon[] : [],
        league_members: Array.isArray(team.league_members)
          ? team.league_members[0] ?? null
          : team.league_members,
      }));

    const mine = cleanedTeams.find((team) => team.member_id === member.id) ?? null;

    setMyTeam(mine);
    setAllTeams(
      cleanedTeams.sort((a, b) => {
        const aName = a.league_members?.team_name ?? "";
        const bName = b.league_members?.team_name ?? "";
        return aName.localeCompare(bName);
      })
    );

    if (!mine) {
      setMessage("Your finalized team will appear here after the draft is complete.");
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadTeams());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveTeamName() {
    const cleanTeamName = teamNameInput.trim();

    if (!cleanTeamName) {
      setMessage("Enter a team name.");
      return;
    }

    setSavingTeamName(true);
    setMessage("");

    const { error } = await supabase
      .from("league_members")
      .update({ team_name: cleanTeamName })
      .eq("id", myMemberId)
      .eq("league_id", leagueId);

    if (error) {
      setMessage(`Could not rename team: ${error.message}`);
      setSavingTeamName(false);
      return;
    }

    setTeamName(cleanTeamName);
    setEditingTeamName(false);
    setSavingTeamName(false);
    setMessage("Team name saved.");
    await loadTeams();
  }

  function cancelTeamNameEdit() {
    setTeamNameInput(teamName === "Unnamed Team" ? "" : teamName);
    setEditingTeamName(false);
  }

  const otherTeams = allTeams.filter((team) => team.member_id !== myMemberId);

  return (
    <>
      <h1 className="text-4xl font-bold">Teams</h1>

      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
        {editingTeamName ? (
          <>
            <input
              value={teamNameInput}
              onChange={(e) => setTeamNameInput(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 p-3 sm:max-w-sm"
              placeholder="Team name"
            />
            <div className="flex gap-2">
              <button
                onClick={saveTeamName}
                disabled={savingTeamName}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {savingTeamName ? "Saving..." : "Save"}
              </button>
              <button
                onClick={cancelTeamNameEdit}
                disabled={savingTeamName}
                className="rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-sm font-semibold hover:bg-stone-800 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-stone-400">{teamName || "Loading team..."}</p>
            {myMemberId && (
              <button
                onClick={() => setEditingTeamName(true)}
                className="w-fit rounded-lg border border-amber-800/50 bg-stone-900 px-4 py-2 text-sm font-semibold hover:bg-stone-800"
              >
                Edit Team Name
              </button>
            )}
          </>
        )}
      </div>

      {message && (
        <p className="mt-4 rounded-lg border border-amber-900/40 bg-stone-900 p-3 text-stone-300">
          {message}
        </p>
      )}

      <section className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">My Team</h2>
          <p className="text-sm text-stone-300">
            {myTeam?.total_points ?? 0} points spent
          </p>
        </div>

        <RosterTable pokemon={myTeam?.pokemon ?? []} />
      </section>

      <section className="mt-8">
        <h2 className="text-2xl font-bold">All Teams</h2>

        <div className="mt-4 space-y-6">
          {otherTeams.map((team) => (
            <section
              key={team.id}
              className="rounded-lg border border-amber-900/40 bg-stone-900 p-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">
                  {team.league_members?.team_name ?? "Unnamed Team"}
                </h3>

                <p className="text-sm text-stone-400">
                  {team.total_points} points spent
                </p>
              </div>

              <RosterTable pokemon={team.pokemon} />
            </section>
          ))}

          {otherTeams.length === 0 && (
            <p className="rounded-lg border border-amber-900/40 bg-stone-900 p-4 text-stone-500">
              No other finalized teams yet.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
