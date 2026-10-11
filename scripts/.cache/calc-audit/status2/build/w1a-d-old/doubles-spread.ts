import { PROTECT_CONTACT, REASONS, SELF_DESTRUCT_MOVES } from "./doubles-actions";
import { cloneWorld, condition, mapHP, marginal, type PendingAction, type World } from "./doubles-world";
import type { FaceKind, HitCheck, SearchEntry, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import * as guardNs from "./doubles-guards";
import * as reactionNs from "./doubles-reactions";
import * as substituteNs from "./doubles-substitute";
import type { TurnSide } from "./uses-to-ko";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const guardHooks = { ...guardNs };
const reactionHooks = { ...reactionNs };
const substituteHooks = { ...substituteNs };

// Spread moves (status2 SPEC2 §3.5, §4.5): Track D's file. spreadStep is moved verbatim from doubles-turn.ts (its private
// helpers are kernel members); D models spread heals here (F4 §4.7 with C12), K's reactions enter through its two hooks
// (contactKO, spreadUser), and D's one-hit KO step and K's steal are asked before each target's calculation.

/**
 * A move with more than one target (SPEC §4.6 "Spread moves"), and Explosion and its kin and Mind Blown with any
 * number: each target hit runs as its own step from the attacker's state before the move, in Showdown's target order,
 * with the spread modifier while more than one target was in place as the move started (`multiple`;
 * sim/battle-actions.ts:551, 1733-1737), protected and immune ones included. The attacker's state each step leaves must
 * agree; its HP then changes once: the targets' retaliation summed (at the hit's Update), then Mind Blown's recoil
 * (sim/battle-actions.ts applyRecoilDamage, or onMoveFail) and Life Orb once when a target was hit (data/items.ts
 * lifeorb onAfterMoveSecondarySelf) at the next Update. Explosion's user fainted as the move started (useMoveInner),
 * so nothing reaches it. `prior`: Spiky Shield's damage taken before the hits, with no Update before them.
 */
export function spreadStep(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, checks: HitCheck[], multiple: boolean, attackerHP?: number, prior = 0): World[] {
  const attacker = action.slot;
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const step = kernel.step(action);
  const user = w.mons[attacker]!.build;
  const selfDestruct = SELF_DESTRUCT_MOVES.has(move.id) && !info.transformed;
  const mindBlown = move.id === "mindblown" && !info.transformed;
  if (!selfDestruct && (info.drain || (user.itemId === "shellbell" && kernel.itemWorks(w, user)))) kernel.notEstimated(REASONS.spreadHeal(move.name));
  if (selfDestruct && !w.ghost) return spreadStep(kernel, Object.assign(cloneWorld(w), { ghost: attacker }), action, info, checks, multiple, attackerHP, prior);
  // Every target's TryHit runs before the hit loop (sim/battle-actions.ts:550-577 trySpreadMoveHit: hitStepTryHitEvent,
  // then hitStepMoveHitLoop): a protecting move's contact effect on the attacker (King's Shield's and Obstruct's drops
  // with Defiant, Baneful Bunker's poison, Burning Bulwark's burn) comes before any target is hit, and the other
  // targets' hits read it. Spiky Shield's damage (this.damage, no Update) joins the retaliation the hits bring: the
  // Update after the hits (sim/battle-actions.ts:967) is the first that can eat a Berry for it.
  const contact = checks.filter((check) => !check.done && check.block && "by" in check.block && check.block.protect && PROTECT_CONTACT[check.block.protect] && info.contact);
  if (contact.length) {
    let worlds = [cloneWorld(w)];
    let loss = prior;
    for (const check of contact) {
      const effect = PROTECT_CONTACT[(check.block as { protect: keyof typeof PROTECT_CONTACT }).protect]!;
      if (!effect.damage) { worlds = worlds.flatMap((world) => kernel.blockedHit(world, action, info, check)); continue; }
      for (const world of worlds) kernel.blockedHit(world, action, info, check, false);
      if (w.mons[attacker]!.build.abilityId !== "magicguard") loss += Math.max(1, Math.floor(kernel.hp[attacker].baseMaxHP / effect.damage));
    }
    const rest = checks.map((check): HitCheck => (contact.includes(check) ? { ...check, done: true } : check));
    return worlds.flatMap((world) => {
      // An attacker its contact effect knocks out still hits the rest (K's contactKO: not followed today).
      reactionHooks.contactKO(kernel, world, action, contact, rest, loss);
      return spreadStep(kernel, world, action, info, rest, multiple, attackerHP, loss);
    });
  }
  // Damage that reads the attacker's HP (Eruption, Water Spout, Blaze at a third): the world is taken apart by the part
  // of that HP the damage reads, each part's steps from a Pokémon at an HP of it (its HP does not change in the move).
  if (attackerHP === undefined) {
    const probe = checks.find((check) => !check.block);
    const entry = probe ? kernel.searchFor(w, attacker, probe.slot, move.id, kernel.conditionsFor(w, attacker, probe.slot, multiple, move.id), kernel.contextFor(w, action, probe.slot, info), true) : null;
    if (entry?.search?.readsAttackerHP()) {
      const classes = new Map<string, number>();
      for (const hp of marginal(w, attacker).keys()) { const key = entry.search.attackerHPClass(hp); if (!classes.has(key)) classes.set(key, hp); }
      if (classes.size > 1 || !classes.has(entry.search.attackerHPClass(kernel.hp[attacker].maxHP))) {
        return [...classes].flatMap(([key, hp]) => condition(w, attacker, (value) => entry.search!.attackerHPClass(value) === key)
          .filter(({ meets }) => meets).flatMap(({ world }) => spreadStep(kernel, world, action, info, checks, multiple, hp, prior)));
      }
    }
  }
  // Every target's calculation from the world before the move (all of the move's damage is dealt at once).
  // locked (status2 Step 1 #2): the healing Berry a Champions Sheer Force hit locks, read as Leftovers in the step (guards.sheerForceLock).
  type Plan = { check: HitCheck; entry: SearchEntry | null; face: FaceKind | null; sub: substituteNs.SubPlan | null; locked?: string | null };
  const plans = checks.map((check): Plan => {
    if (check.block) return { check, entry: null, face: null, sub: null };
    // A hit into a Substitute (doubles-substitute.ts plan, Track E): applied in the target's place in the hit order.
    const sub = substituteHooks.plan(kernel, w, action, info, check, multiple, attackerHP);
    if (sub) return { check, entry: null, face: null, sub };
    // K's steal before the target's calculation (none for a spread move) and D's one-hit KO step (applied in the target's place).
    if (reactionHooks.beforeStep(kernel, w, action, info, check)) throw new Error("doubles-spread.ts: a steal before a spread move's calculation is not supported.");
    const fixed = guardHooks.ohkoStep(kernel, w, action, info, check);
    if (fixed) return { check, entry: null, face: null, sub: { apply: fixed } };
    const conditions = kernel.conditionsFor(w, attacker, check.slot, multiple, move.id);
    const locked = guardHooks.sheerForceLock(kernel, w, attacker, check.slot, info);
    const entry = kernel.searchFor(w, attacker, check.slot, move.id, conditions, kernel.contextFor(w, action, check.slot, info), true, attackerHP, locked ? { healBlocked: true } : undefined);
    if (entry.row.kind !== "calculated") {
      const face = kernel.faceTaken(w, attacker, check.slot, entry.row, move);
      if (!face) kernel.notEstimated(kernel.rowReason(w, check.slot, entry.row, move));
      return { check, entry: null, face, sub: null };
    }
    kernel.focusBandGuard(w, check.slot, entry.row);
    if (entry.search) kernel.unnerveGuard(w, attacker, check.slot);
    return { check, entry, face: null, sub: null, locked };
  });
  const standing = checks.map((check) => check.slot).filter((slot) => kernel.alive(w, slot));
  let worlds: World[] = [cloneWorld(w)];
  worlds[0].spread = [];
  let retaliation = prior, hit = false;
  for (const { check, entry, face, sub, locked } of plans) {
    const target = check.slot;
    if (check.block) { if (!check.done) worlds = worlds.flatMap((world) => kernel.blockedHit(world, action, info, check)); continue; }
    // It adds no retaliation (no DamagingHit behind a Substitute); Life Orb stays this step's, once per move.
    if (sub) { hit = true; worlds = worlds.flatMap((world) => sub.apply(world)); continue; }
    if (face) {
      hit = true;
      worlds = worlds.flatMap((world) => kernel.faceHit(world, action, info, target, face, multiple, true));
      continue;
    }
    if (!entry!.search) {
      for (const world of worlds) if (step) { kernel.hitStats(action, target)!.noDamage += world.mass; kernel.hitFact(action, target, kernel.noDamageFact(entry!.row, move, target), world.mass); }
      continue;
    }
    hit = true;
    retaliation += entry!.search.retaliation();
    worlds = worlds.flatMap((world) => kernel.applyStep(world, action, target, entry!, info, true).map((child) => {
      // The locked Berry back in place of the stand-in, with the lock where the hit reached the Pokémon (status2 Step 1 #2).
      const receiver = child.world.mons[target]!;
      if (locked && receiver.build.itemId === "leftovers") {
        receiver.build = { ...receiver.build, itemId: locked };
        if (child.landed > 0 && !receiver.fainted) receiver.vol = { ...receiver.vol, berryLocked: "sheerforce" };
      }
      return child.world;
    }));
  }
  // The attacker after the move: the state every target's step left it in (its own effects, applied once).
  const out: World[] = [];
  for (const world of worlds) {
    const states = [...new Set(world.spread ?? [])];
    delete world.spread;
    reactionHooks.spreadUser(kernel, world, action, info, states);
    if (states.length === 1) {
      const side = JSON.parse(states[0]) as TurnSide;
      // status2 C14: its heal-block stand-in's real item back (kernel.healStandIn of the world before the move).
      world.mons[attacker]!.build = kernel.unfollowed(world.mons[attacker]!.build, kernel.fromSide(world.mons[attacker]!.build, { ...side, hp: 0 }), kernel.healStandIn(w, attacker, true));
    }
    if (selfDestruct) {
      // Its HP went to 0 as the move started; it faints first in the batch (sim/battle.ts faintQueue order).
      delete world.ghost;
      out.push(...mapHP(world, attacker, () => ({ hp: 0, tag: "" })).map(({ world: next }) => { kernel.faint(next, attacker); return next; }));
      continue;
    }
    // The faint batch after the hits: the targets the move knocked out, the user's ally included (sim/battle.ts faintMessages).
    kernel.koBoost(world, attacker, standing.filter((slot) => world.mons[slot]!.fainted).length);
    const build = world.mons[attacker]!.build;
    const guarded = build.abilityId === "magicguard";
    const losses: (number | number[])[] = [];
    const end: number[] = [];
    if (mindBlown && !guarded) end.push(Math.max(1, Math.round(kernel.hp[attacker].maxHP / 2)));
    const sheerForce = build.abilityId === "sheerforce" && info.secondaries;
    if (hit && build.itemId === "lifeorb" && kernel.itemWorks(world, build) && !guarded && !sheerForce) end.push(Math.max(1, Math.floor(kernel.hp[attacker].baseMaxHP / 10)));
    // The retaliation comes in the hits; the Update after them (sim/battle-actions.ts:967) is before Mind Blown's recoil
    // and Life Orb, so a Berry the move made due without a loss (a target's Unnerve or As One ending with its HP) is eaten there.
    if (retaliation && !guarded) losses.push(retaliation);
    else if (end.length) losses.push(0);
    if (end.length) losses.push(end);
    out.push(...(losses.length ? kernel.afterLoss(world, attacker, ...losses) : [world]));
  }
  if (info.isMax && hit) for (const world of out) kernel.maxEffects(world, action, info, checks[0].slot);
  return out;
}
