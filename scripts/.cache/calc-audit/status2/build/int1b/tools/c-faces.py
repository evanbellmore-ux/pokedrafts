# Integration 1b: doubles-faces.ts's constant `!pipeline` branch (INTEGRATION-1A §4 item 6): the kernel's afterHit is a
# TurnKernel member since integration 1a, so faceOnce always hands its outcome to it.
from patchlib import rep
F = "doubles-faces.ts"
rep(F, """/**
 * The kernel's afterHit (doubles-turn.ts: the turn's reactions to one hit), which this file needs for a hit no pair's step
 * applies. A kernel member from integration 1a (W1A-S.md needsFromIntegrator, ADDENDUM2 §8.2's one-line rule); before it, a
 * move whose hit does more than this file applies keeps today's reason (faceHit).
 */
type AfterHit = (w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo, raisedBefore?: boolean) => void;
const afterHitOf = (kernel: TurnKernel): AfterHit | null => (kernel as TurnKernel & { afterHit?: AfterHit }).afterHit ?? null;
""", "", "afterHitOf")
rep(F, """  const pipeline = afterHitOf(kernel);
""", "", "pipeline const")
rep(F, """  if (!pipeline) {
    const sereneGrace = user.build.abilityId === "serenegrace";
    const cloak = receiver.build.itemId === "covertcloak" && kernel.itemWorks(world, receiver.build);
    const accuracy = info.transformed ? 0 : accuracyDrop(mv.id, sereneGrace);
    if (accuracy && user.build.abilityId !== "sheerforce" && !cloak) kernel.foeDrop(world, target, { accuracy }, attacker, kernel.breaks(world, attacker, target, info));
    kernel.flinchCheck(world, action, target, info);
  }
""", "", "!pipeline block")
rep(F, """  if (pipeline) {
    const outcome: TurnStepOutcome = probe
      ? { ...probe, landed: 1, subHits: 0, knocked: false, attackerFainted: false }
      : { attacker: sideOf(kernel, w, attacker), attackerFainted: false, target: sideOf(kernel, world, target), knocked: false, conditions: kernel.conditionsFor(w, attacker, target, multiple, mv.id),
        landed: 1, subHits: 0, dist: new Map() };
    for (const next of worlds) pipeline(next, action, target, outcome, info, raisedBefore);
  }
  return worlds;""", """  // The kernel's afterHit (doubles-turn.ts: the turn's reactions to one hit, the accuracy drop and flinch included) on an
  // outcome of one hit that reached the Pokémon.
  const outcome: TurnStepOutcome = probe
    ? { ...probe, landed: 1, subHits: 0, knocked: false, attackerFainted: false }
    : { attacker: sideOf(kernel, w, attacker), attackerFainted: false, target: sideOf(kernel, world, target), knocked: false, conditions: kernel.conditionsFor(w, attacker, target, multiple, mv.id),
      landed: 1, subHits: 0, dist: new Map() };
  for (const next of worlds) kernel.afterHit(next, action, target, outcome, info, raisedBefore);
  return worlds;""", "pipeline call")
