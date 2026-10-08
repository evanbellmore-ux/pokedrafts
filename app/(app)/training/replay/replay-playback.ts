import type { DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { ANNOUNCE_MS, hasDip, HP_ANIMATION_MS, playbackBoard, RESOLVE_MS, type QueuedStep, type StepBeat } from "../board/playback";
import type { ReplayState } from "../model/saved-battle";
import type { BoardView, LogTurn, TurnStep } from "../model/view-types";

// The replay screen's playback (pure): the battle turn by turn on the board you saw, each turn's steps with the live
// playback's beats (board/playback.ts), at 1× or 2×. Previous and Next move a whole turn; the slider picks one.

export type ReplaySpeed = 1 | 2;
/** "idle": the board as the turn began, before its first step (a pause between turns while playing). */
export type ReplayBeat = "idle" | StepBeat;
/** at: index into the turns (turns.length = after the last one); step: the step showing; playing: the timer runs. */
export type ReplayPosition = { at: number; step: number; beat: ReplayBeat; playing: boolean };
export type ReplayTurn = { turn: number; steps: TurnStep[]; start: BoardView; next: BoardView };

/** Between turns while playing: the new turn's board before its first step. */
export const IDLE_MS = 700;
export const START: ReplayPosition = { at: 0, step: 0, beat: "idle", playing: false };

/** Each turn the board saw begin (turn 1 on), with its steps and the board it led to (the next turn's, or the end). */
export function replayTurns(log: readonly LogTurn[], boards: NonNullable<ReplayState["boards"]>): ReplayTurn[] {
  const turns = Object.keys(boards.starts).map(Number).filter((turn) => turn >= 1).sort((a, b) => a - b);
  return turns.map((turn) => ({
    turn,
    steps: log.find((entry) => entry.turn === turn)?.steps ?? [],
    start: boards.starts[turn],
    next: boards.starts[turn + 1] ?? boards.end,
  }));
}

export type ReplayFrame = {
  board: BoardView;
  /** The step showing (its popup in the announce beat, its results after), or null between steps. */
  step: QueuedStep | null;
  /** The board as the step began (the live region names Pokémon from it). */
  stepStart: BoardView | null;
  /** The turn shown, or null after the last one. */
  turn: number | null;
};

export function replayFrame(turns: readonly ReplayTurn[], end: BoardView, position: ReplayPosition): ReplayFrame {
  const current = turns[position.at];
  if (!current) return { board: end, step: null, stepStart: null, turn: null };
  const queue: QueuedStep[] = current.steps.map((step, index) => ({ turn: current.turn, index, step }));
  if (position.beat === "idle" || !queue[position.step]) return { board: current.start, step: null, stepStart: null, turn: current.turn };
  const phase = position.beat === "announce" ? "from" : position.beat === "dip" ? "low" : "to";
  return {
    board: playbackBoard(current.start, current.next, queue, position.step, phase),
    step: queue[position.step],
    stepStart: playbackBoard(current.start, current.next, queue, position.step, "from"),
    turn: current.turn,
  };
}

/** How long the position shows before tick (the live playback's beats, halved at 2×). */
export function beatDelay(turns: readonly ReplayTurn[], position: ReplayPosition, speed: ReplaySpeed): number {
  const step = turns[position.at]?.steps[position.step];
  const ms = position.beat === "idle" || !step ? IDLE_MS
    : position.beat === "announce" ? ANNOUNCE_MS
      : position.beat === "dip" ? HP_ANIMATION_MS
        : hasDip(step) ? RESOLVE_MS - HP_ANIMATION_MS : RESOLVE_MS;
  return ms / speed;
}

/** The next beat: the turn's steps one by one, then the next turn; it stops after the last turn. */
export function tick(turns: readonly ReplayTurn[], position: ReplayPosition): ReplayPosition {
  const current = turns[position.at];
  if (!current) return { ...position, playing: false };
  const nextTurn = (): ReplayPosition => {
    const at = position.at + 1;
    return { at, step: 0, beat: "idle", playing: position.playing && at < turns.length };
  };
  const step = current.steps[position.step];
  switch (position.beat) {
    case "idle": return current.steps.length ? { ...position, step: 0, beat: "announce" } : nextTurn();
    case "announce": return { ...position, beat: step && hasDip(step) ? "dip" : "resolve" };
    case "dip": return { ...position, beat: "resolve" };
    case "resolve": return position.step + 1 < current.steps.length ? { ...position, step: position.step + 1, beat: "announce" } : nextTurn();
  }
}

/** Play from here (from the first turn once at the end). */
export function play(turns: readonly ReplayTurn[], position: ReplayPosition): ReplayPosition {
  if (!turns.length) return { ...position, playing: false };
  return position.at >= turns.length ? { at: 0, step: 0, beat: "idle", playing: true } : { ...position, playing: true };
}
/** To this turn's start; already there, to the previous turn's. */
export function previousTurn(position: ReplayPosition): ReplayPosition {
  const atStart = position.beat === "idle" && position.step === 0;
  return { ...position, at: atStart ? Math.max(0, position.at - 1) : position.at, step: 0, beat: "idle" };
}
export function nextTurn(turns: readonly ReplayTurn[], position: ReplayPosition): ReplayPosition {
  const at = Math.min(turns.length, position.at + 1);
  return { at, step: 0, beat: "idle", playing: position.playing && at < turns.length };
}
/** The slider: 0 … turns.length - 1 a turn's start, turns.length the end. */
export function seek(turns: readonly ReplayTurn[], position: ReplayPosition, at: number): ReplayPosition {
  const clamped = Math.max(0, Math.min(turns.length, Math.round(at)));
  return { at: clamped, step: 0, beat: "idle", playing: position.playing && clamped < turns.length };
}

/** "Turn 3 of 9", "End". */
export function positionText(turns: readonly ReplayTurn[], position: ReplayPosition): string {
  const current = turns[position.at];
  return current ? `Turn ${current.turn} of ${turns.at(-1)!.turn}` : "End";
}

/** The cards a step frames: its targets in the resolve beats, its user while it announces. */
export function stepRole(step: TurnStep, slot: DoublesSlotId, resolving: boolean): "target" | "actor" | null {
  return resolving && step.targets.includes(slot) ? "target" : step.actor === slot ? "actor" : null;
}
