"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/app/lib/supabase/client";
import {
  buildScheduleRows,
  type ScheduleFormat,
} from "@/app/lib/league/schedule";
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

type DraftPick = {
  id: string;
  league_id: string;
  member_id: string;
  pokemon_name: string;
  points: number;
  tier: number;
  pick_number: number;
};

type DraftChatMessage = {
  id: string;
  league_id: string;
  member_id: string;
  user_id: string;
  message: string;
  created_at: string;
};

type DraftLeague = {
  id: string;
  point_budget: number | null;
  current_pick_number: number | null;
  draft_completed: boolean | null;
  draft_started: boolean | null;
  picks_per_team: number | null;
  pick_timer_seconds: number | null;
  pick_started_at: string | null;
  auto_pick_in_progress: boolean | null;
  schedule_format: ScheduleFormat | null;
  custom_pool?: {
    pokemon?: Pokemon[];
  } | null;
  draft_format?: {
    id: string;
    name: string;
    json?: {
      pokemon?: Pokemon[];
    } | null;
  } | null;
};

type MobileDraftPanel = "roster" | "pool" | "board" | "chat";

function getSnakeDraftIndex(pickNumber: number, teamCount: number) {
  const roundIndex = Math.floor((pickNumber - 1) / teamCount);
  const pickIndexInRound = (pickNumber - 1) % teamCount;

  return roundIndex % 2 === 0
    ? pickIndexInRound
    : teamCount - 1 - pickIndexInRound;
}

