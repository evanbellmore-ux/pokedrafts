# Integration 1b (INTEGRATION-1A §4 item 6: H's Smack Down guard): Smack Down and Thousand Arrows land a Fly or Bounce user
# they hit even where it is on the ground already (Iron Ball, not Flying type): the condition's onStart removes the volatile
# (applies) before it reads the grounding (PS/data/moves.ts smackdown condition onStart).
from patchlib import rep
T = "doubles-typing.ts"
rep(T, """/**
 * Smack Down and Thousand Arrows (PS/data/moves.ts:16965-16994 smackdown condition onStart; the step's smackedDown when the hit
 * met a target that was not grounded): the target is grounded (eot.smackedDown: the kernel's grounded, calcBuild's pinned
 * marker), its Magnet Rise and Telekinesis end, and a Fly or Bounce user lands (H's land).
 */
export function groundingAfterHit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  void action; void info;
  if (!outcome.target.smackedDown || !kernel.alive(w, target)) return;""", """/**
 * Smack Down and Thousand Arrows (PS/data/moves.ts:16965-16994 smackdown condition onStart; the step's smackedDown when the hit
 * met a target that was not grounded): the target is grounded (eot.smackedDown: the kernel's grounded, calcBuild's pinned
 * marker), its Magnet Rise and Telekinesis end, and a Fly or Bounce user lands (H's land). A Fly or Bounce user the hit
 * reached lands too where it was on the ground already (an Iron Ball, not Flying type: the step's smackedDown is false), since
 * the condition's onStart removes the fly or bounce volatile before it reads the grounding (`applies`; status2 integration 1b,
 * in place of H's guard).
 */
export function groundingAfterHit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  void action;
  if (!kernel.alive(w, target)) return;
  const hidden = w.mons[target]!.eot.hidden;
  const lands = outcome.landed > 0 && !info.transformed && (info.effective.id === "smackdown" || info.effective.id === "thousandarrows") && (hidden === "fly" || hidden === "bounce");
  if (!outcome.target.smackedDown && !lands) return;""", "groundingAfterHit")
H = "doubles-hidden.ts"
rep(H, """  if (kind === "skydrop") skyDropHeld(kernel, w, slot, info.effective.id, move);
  // Smack Down and Thousand Arrows end Fly and Bounce on any Pokémon they hit (their condition's onStart removes the volatile
  // before it checks the grounding), while A2's grounding write lands a hit target only where the step grounded it (not
  // already on the ground: Iron Ball, a Fly user that is not Flying type).
  if ((info.effective.id === "smackdown" || info.effective.id === "thousandarrows") && (kind === "fly" || kind === "bounce") && kernel.grounded(w, slot)) kernel.notEstimated(REASONS.combo(move, hidden));
""", """  if (kind === "skydrop") skyDropHeld(kernel, w, slot, info.effective.id, move);
  // Smack Down and Thousand Arrows end Fly and Bounce on any Pokémon they hit, one already on the ground included (A2's
  // doubles-typing.ts groundingAfterHit; status2 integration 1b).
""", "H guard")
