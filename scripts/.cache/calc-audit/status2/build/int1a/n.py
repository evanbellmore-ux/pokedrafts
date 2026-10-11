# Integration 1a, N's N-1, N-2, N-4, N-5 (W1A-N.md; W1A-N-patch-int.cjs). N-3 (validate) is A2's P10 (the same filter: a2.py).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
J = "\n".join
apply([
 ("doubles-status.ts", J([
  '  if (move.id === "destinybond") {',
  '    mon.destinyBond = true;',
 ]), J([
  '  if (move.id === "destinybond") {',
  "    // status2 N: its own PrepareHit fails it while one from last turn is still up (doubles-history.ts destinyBondPrepare).",
  '    if (historyHooks.destinyBondPrepare(kernel, w, action)) return [w];',
  '    mon.destinyBond = true;',
 ]), "N-1 Destiny Bond's own PrepareHit"),
 ("doubles-status.ts", J([
  '    w.sides[slotSide(slot)] = { ...w.sides[slotSide(slot)], [move.id === "wideguard" ? "wideGuard" : "quickGuard"]: true };',
  '    return [w];',
 ]), J([
  '    w.sides[slotSide(slot)] = { ...w.sides[slotSide(slot)], [move.id === "wideguard" ? "wideGuard" : "quickGuard"]: true };',
  '    // status2 N: the guard raises the stall counter with no roll (doubles-history.ts stallRaise; kept only for a later reader).',
  '    historyHooks.stallRaise(kernel, w, action);',
  '    return [w];',
 ]), "N-4 Quick Guard and Wide Guard raise the stall counter"),
 ("doubles-turn.ts", J([
  '  if (found?.ties.length) {',
  '    const first = found.ties.length === 1 ? historyHooks.entryTie(kernelOf(ctx), w, found.taken.slot, found.ties[0]) : null;',
  '    if (first === null) notEstimated(REASONS.notIn2v2(found.taken.by));',
  '    return first === found.taken.slot ? found.taken : found.tied[0];',
  '  }',
 ]), J([
  '  if (found?.ties.length) {',
  "    // status2 N (C37): the oldest ability state among the tied holders (doubles-history.ts entryTie), pairwise; not known: not estimated.",
  '    let first = found.taken.slot;',
  '    for (const tie of found.ties) {',
  '      const older = historyHooks.entryTie(kernelOf(ctx), w, first, tie);',
  '      if (older === null) notEstimated(REASONS.needsEntryOrder(found.taken.by, ctx.names[first], ctx.names[tie]));',
  '      first = older;',
  '    }',
  '    return first === found.taken.slot ? found.taken : found.tied[found.ties.indexOf(first)];',
  '  }',
 ]), "N-2 the redirect tie by entry order"),
 ("doubles-status.ts", J([
  "  // A protecting move that fails stops in its own PrepareHit (data/moves.ts protect onPrepareHit), before Protean's:",
  "  // it fails only with no action left, where nothing reads the type.",
  "  typingHooks.proteanGuard(kernel, w, slot, move.id, () => move.type);",
  "  const protect = PROTECT_MOVES[move.id];",
  '  if (protect || move.id === "endure") {',
  "    // onPrepareHit: !!this.queue.willAct() (data/moves.ts:13973-13974): an action, a fainted Pokémon's included, is still queued.",
  "    if (!w.remaining.length) { kernel.stepFact(action, `${move.name} fails: no Pokémon moves after it.`, w.mass); return [w]; }",
  "    // The stall roll (N, ADDENDUM2 §4.2): the worlds where it fails get no protection (the stub: every world passes).",
  "    const roll = historyHooks.stallPrepare(kernel, w, action, move);",
  "    for (const world of roll.pass) {",
 ]), J([
  "  const protect = PROTECT_MOVES[move.id];",
  '  if (protect || move.id === "endure") {',
  "    // onPrepareHit: !!this.queue.willAct() (data/moves.ts:13973-13974): an action, a fainted Pokémon's included, is still queued.",
  "    if (!w.remaining.length) { kernel.stepFact(action, `${move.name} fails: no Pokémon moves after it.`, w.mass); return [w]; }",
  "    // The stall roll (N, ADDENDUM2 §4.2): the worlds where it fails get no protection and no Protean change.",
  "    const roll = historyHooks.stallPrepare(kernel, w, action, move);",
  "    for (const world of roll.pass) {",
  "      // The PrepareHit event after the move's own (PS/sim/battle-actions.ts:591-592): Protean and Libero where it passed.",
  "      typingHooks.proteanGuard(kernel, world, slot, move.id, () => move.type);",
 ]), "N-5 Protean after a protecting move's own PrepareHit"),
 ("doubles-status.ts", J([
  "  // A snatchable move here (Quick Guard, Wide Guard; the screens, Tailwind) is taken by a Snatch user (A3; the stub: none).",
 ]), J([
  "  // Protean and Libero for the other early moves (their PrepareHit as before status2 N).",
  "  typingHooks.proteanGuard(kernel, w, slot, move.id, () => move.type);",
  "  // A snatchable move here (Quick Guard, Wide Guard; the screens, Tailwind) is taken by a Snatch user (A3; the stub: none).",
 ]), "N-5 Protean for the other early moves"),
])
# Destiny Bond's own PrepareHit comes before the PrepareHit event (Protean) too (sim/battle-actions.ts:590-592): N-1's check
# moves above the Protean line N-5 placed for the other early moves.
apply([
 ("doubles-status.ts", J([
  "  // Protean and Libero for the other early moves (their PrepareHit as before status2 N).",
  "  typingHooks.proteanGuard(kernel, w, slot, move.id, () => move.type);",
 ]), J([
  "  // status2 N: Destiny Bond's own PrepareHit fails it while one from last turn is still up (doubles-history.ts",
  "  // destinyBondPrepare), before the PrepareHit event (sim/battle-actions.ts:590-592).",
  '  if (move.id === "destinybond" && historyHooks.destinyBondPrepare(kernel, w, action)) return [w];',
  "  // Protean and Libero for the other early moves (the PrepareHit event, after the move's own).",
  "  typingHooks.proteanGuard(kernel, w, slot, move.id, () => move.type);",
 ]), "N-1 moved before Protean"),
 ("doubles-status.ts", J([
  "    // status2 N: its own PrepareHit fails it while one from last turn is still up (doubles-history.ts destinyBondPrepare).",
  '    if (historyHooks.destinyBondPrepare(kernel, w, action)) return [w];',
  '    mon.destinyBond = true;',
 ]), J([
  '    mon.destinyBond = true;',
 ]), "N-1 (its old place)"),
 ("doubles-status.ts",
  "  // (onKnockOut); its onPrepareHit fails it after a use last turn (a turn fact).",
  "  // (onKnockOut); its onPrepareHit fails it after a use last turn (above, before Protean).",
  "Destiny Bond comment"),
])
