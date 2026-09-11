"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { useLeague } from "@/app/components/league/LeagueProvider";
import { friendlyError } from "@/app/lib/errors";
import {
  getDraftRound,
  getSnakeDraftIndex,
  totalDraftPicks,
} from "@/app/lib/league/draft";
import { teamNameLabel } from "@/app/lib/league/labels";
import { CREATE_LEAGUE_DEFAULTS } from "@/app/lib/league/limits";
import { useDex } from "@/app/lib/pokemon/useDex";
import { rpc, type RpcResult } from "@/app/lib/rpc";
import { createClient } from "@/app/lib/supabase/client";
import type { DraftPokemon } from "@/app/types/draft";
import type {
  DraftChatMessage,
  DraftPick,
  LeagueMember,
} from "@/app/types/league";
import {
  AUTO_PICK_RETRY_MS,
  CHAT_LIMIT,
  RECONNECT_POLL_MS,
  buildBoard,
  clampChatMessage,
  compareByValue,
  getDraftPhase,
  getDraftingCoaches,
  getMinPoolPoints,
  getPickBlock,
  getSecondsLeft,
  getStartBlock,
  getTeamBudget,
  isChatMessage,
  mergeChat,
  pokemonKey,
  readPool,
  type BoardRound,
  type PickBlock,
  type TeamBudget,
} from "./draft-room";

/** Realtime channel state as seen by the room (docs section 7). */
export type LiveStatus = "connecting" | "live" | "reconnecting";

export type DraftNotice = {
  variant: "success" | "error" | "warning";
  text: string;
};

/** Which mutation is in flight; `pick:<name>` for the Draft buttons. */
export type DraftAction =
  | "start"
  | "pause"
  | "resume"
  | "undo"
  | "force"
  | "finalize"
  | "reset"
  | `pick:${string}`;

const CHAT_SELECT = "id, league_id, member_id, user_id, message, created_at";

/**
 * Every subscription gets a topic of its own (docs section 7): supabase-js
 * hands back the existing channel for a repeated topic, and React runs
 * effects twice in development, so a fixed topic would re-attach to a
 * channel the first cleanup is still tearing down and never report "Live".
 */
let channelSequence = 0;

/**
 * State and actions for the draft room (docs/release-architecture.md
 * sections 5, 7 and 8.2).
 *
 * - The league row comes from `useLeague()`; every reload refreshes it
 *   through the provider and re-reads members, picks and the newest chat.
 * - Reloads are serialized and coalesced: a reload requested while one is
 *   running starts after it, and several requests made in the meantime share
 *   that single run. `load` also carries a generation counter so a response
 *   from an older request is ignored.
 * - Every mutation goes through `rpc.*`; on success the room reloads before
 *   the success message is shown, on error it shows the function's message
 *   and reloads anyway so stale local state never lingers.
 * - The Pokémon dex (sprites and types) loads through `useDex()`; a failure
 *   is surfaced with a Retry but never blocks the room, which works from the
 *   pool's names and points alone.
 */
