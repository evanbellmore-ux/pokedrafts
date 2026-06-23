"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";

type Pokemon = {
  name: string;
  points: number;
  tier: number;
};

type LeagueMember = {
  id: string;
  user_id: string;
  team_name: string | null;
  role: string | null;
  draft_position: number | null;
};

export default function DraftPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [league, setLeague] = useState<any>(null);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [pool, setPool] = useState<Pokemon[]>([]);
  const [search, setSearch] = useState("");
  const [userMember, setUserMember] = useState<LeagueMember | null>(null);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadDraft();

    const channel = supabase
      .channel(`draft-${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "draft_picks",
          filter: `league_id=eq.${leagueId}`,
        },
        () => loadDraft()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leagues",
          filter: `id=eq.${leagueId}`,
        },
        () => loadDraft()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "league_members",
          filter: `league_id=eq.${leagueId}`,
        },
        () => loadDraft()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId]);

  async function loadDraft() {
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: leagueData, error: leagueError } = await supabase
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

    if (leagueError) {
      setMessage(leagueError.message);
      return;
    }

    setLeague(leagueData);

    const pokemonPool = leagueData?.draft_format?.json?.pokemon ?? [];
    setPool(Array.isArray(pokemonPool) ? pokemonPool : []);

    const { data: memberData, error: memberError } = await supabase
      .from("league_members")
      .select("id, user_id, team_name, role, draft_position")
      .eq("league_id", leagueId)
      .not("draft_position", "is", null)
      .order("draft_position", { ascending: true });

    if (memberError) {
      setMessage(memberError.message);
      return;
    }

    setMembers(memberData ?? []);

    if (user) {
      const mine = memberData?.find((member) => member.user_id === user.id);
      setUserMember(mine ?? null);
    }

    const { data: pickData, error: pickError } = await supabase
      .from("draft_picks")
      .select("*")
      .eq("league_id", leagueId)
      .order("pick_number", { ascending: true });

    if (pickError) {
      setMessage(pickError.message);
      return;
    }

    setPicks(pickData ?? []);
  }

  const currentPickNumber = league?.current_pick_number ?? picks.length + 1;
  const pointBudget = league?.point_budget ?? 120;
  const draftCompleted = Boolean(league?.draft_completed);
  const picksPerTeam = league?.picks_per_team ?? 10;

  const orderedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      return (a.draft_position ?? 9999) - (b.draft_position ?? 9999);
    });
  }, [members]);

  const totalRequiredPicks = orderedMembers.length * picksPerTeam;

  const currentMember = useMemo(() => {
    if (orderedMembers.length === 0) return null;
    if (draftCompleted) return null;

    const index = (currentPickNumber - 1) % orderedMembers.length;
    return orderedMembers[index];
  }, [orderedMembers, currentPickNumber, draftCompleted]);

  const draftedNames = useMemo(() => {
    return new Set(picks.map((pick) => pick.pokemon_name));
  }, [picks]);

  const spentByMember = useMemo(() => {
    const map = new Map<string, number>();

    for (const pick of picks) {
      map.set(pick.member_id, (map.get(pick.member_id) ?? 0) + pick.points);
    }

    return map;
  }, [picks]);

  const userSpent = userMember ? spentByMember.get(userMember.id) ?? 0 : 0;
  const userRemaining = pointBudget - userSpent;

  const availablePokemon = pool
    .filter((pokemon) => !draftedNames.has(pokemon.name))
    .filter((pokemon) =>
      pokemon.name.toLowerCase().includes(search.toLowerCase())
    );

  const isMyTurn = Boolean(
    userMember?.id && currentMember?.id === userMember.id
  );

  async function saveFinalTeams(finalPicks: any[]) {
    for (const member of orderedMembers) {
      const memberPicks = finalPicks.filter(
        (pick) => pick.member_id === member.id
      );

      const totalPoints = memberPicks.reduce(
        (sum, pick) => sum + Number(pick.points ?? 0),
        0
      );

      const pokemon = memberPicks.map((pick) => ({
        name: pick.pokemon_name,
        points: pick.points,
        tier: pick.tier,
        pick_number: pick.pick_number,
      }));

      const { error } = await supabase.from("drafted_teams").upsert(
        {
          league_id: leagueId,
          member_id: member.id,
          pokemon,
          total_points: totalPoints,
        },
        {
          onConflict: "league_id,member_id",
        }
      );

      if (error) throw error;
    }
  }
function canDraftPokemon(pokemon: Pokemon) {
  if (!userMember) return false;
  if (!isMyTurn) return false;
  if (draftCompleted) return false;

  if (pokemon.points > userRemaining) {
    return false;
  }

  const userPickCount = picks.filter(
    (pick) => pick.member_id === userMember.id
  ).length;

  const picksLeftAfterThis = picksPerTeam - userPickCount - 1;
  const remainingAfterPick = userRemaining - pokemon.points;

  if (remainingAfterPick < picksLeftAfterThis) {
    return false;
  }

  return true;
}

  async function draftPokemon(pokemon: Pokemon) {
    setMessage("");

    if (draftCompleted) {
      setMessage("The draft is already complete.");
      return;
    }

    if (!userMember) {
      setMessage("You are not a member of this league.");
      return;
    }

    if (!isMyTurn) {
      setMessage("It is not your turn.");
      return;
    }

    if (pokemon.points > userRemaining) {
      setMessage("You do not have enough points left for this Pokémon.");
      return;
    }

    const userPickCount = picks.filter(
      (pick) => pick.member_id === userMember.id
    ).length;

    const picksLeftAfterThis = picksPerTeam - userPickCount - 1;
    const remainingAfterPick = userRemaining - pokemon.points;

    if (remainingAfterPick < picksLeftAfterThis) {
      setMessage(
        `You need to leave at least ${picksLeftAfterThis} point${
          picksLeftAfterThis === 1 ? "" : "s"
        } for your remaining picks.`
      );
      return;
    }

    setPicking(true);

    const { error: pickError } = await supabase.from("draft_picks").insert({
      league_id: leagueId,
      member_id: userMember.id,
      pokemon_name: pokemon.name,
      points: pokemon.points,
      tier: pokemon.tier,
      pick_number: currentPickNumber,
    });

    if (pickError) {
      setMessage(pickError.message);
      setPicking(false);
      return;
    }

    const nextPickNumber = currentPickNumber + 1;
    const draftIsDone = nextPickNumber > totalRequiredPicks;

    if (draftIsDone) {
      const { data: finalPicks, error: finalPicksError } = await supabase
        .from("draft_picks")
        .select("*")
        .eq("league_id", leagueId)
        .order("pick_number", { ascending: true });

      if (finalPicksError) {
        setMessage(finalPicksError.message);
        setPicking(false);
        return;
      }

      try {
        await saveFinalTeams(finalPicks ?? []);
      } catch (error: any) {
        setMessage(error.message);
        setPicking(false);
        return;
      }

      const { error: completeError } = await supabase
        .from("leagues")
        .update({
          draft_completed: true,
          current_pick_number: currentPickNumber,
        })
        .eq("id", leagueId);

      if (completeError) {
        setMessage(completeError.message);
        setPicking(false);
        return;
      }
    } else {
      const { error: updateError } = await supabase
        .from("leagues")
        .update({
          current_pick_number: nextPickNumber,
        })
        .eq("id", leagueId);

      if (updateError) {
        setMessage(updateError.message);
        setPicking(false);
        return;
      }
    }

    setPicking(false);
    await loadDraft();
  }

  return (
    <>
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-4xl font-bold">Draft Room</h1>

          <p className="mt-2 text-zinc-400">
            {draftCompleted ? (
              <span className="text-emerald-300">Draft complete</span>
            ) : (
              <>
                Pick #{currentPickNumber} • Current Team:{" "}
                <span className="text-zinc-100">
                  {currentMember?.team_name ?? "No draft order"}
                </span>
              </>
            )}
          </p>

          <p className="mt-1 text-sm text-zinc-500">
            {picks.length}/{totalRequiredPicks} total picks made
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm text-zinc-400">Your Budget</p>
          <p className="text-2xl font-bold">
            {userRemaining}/{pointBudget}
          </p>
        </div>
      </div>

      {message && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-300">
          {message}
        </p>
      )}

      {draftCompleted && (
        <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-300">
          Draft complete. Teams have been saved.
        </p>
      )}

      {orderedMembers.length === 0 && (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300">
          No draft order has been set. Go to Settings, assign draft positions,
          and save.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search available Pokémon..."
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3"
          />

          <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <table className="w-full">
              <thead className="bg-zinc-950 text-sm text-zinc-400">
                <tr>
                  <th className="p-3 text-left">Pokémon</th>
                  <th className="p-3 text-left">Points</th>
                  <th className="p-3 text-left">Tier</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>

              <tbody>
                {availablePokemon.map((pokemon) => (
                  <tr key={pokemon.name} className="border-t border-zinc-800">
                    <td className="p-3 font-semibold">{pokemon.name}</td>
                    <td className="p-3">{pokemon.points}</td>
                    <td className="p-3">{pokemon.tier}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => draftPokemon(pokemon)}
                        disabled={
  picking ||
  !canDraftPokemon(pokemon)
}
                        className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Draft
                      </button>
                    </td>
                  </tr>
                ))}

                {availablePokemon.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-zinc-500">
                      No available Pokémon found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-xl font-semibold">Draft Board</h2>

          <div className="mt-4 space-y-3">
            {picks.map((pick) => {
              const member = members.find((m) => m.id === pick.member_id);

              return (
                <div
                  key={pick.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"
                >
                  <p className="text-sm text-zinc-500">
                    Pick #{pick.pick_number} • {member?.team_name ?? "Team"}
                  </p>
                  <p className="font-semibold">{pick.pokemon_name}</p>
                  <p className="text-sm text-zinc-400">
                    {pick.points} pts • Tier {pick.tier}
                  </p>
                </div>
              );
            })}

            {picks.length === 0 && (
              <p className="text-sm text-zinc-500">No picks yet.</p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}