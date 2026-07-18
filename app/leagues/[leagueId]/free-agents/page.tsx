"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import PokemonSprite from "@/app/components/PokemonSprite";
import { createClient } from "@/app/lib/supabase/client";

type Pokemon = {
  name: string;
  points: number;
  tier: number;
};

type DraftedPokemon = Pokemon & {
  pick_number: number;
};

type League = {
  point_budget: number | null;
  picks_per_team: number | null;
  free_agent_swap_limit: number | null;
  draft_completed: boolean | null;
  custom_pool: { pokemon?: unknown } | null;
  draft_format: {
    json: { pokemon?: unknown } | null;
  } | null;
};

type LeagueRow = Omit<League, "draft_format"> & {
  draft_format:
    | {
        json: { pokemon?: unknown } | null;
      }
    | {
        json: { pokemon?: unknown } | null;
      }[]
    | null;
};

type LeagueMember = {
  id: string;
  team_name: string | null;
  free_agent_swaps_used: number | null;
};

type DraftedTeamRow = {
  id: string;
  member_id: string;
  pokemon: unknown;
  total_points: number | null;
};

function isPokemon(value: unknown): value is Pokemon {
  const pokemon = value as Pokemon;

  return (
    typeof pokemon?.name === "string" &&
    typeof pokemon?.points === "number" &&
    typeof pokemon?.tier === "number"
  );
}

function isDraftedPokemon(value: unknown): value is DraftedPokemon {
  const pokemon = value as DraftedPokemon;

  return isPokemon(value) && typeof pokemon.pick_number === "number";
}

