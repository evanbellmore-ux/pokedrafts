# Integration 1a, ADDENDUM2 §2.4 (the integrator removes a key at the integration where its last site goes; FACE_UNSAFE_MOVES
# is emptied by the integrator) with W's and S's asks (W1A-W.md §2: focusBand and ariaFaint lose their last site once
# selfHitBand and faintedInHits are wired; W1A-S.md 6: FACE_UNSAFE_MOVES and REASONS.faceSelfHit after S's lines 1 and 2):
# - selfHitBand's `dist` is always given (doubles-status.ts confusionHit, W's L6), so its "Focus Band is not modelled." goes;
# - ariaFaint's guard read WIRED.faintedInHits, true since the kernel lines went in;
# - faceHooks.selfHit is called with the action only (S's line 2), so the slot-only call and its reason go;
# - faceOnce's FACE_UNSAFE_MOVES guard ran only without the kernel's afterHit, which the kernel has since S's line 1.
# No path changes: each removed line was unreachable in this tree.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([
 ("doubles-actions.ts", '''/** Moves whose hit does more to its target than damage, the stages and statuses of stat-moves.ts and a flinch (doubles-turn.ts faceHit). */
export const FACE_UNSAFE_MOVES: ReadonlySet<string> = new Set([
  "knockoff", "thief", "covet", "bugbite", "pluck", "incinerate", "smackdown", "thousandarrows", "clearsmog", "spectralthief", "saltcure", "throatchop",
  "psychicnoise", "coreenforcer", "alluringvoice", "burningjealousy", "anchorshot", "spiritshackle", "thousandwaves", "jawlock", "ceaselessedge", "stoneaxe",
  "circlethrow", "dragontail", "mortalspin", "rapidspin", "uturn", "voltswitch", "flipturn", "finalgambit", "relicsong", "fellstinger", "bind", "wrap",
  "firespin", "infestation", "magmastorm", "sandtomb", "snaptrap", "thundercage", "whirlpool", "clamp", "sparklingaria", "smellingsalts", "wakeupslap",
]);
''', "", "FACE_UNSAFE_MOVES (emptied: S's faceOnce reads the kernel's afterHit)"),
 ("doubles-actions.ts", '''  faceSelfHit: (ability: string) => `${ability} against a confusion self-hit is not modelled in 2v2.`,
''', "", "REASONS.faceSelfHit (its last site went with S's line 2)"),
 ("doubles-actions.ts", '''  ariaFaint: (name: string) => `Sparkling Aria's burn cure after ${name} faints in the move is not modelled in 2v2.`,
''', "", "REASONS.ariaFaint (W's faintedInHits wired)"),
 ("doubles-actions.ts", '''  focusBand: "Focus Band is not modelled.",
''', "", "REASONS.focusBand (W's selfHitBand always has its distribution)"),
 ("doubles-faces.ts", 'import { BUSTED_FORMS, DRAG_MOVES, FACE_UNSAFE_MOVES, REASONS, SWITCH_MOVES } from "./doubles-actions";',
  'import { BUSTED_FORMS, DRAG_MOVES, REASONS, SWITCH_MOVES } from "./doubles-actions";', "faces: import"),
 ("doubles-faces.ts", '''  // Before integration 1a (no kernel afterHit), a move whose hit does more than zeroHit applies keeps today's reason.
  if (!pipeline && !info.transformed && FACE_UNSAFE_MOVES.has(mv.id) && !OWN_RULE_MOVES.has(mv.id)) kernel.notEstimated(REASONS.notIn2v2(faceName));
''', "", "faces: the FACE_UNSAFE_MOVES guard"),
 ("doubles-faces.ts", ''' * physical moves' hits, which the self-hit is not: null. `at`: the action (doubles-status.ts confusionHit uses the worlds);
 * the slot alone is the call before integration 1a, whose result confusionHit drops: the reason stands there.
 */
export function selfHit(kernel: TurnKernel, w: World, at: DoublesSlotId | PendingAction): World[] | null {
  const slot = typeof at === "string" ? at : at.slot;''',
  ''' * physical moves' hits, which the self-hit is not: null. `at`: the action (doubles-status.ts confusionHit uses the worlds).
 */
export function selfHit(kernel: TurnKernel, w: World, at: PendingAction): World[] | null {
  const slot = at.slot;''', "faces: selfHit takes the action"),
 ("doubles-faces.ts", '''  if (typeof at === "string") kernel.notEstimated(REASONS.faceSelfHit(kernel.abilityName("disguise")));
''', "", "faces: the slot-only call's reason"),
 ("doubles-pairs.ts", ''' * knock out, after Endure, Sturdy and Focus Sash), and the loss fact `Focus Band: {Name} keeps 1 HP.` with its chance.
 * Without `dist` (the line not in yet): not estimated where it can save, as before.
 */
export function selfHitBand(kernel: TurnKernel, w: World, slot: DoublesSlotId, values: number[], dist?: Map<number, number>) {''',
  ''' * knock out, after Endure, Sturdy and Focus Sash), and the loss fact `Focus Band: {Name} keeps 1 HP.` with its chance.
 */
export function selfHitBand(kernel: TurnKernel, w: World, slot: DoublesSlotId, values: number[], dist: Map<number, number>) {''',
  "pairs: selfHitBand's dist is given"),
 ("doubles-pairs.ts", '''  if (!dist) kernel.notEstimated(REASONS.focusBand);
''', "", "pairs: the Focus Band reason"),
 ("doubles-pairs.ts", ''' * working Life Orb nothing can knock it out after the hits. `cures`: a Pokémon it hit that is cured. Without faintedInHits'
 * kernel lines (WIRED.faintedInHits), today's guard where Life Orb could be the cause.
 */''', ''' * working Life Orb nothing can knock it out after the hits. `cures`: a Pokémon it hit that is cured.
 */''', "pairs: ariaFaint's doc"),
 ("doubles-pairs.ts", '''  if (!WIRED.faintedInHits) kernel.notEstimated(REASONS.ariaFaint(kernel.names[action.slot]));
''', "", "pairs: the Sparkling Aria reason"),
 ("tests/unit/doubles-status.test.ts", '''    expect(REASONS.faceSelfHit("Disguise")).toBe("Disguise against a confusion self-hit is not modelled in 2v2.");
''', "", "test: REASONS.faceSelfHit's text"),
])
