"use client";

import { useDeferredValue, useMemo } from "react";
import type { MatchupResult } from "@/app/lib/battle/calculate";
import { DOUBLES_SLOTS, type DoublesTurnInput, type DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { doublesTurnInput, type DoublesMatchup } from "./doubles-prep";
import { errorMessage } from "./useMatchupCalculation";

export type DoublesEngine = typeof import("@/app/lib/battle/doubles-turn");

export type DoublesCalculation = {
  /** The four owners (key and epoch), the game and the Moves pane's slot and receiver the results are for. */
  identity: string;
  turn: DoublesTurnResult | null;
  turnError: string | null;
  moves: MatchupResult | null;
  movesError: string | null;
};

/** The results' identity for this 2v2 state: owners, game and the Moves pane's pair. */
export function doublesIdentity(doubles: DoublesMatchup): string {
  const { slots, runtime, moves } = doubles;
  const owners = DOUBLES_SLOTS.map((slot) => `${slots[slot].key}:${slots[slot].moveEpoch}`);
  return JSON.stringify([runtime.identity, owners, moves.slot, moves.into]);
}

/**
 * calculateDoublesTurn and calculateDoublesMoves (the Moves pane's rows), keyed on what they read: the four builds,
 * contexts, Charge flags and actions, the field and the game. Edits to the same four Pokémon recalculate in the
 * background while the last results show; new Pokémon, a new game or another Moves-pane pair is calculated at once,
 * as useMatchupCalculation does for 1v1. The turn is not recalculated when only the Moves pane changes. Nothing is
 * calculated while `enabled` is false (1v1 view) or before the engine loads.
 */
export function useDoublesCalculation(engine: DoublesEngine | null, doubles: DoublesMatchup, enabled: boolean): DoublesCalculation | null {
  const { runtime, field, slots, actions, charged, moves } = doubles;
  const [a, b, c, d] = [slots["own-left"], slots["own-right"], slots["opponent-left"], slots["opponent-right"]];
  const [actionA, actionB, actionC, actionD] = [actions["own-left"], actions["own-right"], actions["opponent-left"], actions["opponent-right"]];
  const [chargedA, chargedB, chargedC, chargedD] = [charged["own-left"], charged["own-right"], charged["opponent-left"], charged["opponent-right"]];
  // A Pokémon at 0 HP has fainted before the turn: its slot is empty in the input (doubles-prep doublesTurnInput).
  const input = useMemo((): DoublesTurnInput => doublesTurnInput(runtime, field, {
    "own-left": { build: a.build, contexts: a.contexts, charged: chargedA, action: actionA },
    "own-right": { build: b.build, contexts: b.contexts, charged: chargedB, action: actionB },
    "opponent-left": { build: c.build, contexts: c.contexts, charged: chargedC, action: actionC },
    "opponent-right": { build: d.build, contexts: d.contexts, charged: chargedD, action: actionD },
  }), [runtime, field, a.build, a.contexts, b.build, b.contexts, c.build, c.contexts, d.build, d.contexts,
    chargedA, chargedB, chargedC, chargedD, actionA, actionB, actionC, actionD]);
  const identity = doublesIdentity(doubles);
  const request = useMemo(() => ({ input, slot: moves.slot, into: moves.into, identity }), [input, moves.slot, moves.into, identity]);
  const deferred = useDeferredValue(request);
  const used = deferred.identity === request.identity ? deferred : request;
  const live = enabled ? engine : null;
  const turn = useMemo(() => {
    if (!live) return null;
    try {
      return { turn: live.calculateDoublesTurn(used.input), turnError: null };
    } catch (error) {
      return { turn: null, turnError: errorMessage(error) };
    }
  }, [live, used.input]);
  const pane = useMemo(() => {
    if (!live) return null;
    try {
      return { moves: live.calculateDoublesMoves(used.input, used.slot, used.into), movesError: null };
    } catch (error) {
      return { moves: null, movesError: errorMessage(error) };
    }
  }, [live, used.input, used.slot, used.into]);
  return turn && pane ? { identity: used.identity, ...turn, ...pane } : null;
}
