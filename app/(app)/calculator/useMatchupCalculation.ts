"use client";

import { useDeferredValue, useMemo } from "react";
import { orientField, sameMoveOwner, type AttackView, type PreparedMatchup } from "./roster-prep";

export type CalculateMatchup = typeof import("@/app/lib/battle/calculate").calculateMatchup;

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected calculator error occurred.";
}

/**
 * calculateMatchup for the attack's direction, keyed on what it reads (both builds, the field as the source
 * sees it, the source's move contexts and the game), not on the matchup object: selecting a move row or
 * editing an import draft makes a new matchup with the same inputs, and keeps the result. Edits to the same
 * two Pokémon (typing EVs, HP, a hit count) recalculate in the background, so the inputs stay responsive while
 * the last rows show; a new pair of Pokémon or a new game is calculated at once. `identity` names the pair
 * the result is for, as rows for another pair are never shown.
 */
export function useMatchupCalculation(calculate: CalculateMatchup | null, matchup: PreparedMatchup, view: AttackView) {
  const { runtime } = matchup;
  const { sourceSide, contexts } = view;
  const source = view.source.build, receiver = view.receiver.build;
  const { key: sourceKey, epoch: sourceEpoch } = view.owner;
  const { key: receiverKey, epoch: receiverEpoch } = view.receiverOwner;
  // getAttackView swaps the side conditions into a new object on every matchup when the right Pokémon attacks.
  const field = useMemo(() => orientField(matchup.field, sourceSide), [matchup.field, sourceSide]);
  const input = useMemo(() => ({
    source, receiver, field, contexts, runtime,
    identity: { source: { key: sourceKey, epoch: sourceEpoch }, receiver: { key: receiverKey, epoch: receiverEpoch } },
  }), [source, receiver, field, contexts, runtime, sourceKey, sourceEpoch, receiverKey, receiverEpoch]);
  const deferred = useDeferredValue(input);
  const samePair = deferred.runtime === input.runtime
    && sameMoveOwner(deferred.identity.source, input.identity.source) && sameMoveOwner(deferred.identity.receiver, input.identity.receiver);
  const used = samePair ? deferred : input;
  return useMemo(() => {
    if (!calculate) return null;
    try {
      return { identity: used.identity, result: calculate(used.source, used.receiver, used.field, used.contexts, used.runtime), error: null };
    } catch (error) {
      return { identity: used.identity, result: null, error: errorMessage(error) };
    }
  }, [calculate, used]);
}
