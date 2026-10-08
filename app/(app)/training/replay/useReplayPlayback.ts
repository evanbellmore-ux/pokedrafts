"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "../board/useTurnPlayback";
import type { BoardView } from "../model/view-types";
import {
  beatDelay, nextTurn, play, previousTurn, replayFrame, seek, START, tick, type ReplayFrame, type ReplayPosition, type ReplaySpeed, type ReplayTurn,
} from "./replay-playback";

export type ReplayPlayback = ReplayFrame & {
  position: ReplayPosition;
  speed: ReplaySpeed;
  reducedMotion: boolean;
  play(): void;
  pause(): void;
  previous(): void;
  next(): void;
  seek(at: number): void;
  setSpeed(speed: ReplaySpeed): void;
};

/** The replay screen's clock: one timer per beat while playing (its cleanup stops it when the screen closes). */
export function useReplayPlayback(turns: readonly ReplayTurn[], end: BoardView): ReplayPlayback {
  const reducedMotion = useReducedMotion();
  const [position, setPosition] = useState<ReplayPosition>(START);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const { playing } = position;
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPosition((current) => tick(turns, current)), beatDelay(turns, position, speed));
    return () => clearTimeout(timer);
  }, [playing, position, speed, turns]);
  const frame = useMemo(() => replayFrame(turns, end, position), [turns, end, position]);
  return {
    ...frame, position, speed, reducedMotion,
    play: useCallback(() => setPosition((current) => play(turns, current)), [turns]),
    pause: useCallback(() => setPosition((current) => ({ ...current, playing: false })), []),
    previous: useCallback(() => setPosition(previousTurn), []),
    next: useCallback(() => setPosition((current) => nextTurn(turns, current)), [turns]),
    seek: useCallback((at: number) => setPosition((current) => seek(turns, current, at)), [turns]),
    setSpeed,
  };
}
