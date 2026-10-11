# Integration 1a, H's follow-ups: Sky Drop's guard and PENDING_MOVES go (H's I3 took its call site out); the hooks test rows.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("doubles-hidden.ts", '''/**
 * Sky Drop (PENDING_MOVES: it lifts its target): doubles-turn.ts presenceGuards' guard, kept until integration 1a wires the
 * charge turn's two kernel calls (W1A-H.md: doubles-status.ts beforeMove's `hiddenHooks.beforeMove`, doubles-turn.ts
 * singleStep's `hiddenHooks.skyDropHit`), when the integrator removes this call. The model itself is skyDropHit, beforeMove,
 * misses (C21).
 */
export function skyDrop(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void w;
  const moveId = kernel.input.pokemon[slot]?.action.moveId;
  if (moveId && PENDING_MOVES.has(moveId)) kernel.notEstimated(REASONS.notIn2v2(kernel.runtime.movesById.get(moveId)!.name));
}

''', '', "Sky Drop's guard goes (modelled: skyDropHit, beforeMove, misses)"),
 ("doubles-hidden.ts", 'import { DRAG_MOVES, PENDING_MOVES, PROTECT_MOVES, REASONS, SEMI_INVULNERABLE_MOVES } from "./doubles-actions";', 'import { DRAG_MOVES, PROTECT_MOVES, REASONS, SEMI_INVULNERABLE_MOVES } from "./doubles-actions";', "import"),
 ("doubles-actions.ts", '''
/** Moves the turn does not follow, as presence guards with the `{Move} is not modelled in 2v2.` text: Sky Drop (it lifts its target). */
export const PENDING_MOVES: ReadonlySet<string> = new Set(["skydrop"]);
''', '', "PENDING_MOVES goes (its one member, Sky Drop, is modelled)"),
 ("doubles-turn.ts", "contextFor, presenceGuards/PENDING_MOVES (each guard removed where a mechanic is modelled).", "contextFor, presenceGuards (each guard removed where a mechanic is modelled).", "comment"),
 ("tests/source/status2-hooks.test.ts", '''  ["doubles-hidden.ts", "skyDrop", "doubles-turn.ts", "presenceGuards", "hiddenHooks.skyDrop("],\n''', '', "hooks test: the skyDrop row goes"),
 ("tests/source/status2-hooks.test.ts", '''"presenceHooks.movesGuard(", "hiddenHooks.skyDrop(", "callingHooks.callingGuard(",''', '''"presenceHooks.movesGuard(", "callingHooks.callingGuard(",''', "hooks test: PRESENCE_ORDER"),
])
