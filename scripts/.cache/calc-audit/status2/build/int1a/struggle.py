# Integration 1a (W's note, not W's file): Struggle's recoil is directDamage (PS/sim/battle-actions.ts:1388-1389), which
# sets no hurtThisTurn (only spreadDamage does, sim/battle.ts:2138) and runs no Damage event (a Berserk or Anger Shell lock
# stays): Assurance into the Struggle user is not doubled by it. A locked user's recoil is not followed.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
apply([("doubles-turn.ts", '''function struggleRecoil(ctx: Ctx, before: World, w: World, action: PendingAction, checks: HitCheck[]): World[] {
  const attacker = action.slot;
  if (!alive(w, attacker)) return [w];
  return hitSomething(before, w, checks) ? afterLoss(ctx, w, attacker, Math.max(1, Math.round(ctx.hp[attacker].baseMaxHP / 4))) : [w];
}''', '''function struggleRecoil(ctx: Ctx, before: World, w: World, action: PendingAction, checks: HitCheck[]): World[] {
  const attacker = action.slot;
  if (!alive(w, attacker) || !hitSomething(before, w, checks)) return [w];
  // status2 (integration 1a): directDamage sets no hurtThisTurn and runs no Damage event (a Berserk lock would stay).
  const mon = w.mons[attacker]!;
  if (mon.vol.berryLocked) notEstimated(REASONS.combo(moveName(ctx, "struggle"), `${abilityName(ctx, mon.build.abilityId)}'s locked ${itemName(ctx, mon.build.itemId)}`));
  const hurt = mon.hurt;
  return afterLoss(ctx, w, attacker, Math.max(1, Math.round(ctx.hp[attacker].baseMaxHP / 4))).map((world) => { world.mons[attacker]!.hurt = hurt; return world; });
}''', "Struggle's recoil: no hurtThisTurn")])