export function useDraftRoom() {
  const { league, member, user, isCommissioner, refresh } = useLeague();
  const leagueId = league.id;
  const supabase = useMemo(() => createClient(), []);
  const { dex, error: dexError, retry: retryDex } = useDex();

  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [chat, setChat] = useState<DraftChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Client clock at the last tick or load (0 until the first load). */
  const [now, setNow] = useState(0);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [clockSynced, setClockSynced] = useState(false);
  const [live, setLive] = useState<LiveStatus>("connecting");
  const [notice, setNotice] = useState<DraftNotice | null>(null);
  const [pendingAction, setPendingAction] = useState<DraftAction | null>(null);
  const [autoPickError, setAutoPickError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const queuedRef = useRef<Promise<void> | null>(null);
  const autoPickBusyRef = useRef(false);
  const autoPickRef = useRef<() => void>(() => {});
  const mountedRef = useRef(false);
  const retryRef = useRef(0);

  const load = useCallback(async (): Promise<string | null | undefined> => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const requestedAt = Date.now();

    const fetchAll = () =>
      Promise.all([
        supabase
          .from("league_members")
          .select("*")
          .eq("league_id", leagueId)
          .order("joined_at", { ascending: true }),
        supabase
          .from("draft_picks")
          .select("*")
          .eq("league_id", leagueId)
          .order("pick_number", { ascending: true }),
        supabase
          .from("draft_chat_messages")
          .select(CHAT_SELECT)
          .eq("league_id", leagueId)
          .order("created_at", { ascending: false })
          .limit(CHAT_LIMIT),
        rpc.getServerTime(),
      ]);

    let results: Awaited<ReturnType<typeof fetchAll>>;
    try {
      results = await fetchAll();
    } catch (caught) {
      if (generation !== generationRef.current) return undefined;
      const message = friendlyError(caught);
      setLoadError(message);
      return message;
    }

    if (generation !== generationRef.current) return undefined;
    const respondedAt = Date.now();
    const [membersResult, picksResult, chatResult, timeResult] = results;

    const queryError =
      membersResult.error ?? picksResult.error ?? chatResult.error;
    if (queryError) {
      const message = friendlyError(queryError);
      setLoadError(message);
      return message;
    }

    if (timeResult.error === null) {
      const serverMs = new Date(timeResult.data).getTime();
      if (!Number.isNaN(serverMs)) {
        // Sample the offset at the request midpoint to cancel the round trip.
        setServerOffsetMs(serverMs - (requestedAt + respondedAt) / 2);
        setClockSynced(true);
      }
    }

    setNow(respondedAt);
    setMembers(
      Array.isArray(membersResult.data)
        ? (membersResult.data as LeagueMember[])
        : []
    );
    setPicks(
      Array.isArray(picksResult.data) ? (picksResult.data as DraftPick[]) : []
    );
    const incoming = Array.isArray(chatResult.data)
      ? chatResult.data.filter(isChatMessage).reverse()
      : [];
    setChat((previous) => mergeChat(previous, incoming));
    setLoadError(null);
    setLoaded(true);
    return null;
  }, [supabase, leagueId]);

  /**
   * Reloads the room (members, picks, chat) and the league row. Serialized
   * and coalesced; the returned promise resolves once the run that will
   * include this request has finished.
   */
  const reload = useCallback((): Promise<void> => {
    if (queuedRef.current) return queuedRef.current;

    const run = chainRef.current.then(async () => {
      queuedRef.current = null;
      const [loadResult, refreshError] = await Promise.all([load(), refresh()]);
      if (loadResult === undefined) return;
      if (loadResult === null && refreshError) setLoadError(refreshError);
    });

    queuedRef.current = run;
    chainRef.current = run.catch(() => undefined);
    return run;
  }, [load, refresh]);

  // Initial load (docs section 8.2): the effect owns the `loading` flag and
  // clears it only while still active. `load` applies a response only when
  // its generation is current, so bumping the counter on cleanup makes a
  // response that arrives after unmount (or after a StrictMode re-run) fall
  // out as stale instead of being applied.
  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    void reload().then(() => {
      if (!active) return;
      setLoading(false);
    });
    return () => {
      active = false;
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, [reload]);

  // Retry keeps the same guards: bumping the generation makes `load` drop a
  // response still in flight from the failed attempt, and only the newest
  // Retry clears `loading`, never one that settles after unmount or after a
  // later Retry has started.
  const retry = useCallback(() => {
    generationRef.current += 1;
    retryRef.current += 1;
    const attempt = retryRef.current;
    if (!loaded) setLoading(true);
    setLoadError(null);
    void reload().then(() => {
      if (!mountedRef.current || attempt !== retryRef.current) return;
      setLoading(false);
    });
  }, [loaded, reload]);

  // Realtime (docs section 7): one channel for picks, the league row, the
  // member list and chat inserts, with a status callback.
  useEffect(() => {
    let active = true;
    channelSequence += 1;
    const channel = supabase
      .channel(`league:${leagueId}:draft:${channelSequence}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "draft_picks",
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          void reload();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leagues",
          filter: `id=eq.${leagueId}`,
        },
        () => {
          void reload();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "league_members",
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          void reload();
        }
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
          const row: unknown = payload.new;
          if (!isChatMessage(row)) return;
          setChat((previous) => mergeChat(previous, [row]));
        }
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          setLive("live");
          void reload();
        } else if (
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
          status === REALTIME_SUBSCRIBE_STATES.CLOSED
        ) {
          setLive("reconnecting");
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [supabase, leagueId, reload]);

  // Refetch when the tab becomes visible again (missed events, throttled timers).
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") void reload();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [reload]);

  // ---- Derived state -------------------------------------------------------

  const phase = getDraftPhase(league);
  const started = phase !== "setup";
  const completed = phase === "completed";
  const paused = phase === "paused";
  const draftLive = started && !completed;

  const pool = useMemo(() => readPool(league.custom_pool), [league.custom_pool]);
  const coaches = useMemo(() => getDraftingCoaches(members), [members]);
  const membersById = useMemo(
    () => new Map(members.map((row) => [row.id, row] as const)),
    [members]
  );
  const me = membersById.get(member.id) ?? member;
  const isDrafting = me.draft_position !== null;

  const picksPerTeam = league.picks_per_team ?? CREATE_LEAGUE_DEFAULTS.picksPerTeam;
  const budget = league.point_budget ?? CREATE_LEAGUE_DEFAULTS.pointBudget;
  const teamCount = coaches.length;
  const totalPicks = totalDraftPicks(teamCount, picksPerTeam);
  const currentPick = league.current_pick_number ?? 1;
  const round =
    teamCount > 0
      ? getDraftRound(Math.min(currentPick, Math.max(totalPicks, 1)), teamCount)
      : 1;

  const onClock =
    draftLive && teamCount > 0 && currentPick <= totalPicks
      ? (coaches[getSnakeDraftIndex(currentPick, teamCount)] ?? null)
      : null;
  const nextUp =
    draftLive && teamCount > 0 && currentPick + 1 <= totalPicks
      ? (coaches[getSnakeDraftIndex(currentPick + 1, teamCount)] ?? null)
      : null;
  const isMyTurn = onClock !== null && onClock.id === me.id;

  const draftedKeys = useMemo(
    () => new Set(picks.map((pick) => pokemonKey(pick.pokemon_name))),
    [picks]
  );
  const undrafted = useMemo(
    () =>
      pool
        .filter((entry) => !draftedKeys.has(pokemonKey(entry.name)))
        .sort(compareByValue),
    [pool, draftedKeys]
  );
  const minPoolPoints = useMemo(() => getMinPoolPoints(pool), [pool]);

  const budgets = useMemo(() => {
    const map = new Map<string, TeamBudget>();
    for (const coach of coaches) {
      map.set(coach.id, getTeamBudget(coach.id, picks, budget, picksPerTeam));
    }
    return map;
  }, [coaches, picks, budget, picksPerTeam]);

  const myBudget = isDrafting ? (budgets.get(me.id) ?? null) : null;

  /** Reason each undrafted entry is blocked for the caller (absent = legal). */
  const myBlocks = useMemo(() => {
    const map = new Map<string, PickBlock>();
    if (!myBudget) return map;
    for (const entry of undrafted) {
      const block = getPickBlock(entry.points, myBudget, minPoolPoints);
      if (block) map.set(entry.name, block);
    }
    return map;
  }, [undrafted, myBudget, minPoolPoints]);

  /** Legal list for the caller, independent of the search box. */
  const legalForMe = useMemo<DraftPokemon[]>(
    () => (myBudget ? undrafted.filter((entry) => !myBlocks.has(entry.name)) : []),
    [undrafted, myBudget, myBlocks]
  );

  /** Legal list for the coach on the clock (the Force pick options). */
  const legalForOnClock = useMemo<DraftPokemon[]>(() => {
    if (!onClock) return [];
    const teamBudget = budgets.get(onClock.id);
    if (!teamBudget) return [];
    return undrafted.filter(
      (entry) => getPickBlock(entry.points, teamBudget, minPoolPoints) === null
    );
  }, [onClock, budgets, undrafted, minPoolPoints]);

  const board = useMemo<BoardRound[]>(
    () =>
      buildBoard(
        picks,
        coaches,
        membersById,
        completed ? totalPicks : currentPick - 1
      ),
    [picks, coaches, membersById, completed, totalPicks, currentPick]
  );

  const lastPick = useMemo(
    () =>
      picks.reduce<DraftPick | null>(
        (best, pick) =>
          best === null || pick.pick_number > best.pick_number ? pick : best,
        null
      ),
    [picks]
  );

  const everyCoachFull =
    teamCount > 0 &&
    coaches.every((coach) => (budgets.get(coach.id)?.pickCount ?? 0) >= picksPerTeam);
  /**
   * Stricter than `finalize_draft`'s own guard on purpose. The function also
   * accepts `current_pick_number = total`, but that is the normal state while
   * the last pick is still on the clock (`_advance_or_finalize` only moves
   * on after that pick is inserted), so offering Finalize then would let the
   * commissioner drop the last coach's final slot. Only every roster being
   * full, or a pick number past the end, is a recovery case.
   */
  const pastLastPick = teamCount > 0 && currentPick > totalPicks;
  const canFinalize = draftLive && (everyCoachFull || pastLastPick);
  /** Why Finalize is offered, so the controls' copy matches the state. */
  const finalizeNote = !canFinalize
    ? null
    : everyCoachFull
      ? "Every roster is full but the draft is not marked complete."
      : "The draft is past its last pick number but is not marked complete.";
  const startBlock = started ? null : getStartBlock(teamCount, pool.length, picksPerTeam);

  // ---- Timer ---------------------------------------------------------------

  useEffect(() => {
    if (!draftLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [draftLive]);

  const secondsLeft = useMemo(() => {
    if (!draftLive || now === 0) return null;
    return getSecondsLeft({
      pickStartedAt: league.pick_started_at,
      pickTimerSeconds: league.pick_timer_seconds,
      pausedAt: league.draft_paused_at,
      nowMs: now + serverOffsetMs,
    });
  }, [
    draftLive,
    now,
    serverOffsetMs,
    league.pick_started_at,
    league.pick_timer_seconds,
    league.draft_paused_at,
  ]);

  const runAutoPick = useCallback(async () => {
    if (autoPickBusyRef.current) return;
    autoPickBusyRef.current = true;
    try {
      const { error } = await rpc.autoPickIfExpired(leagueId);
      setAutoPickError(error);
      await reload();
    } finally {
      autoPickBusyRef.current = false;
    }
  }, [leagueId, reload]);

  // The interval below always calls the latest auto-pick function through
  // this ref, so the timer effect never has to re-arm for a new closure.
  useEffect(() => {
    autoPickRef.current = () => {
      void runAutoPick();
    };
  }, [runAutoPick]);

  // Every client calls auto_pick_if_expired once when its countdown reaches
  // 0 and then every 5 s while it stays there (docs section 7).
  const expired = draftLive && !paused && secondsLeft === 0;
  useEffect(() => {
    if (!expired) return;
    autoPickRef.current();
    const id = setInterval(() => autoPickRef.current(), AUTO_PICK_RETRY_MS);
    return () => clearInterval(id);
  }, [expired]);

  // Polling fallback while the channel is down and the draft is live.
  useEffect(() => {
    if (live !== "reconnecting" || !draftLive) return;
    const id = setInterval(() => {
      void reload();
    }, RECONNECT_POLL_MS);
    return () => clearInterval(id);
  }, [live, draftLive, reload]);

  // ---- Actions -------------------------------------------------------------

  const runAction = useCallback(
    async <T,>(
      action: DraftAction,
      call: () => Promise<RpcResult<T>>,
      success: (data: T) => string | null
    ): Promise<string | null> => {
      setNotice(null);
      setPendingAction(action);
      const result = await call();
      await reload();
      setPendingAction(null);
      if (result.error !== null) {
        setNotice({ variant: "error", text: result.error });
        return result.error;
      }
      const text = success(result.data);
      if (text) setNotice({ variant: "success", text });
      return null;
    },
    [reload]
  );

  const makePick = useCallback(
    (name: string) =>
      runAction(`pick:${name}`, () => rpc.makePick(leagueId, name), (data) =>
        data.draft_completed
          ? `You drafted ${name}. That was the last pick, the draft is complete.`
          : `You drafted ${name}.`
      ),
    [leagueId, runAction]
  );

  const startDraft = useCallback(
    () =>
      runAction("start", () => rpc.startDraft(leagueId), () => "The draft has started."),
    [leagueId, runAction]
  );

  const pauseDraft = useCallback(
    () => runAction("pause", () => rpc.pauseDraft(leagueId), () => "Draft paused."),
    [leagueId, runAction]
  );

  const resumeDraft = useCallback(
    () => runAction("resume", () => rpc.resumeDraft(leagueId), () => "Draft resumed."),
    [leagueId, runAction]
  );

  const undoLastPick = useCallback(
    () =>
      runAction(
        "undo",
        () => rpc.undoLastPick(leagueId),
        (data) => `Pick #${data.pick_number} (${data.pokemon_name}) was undone.`
      ),
    [leagueId, runAction]
  );

  const forcePick = useCallback(
    (name: string | null) => {
      const team = teamNameLabel(onClock?.team_name);
      return runAction(
        "force",
        () => rpc.forcePick(leagueId, name),
        (data) => {
          if (data.skipped) {
            return `${team} had no legal Pokémon left, so the turn was skipped.`;
          }
          const picked = data.pokemon_name ?? name ?? "The best available Pokémon";
          return data.draft_completed
            ? `${picked} was picked for ${team}. That was the last pick, the draft is complete.`
            : `${picked} was picked for ${team}.`;
        }
      );
    },
    [leagueId, onClock?.team_name, runAction]
  );

  const finalizeDraft = useCallback(
    () =>
      runAction(
        "finalize",
        () => rpc.finalizeDraft(leagueId),
        () => "The draft is finalized. Teams and the match schedule are ready."
      ),
    [leagueId, runAction]
  );

  const resetDraft = useCallback(
    () =>
      runAction(
        "reset",
        () => rpc.resetDraft(leagueId),
        () => "The draft was reset. Picks, teams, matches and news were cleared."
      ),
    [leagueId, runAction]
  );

  const sendChat = useCallback(
    async (text: string): Promise<string | null> => {
      // Counted in characters like the `char_length` check, so an emoji at
      // the limit is kept whole rather than cut into a lone surrogate.
      const clean = clampChatMessage(text.trim());
      if (!clean) return "Type a message first.";
      try {
        const { data, error } = await supabase
          .from("draft_chat_messages")
          .insert({
            league_id: leagueId,
            member_id: member.id,
            user_id: user.id,
            message: clean,
          })
          .select(CHAT_SELECT)
          .single();
        if (error) return friendlyError(error);
        const row: unknown = data;
        if (isChatMessage(row)) {
          setChat((previous) => mergeChat(previous, [row]));
        }
        return null;
      } catch (caught) {
        return friendlyError(caught);
      }
    },
    [supabase, leagueId, member.id, user.id]
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    league,
    me,
    isCommissioner,
    isDrafting,
    isMyTurn,
    phase,
    started,
    completed,
    paused,
    draftLive,
    loading,
    loaded,
    loadError,
    retry,
    dex,
    dexError,
    retryDex,
    live,
    notice,
    dismissNotice,
    pendingAction,
    autoPickError,
    clockSynced,
    secondsLeft,
    members,
    membersById,
    coaches,
    picks,
    pool,
    undrafted,
    legalForMe,
    legalForOnClock,
    myBlocks,
    myBudget,
    budgets,
    board,
    lastPick,
    chat,
    picksPerTeam,
    budget,
    teamCount,
    totalPicks,
    currentPick,
    round,
    onClock,
    nextUp,
    canFinalize,
    finalizeNote,
    startBlock,
    makePick,
    startDraft,
    pauseDraft,
    resumeDraft,
    undoLastPick,
    forcePick,
    finalizeDraft,
    resetDraft,
    sendChat,
  };
}

export type DraftRoom = ReturnType<typeof useDraftRoom>;
