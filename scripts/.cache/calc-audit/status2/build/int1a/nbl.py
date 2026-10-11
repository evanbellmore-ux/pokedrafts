# Integration 1a (V1's needsFromIntegrator 4: IN-NBL-01): once the battle is over, a fainted Pokémon's queued action is skipped
# as execute skips it ("Faints before it moves."), not left without a skip fact.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([("doubles-turn.ts", '''  for (const action of w.remaining) {
    const step = stepOf(ctx, action);
    if (step && action.moveId !== null && !w.mons[action.slot]!.fainted) bump(step.skipped, "The battle ends before it moves.", w.mass);
  }
  return true;''', '''  for (const action of w.remaining) {
    const step = stepOf(ctx, action);
    if (!step || action.moveId === null) continue;
    // A fainted Pokémon's action is skipped as execute skips it (sim/battle.ts:2707).
    if (w.mons[action.slot]!.fainted) { bump(step.skipped, "Faints before it moves.", w.mass); bump(ctx.faintsBefore, action.slot, w.mass); }
    else bump(step.skipped, "The battle ends before it moves.", w.mass);
  }
  return true;''', "battleOver: a fainted Pokémon's skipped action")])

# Refined after the oracle (faintsBeforeMoving stays undefined once the battle ended):
apply([('doubles-turn.ts', '    if (w.mons[action.slot]!.fainted) { bump(step.skipped, "Faints before it moves.", w.mass); bump(ctx.faintsBefore, action.slot, w.mass); }', '    // (Its card\'s faintsBeforeMoving stays a fainting before its turn came: here the battle ended first.)\n    if (w.mons[action.slot]!.fainted) bump(step.skipped, "Faints before it moves.", w.mass);', 'battleOver: no faintsBefore count')])
