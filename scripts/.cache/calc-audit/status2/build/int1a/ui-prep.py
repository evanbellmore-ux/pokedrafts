# Integration 1a: the calculator's doubles-prep.ts calls NU's reset rules (W1A-NU.md needsFromOthers to U1; W1A-U1.md asks the
# integrator to wire them): another Pokémon in a slot clears what names it (clearSlotEarlier), a build change reconciles the
# history answers (reconcileEarlier), a changed action drops its action-bound states and ends Switched in
# (afterDoublesAction), and choosing a move (No move included) ends Switched in. The re-exports for the page.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
F = "app/(app)/calculator/doubles-prep.ts"
apply([
 (F, '''import {
  carriedAbilityOn, isFaintedBuild, NO_CARRIED, NO_HISTORY, NO_TURN_EARLIER, reconcileCarried, withSlotHistory, withTurnEarlier,
  type DoublesSlotHistory, type DoublesTurnEarlier,
} from "./doubles-inputs";''', '''import {
  afterDoublesAction, carriedAbilityOn, clearSlotEarlier, isFaintedBuild, NO_CARRIED, NO_HISTORY, NO_TURN_EARLIER, reconcileCarried, reconcileEarlier,
  withSlotHistory, withTurnEarlier, type DoublesSlotHistory, type DoublesTurnEarlier,
} from "./doubles-inputs";''', "imports"),
 (F, '''export {
  carriedAbilityOn, carriedIssueTexts, carriedOptions, isFaintedBuild, NO_CARRIED_OPTIONS, reconcileCarried, sleepTurnsMax,
  type CarriedOptions,
} from "./doubles-inputs";''', '''export {
  carriedAbilityOn, carriedIssueTexts, carriedOptions, earlierTurnToggles, isFaintedBuild, NO_CARRIED_OPTIONS, reconcileCarried, setDoublesSwitchedIn,
  sleepTurnsMax, type CarriedOptions,
} from "./doubles-inputs";''', "re-exports"),
 (F, '''  return {
    matchup: next.cache === matchup.cache ? matchup : { ...matchup, cache: next.cache },
    // Every slot: this one's build, or a Neutralizing Gas it gains, loses or faints with, changes what the others carry.
    doubles: livingPane(retarget(reconcileAllCarried(updated), slot)),
  };
}''', '''  // status2 (integration 1a, NU's rules: IN §5.4): another Pokémon also ends the states that name this one as their source
  // (clearSlotEarlier); a changed action drops its action-bound states and ends Switched in (afterDoublesAction); every
  // build change reconciles the history answers (reconcileEarlier: types of another species, a trap's source item).
  const cleared = anotherPokemon ? clearSlotEarlier(updated, slot) : updated;
  const acted = cleared.actions[slot].moveId !== action.moveId ? afterDoublesAction(cleared, slot) : cleared;
  return {
    matchup: next.cache === matchup.cache ? matchup : { ...matchup, cache: next.cache },
    // Every slot: this one's build, or a Neutralizing Gas it gains, loses or faints with, changes what the others carry.
    doubles: livingPane(retarget(reconcileAllCarried(reconcileEarlier(acted)), slot)),
  };
}''', "onSlot: NU's reset rules"),
 (F, '''export function chooseDoublesMove(state: CalculatorState, owner: MoveOwner, moveId: string | null): CalculatorState {
  const slot = slotByOwner(state.doubles, owner);
  return slot ? onSlot(state, slot, (pair) => selectMatchupMove(pair, moveId, owner)) : state;
}''', '''export function chooseDoublesMove(state: CalculatorState, owner: MoveOwner, moveId: string | null): CalculatorState {
  const slot = slotByOwner(state.doubles, owner);
  if (!slot) return state;
  const next = onSlot(state, slot, (pair) => selectMatchupMove(pair, moveId, owner));
  // Choosing a move, No move included, ends Switched in (status2 NU: doubles-inputs afterDoublesAction).
  return withDoubles(next, afterDoublesAction(next.doubles, slot));
}''', "chooseDoublesMove: afterDoublesAction"),
])
