import { PROTECT_CONTACT, REASONS, SELF_DESTRUCT_MOVES } from "./doubles-actions";
import { DOUBLES_SLOTS, type DoublesSlotId } from "./doubles-types";
import {
  cloneWorld, condition, digitAt, entryCount, join, locate, mapHP, mapJoint, marginal, mergeWorlds, pointFactor, RADIX, radixPow, splitFactor, type Factor, type PendingAction, type World,
} from "./doubles-world";
import type { FaceKind, HitCheck, SearchEntry, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import * as guardNs from "./doubles-guards";
import * as reactionNs from "./doubles-reactions";
import * as substituteNs from "./doubles-substitute";
import * as faceNs from "./doubles-faces";
import * as pairNs from "./doubles-pairs";
import { berryArithmetic, BERSERK_BERRIES, eatBerry, HEALING_BERRIES, LANSAT_STARF, PINCH_STAT_BERRIES, UNNERVES } from "./hit-loop";
import type { CombatStat } from "./types";
import type { TurnSide, TurnStepResult, UsesSearch } from "./uses-to-ko";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const guardHooks = { ...guardNs };
const reactionHooks = { ...reactionNs };
const substituteHooks = { ...substituteNs };
const pairHooks = { ...pairNs };

// Spread moves (status2 SPEC2 §3.5, §4.5): Track D's file. spreadStep is moved verbatim from doubles-turn.ts (its private
// helpers are kernel members); D models spread heals here (F4 §4.7 with C12: drainingStep), K's reactions enter through its
// two hooks (contactKO, spreadUser), and D's one-hit KO step and K's steal are asked before each target's calculation.

/**
 * A move with more than one target (SPEC §4.6 "Spread moves"), and Explosion and its kin and Mind Blown with any
 * number: each target hit runs as its own step from the attacker's state before the move, in Showdown's target order,
 * with the spread modifier while more than one target was in place as the move started (`multiple`;
 * sim/battle-actions.ts:551, 1733-1737), protected and immune ones included. The attacker's state each step leaves must
 * agree; its HP then changes once: the targets' retaliation summed (at the hit's Update), then Mind Blown's recoil
 * (sim/battle-actions.ts applyRecoilDamage, or onMoveFail) and Life Orb once when a target was hit (data/items.ts
 * lifeorb onAfterMoveSecondarySelf) at the next Update. Explosion's user fainted as the move started (useMoveInner),
 * so nothing reaches it. `prior`: Spiky Shield's damage taken before the hits, with no Update before them. A draining
 * move, or a user with a working Shell Bell, heals from what each target lost (drainingStep).
 */
export function spreadStep(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, checks: HitCheck[], multiple: boolean, attackerHP?: number, prior = 0): World[] {
  const attacker = action.slot;
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const step = kernel.step(action);
  const user = w.mons[attacker]!.build;
  const selfDestruct = SELF_DESTRUCT_MOVES.has(move.id) && !info.transformed;
  const mindBlown = move.id === "mindblown" && !info.transformed;
  // status2 (F4 §4.7): a draining move heals per target in hit order; Shell Bell once from the damage summed (no heal under
  // Heal Block: its TryHeal, C14; none after a Sheer Force move with secondaries, which runs no AfterMoveSecondarySelf).
  const sheerForce = user.abilityId === "sheerforce" && info.secondaries;
  const bell = !selfDestruct && user.itemId === "shellbell" && kernel.itemWorks(w, user) && !sheerForce && !w.mons[attacker]!.eot.healBlock;
  const heals = !selfDestruct && (info.drain || bell);
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
  const plans = checks.map((check): Plan => {
    if (check.block) return { check, entry: null, face: null, sub: null };
    // A hit into a Substitute (doubles-substitute.ts plan, Track E): applied in the target's place in the hit order.
    // status2 (S): with each Substitute's Mind Blown cost (SubPlan.cost), which the user takes with the retaliation.
    const sub = substituteHooks.plan(kernel, w, action, info, check, multiple, attackerHP, { costs: true });
    if (sub) return { check, entry: null, face: null, sub };
    // K's steal before the target's calculation (none for a spread move) and D's one-hit KO step (applied in the target's place).
    if (reactionHooks.beforeStep(kernel, w, action, info, check)) throw new Error("doubles-spread.ts: a steal before a spread move's calculation is not supported.");
    const fixed = guardHooks.ohkoStep(kernel, w, action, info, check);
    if (fixed) return { check, entry: null, face: null, sub: { apply: fixed } };
    const conditions = kernel.conditionsFor(w, attacker, check.slot, multiple, move.id);
    const locked = guardHooks.sheerForceLock(kernel, w, attacker, check.slot, info);
    const search = () => kernel.searchFor(w, attacker, check.slot, move.id, conditions, kernel.contextFor(w, action, check.slot, info), true, attackerHP, locked ? { healBlocked: true } : undefined);
    // status2 (F4 §4.7): a spread heal reads each hit's damage (UsesEnv.report.dealt).
    const entry = heals ? guardHooks.withDealt(search) : search();
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
  if (heals) return drainingStep(kernel, w, action, info, plans, standing, { multiple, prior, bell, mindBlown });
  let worlds: World[] = [cloneWorld(w)];
  worlds[0].spread = [];
  let retaliation = prior, hit = false;
  for (const { check, entry, face, sub, locked } of plans) {
    const target = check.slot;
    if (check.block) { if (!check.done) worlds = worlds.flatMap((world) => kernel.blockedHit(world, action, info, check)); continue; }
    // It adds no retaliation (no DamagingHit behind a Substitute); Life Orb stays this step's, once per move.
    if (sub) { hit = true; retaliation += sub.cost ?? 0; worlds = worlds.flatMap((world) => sub.apply(world)); continue; }
    if (face) {
      hit = true;
      retaliation += faceNs.faceRetaliation(kernel, w, action, info, target);
      worlds = worlds.flatMap((world) => faceNs.faceHit(kernel, world, action, info, target, face, multiple, true, { retaliation: "caller" }));
      continue;
    }
    if (!entry!.search) {
      for (const world of worlds) if (step) { kernel.hitStats(action, target)!.noDamage += world.mass; kernel.hitFact(action, target, kernel.noDamageFact(entry!.row, move, target), world.mass); }
      continue;
    }
    hit = true;
    retaliation += entry!.search.retaliation();
    worlds = worlds.flatMap((world) => kernel.applyStep(world, action, target, entry!, info, true).map((child) => {
      putBack(child.world, target, locked, child.landed);
      return child.world;
    }));
  }
  // Mind Blown (S): a target took damage, or every target failed (blocked or no damage).
  const damaged = plans.some((p) => p.entry?.search), failed = plans.every((p) => p.check.block || (p.entry && !p.entry.search));
  // The attacker after the move: the state every target's step left it in (its own effects, applied once).
  const out: World[] = [];
  for (const world of worlds) {
    const { states, rises } = attackerStates(world);
    reactionHooks.spreadUser(kernel, world, action, info, states);
    if (states.length === 1) {
      const side = JSON.parse(states[0]) as TurnSide;
      // status2 C14: its heal-block stand-in's real item back (kernel.healStandIn of the world before the move).
      world.mons[attacker]!.build = kernel.unfollowed(world.mons[attacker]!.build, kernel.fromSide(world.mons[attacker]!.build, { ...side, hp: 0 }), kernel.healStandIn(w, attacker, true));
    }
    // status2 (F4 §4.1): its own rises in the steps (UsesEnv.report.rises) into the foes' pending copies, once for the move.
    guardHooks.stepRises(kernel, world, attacker, rises);
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
    // Mind Blown's own cost only where a target took damage or every target failed (S; PS/data/moves.ts mindblown onAfterMove).
    if (mindBlown && !guarded && (damaged || failed)) end.push(Math.max(1, Math.round(kernel.hp[attacker].maxHP / 2)));
    const sheerForceNow = build.abilityId === "sheerforce" && info.secondaries;
    if (hit && build.itemId === "lifeorb" && kernel.itemWorks(world, build) && !guarded && !sheerForceNow) end.push(Math.max(1, Math.floor(kernel.hp[attacker].baseMaxHP / 10)));
    // The retaliation comes in the hits; the Update after them (sim/battle-actions.ts:967) is before Mind Blown's recoil
    // and Life Orb, so a Berry the move made due without a loss (a target's Unnerve or As One ending with its HP) is eaten there.
    if (retaliation && !guarded) losses.push(retaliation);
    else if (end.length) losses.push(0);
    if (end.length) losses.push(end);
    // W's userLosses: a Sparkling Aria user's faint in the hits is told apart from one after them (doubles-pairs.ts).
    out.push(...(losses.length ? pairHooks.userLosses(kernel, world, action, info, losses) : [world]));
  }
  return info.isMax && hit ? out.flatMap((world) => kernel.maxEffects(world, action, info, checks[0].slot)) : out;
}

type Plan = { check: HitCheck; entry: SearchEntry | null; face: FaceKind | null; sub: substituteNs.SubPlan | null; locked?: string | null };

/** The locked Berry back in place of the stand-in, with the lock where the hit reached the Pokémon (status2 Step 1 #2; guards.sheerForceLock). */
function putBack(world: World, target: DoublesSlotId, locked: string | null | undefined, landed: number) {
  const receiver = world.mons[target]!;
  if (!locked || receiver.build.itemId !== "leftovers") return;
  receiver.build = { ...receiver.build, itemId: locked };
  if (landed > 0 && !receiver.fainted) receiver.vol = { ...receiver.vol, berryLocked: "sheerforce" };
}

/**
 * World.spread taken off one world after the hits: each target step's state for the attacker (its distinct entries), and the
 * attacker's own rises in a step (D's marker, guards.flingAfter; one step's, as every step gives the same state).
 */
function attackerStates(world: World): { states: string[]; rises: Partial<Record<CombatStat, number>> | undefined } {
  const entries = world.spread ?? [];
  delete world.spread;
  const states = [...new Set(entries.filter((entry) => !entry.startsWith(guardHooks.SPREAD_RISES)))];
  const rise = entries.find((entry) => entry.startsWith(guardHooks.SPREAD_RISES));
  return { states, rises: rise ? JSON.parse(rise.slice(guardHooks.SPREAD_RISES.length)) as Partial<Record<CombatStat, number>> : undefined };
}

/**
 * The attacker after the hits, in one world (World.spread): K's reactions on it (spreadUser), the one state applied (its HP
 * aside: the kernel changes that once), and its own rises in the steps into the foes' pending copies, once for the move.
 */
function attackerAfter(kernel: TurnKernel, before: World, world: World, action: PendingAction, info: TurnMoveInfo) {
  const attacker = action.slot;
  const { states, rises } = attackerStates(world);
  reactionHooks.spreadUser(kernel, world, action, info, states);
  if (states.length === 1) {
    const side = JSON.parse(states[0]) as TurnSide;
    // status2 C14: its heal-block stand-in's real item back (kernel.healStandIn of the world before the move).
    world.mons[attacker]!.build = kernel.unfollowed(world.mons[attacker]!.build, kernel.fromSide(world.mons[attacker]!.build, { ...side, hp: 0 }), kernel.healStandIn(before, attacker, true));
  }
  guardHooks.stepRises(kernel, world, attacker, rises);
}

// ---------------- Spread heals (F4 §4.7, SPEC2 §4.5 with C12) ----------------

/** The step's attacker side key carries each outcome's dealt damage (World.spread), so the kernel's step keeps outcomes of different damage apart. */
const DEALT_KEY = "spreadDealt";
/** A factor slot (not a Pokémon) holding the damage the move's hits dealt so far, for Shell Bell's heal: joined with the Pokémon whose HP it depends on. */
const BELL = "shellbell" as DoublesSlotId;

/**
 * The pair's search with each outcome's dealt damage (UsesEnv.report.dealt) in its attacker side (DEALT_KEY), so applyStep
 * keeps the outcomes of each damage apart; every other member is the search's own.
 */
function dealtEntry(entry: SearchEntry): SearchEntry {
  const search = entry.search!;
  const turnStep: UsesSearch["turnStep"] = (...args) => {
    const result: TurnStepResult = search.turnStep(...args);
    if ("failed" in result) return result;
    return {
      ...result,
      outcomes: result.outcomes.map((outcome) => {
        if (outcome.dealt === undefined) throw new Error("doubles-spread.ts: a spread heal's step reported no damage.");
        return { ...outcome, attacker: { ...outcome.attacker, [DEALT_KEY]: outcome.dealt } as TurnSide };
      }),
    };
  };
  const proxy = new Proxy(search, {
    get(target, property) {
      if (property === "turnStep") return turnStep;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...entry, search: proxy };
}

/** The damage one target's step dealt in a child world (its World.spread entry), taken out of the entry. */
function takeDealt(world: World): number {
  const entries = world.spread!;
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].startsWith(guardHooks.SPREAD_RISES) || !entries[index].includes(`"${DEALT_KEY}"`)) continue;
    const side = JSON.parse(entries[index]) as Record<string, unknown>;
    const dealt = side[DEALT_KEY] as number;
    delete side[DEALT_KEY];
    world.spread = [...entries.slice(0, index), JSON.stringify(side), ...entries.slice(index + 1)];
    return dealt;
  }
  throw new Error("doubles-spread.ts: a spread heal's step left no damage.");
}

/** Pinned Showdown battle.modify: a 4096-based modifier, rounded half down. */
function modify(value: number, numerator: number, denominator: number): number {
  const modifier = Math.trunc(numerator * 4096 / denominator);
  return Math.trunc((Math.trunc(value * modifier) + 2048 - 1) / 4096);
}

/** The slots of the factors holding `slots` in `world`. */
function factorSlots(world: World, slots: DoublesSlotId[]): DoublesSlotId[] {
  const out = new Set<DoublesSlotId>();
  for (const slot of slots) for (const each of world.factors[locate(world, slot).factor].slots) out.add(each);
  return [...out];
}

const RANK = (slot: DoublesSlotId) => (slot === BELL ? DOUBLES_SLOTS.length : DOUBLES_SLOTS.indexOf(slot));

/** `slots` in one factor, its slots in a fixed order (the four positions, then BELL), so worlds that differ only in it merge. */
function canonicalJoin(world: World, slots: DoublesSlotId[]) {
  const at = join(world, slots);
  const factor = world.factors[at];
  const order = [...factor.slots].sort((a, b) => RANK(a) - RANK(b));
  if (order.every((slot, index) => slot === factor.slots[index])) return;
  // Perf pass 1b: each new place's digit read at its old index, found once (the same keys, summed in the same order).
  const from = order.map((slot) => factor.slots.indexOf(slot));
  const table = new Map<number, number>();
  for (const [key, mass] of factor.table) {
    let next = 0;
    for (let index = 0; index < from.length; index++) next += digitAt(key, from[index]) * radixPow(index);
    table.set(next, (table.get(next) ?? 0) + mass);
  }
  world.factors = world.factors.map((each, index): Factor => (index === at ? { slots: order, table } : each));
}

/** BELL out of the world's factors (summed out; it is 0 once Shell Bell has healed). */
function dropBell(world: World) {
  const at = world.factors.findIndex((factor) => factor.slots.includes(BELL));
  if (at < 0) return;
  const factor = world.factors[at];
  if (factor.slots.length === 1) { world.factors = world.factors.filter((_, index) => index !== at); return; }
  const keep = factor.slots.filter((slot) => slot !== BELL);
  const from = keep.map((slot) => factor.slots.indexOf(slot));
  const table = new Map<number, number>();
  for (const [key, mass] of factor.table) {
    let next = 0;
    for (let index = 0; index < from.length; index++) next += digitAt(key, from[index]) * radixPow(index);
    table.set(next, (table.get(next) ?? 0) + mass);
  }
  world.factors = [...world.factors.slice(0, at), ...splitFactor({ slots: keep, table }), ...world.factors.slice(at + 1)];
}

/**
 * A draining spread move (Matcha Gotcha, Parabolic Charge), or a spread move from a working Shell Bell holder (F4 §4.7;
 * PS/sim/battle.ts:2091-2186 spreadDamage, PS/sim/battle-actions.ts hitStepMoveHitLoop, AfterMoveSecondarySelf). The hits
 * into Substitutes first (their drain, ceil(taken × drain), comes in TryPrimaryHit, before every other target's damage:
 * doubles-substitute.ts), then per target in hit order its step, reporting the HP it took (dealt: Sturdy, a Sash and Endure
 * already applied, at most its HP), and right after it the drain: round(dealt × drain), at least 1 (battle.heal), into
 * TryHeal — the target's Liquid Ooze deals that raw amount to the user (none through Magic Guard, at full HP too: G8),
 * else Big Root's 5324/4096 on each heal by itself (G2), at most to the maximum, none at full HP or at 0. The user's HP
 * joins each target's factor (C12: the joint (user, targets) is kept; over the entries budget the turn is "Too many cases to
 * follow."). Then the targets' retaliation summed (DamagingHit: Rough Skin, Rocky Helmet, Rowap: G3) and the Update after
 * the hits (its HP Berry, once); a user Liquid Ooze took to 0 faints in the faint batch; then Mind Blown's recoil, Life
 * Orb, and Shell Bell's one heal of trunc(Σ dealt / 8), at least 1 (G4: a Substitute's damage not counted; move.totalDamage),
 * and the Update after the move.
 */
function drainingStep(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, plans: Plan[], standing: DoublesSlotId[],
  { multiple, prior, bell, mindBlown }: { multiple: boolean; prior: number; bell: boolean; mindBlown: boolean }): World[] {
  const attacker = action.slot;
  const move = kernel.runtime.movesById.get(action.moveId!)!;
  const step = kernel.step(action);
  const { maxHP } = kernel.hp[attacker];
  let worlds: World[] = [cloneWorld(w)];
  worlds[0].spread = [];
  if (bell) worlds[0].factors = [...worlds[0].factors, pointFactor(BELL, 0)];
  let retaliation = prior, hit = false, oozed = false;
  // TryPrimaryHit (the Substitutes' hits) before spreadDamage.
  const order = [...plans.filter((plan) => plan.sub && !plan.check.block), ...plans.filter((plan) => !(plan.sub && !plan.check.block))];
  for (const { check, entry, face, sub, locked } of order) {
    const target = check.slot;
    if (check.block) { if (!check.done) worlds = worlds.flatMap((world) => kernel.blockedHit(world, action, info, check)); continue; }
    if (sub) { hit = true; retaliation += sub.cost ?? 0; worlds = worlds.flatMap((world) => sub.apply(world)); continue; }
    if (face) {
      hit = true;
      retaliation += faceNs.faceRetaliation(kernel, w, action, info, target);
      worlds = worlds.flatMap((world) => faceNs.faceHit(kernel, world, action, info, target, face, multiple, true, { retaliation: "caller" }));
      continue;
    }
    if (!entry!.search) {
      for (const world of worlds) if (step) { kernel.hitStats(action, target)!.noDamage += world.mass; kernel.hitFact(action, target, kernel.noDamageFact(entry!.row, move, target), world.mass); }
      continue;
    }
    hit = true;
    retaliation += entry!.search.retaliation();
    const counted = dealtEntry(entry!);
    const drain = info.drain ? (entry!.search.result.move as { drain?: [number, number] }).drain ?? null : null;
    const next: World[] = [];
    for (const world of worlds) {
      // The target's Liquid Ooze as the move hits (its DamagingHit ability changes come after the drains); the user's Big Root.
      const ooze = !!drain && world.mons[target]!.build.abilityId === "liquidooze";
      const userBuild = world.mons[attacker]!.build;
      const bigRoot = userBuild.itemId === "bigroot" && kernel.itemWorks(world, userBuild);
      const guarded = userBuild.abilityId === "magicguard";
      const joined = factorSlots(world, bell ? [attacker, target, BELL] : [attacker, target]);
      for (const child of kernel.applyStep(world, action, target, counted, info, true)) {
        putBack(child.world, target, locked, child.landed);
        const dealt = takeDealt(child.world);
        let result = child.world;
        if (drain && dealt > 0) {
          let amount = Math.round(dealt * drain[0] / drain[1]);
          if (amount && amount <= 1) amount = 1;
          if (ooze) {
            oozed ||= !guarded;
            kernel.hitFact(action, target, `${kernel.abilityName("liquidooze")}: ${kernel.names[attacker]} loses the HP it would drain.`, result.mass);
            if (!guarded) {
              result = mapHP(result, attacker, (hp) => ({ hp: hp > 0 ? Math.max(0, hp - Math.max(1, amount)) : hp, tag: "" }))[0].world;
              const mon = result.mons[attacker]!;
              mon.hurt = true;
              // Damage from something other than a move resets a Berserk or Anger Shell lock (onDamage).
              if (mon.vol.berryLocked) { const { berryLocked: _locked, ...rest } = mon.vol; void _locked; mon.vol = rest; }
            }
          } else if (amount) {
            const heal = bigRoot ? modify(amount, 5324, 4096) : amount;
            result = mapHP(result, attacker, (hp) => ({ hp: hp > 0 && hp < maxHP ? Math.min(maxHP, hp + heal) : hp, tag: "" }))[0].world;
          }
        }
        if (bell && dealt > 0) {
          result = mapHP(result, BELL, (sum) => ({ hp: sum + dealt, tag: "" }))[0].world;
          if (marginalMax(result, BELL) >= RADIX) kernel.notEstimated(REASONS.tooMany);
        }
        canonicalJoin(result, joined);
        next.push(result);
      }
    }
    worlds = kernel.reference ? next.filter((world) => world.mass > 0) : mergeWorlds(next, kernel.mode === "all");
    if (!kernel.reference && (worlds.length > kernel.budget.worlds || entryCount(worlds) > kernel.budget.entries)) kernel.notEstimated(REASONS.tooMany);
  }
  // Mind Blown (S): a target took damage, or every target failed (blocked or no damage).
  const damaged = plans.some((p) => p.entry?.search), failed = plans.every((p) => p.check.block || (p.entry && !p.entry.search));
  const out: World[] = [];
  for (const each of worlds) {
    attackerAfter(kernel, w, each, action, info);
    // A user Liquid Ooze took to 0 HP faints in the faint batch after the hits (no Moxie, retaliation, Life Orb or Shell Bell).
    const parts = oozed ? condition(each, attacker, (hp) => hp > 0) : [{ world: each, meets: true }];
    for (const { world, meets } of parts) {
      if (!meets) {
        kernel.faint(world, attacker);
        dropBell(world);
        out.push(world);
        continue;
      }
      kernel.koBoost(world, attacker, standing.filter((slot) => world.mons[slot]!.fainted).length);
      const build = world.mons[attacker]!.build;
      const guarded = build.abilityId === "magicguard";
      const sheerForce = build.abilityId === "sheerforce" && info.secondaries;
      const first = retaliation && !guarded ? retaliation : 0;
      const end: number[] = [];
      if (mindBlown && !guarded && (damaged || failed)) end.push(Math.max(1, Math.round(kernel.hp[attacker].maxHP / 2)));
      if (hit && build.itemId === "lifeorb" && kernel.itemWorks(world, build) && !guarded && !sheerForce) end.push(Math.max(1, Math.floor(kernel.hp[attacker].baseMaxHP / 10)));
      const heals = bell && hit && build.itemId === "shellbell" && kernel.itemWorks(world, build) && !world.mons[attacker]!.eot.healBlock;
      if (!first && !end.length && !heals && !oozed) { dropBell(world); out.push(world); continue; }
      for (const done of settle(kernel, world, attacker, [{ losses: [first] }, ...(end.length || heals ? [{ losses: end, bell: heals }] : [])], first > 0 || end.length > 0)) {
        dropBell(done);
        out.push(done);
      }
    }
  }
  return info.isMax && hit ? out.flatMap((world) => kernel.maxEffects(world, action, info, plans[0].check.slot)) : out;
}

const marginalMax = (world: World, slot: DoublesSlotId) => Math.max(...marginal(world, slot).keys());

/**
 * The attacker's HP through the Updates after a spread move (doubles-turn.ts afterLoss, with Shell Bell's heal): per group,
 * its losses (none through 0), then Shell Bell's max(1, trunc(Σ dealt / 8)) from BELL (heal: none at 0 or at full HP), then
 * the Update's HP or pinch Berry at its line (once; a foe's Unnerve or As One stops it, not Berry Juice), Cheek Pouch with
 * it. Fainted at 0. `reset`: a loss came from something other than a move (a Berserk or Anger Shell lock ends). One world
 * per outcome (fainted or not, a Berry eaten or not), BELL set to 0.
 */
function settle(kernel: TurnKernel, w: World, slot: DoublesSlotId, groups: { losses: number[]; bell?: boolean }[], reset: boolean): World[] {
  const mon = w.mons[slot]!;
  if (reset && mon.vol.berryLocked) { const { berryLocked: _locked, ...rest } = mon.vol; void _locked; mon.vol = rest; }
  const item = mon.build.itemId;
  const usable = kernel.itemWorks(w, mon.build) && (HEALING_BERRIES.has(item) || !!PINCH_STAT_BERRIES[item] || LANSAT_STARF.has(item)) && item !== "enigmaberry";
  const unnerved = DOUBLES_SLOTS.some((other) => kernel.alive(w, other) && other !== w.ghost && kernel.isFoe(other, slot) && UNNERVES.has(w.mons[other]!.build.abilityId)) && item !== "berryjuice";
  const locked = !!mon.vol.berryLocked && BERSERK_BERRIES.has(item);
  const { maxHP, baseMaxHP } = kernel.hp[slot];
  const berry = usable && !unnerved && !locked ? berryArithmetic(item, { maxHP, baseMaxHP, ability: mon.build.abilityId }, kernel.runtime.profile.generation) : null;
  const bellName = kernel.itemName("shellbell");
  const run = (start: number, sum: number) => {
    let hp = start, ate = false;
    for (const group of groups) {
      if (hp <= 0) break;
      for (const loss of group.losses) hp = Math.max(0, hp - loss);
      if (group.bell && hp > 0 && sum > 0 && hp < maxHP) {
        const healed = Math.min(maxHP, hp + Math.max(1, Math.floor(sum / 8)));
        kernel.noteHeal(slot, bellName, healed - hp);
        hp = healed;
      }
      if (berry && !ate && hp > 0 && hp <= berry.line) { kernel.noteBerry(slot, item, berry, hp); hp = eatBerry(berry, hp); ate = true; }
    }
    return { hp, tag: `${hp <= 0 ? "fainted" : "in"}|${ate ? "ate" : ""}` };
  };
  const hasBell = w.factors.some((factor) => factor.slots.includes(BELL));
  const outcomes = hasBell
    ? mapJoint(w, [slot, BELL], (hp, sum) => { const { hp: after, tag } = run(hp, sum); return { hp: [after, 0] as const, tag }; })
    : mapHP(w, slot, (hp) => run(hp, 0));
  const lost = groups.some((group) => group.losses.some((loss) => loss > 0));
  return outcomes.flatMap(({ world, tag }) => {
    if (lost) world.mons[slot]!.hurt = true;
    if (tag.startsWith("fainted")) kernel.faint(world, slot);
    return tag.endsWith("ate") ? kernel.ateBerry(world, slot, item) : [world];
  });
}
