# Integration 1a, the kernel's charge release (V1's needsFromIntegrator 3: IN-CHG-02-sv, IN-CHG-03-champions): a two-turn move
# charged last turn (carried.charging, vol.locked) is released with no charge of its own: its Power Herb is not used (data/
# items.ts powerherb onChargeMove runs only in the charge's onTryMove) and Meteor Beam and Electro Shot add no rise (data/
# moves.ts meteorbeam, electroshot onTryMove: removeVolatile returns before the boost). MoveContext.released carries it.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("types.ts", '''  /** Set only by the 2v2 turn: Pursuit with no switching target. */
  switching?: false;
};''', '''  /** Set only by the 2v2 turn: Pursuit with no switching target. */
  switching?: false;
  /** Set only by the 2v2 turn: a two-turn move charged last turn released now (carried.charging): no Power Herb, no pre-hit rise. */
  released?: true;
};''', "MoveContext.released"),
 ("doubles-turn.ts", '''  if (user.helpingHand >= 2) context.helpingHands = Math.min(3, user.helpingHand) as 2 | 3;
  // W's part''', '''  if (user.helpingHand >= 2) context.helpingHands = Math.min(3, user.helpingHand) as 2 | 3;
  // A two-turn move charged last turn, released now (C38: vol.locked): no charge of its own (integration 1a).
  if (!info.transformed && user.vol.locked === id) context.released = true;
  // W's part''', "contextFor: released"),
 ("calculate.ts", '''  if (SUCCESS_ASSUMPTIONS[metadata.id]) assumptions.push(SUCCESS_ASSUMPTIONS[metadata.id]);''', '''  // status2 (2v2 only): a released Meteor Beam or Electro Shot has no rise of its own (MoveContext.released).
  if (SUCCESS_ASSUMPTIONS[metadata.id] && !(context?.released && PRE_HIT_RISE.has(metadata.id))) assumptions.push(SUCCESS_ASSUMPTIONS[metadata.id]);''', "calculate: no pre-hit note on a release"),
 ("calculate.ts", '''    const attacker = makePokemon(analyticAfterProtect ? { ...attackerBuild, abilityActive: true } : attackerBuild, runtime, attackingSpecies, attackerMimicry.types);
''', '''    const attacker = makePokemon(analyticAfterProtect ? { ...attackerBuild, abilityActive: true } : attackerBuild, runtime, attackingSpecies, attackerMimicry.types);
    // status2 (2v2 only, MoveContext.released): the engine adds Meteor Beam's and Electro Shot's rise to every use (mechanics
    // gen789.js / champions.js: Simple 2, Contrary −1, clamped at ±6); a release has none, so the stage goes in that much lower.
    if (context?.released && PRE_HIT_RISE.has(metadata.id) && !resolved.transformed) attacker.boosts.spa -= attacker.hasAbility("Simple") ? 2 : attacker.hasAbility("Contrary") ? -1 : 1;
''', "calculate: a release's damage at its own stage"),
 ("calculate.ts", '''const FIXED_HP_MOVES: Record<string, (hp: FixedHP) => number | null> = {''', '''/** Moves whose rise before the hit the engine adds to the calculation (mechanics gen789.js, champions.js: Meteor Beam, Electro Shot). */
const PRE_HIT_RISE: ReadonlySet<string> = new Set(["meteorbeam", "electroshot"]);
const FIXED_HP_MOVES: Record<string, (hp: FixedHP) => number | null> = {''', "PRE_HIT_RISE"),
 ("uses-to-ko.ts", '''  private charges(state: State, ignoreHerb = false): boolean {
    const id = this.useMoveId(state);
    if (!CHARGE_MOVES.has(id)) return false;''', '''  private charges(state: State, ignoreHerb = false): boolean {
    const id = this.useMoveId(state);
    if (!CHARGE_MOVES.has(id)) return false;
    // status2 (2v2 only, MoveContext.released): a move charged last turn is released with no charge (no Power Herb used).
    if (this.input.context?.released && state.first) return false;''', "uses-to-ko: a release does not charge"),
 ("uses-to-ko.ts", '''      if (table.preHit) boost(m, state, "att", table.preHit, false);''', '''      // A move charged last turn and released now (MoveContext.released, 2v2 only) raises nothing of its own.
      if (table.preHit && !(this.input.context?.released && prev.first)) boost(m, state, "att", table.preHit, false);''', "uses-to-ko: a release's pre-hit rise"),
])
