# Integration 1b (INTEGRATION-1A §4 item 6: D's ask 2, W1A-D.md "For the integrator" 2): Fling's per-use item effects in the
# doubles turn's step. Pinned Showdown: the `fling` volatile takes the item at the hit's Update (PS/data/moves.ts fling condition
# onUpdate; sim/battle-actions.ts:967), before recoil and onAfterMoveSecondarySelf, so a flung Life Orb or Shell Bell does not
# act after the hit, and its user eats no HP Berry it flung after that Update. 1v1 (no turn mode) is unchanged.
from patchlib import rep
U = "uses-to-ko.ts"
rep(U, """  private afterMove(prev: State, after: State): State {
    const moveId = this.useMoveId(prev);
    const magician = moveId !== "covet" && moveId !== "thief" && !prev.att.itemId && !!after.att.itemId && this.ability(prev, "att") === "magician";
    return magician ? { ...after, att: { ...after.att, itemId: prev.att.itemId } } : after;
  }""", """  private afterMove(prev: State, after: State): State {
    const moveId = this.useMoveId(prev);
    // status2 integration 1b (D's ask 2): a doubles turn's own Fling threw its item at the hit's Update (PS/data/moves.ts fling
    // condition onUpdate), so recoil, Life Orb and Shell Bell after the hits find none (doubles-guards.ts flingEnd takes it).
    if (this.flungUse(prev)) return { ...after, att: { ...after.att, itemId: "" } };
    const magician = moveId !== "covet" && moveId !== "thief" && !prev.att.itemId && !!after.att.itemId && this.ability(prev, "att") === "magician";
    return magician ? { ...after, att: { ...after.att, itemId: prev.att.itemId } } : after;
  }

  /** A doubles turn's own Fling with an item to throw (turn mode only: 1v1's Uses to KO keeps its own Fling rows). */
  private flungUse(prev: State): boolean {
    return this.turnMode && this.useMoveId(prev) === "fling" && !!prev.att.itemId;
  }""", "afterMove")
rep(U, """    // The last hit's Update, for a berry Thief or Covet took in it.
    update();
    const { recoil, rest } = this.afterHitsLosses(after, result, dealt, noDamage);""", """    // The last hit's Update, for a berry Thief or Covet took in it.
    update();
    // status2 integration 1b (D's ask 2): a doubles turn's Fling took its item at that Update: no HP Berry of it after.
    if (this.flungUse(prev)) berry = null;
    const { recoil, rest } = this.afterHitsLosses(after, result, dealt, noDamage);""", "berry after")
G = "doubles-guards.ts"
rep(G, """ * `fling` volatile takes the item at the next Update (flingAfter, flingEnd). Not followed (REASONS.combo): a flung Shell Bell
 * (the pair's step heals with it, uses-to-ko.ts), and a flung Life Orb where a Substitute, Disguise or Ice Face takes the
 * hit (their paths take its recoil).
 */""", """ * `fling` volatile takes the item at the next Update (flingAfter, flingEnd); the pair's step leaves the thrown item out after
 * the hit (uses-to-ko.ts afterMove: no Life Orb recoil, no Shell Bell heal, no HP Berry of it: status2 integration 1b, D's ask 2),
 * as doubles-faces.ts does after a face's hit.
 */""", "flingTry doc")
rep(G, """  const receiver = w.mons[target];
  if (user.itemId === "shellbell") kernel.notEstimated(REASONS.combo(move.name, kernel.itemName("shellbell")));
  if (user.itemId === "lifeorb" && user.abilityId !== "magicguard" && receiver && (receiver.vol.substitute || intactFace(receiver.build))) {
    kernel.notEstimated(REASONS.combo(move.name, kernel.itemName("lifeorb")));
  }
  (mon as Marked).flung = { item: user.itemId, target, before: receiver?.build ?? user, hurt: mon.hurt };
  return null;
}

/** An intact Disguise or Ice Face (doubles-faces.ts takes such a hit, with the attacker's Life Orb). */
function intactFace(build: BattleBuild): boolean {
  return (build.abilityId === "disguise" && !build.speciesId.includes("busted")) || (build.abilityId === "iceface" && build.speciesId === "eiscue");
}""", """  const receiver = w.mons[target];
  (mon as Marked).flung = { item: user.itemId, target, before: receiver?.build ?? user, hurt: mon.hurt };
  return null;
}""", "flingTry guards")
rep(G, """ * (move.onHit, or a certain secondary: flungOn); then the hit's Update, where the `fling` volatile takes the item (flingEnd),
 * so the user's AfterMoveSecondarySelf finds none: the step's Life Orb recoil is given back (lifeOrbBack). The step must
 * still leave the user its item (an item it used itself in the step, a Berry after a Jaboca Berry: not followed).
 */""", """ * (move.onHit, or a certain secondary: flungOn); then the hit's Update, where the `fling` volatile takes the item (flingEnd),
 * so the user's AfterMoveSecondarySelf finds none (the step left it out: uses-to-ko.ts afterMove). The step must still leave
 * the user its item (an item it used itself in the step, a Berry after a Jaboca Berry: not followed).
 */""", "flingHit doc")
