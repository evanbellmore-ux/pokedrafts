# Integration 1b (census: K's "Innards Out with earlier damage this turn is not modelled in 2v2.", a reason ADDENDUM2 §2.3 #13
# does not keep): a single target's Innards Out reads the HP it had as the move started (one value per step, stepEnv's
# koRetaliation), so a holder whose HP differs between entries is stepped once per HP it has (Final Gambit's split).
from patchlib import rep
K = "doubles-reactions.ts"
rep(K, """function startHP(kernel: TurnKernel, w: World, target: DoublesSlotId): number | null {""", """/**
 * Whether a single-target hit into `target` is stepped once per HP the target has (doubles-turn.ts singleStep, status2 integration
 * 1b): an Innards Out holder whose HP differs between entries (PS/data/abilities.ts innardsout onDamagingHit: the HP it had before
 * the hit, target.getUndynamaxedHP(damage), one value per step: stepEnv's koRetaliation), with a living user. Any damaging move,
 * a Z-Move or Max Move included; not at the end of turn (a residual hit is not followed).
 */
export function innardsOutSplit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId): boolean {
  const mon = w.mons[target];
  if (kernel.inEndOfTurn || action.slot === target || !mon || mon.fainted || mon.build.abilityId !== "innardsout" || !kernel.alive(w, action.slot)) return false;
  return [...marginal(w, target).keys()].filter((hp) => hp > 0).length > 1;
}

function startHP(kernel: TurnKernel, w: World, target: DoublesSlotId): number | null {""", "innardsOutSplit")
T = "doubles-turn.ts"
rep(T, """  // status2: K's steal before the target's calculation (Spectral Thief's hitStepStealBoosts, before the hit loop; a stub: none).
  const w = reactionHooks.beforeStep(kernel, w0, action, info, check) ?? w0;""", """  // status2 integration 1b: an Innards Out holder whose HP differs between entries, one world per HP it has (its loss on the
  // user is the HP it had as the move started: K's stepEnv koRetaliation reads one value).
  if (reactionHooks.innardsOutSplit(kernel, w0, action, target)) {
    return [...marginal(w0, target).keys()].flatMap((hp) => condition(w0, target, (value) => value === hp)
      .filter(({ meets }) => meets).flatMap(({ world }) => singleStep(ctx, world, action, info, check, attackerHP)));
  }
  // status2: K's steal before the target's calculation (Spectral Thief's hitStepStealBoosts, before the hit loop; a stub: none).
  const w = reactionHooks.beforeStep(kernel, w0, action, info, check) ?? w0;""", "singleStep split")
