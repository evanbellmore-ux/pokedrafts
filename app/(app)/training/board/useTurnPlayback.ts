"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { BoardView, LogTurn, TrainingBattle } from "../model/view-types";
import { ANNOUNCE_MS, hasDip, HP_ANIMATION_MS, playbackBoard, playedCounts, RESOLVE_MS, unplayedSteps, type QueuedStep, type StepBeat } from "./playback";

// Plays each resolved turn on the board, one step at a time from the board you saw before it: the step's popup (ANNOUNCE_MS),
// then its results on the cards (RESOLVE_MS). New steps in a battle snapshot start playing; steps that arrive meanwhile (a
// mid-turn replacement) join the queue. Skip ends it.

export type TurnPlayback = {
  playing: boolean;
  /** The board to draw: the replayed one while playing, else the real one. */
  board: BoardView | null;
  /** While playing: the board as the current step began (its announce beat), unchanged until the next step. */
  stepStart: BoardView | null;
  step: QueuedStep | null;
  beat: StepBeat;
  /** The step's place in the queue (0-based) and the queue's length now (the progress shown). */
  index: number;
  count: number;
  /** prefers-reduced-motion: no pop-in, fade or slide (each beat still shows). */
  reducedMotion: boolean;
  /** The turn of the last playback's steps when it ran to its end (not skipped): the live region read each one. Else null. */
  heard: number | null;
  skip(): void;
};

type State = {
  battleId: number;
  /** The log and board of the last snapshot seen; the board is the next playback's start. */
  log: readonly LogTurn[];
  board: BoardView | null;
  played: Record<number, number>;
  queue: QueuedStep[];
  base: BoardView | null;
  index: number;
  beat: StepBeat;
  heard: number | null;
};
type Battle = Pick<TrainingBattle, "id" | "log" | "board">;

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReduced(onChange: () => void) {
  const media = window.matchMedia(REDUCED);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const reducedNow = () => window.matchMedia(REDUCED).matches;
const reducedOnServer = () => false;
/** prefers-reduced-motion (false while server rendering). The replay screen's playback reads it too. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, reducedNow, reducedOnServer);
}

/** A battle seen for the first time (mounting, a rematch): nothing it already showed is replayed. */
function fresh(battle: Battle): State {
  return { battleId: battle.id, log: battle.log, board: battle.board, played: playedCounts(battle.log), queue: [], base: null, index: 0, beat: "announce", heard: null };
}
const isPlaying = (state: State) => state.index < state.queue.length;

function sync(state: State, battle: Battle): State {
  const { queue, played } = unplayedSteps(battle.log, state.played);
  const next = { ...state, log: battle.log, board: battle.board, played };
  if (!queue.length) return next;
  if (isPlaying(state)) return { ...next, queue: [...state.queue, ...queue] };
  // The first board of a battle has nothing before it to replay from.
  if (!state.board) return next;
  return { ...next, queue, base: state.board, index: 0, beat: "announce", heard: null };
}
function stopped(state: State, heard: number | null): State {
  return { ...state, queue: [], base: null, index: 0, beat: "announce", heard };
}
function advance(state: State): State {
  if (!isPlaying(state)) return state;
  if (state.beat === "announce") return { ...state, beat: hasDip(state.queue[state.index].step) ? "dip" : "resolve" };
  if (state.beat === "dip") return { ...state, beat: "resolve" };
  if (state.index + 1 < state.queue.length) return { ...state, index: state.index + 1, beat: "announce" };
  return stopped(state, state.queue[state.index].turn);
}
const skipped = (state: State) => stopped(state, null);

export function useTurnPlayback(battle: Battle): TurnPlayback {
  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<State>(() => fresh(battle));
  // A new snapshot is read during render (as useTurnControls reads a new request), so its board never shows before its steps.
  let current = state;
  if (state.battleId !== battle.id) current = fresh(battle);
  else if (state.log !== battle.log || state.board !== battle.board) current = sync(state, battle);
  if (current !== state) setState(current);

  const playing = isPlaying(current);
  const { index, beat } = current;
  const dips = playing && hasDip(current.queue[index].step);
  useEffect(() => {
    if (!playing) return;
    // The resolve beat lasts RESOLVE_MS in all, its dip included.
    const delay = beat === "announce" ? ANNOUNCE_MS : beat === "dip" ? HP_ANIMATION_MS : dips ? RESOLVE_MS - HP_ANIMATION_MS : RESOLVE_MS;
    const timer = setTimeout(() => setState(advance), delay);
    return () => clearTimeout(timer);
  }, [playing, index, beat, dips]);

  const { base, queue } = current;
  const latest = battle.board;
  const board = useMemo(
    () => (playing && base ? playbackBoard(base, latest, queue, index, beat === "announce" ? "from" : beat === "dip" ? "low" : "to") : latest),
    [playing, base, latest, queue, index, beat],
  );
  // The board as the step began, the same through its beats: it names the step's Pokémon for the live region.
  const stepStart = useMemo(() => (playing && base ? playbackBoard(base, latest, queue, index, "from") : null), [playing, base, latest, queue, index]);
  const skip = useCallback(() => setState(skipped), []);
  return { playing, board, stepStart, step: playing ? queue[index] : null, beat, index, count: queue.length, reducedMotion, heard: playing ? null : current.heard, skip };
}