rep(G, """  const receiver = w.mons[target];
  if (flung.item === "lifeorb") lifeOrbBack(kernel, w, attacker, target, outcome, flung);
  const data = flingData(kernel.runtime, flung.item);""", """  const receiver = w.mons[target];
  const data = flingData(kernel.runtime, flung.item);""", "lifeOrbBack call")
rep(G, """/**
 * The step's Life Orb recoil given back (uses-to-ko.ts afterHitsLosses reads the item as held; pinned Life Orb's
 * onAfterMoveSecondarySelf never runs after Fling threw it): its user's HP + max(1, trunc(base maximum HP / 10)), as the step
 * took it (the step follows a Life Orb user's HP: uses-to-ko.ts attackerLosesHP; not with Magic Guard). Its hurtThisTurn
 * (W's doubles-pairs.ts hurt set it for the recoil) goes back to what it was before the hit unless the target's Jaboca Berry,
 * Gulp Missile or Innards Out also hurt it. A user at 0 HP after the step (Life Orb's or a Jaboca Berry's) is not followed.
 */
function lifeOrbBack(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, outcome: TurnStepOutcome, flung: Flung) {
  const mon = w.mons[attacker]!;
  if (mon.build.abilityId === "magicguard") return;
  if (mon.fainted) kernel.notEstimated(REASONS.combo(kernel.moveName("fling"), kernel.itemName("lifeorb")));
  const recoil = Math.max(1, Math.floor(kernel.hp[attacker].baseMaxHP / 10));
  const maxHP = kernel.hp[attacker].maxHP;
  shiftHP(w, attacker, (hp) => (hp > 0 ? Math.min(maxHP, hp + recoil) : hp));
  const before = flung.before, now = w.mons[target]?.build;
  const jaboca = before.itemId === "jabocaberry" && now?.itemId !== "jabocaberry";
  const gulp = before.speciesId === "cramorantgulping" || before.speciesId === "cramorantgorging";
  const innards = before.abilityId === "innardsout" && outcome.knocked;
  if (outcome.landed > 0 && (jaboca || gulp || innards)) return;
  mon.hurt = flung.hurt;
}

/** `slot`'s HP through a deterministic `map` in place (mapHP's single world: no split). */
function shiftHP(w: World, slot: DoublesSlotId, map: (hp: number) => number) {
  const [next] = mapHP(w, slot, (hp) => ({ hp: map(hp), tag: "" }));
  w.factors = next.world.factors;
}

""", "", "lifeOrbBack fn")
F = "doubles-faces.ts"
rep(F, """    // Life Orb after a hit that landed (its onAfterMoveSecondarySelf needs no damage), at the action's Update.
    const build = next.mons[attacker]!.build;
    const lifeOrb = build.itemId === "lifeorb" && kernel.itemWorks(next, build) && build.abilityId !== "magicguard" && !sheerForce && kernel.alive(next, attacker);""",
 """    // Life Orb after a hit that landed (its onAfterMoveSecondarySelf needs no damage), at the action's Update; none for a flung
    // Life Orb (the `fling` volatile took it at the hit's Update: status2 integration 1b, D's ask 2).
    const build = next.mons[attacker]!.build;
    const flung = mv.id === "fling" && !info.transformed;
    const lifeOrb = build.itemId === "lifeorb" && !flung && kernel.itemWorks(next, build) && build.abilityId !== "magicguard" && !sheerForce && kernel.alive(next, attacker);""", "faces life orb")