export default function DraftPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const supabase = createClient();

  const [league, setLeague] = useState<DraftLeague | null>(null);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [pool, setPool] = useState<Pokemon[]>([]);
  const [search, setSearch] = useState("");
  const [userMember, setUserMember] = useState<LeagueMember | null>(null);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<DraftChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatUnavailable, setChatUnavailable] = useState(false);
  const [activeMobilePanel, setActiveMobilePanel] =
    useState<MobileDraftPanel>("pool");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  useEffect(() => {
    loadDraft();
    loadChatMessages();

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
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "draft_chat_messages",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          setChatMessages((prev) => {
            const nextMessage = payload.new as DraftChatMessage;

            if (prev.some((chatMessage) => chatMessage.id === nextMessage.id)) {
              return prev;
            }

            return [...prev, nextMessage].slice(-100);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const { data: serverTime } = await supabase.rpc("get_server_time");

    if (serverTime) {
      setServerOffsetMs(new Date(serverTime).getTime() - Date.now());
    }
    const pokemonPool =
  leagueData?.custom_pool?.pokemon ??
  leagueData?.draft_format?.json?.pokemon ??
  [];
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

  async function loadChatMessages() {
    setChatError("");
    setChatUnavailable(false);

    const { data, error } = await supabase
      .from("draft_chat_messages")
      .select("id, league_id, member_id, user_id, message, created_at")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      if (
        error.code === "PGRST205" ||
        error.message.toLowerCase().includes("draft_chat_messages")
      ) {
        setChatUnavailable(true);
        setChatError("Draft chat needs the draft_chat_messages table migration.");
      } else {
        setChatError(error.message);
      }
      return;
    }

    setChatMessages(data ?? []);
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

    const index = getSnakeDraftIndex(currentPickNumber, orderedMembers.length);
    return orderedMembers[index];
  }, [orderedMembers, currentPickNumber, draftCompleted]);

  const currentRound = orderedMembers.length
    ? Math.floor((currentPickNumber - 1) / orderedMembers.length) + 1
    : 0;

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
  .filter((pokemon) => canAffordPokemon(pokemon))
  .sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }

    return a.name.localeCompare(b.name);
  });

  useEffect(() => {
    if (!draftStarted || !pickStartedAt || draftCompleted) return;

    const tick = () => {
      const serverNow = Date.now() + serverOffsetMs;
      const elapsed = Math.floor((serverNow - pickStartedAt) / 1000);
      const remaining = Math.max(0, pickTimerSeconds - elapsed);

      setSecondsLeft(remaining);

      if (
  remaining <= 0 &&
  draftStarted &&
  !draftCompleted &&
  !picking &&
  !league?.auto_pick_in_progress
) {
  autoDraftTopPick();
}
    };

    tick();

    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftStarted,
    pickStartedAt,
    pickTimerSeconds,
    draftCompleted,
    isMyTurn,
    picking,
    league?.auto_pick_in_progress,
    serverOffsetMs,
  ]);

  async function saveFinalTeams(finalPicks: DraftPick[]) {
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

  async function generateMatchupsAfterDraft() {
    if (orderedMembers.length < 2) return null;

    const scheduleFormat =
      league?.schedule_format === "double_round_robin"
        ? "double_round_robin"
        : "round_robin";
    const rows = buildScheduleRows(leagueId, orderedMembers, scheduleFormat);

    const { error: deleteError } = await supabase
      .from("league_matches")
      .delete()
      .eq("league_id", leagueId);

    if (deleteError) return deleteError.message;

    const { error: insertError } = await supabase
      .from("league_matches")
      .insert(rows);

    return insertError?.message ?? null;
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
  if (pickError.code === "23505") {
    setMessage("That Pokémon was just drafted by someone else. Refreshing draft...");
    setPicking(false);
    await loadDraft();
    return;
  }

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
      } catch (error: unknown) {
        setMessage(error instanceof Error ? error.message : "Could not save final teams.");
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

      const matchupError = await generateMatchupsAfterDraft();

      if (matchupError) {
        setMessage(`Draft complete, but matchups were not generated: ${matchupError}`);
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

  async function sendChatMessage() {
    const cleanMessage = chatInput.trim();

    if (!cleanMessage || chatSending) return;

    if (chatUnavailable) {
      setChatError("Draft chat needs the draft_chat_messages table migration.");
      return;
    }

    if (!userMember) {
      setChatError("You must be a league member to chat.");
      return;
    }

    setChatSending(true);
    setChatError("");

    const { error } = await supabase.from("draft_chat_messages").insert({
      league_id: leagueId,
      member_id: userMember.id,
      user_id: userMember.user_id,
      message: cleanMessage.slice(0, 500),
    });

    if (error) {
      if (
        error.code === "PGRST205" ||
        error.message.toLowerCase().includes("draft_chat_messages")
      ) {
        setChatUnavailable(true);
        setChatError("Draft chat needs the draft_chat_messages table migration.");
      } else {
        setChatError(error.message);
      }
      setChatSending(false);
      return;
    }

    setChatInput("");
    setChatSending(false);
  }

  function getMemberName(memberId: string) {
    return members.find((member) => member.id === memberId)?.team_name ?? "Team";
  }

  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-4xl font-bold">Draft Room</h1>

          <p className="mt-2 text-stone-400">
            {!draftStarted && !draftCompleted ? (
              <span className="text-amber-300">Draft has not started</span>
            ) : draftCompleted ? (
              <span className="text-emerald-300">Draft complete</span>
            ) : (
              <>
                Round {currentRound} - Pick #{currentPickNumber} - Current Team:{" "}
                <span className="text-stone-100">
                  {currentMember?.team_name ?? "No draft order"}
                </span>
              </>
            )}
          </p>

          <p className="mt-1 text-sm text-stone-500">
            {picks.length}/{totalRequiredPicks} total picks made
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          {isCommissioner && !draftStarted && !draftCompleted && (
            <button
              onClick={startDraft}
              className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-stone-950 hover:bg-emerald-400"
            >
              Start Draft
            </button>
          )}

          <div className="rounded-lg border border-amber-900/40 bg-stone-900 px-5 py-3 text-center">
            <p className="text-xs uppercase tracking-wide text-stone-500">
              Pick Timer
            </p>

            <p className="text-3xl font-bold">
              {draftStarted && !draftCompleted
                ? `${secondsLeft ?? pickTimerSeconds}s`
                : "—"}
            </p>
          </div>

          <div className="rounded-lg border border-emerald-900/40 bg-stone-900 px-5 py-3 text-center">
            <p className="text-xs uppercase tracking-wide text-stone-500">
              Budget
            </p>

            <p className="text-3xl font-bold">{userRemaining}</p>

            <p className="text-xs text-stone-500">/ {pointBudget}</p>
          </div>
        </div>
      </div>

      {message && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-300">
          {message}
        </p>
      )}

      {draftCompleted && (
        <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-300">
          Draft complete. Teams have been saved.
        </p>
      )}

      {orderedMembers.length === 0 && (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300">
          No draft order has been set. Go to Settings, assign draft positions,
          and save.
        </p>
      )}

      {!draftStarted && !draftCompleted && orderedMembers.length > 0 && (
        <p className="mt-4 rounded-lg border border-amber-900/40 bg-stone-900 p-3 text-stone-300">
          Waiting for the commissioner to start the draft.
        </p>
      )}

      {!isMyTurn && draftStarted && !draftCompleted && orderedMembers.length > 0 && (
        <p className="mt-4 rounded-lg border border-amber-900/40 bg-stone-900 p-3 text-stone-300">
          Waiting for {currentMember?.team_name ?? "the current team"} to pick.
        </p>
      )}

      {isMyTurn && draftStarted && !draftCompleted && (
        <p className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-200">
          You are on the clock. Choose a Pokemon that fits your remaining budget.
        </p>
      )}

      <nav className="mt-6 grid grid-cols-4 gap-2 rounded-lg border border-amber-900/40 bg-stone-900 p-2 lg:hidden">
        {[
          { id: "roster", label: "Roster" },
          { id: "pool", label: "Pool" },
          { id: "board", label: "Board" },
          { id: "chat", label: "Chat" },
        ].map((panel) => (
          <button
            key={panel.id}
            type="button"
            onClick={() => setActiveMobilePanel(panel.id as MobileDraftPanel)}
            className={`rounded-md px-2 py-2 text-sm font-semibold ${
              activeMobilePanel === panel.id
                ? "bg-emerald-500 text-stone-950"
                : "text-stone-300 hover:bg-stone-800"
            }`}
          >
            {panel.label}
          </button>
        ))}
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <section
            className={`mb-4 rounded-lg border border-emerald-900/40 bg-stone-900 p-4 ${
              activeMobilePanel === "roster" ? "block" : "hidden"
            } lg:block`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Your Drafted Pokémon</h2>
                <p className="text-sm text-stone-500">
                  {userPicks.length}/{picksPerTeam} roster slots filled
                </p>
              </div>

              <p className="text-sm text-stone-400">
                {userRemaining}/{pointBudget} points remaining
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-10">
              {rosterSlots.map((pick, index) => (
                <div
                  key={index}
                  className="flex min-h-24 flex-col items-center justify-center rounded-lg border border-amber-900/30 bg-stone-950 p-2 text-center"
                >
                  {pick ? (
                    <>
                      <PokemonSprite name={pick.pokemon_name} />
                      <p className="mt-2 text-xs font-semibold leading-tight">
                        {pick.pokemon_name}
                      </p>
                      <p className="text-[11px] text-stone-500">
                        {pick.points} pts
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-stone-700 text-xs text-stone-600">
                        {index + 1}
                      </div>
                      <p className="mt-2 text-xs text-stone-600">Empty</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section
            className={`${activeMobilePanel === "pool" ? "block" : "hidden"} lg:block`}
          >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search selectable Pokémon..."
            className="w-full rounded-lg border border-stone-700 bg-stone-900 p-3"
          />

          <div className="mt-4 overflow-hidden rounded-lg border border-amber-900/40 bg-stone-900">
            <table className="w-full">
              <thead className="bg-stone-950 text-sm text-stone-400">
                <tr>
                  <th className="p-3 text-left">Pokémon</th>
                  <th className="p-3 text-left">Points</th>
                  <th className="p-3 text-left">Tier</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>

              <tbody>
                {visiblePokemon.map((pokemon) => (
                  <tr key={pokemon.name} className="border-t border-amber-900/25">
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
                        className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-stone-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {canDraftPokemon(pokemon) ? "Draft" : "Unavailable"}
                      </button>
                    </td>
                  </tr>
                ))}

                {visiblePokemon.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-stone-500">
                      No selectable Pokémon available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </section>
        </section>

        <aside
          className={`rounded-lg border border-amber-900/40 bg-stone-900 p-5 ${
            activeMobilePanel === "board" || activeMobilePanel === "chat"
              ? "block"
              : "hidden"
          } lg:block`}
        >
          <section
            className={`${activeMobilePanel === "board" ? "block" : "hidden"} lg:block`}
          >
          <h2 className="text-xl font-semibold">Draft Board</h2>

          <div className="mt-4 space-y-3">
           {[...picks]
  .sort((a, b) => b.pick_number - a.pick_number)
  .map((pick) => {
              const member = members.find((m) => m.id === pick.member_id);

              return (
                <div
                  key={pick.id}
                  className="rounded-lg border border-amber-900/30 bg-stone-950 p-3"
                >
                  <p className="text-sm text-stone-500">
                    Pick #{pick.pick_number} • {member?.team_name ?? "Team"}
                  </p>

                  <div className="mt-2 flex items-center gap-3">
                    <PokemonSprite name={pick.pokemon_name} size="sm" />
                    <p className="font-semibold">{pick.pokemon_name}</p>
                  </div>

                  <p className="text-sm text-stone-400">
                    {pick.points} pts • Tier {pick.tier}
                  </p>
                </div>
              );
            })}

            {picks.length === 0 && (
              <p className="text-sm text-stone-500">No picks yet.</p>
            )}
          </div>
          </section>

          <section
            className={`${
              activeMobilePanel === "chat" ? "block" : "hidden"
            } border-sky-900/40 lg:mt-6 lg:block lg:border-t lg:pt-5`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Draft Chat</h2>
              <p className="text-xs uppercase tracking-wide text-stone-500">
                League
              </p>
            </div>

            <div className="mt-4 flex h-80 flex-col gap-3 overflow-y-auto rounded-lg border border-sky-900/30 bg-stone-950 p-3">
              {chatMessages.map((chatMessage) => (
                <div key={chatMessage.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold text-sky-200">
                      {getMemberName(chatMessage.member_id)}
                    </p>
                    <time className="text-[11px] text-stone-600">
                      {new Date(chatMessage.created_at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p className="mt-1 break-words text-sm text-stone-300">
                    {chatMessage.message}
                  </p>
                </div>
              ))}

              {chatMessages.length === 0 && (
                <p className="text-sm text-stone-500">No chat messages yet.</p>
              )}
            </div>

            {chatError && (
              <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300">
                {chatError}
              </p>
            )}

            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendChatMessage();
              }}
            >
              <input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                maxLength={500}
                placeholder={
                  chatUnavailable
                    ? "Chat is not configured yet"
                    : "Message the draft room..."
                }
                className="min-w-0 flex-1 rounded-lg border border-stone-700 bg-stone-950 p-3 text-sm"
              />
              <button
                type="submit"
                disabled={
                  chatUnavailable ||
                  chatSending ||
                  !chatInput.trim() ||
                  !userMember
                }
                className="rounded-lg bg-emerald-500 px-4 text-sm font-semibold text-stone-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}
