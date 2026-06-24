"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";
import PokemonSprite from "@/app/components/PokemonSprite";

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
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

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
  const draftStarted = Boolean(league?.draft_started);
  const picksPerTeam = league?.picks_per_team ?? 10;
  const pickTimerSeconds = league?.pick_timer_seconds ?? 120;
  const pickStartedAt = league?.pick_started_at
    ? new Date(league.pick_started_at).getTime()
    : null;

  const isCommissioner = userMember?.role === "commissioner";

  const orderedMembers = useMemo(() => {
    return [...members].sort(
      (a, b) => (a.draft_position ?? 9999) - (b.draft_position ?? 9999)
    );
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

  const userPicks = useMemo(() => {
    if (!userMember) return [];

    return picks
      .filter((pick) => pick.member_id === userMember.id)
      .sort((a, b) => a.pick_number - b.pick_number);
  }, [picks, userMember]);

  const rosterSlots = Array.from({ length: picksPerTeam }, (_, index) => {
    return userPicks[index] ?? null;
  });

  const isMyTurn = Boolean(userMember?.id && currentMember?.id === userMember.id);

  function canAffordPokemon(pokemon: Pokemon) {
    if (!userMember) return false;

    if (pokemon.points > userRemaining) return false;

    const userPickCount = picks.filter(
      (pick) => pick.member_id === userMember.id
    ).length;

    const picksLeftAfterThis = picksPerTeam - userPickCount - 1;
    const remainingAfterPick = userRemaining - pokemon.points;

    return remainingAfterPick >= picksLeftAfterThis;
  }

  function canDraftPokemon(pokemon: Pokemon) {
    if (!draftStarted) return false;
    if (!userMember) return false;
    if (!isMyTurn) return false;
    if (draftCompleted) return false;

    return canAffordPokemon(pokemon);
  }

  const visiblePokemon = pool
    .filter((pokemon) => !draftedNames.has(pokemon.name))
    .filter((pokemon) =>
      pokemon.name.toLowerCase().includes(search.toLowerCase())
    )
    .filter((pokemon) => canAffordPokemon(pokemon));

  useEffect(() => {
    if (!draftStarted || !pickStartedAt || draftCompleted) return;

    const tick = () => {
      const elapsed = Math.floor((Date.now() - pickStartedAt) / 1000);
      const remaining = Math.max(0, pickTimerSeconds - elapsed);

      setSecondsLeft(remaining);

      if (
        remaining <= 0 &&
        isMyTurn &&
        !picking &&
        !league?.auto_pick_in_progress
      ) {
        autoDraftTopPick();
      }
    };

    tick();

    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
  }, [
    draftStarted,
    pickStartedAt,
    pickTimerSeconds,
    draftCompleted,
    isMyTurn,
    picking,
    league?.auto_pick_in_progress,
  ]);

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

  async function autoDraftTopPick() {
    if (!isMyTurn || picking || draftCompleted) return;

    const { data: lockData, error: lockError } = await supabase
      .from("leagues")
      .update({ auto_pick_in_progress: true })
      .eq("id", leagueId)
      .eq("current_pick_number", currentPickNumber)
      .eq("auto_pick_in_progress", false)
      .select("id")
      .maybeSingle();

    if (lockError || !lockData) return;

    const topPick = visiblePokemon[0];

    if (!topPick) {
      setMessage("Timer expired, but no legal Pokémon were available.");

      await supabase
        .from("leagues")
        .update({ auto_pick_in_progress: false })
        .eq("id", leagueId);

      return;
    }

    await draftPokemon(topPick);
  }

  async function startDraft() {
    setMessage("");

    if (!isCommissioner) {
      setMessage("Only the commissioner can start the draft.");
      return;
    }

    if (orderedMembers.length === 0) {
      setMessage("Set the draft order before starting the draft.");
      return;
    }

    const { error } = await supabase.rpc("start_draft_timer", {
      target_league_id: leagueId,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    await loadDraft();
  }

  async function draftPokemon(pokemon: Pokemon) {
    setMessage("");

    if (!draftStarted) {
      setMessage("The draft has not started yet.");
      return;
    }

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

    if (!canDraftPokemon(pokemon)) {
      setMessage("That Pokémon is not selectable with your current budget.");
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

      const { error: completeError } = await supabase.rpc(
        "complete_draft_timer",
        {
          target_league_id: leagueId,
          final_pick: currentPickNumber,
        }
      );

      if (completeError) {
        setMessage(completeError.message);
        setPicking(false);
        return;
      }
    } else {
      const { error: updateError } = await supabase.rpc(
        "advance_draft_timer",
        {
          target_league_id: leagueId,
          next_pick: nextPickNumber,
        }
      );

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
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-4xl font-bold">Draft Room</h1>

          <p className="mt-2 text-zinc-400">
            {!draftStarted && !draftCompleted ? (
              <span className="text-amber-300">Draft has not started</span>
            ) : draftCompleted ? (
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

        <div className="flex flex-wrap gap-4">
          {isCommissioner && !draftStarted && !draftCompleted && (
            <button
              onClick={startDraft}
              className="rounded-2xl bg-emerald-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              Start Draft
            </button>
          )}

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-3 text-center">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Pick Timer
            </p>

            <p className="text-3xl font-bold">
              {draftStarted && !draftCompleted
                ? `${secondsLeft ?? pickTimerSeconds}s`
                : "—"}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-3 text-center">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Budget
            </p>

            <p className="text-3xl font-bold">{userRemaining}</p>

            <p className="text-xs text-zinc-500">/ {pointBudget}</p>
          </div>
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

      {!draftStarted && !draftCompleted && orderedMembers.length > 0 && (
        <p className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-zinc-300">
          Waiting for the commissioner to start the draft.
        </p>
      )}

      {!isMyTurn && draftStarted && !draftCompleted && orderedMembers.length > 0 && (
        <p className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-zinc-300">
          Waiting for {currentMember?.team_name ?? "the current team"} to pick.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <section className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Your Drafted Pokémon</h2>
                <p className="text-sm text-zinc-500">
                  {userPicks.length}/{picksPerTeam} roster slots filled
                </p>
              </div>

              <p className="text-sm text-zinc-400">
                {userRemaining}/{pointBudget} points remaining
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
              {rosterSlots.map((pick, index) => (
                <div
                  key={index}
                  className="flex min-h-24 flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-center"
                >
                  {pick ? (
                    <>
                      <PokemonSprite name={pick.pokemon_name} />
                      <p className="mt-2 text-xs font-semibold leading-tight">
                        {pick.pokemon_name}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {pick.points} pts
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-zinc-700 text-xs text-zinc-600">
                        {index + 1}
                      </div>
                      <p className="mt-2 text-xs text-zinc-600">Empty</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search selectable Pokémon..."
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
                {visiblePokemon.map((pokemon) => (
                  <tr key={pokemon.name} className="border-t border-zinc-800">
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
                        onClick={() => draftPokemon(pokemon)}
                        disabled={picking || !canDraftPokemon(pokemon)}
                        className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {canDraftPokemon(pokemon) ? "Draft" : "Unavailable"}
                      </button>
                    </td>
                  </tr>
                ))}

                {visiblePokemon.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-zinc-500">
                      No selectable Pokémon available.
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

                  <div className="mt-2 flex items-center gap-3">
                    <PokemonSprite name={pick.pokemon_name} size="sm" />
                    <p className="font-semibold">{pick.pokemon_name}</p>
                  </div>

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