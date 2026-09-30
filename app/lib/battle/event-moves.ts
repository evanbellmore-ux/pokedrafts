import type { MoveContext } from "./types";

/**
 * Moves whose power doubles after an event this turn (or the user's last turn)
 * that a two-build snapshot cannot see. The calculator computes the normal case
 * and states that assumption; the move's `doubled` context selects the doubled
 * case. Rules and powers follow pinned Showdown data/moves.ts (basePowerCallback
 * or onBasePower); the Champions mod does not change them.
 */
export type EventDoublingRule = {
  /** The event that doubles the move's power: the doubled-case toggle's label. */
  readonly label: string;
  /** The normal case, phrased for the assumption line. */
  readonly normal: string;
};

export const EVENT_DOUBLING_MOVES: Readonly<Record<string, EventDoublingRule>> = {
  stompingtantrum: { label: "The user's previous move failed", normal: "the user's previous move did not fail" },
  temperflare: { label: "The user's previous move failed", normal: "the user's previous move did not fail" },
  lashout: { label: "The user's stats were lowered this turn", normal: "the user's stats were not lowered this turn" },
  payback: { label: "The target has already moved this turn", normal: "the target moves after the user this turn" },
  // Showdown's Round.onTry reorders the next queued Round of any Pokémon, a foe's
  // included, so it doubles after any earlier Round this turn, in Singles too.
  round: { label: "Another Pokémon used Round earlier this turn", normal: "no other Pokémon used Round earlier this turn" },
  avalanche: { label: "The target damaged the user earlier this turn", normal: "the target has not damaged the user this turn" },
  revenge: { label: "The target damaged the user earlier this turn", normal: "the target has not damaged the user this turn" },
  assurance: { label: "The target was already hurt this turn", normal: "the target has not been hurt this turn" },
};

/** Whether the doubled case was chosen for one of these moves. */
export function isEventDoubled(moveId: string, context: MoveContext | undefined): boolean {
  return !!EVENT_DOUBLING_MOVES[moveId] && context?.doubled === true;
}

/** The assumption line a calculated result carries for one of these moves. */
export function eventDoublingAssumption(moveId: string, context: MoveContext | undefined): string | null {
  const rule = EVENT_DOUBLING_MOVES[moveId];
  if (!rule) return null;
  const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
  return isEventDoubled(moveId, context)
    ? `Doubled power: ${lower(rule.label)}.`
    : `Normal power: assumes ${rule.normal}. For the doubled case, tick “${rule.label}” in the move settings above the move list.`;
}
