# Integration 1a: lint after the merge (the L branch's beforeFieldMove call and the Recycle check's `mon` went with it).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("doubles-items.ts", 'import { berryArithmetic, CONFUSING_BERRIES, HEALING_BERRIES, PINCH_STAT_BERRIES, stolenEat } from "./hit-loop";', 'import { berryArithmetic, HEALING_BERRIES, PINCH_STAT_BERRIES, stolenEat } from "./hit-loop";', "unused import"),
 ("doubles-status.ts", 'import * as fieldChangeNs from "./doubles-fieldchange";\n', '', "fieldChangeNs no longer read here"),
 ("doubles-status.ts", 'const fieldChangeHooks = { ...fieldChangeNs };\n', '', "fieldChangeHooks no longer read here"),
 ("doubles-status.ts", '''export function statusMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] {
  const slot = action.slot;
  const mon = w.mons[slot]!;
''', '''export function statusMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] {
  const slot = action.slot;
''', "unused mon"),
 ("tests/source/status2-hooks.test.ts", '''  ["doubles-fieldchange.ts", "beforeFieldMove", "doubles-status.ts", "statusMove", "fieldChangeHooks.beforeFieldMove("],\n''', '', "hooks test: the L branch's beforeFieldMove row goes"),
])