export default function FreeAgentsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [league, setLeague] = useState<League | null>(null);
  const [myMember, setMyMember] = useState<LeagueMember | null>(null);
  const [myTeamId, setMyTeamId] = useState("");
  const [myPokemon, setMyPokemon] = useState<DraftedPokemon[]>([]);
  const [allTeamPokemon, setAllTeamPokemon] = useState<DraftedPokemon[]>([]);
  const [pool, setPool] = useState<Pokemon[]>([]);
  const [selectedDropName, setSelectedDropName] = useState("");
  const [pendingAdd, setPendingAdd] = useState<Pokemon | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");

  async function loadFreeAgents() {
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("You must be logged in to view free agents.");
      return;
    }

    const { data: leagueData, error: leagueError } = await supabase
      .from("leagues")
      .select(
        "point_budget, picks_per_team, free_agent_swap_limit, draft_completed, custom_pool, draft_format:draft_formats(json)"
      )
      .eq("id", leagueId)
      .single();

    if (leagueError) {
      setMessage(leagueError.message);
      return;
    }

    const leagueRow = leagueData as LeagueRow;
    const typedLeague: League = {
      ...leagueRow,
      draft_format: Array.isArray(leagueRow.draft_format)
        ? leagueRow.draft_format[0] ?? null
        : leagueRow.draft_format,
    };
    setLeague(typedLeague);

    const rawPool =
      typedLeague.custom_pool?.pokemon ??
      typedLeague.draft_format?.json?.pokemon ??
      [];

    setPool(Array.isArray(rawPool) ? rawPool.filter(isPokemon) : []);

    const { data: member, error: memberError } = await supabase
      .from("league_members")
      .select("id, team_name, free_agent_swaps_used")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .single();

    if (memberError || !member) {
      setMessage("You are not a member of this league.");
      return;
    }

    setMyMember(member);

    const { data: teamRows, error: teamError } = await supabase
      .from("drafted_teams")
      .select("id, member_id, pokemon, total_points")
      .eq("league_id", leagueId);

    if (teamError) {
      setMessage(teamError.message);
      return;
    }

    const teams = (teamRows ?? []) as DraftedTeamRow[];
    const mine = teams.find((team) => team.member_id === member.id);

    setMyTeamId(mine?.id ?? "");

    const minePokemon = Array.isArray(mine?.pokemon)
      ? mine.pokemon.filter(isDraftedPokemon)
      : [];

    setMyPokemon(minePokemon);
    setSelectedDropName((current) =>
      minePokemon.some((pokemon) => pokemon.name === current)
        ? current
        : minePokemon[0]?.name ?? ""
    );

    setAllTeamPokemon(
      teams.flatMap((team) =>
        Array.isArray(team.pokemon) ? team.pokemon.filter(isDraftedPokemon) : []
      )
    );
  }

  useEffect(() => {
    void Promise.resolve().then(loadFreeAgents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pointBudget = league?.point_budget ?? 120;
  const picksPerTeam = league?.picks_per_team ?? 10;
  const freeAgentSwapLimit = league?.free_agent_swap_limit ?? 3;
  const freeAgentSwapsUsed = myMember?.free_agent_swaps_used ?? 0;
  const freeAgentSwapsRemaining = Math.max(
    0,
    freeAgentSwapLimit - freeAgentSwapsUsed
  );
  const currentTotal = myPokemon.reduce(
    (total, pokemon) => total + pokemon.points,
    0
  );
  const draftedNames = useMemo(
    () => new Set(allTeamPokemon.map((pokemon) => pokemon.name)),
    [allTeamPokemon]
  );
  const selectedDrop = myPokemon.find(
    (pokemon) => pokemon.name === selectedDropName
  );

  const freeAgents = pool
    .filter((pokemon) => !draftedNames.has(pokemon.name))
    .filter((pokemon) =>
      pokemon.name.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return a.name.localeCompare(b.name);
    });

  function openSwapConfirmation(freeAgent: Pokemon) {
    if (!league?.draft_completed) {
      setMessage("Free agent moves open after the draft is complete.");
      return;
    }

    if (!myTeamId) {
      setMessage("Your finalized team has not been saved yet.");
      return;
    }

    if (freeAgentSwapsRemaining <= 0) {
      setMessage("You have used all of your free agent swaps for the season.");
      return;
    }

    if (myPokemon.length >= picksPerTeam && !selectedDrop) {
      setMessage("Choose a Pokemon to drop first.");
      return;
    }

    const nextTotal =
      currentTotal - (selectedDrop?.points ?? 0) + freeAgent.points;

    if (nextTotal > pointBudget) {
      setMessage("That move would put your team over the point budget.");
      return;
    }

    setMessage("");
    setPendingAdd(freeAgent);
  }

  async function confirmSwapPokemon() {
    if (!pendingAdd) return;

    const freeAgent = pendingAdd;
    const nextTotal =
      currentTotal - (selectedDrop?.points ?? 0) + freeAgent.points;

    setSaving(freeAgent.name);
    setMessage("");

    const nextPokemon = selectedDrop
      ? myPokemon.map((pokemon) =>
          pokemon.name === selectedDrop.name
            ? { ...freeAgent, pick_number: pokemon.pick_number }
            : pokemon
        )
      : [
          ...myPokemon,
          {
            ...freeAgent,
            pick_number:
              Math.max(0, ...myPokemon.map((pokemon) => pokemon.pick_number)) +
              1,
          },
        ];

    const { error } = await supabase
      .from("drafted_teams")
      .update({
        pokemon: nextPokemon,
        total_points: nextTotal,
      })
      .eq("id", myTeamId);

    if (error) {
      setMessage(`Could not update team: ${error.message}`);
      setSaving("");
      return;
    }

    const { error: memberError } = await supabase
      .from("league_members")
      .update({ free_agent_swaps_used: freeAgentSwapsUsed + 1 })
      .eq("id", myMember?.id ?? "")
      .eq("league_id", leagueId)
      .eq("free_agent_swaps_used", freeAgentSwapsUsed);

    if (memberError) {
      setMessage(`Team updated, but swap count failed: ${memberError.message}`);
      setSaving("");
      return;
    }

    const newsMessage = selectedDrop
      ? `${myMember?.team_name ?? "A team"} added ${freeAgent.name} and dropped ${selectedDrop.name}.`
      : `${myMember?.team_name ?? "A team"} added ${freeAgent.name}.`;

    const { error: newsError } = await supabase.from("league_news").insert({
      league_id: leagueId,
      member_id: myMember?.id ?? null,
      news_type: "free_agent",
      message: newsMessage,
      metadata: {
        added: freeAgent.name,
        dropped: selectedDrop?.name ?? null,
        team_id: myTeamId,
        before_pokemon: myPokemon,
        after_pokemon: nextPokemon,
        previous_free_agent_swaps_used: freeAgentSwapsUsed,
        next_free_agent_swaps_used: freeAgentSwapsUsed + 1,
      },
    });

    if (newsError) {
      setMessage(`Team updated, but league news failed: ${newsError.message}`);
      setSaving("");
      return;
    }

    setSaving("");
    setPendingAdd(null);
    setMessage(newsMessage);
    await loadFreeAgents();
  }

  return (
    <>
      <h1 className="text-4xl font-bold">Free Agents</h1>
      <p className="mt-2 text-stone-400">
        Make post-draft changes to {myMember?.team_name ?? "your team"}.
      </p>
      <p className="mt-1 text-sm text-stone-500">
        {freeAgentSwapsRemaining}/{freeAgentSwapLimit} free agent swaps
        remaining
      </p>

      {message && (
        <p className="mt-4 rounded-lg border border-amber-900/40 bg-stone-900 p-3 text-stone-300">
          {message}
        </p>
      )}

      {!league?.draft_completed && (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300">
          Free agent moves open after the draft is complete.
        </p>
      )}

      <section className="mt-6 rounded-lg border border-emerald-900/40 bg-stone-900 p-5">
        <div>
          <div>
            <h2 className="text-xl font-semibold">Your Team</h2>
            <p className="mt-1 text-sm text-stone-400">
              {myPokemon.length}/{picksPerTeam} roster slots filled ·{" "}
              {currentTotal}/{pointBudget} points used
            </p>
          </div>

        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {myPokemon.map((pokemon) => (
            <button
              key={pokemon.name}
              type="button"
              onClick={() => setSelectedDropName(pokemon.name)}
              className={`rounded-lg border p-3 text-center ${
                selectedDropName === pokemon.name
                  ? "border-emerald-400 bg-emerald-500/10 ring-2 ring-emerald-400/60"
                  : "border-amber-900/30 bg-stone-950 hover:border-amber-700/70"
              }`}
            >
              <PokemonSprite name={pokemon.name} />
              <p className="mt-2 text-sm font-semibold">{pokemon.name}</p>
              <p className="text-xs text-stone-500">
                {pokemon.points} pts · Tier {pokemon.tier}
              </p>
              {selectedDropName === pokemon.name && (
                <p className="mt-2 text-xs font-semibold text-emerald-300">
                  Selected to drop
                </p>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold">Available Pokemon</h2>
            <p className="mt-1 text-sm text-stone-400">
              {freeAgents.length} undrafted Pokemon
            </p>
          </div>

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search free agents..."
            className="rounded-lg border border-stone-700 bg-stone-900 p-3"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-amber-900/40 bg-stone-900">
          <table className="w-full">
            <thead className="bg-stone-950 text-sm text-stone-400">
              <tr>
                <th className="p-3 text-left">Pokemon</th>
                <th className="p-3 text-left">Points</th>
                <th className="p-3 text-left">Tier</th>
                <th className="p-3 text-right">Move</th>
              </tr>
            </thead>

            <tbody>
              {freeAgents.map((pokemon) => {
                const nextTotal =
                  currentTotal - (selectedDrop?.points ?? 0) + pokemon.points;
                const overBudget = nextTotal > pointBudget;

                return (
                  <tr
                    key={pokemon.name}
                    className="border-t border-amber-900/25"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <PokemonSprite name={pokemon.name} />
                        <span className="font-semibold">{pokemon.name}</span>
                      </div>
                    </td>
                    <td className="p-3">{pokemon.points}</td>
                    <td className="p-3">{pokemon.tier}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => openSwapConfirmation(pokemon)}
                        disabled={
                          saving === pokemon.name ||
                          !league?.draft_completed ||
                          overBudget ||
                          freeAgentSwapsRemaining <= 0
                        }
                        className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-stone-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {overBudget
                          ? "Over budget"
                          : freeAgentSwapsRemaining <= 0
                            ? "No swaps left"
                          : saving === pokemon.name
                            ? "Saving..."
                            : "Add"}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {freeAgents.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-stone-500">
                    No free agents found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {pendingAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-4">
          <div className="w-full max-w-md rounded-lg border border-amber-900/60 bg-stone-900 p-5 shadow-xl">
            <h2 className="text-xl font-semibold">Confirm Free Agent Move</h2>
            <p className="mt-3 text-sm text-stone-300">
              Add {pendingAdd.name}
              {selectedDrop ? ` and drop ${selectedDrop.name}` : ""}?
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {selectedDrop && (
                <div className="rounded-lg border border-red-900/50 bg-stone-950 p-3 text-center">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-300">
                    Drop
                  </p>
                  <PokemonSprite name={selectedDrop.name} />
                  <p className="mt-2 text-sm font-semibold">
                    {selectedDrop.name}
                  </p>
                  <p className="text-xs text-stone-500">
                    {selectedDrop.points} pts
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-emerald-900/50 bg-stone-950 p-3 text-center">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                  Add
                </p>
                <PokemonSprite name={pendingAdd.name} />
                <p className="mt-2 text-sm font-semibold">{pendingAdd.name}</p>
                <p className="text-xs text-stone-500">
                  {pendingAdd.points} pts
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setPendingAdd(null)}
                disabled={Boolean(saving)}
                className="rounded-lg border border-stone-700 px-4 py-2 text-sm font-semibold text-stone-300 hover:border-stone-500 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmSwapPokemon}
                disabled={Boolean(saving)}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Confirm Move"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
