import { Generations, toID } from "@smogon/calc";
import { GAS_STAND_IN, usesHelpers } from "./calculate";
import { BUSTED_FORMS, REASONS } from "./doubles-actions";
import { allyOf, DOUBLES_SLOTS, foesOf, slotSide, type DoublesSlotId, type DoublesTurnInput } from "./doubles-types";
import { cloneWorld, mapHP, marginal, type MonState, type PendingAction, type Stage, type World } from "./doubles-world";
import type { HitCheck, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import { generation, setEot, setVol, signed, STAGE_NAMES, STATS, type Gate } from "./doubles-use";
import { flingData, flingFailure, flungEffect, flungFact, type FlungEffect } from "./fling";
import { berryArithmetic, BERSERK_BERRIES, HEALING_BERRIES, KLUTZ_IGNORED_ITEMS, PINCH_STAT_BERRIES, stolenEat, UNEATEN_BERRIES } from "./hit-loop";
import { isMaxActive } from "./mechanics";
import { NATURES } from "./model";
import type { BattleBuild, ChampionsMove, CombatStat, MoveContext } from "./types";
import { itemTakeable, type TurnStepOutcome } from "./uses-to-ko";

// The moves-phase guards (status2 SPEC2 §3.5, §4.5; ADDENDUM2 §4.2): Track D's file. Step 0 moved today's guards here
// verbatim; wave 1a models them (pinned Showdown c23d2e94, PS/ = node_modules/.cache/champions/pokemon-showdown-c23d2e94…):
// - Opportunist and Mirror Herb copying a foe's rise: the ledger with amounts (noteRise; the pairwise step's own rises through
//   UsesEnv.report.rises), each copier's sum applied at the action's AfterMove in Speed order (afterMoveCopies);
// - the Berserk / Anger Shell lock in later steps (the held Berry read as Leftovers, sheerForceLock) and its reset by a move
//   reaching the holder (its AfterMoveSecondary: the Berry at the action's Update);
// - the hidden accuracy and evasion stages (the kernel's contextFor and Step 0b's countBoosts scope compute the power);
// - Glaive Rush's ×2 until its holder's next BeforeMove (beforeFirst); Ripen's weakened Berry, consumed by the next hit;
// - an attacker's own Starf Berry in a step (report.starf; the random stat at the action's end);
// - Encore changing a queued move (encoreRewrite); the one-hit KO moves' immunities (ohkoStep); Fling (flingTry, then the
//   thrown item's effect on the target and the item gone at the hit's or the action's Update: flingAfter, afterMoveCopies);
// - the item history's readers (tracksItems) and what the step reports (stepReport).
// doubles-turn.ts, doubles-status.ts, doubles-eot.ts, doubles-items.ts and doubles-spread.ts call these hooks; this file
// imports the kernel's type only and calls applyBoosts through the kernel (no import of doubles-stages.ts, which calls
// noteRise: no cycle).

/**
 * D's marks on a Pokémon during one action, cleared at that action's AfterMove (afterMoveCopies; cloneMon copies them, so the
 * worlds a step splits into keep them): `lockReached`, a move reached a Berserk or Anger Shell holder whose Berry is locked
 * (its AfterMoveSecondary resets the lock); `starfRise`, the attacker ate a Starf Berry in a step (UsesEnv.report.starf) or
 * the target a flung one, +2 (Ripen +4) to a random stat below +6; `flung`, a Fling user past Fling's own Try.
 */
type Marked = MonState & { lockReached?: true; starfRise?: 2 | 4; flung?: Flung };
/**
 * A Fling user past its own Try (flingTry; PS/data/moves.ts:5771 addVolatile('fling')): the item it throws, its target and
 * that target's build before the hit (flingAfter's order checks). The `fling` volatile's onUpdate (:5773-5782) takes the item
 * at the next Update: the hit's (sim/battle-actions.ts:967; flingAfter), else the action's (sim/battle.ts:2861; afterMoveCopies).
 */
type Flung = { item: string; target: DoublesSlotId; before: BattleBuild; hurt: boolean };
const marked = (mon: MonState | undefined) => mon as Marked | undefined;

// ---------------- The ledger and the copies (F4 §3.1, §4.1; SPEC2 §4.5) ----------------

/**
 * While D applies an Opportunist or Mirror Herb copy (afterMoveCopies): that boost()'s effect is Opportunist or Mirror Herb,
 * which no copier adds (PS/data/abilities.ts:3041-3043 opportunist onFoeAfterBoost; PS/data/items.ts:4152-4153 mirrorherb).
 */
let copying = 0;

/**
 * The boost() table AfterBoost reads (after ChangeBoost, the cap and TryBoost; doubles-stages.ts applyBoosts): a rise for a
 * foe's Opportunist or Mirror Herb, a drop for Eject Pack, recorded for the action's eventGuards (doubles-turn.ts) whatever
 * the stages end at. `rose` sums the positive parts by stat of every table that reached the Pokémon in the action. Each
 * living foe copier of `slot` adds the positive parts to its pending copy (MonState.copy, effectState.boosts), unless the
 * boost is a copy itself.
 */
export function noteRise(kernel: TurnKernel, w: World, slot: DoublesSlotId, boost: Partial<Record<Stage, number>>) {
  const rises = Object.values(boost).some((amount) => amount! > 0), drops = Object.values(boost).some((amount) => amount! < 0);
  if (!rises && !drops) return;
  const known = w.boosted?.[slot];
  let rose = known?.rose;
  if (rises) {
    const sum: Partial<Record<Stage, number>> = { ...rose };
    for (const [stat, amount] of Object.entries(boost) as [Stage, number][]) if (amount > 0) sum[stat] = (sum[stat] ?? 0) + amount;
    rose = sum;
  }
  w.boosted = { ...w.boosted, [slot]: { ...known, ...(rose ? { rose } : {}), ...(drops ? { fell: true as const } : {}) } };
  if (rises && !copying) accumulate(kernel, w, slot, boost);
}

/**
 * The step's own rises (UsesEnv.report.rises: the summed positive parts of each boost() table the pairwise step made, after
 * ChangeBoost, the cap and TryBoost; the step itself copies nothing then): each living foe copier of `slot` adds them.
 * Called from flingAfter (the hit's reactions) and, for a spread move's attacker (once per move), from doubles-spread.ts.
 */
export function stepRises(kernel: TurnKernel, w: World, slot: DoublesSlotId, rises: Partial<Record<CombatStat, number>> | undefined) {
  if (!rises || copying || !w.mons[slot]) return;
  if (Object.values(rises).some((amount) => amount! > 0)) accumulate(kernel, w, slot, rises);
}

/**
 * One boost() table's positive parts into the pending copies of `slot`'s living foes holding Opportunist (in effect: a
 * Neutralizing Gas stand-in is not "opportunist") or a working Mirror Herb (PS/data/abilities.ts:3041-3051,
 * PS/data/items.ts:4152-4163: onFoeAfterBoost, an ally's rise is not copied). An exploding user's handlers no longer run
 * (World.ghost). A Pokémon with both (two effect states, two boosts) is not followed.
 */
function accumulate(kernel: TurnKernel, w: World, slot: DoublesSlotId, boost: Partial<Record<Stage, number>>) {
  for (const other of DOUBLES_SLOTS) {
    if (other === slot || !kernel.isFoe(other, slot) || !kernel.alive(w, other) || other === w.ghost) continue;
    const mon = w.mons[other]!;
    const build = mon.build;
    const opportunist = build.abilityId === "opportunist";
    const herb = build.itemId === "mirrorherb" && kernel.itemWorks(w, build);
    if (!opportunist && !herb) continue;
    if (opportunist && herb) kernel.notEstimated(REASONS.copiesRise(`${kernel.abilityName("opportunist")} with ${kernel.itemName("mirrorherb")}`));
    const by = opportunist ? "opportunist" : "mirrorherb";
    if (mon.copy && mon.copy.by !== by) kernel.notEstimated(REASONS.copiesRise(`${kernel.abilityName("opportunist")} with ${kernel.itemName("mirrorherb")}`));
    const stages: Partial<Record<Stage, number>> = { ...mon.copy?.stages };
    for (const [stat, amount] of Object.entries(boost) as [Stage, number][]) if (amount > 0) stages[stat] = (stages[stat] ?? 0) + amount;
    mon.copy = { stages, by };
  }
}

/** Opportunist and Mirror Herb are modelled (afterMoveCopies): eventGuards' copier check acts no more. */
export function copierGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void kernel; void w; void slot;
}

/**
 * The end of turn's copy guard (doubles-eot.ts afterChecks; Track E1 applies the copies at residual 29): a stage of `slot`
 * above its residual-start one, with a living foe's Opportunist or Mirror Herb.
 */
export function copierEndOfTurn(kernel: TurnKernel, w: World, slot: DoublesSlotId, startBoosts: BattleBuild["boosts"]) {
  const mon = w.mons[slot]!;
  if (kernel.alive(w, slot) && STATS.some((stat) => (mon.build.boosts[stat] ?? 0) > (startBoosts[stat] ?? 0))) {
    for (const other of DOUBLES_SLOTS) {
      if (slotSide(other) === slotSide(slot) || !kernel.alive(w, other)) continue;
      const copier = w.mons[other]!.build;
      if (copier.abilityId === "opportunist") kernel.notEstimated(REASONS.copiesRise(kernel.abilityName("opportunist")));
      if (copier.itemId === "mirrorherb" && kernel.itemWorks(w, copier)) kernel.notEstimated(REASONS.copiesRise(kernel.itemName("mirrorherb")));
    }
  }
}

/**
 * The action's end (SPEC2 §4.1 step 7; runMove before eventGuards, and a No move's): D's marks, then the onAnyAfterMove copies.
 * 1. The Berserk / Anger Shell lock a move reached (lockedBerryGuard, flingAfter): its AfterMoveSecondary set
 *    checkedBerserk true (PS/data/abilities.ts:414-444, :143-173), so the action's Update eats the healing Berry at its line;
 *    a Champions Sheer Force hit runs none (PS/sim/battle-actions.ts:811-816) and the lock stays.
 * 2. An attacker's Starf Berry eaten in a step (data/items.ts starfberry onEat: this.sample over the five stats below +6):
 *    one world per stat.
 * 3. Each pending copy (MonState.copy) in its holder's Speed order: Opportunist boosts itself with it (effect Opportunist);
 *    Mirror Herb is used (useItem: the boost in its onUse, then the item gone, lastItem, Unburden) — a held Herb that does
 *    not work (Magic Room, Klutz, Embargo) keeps it pending; a copier whose ability or item is gone has lost it (onEnd).
 * The worlds after it, or null for `w` unchanged.
 */
export function afterMoveCopies(kernel: TurnKernel, w: World, action: PendingAction): World[] | null {
  let todo = false;
  for (const slot of DOUBLES_SLOTS) {
    const mon = marked(w.mons[slot]);
    if (mon && (mon.copy || mon.lockReached || mon.starfRise || mon.flung)) { todo = true; break; }
  }
  return todo ? afterAction(kernel, w, action) : null;
}

function afterAction(kernel: TurnKernel, w: World, action: PendingAction): World[] {
  let worlds = [w];
  for (const slot of DOUBLES_SLOTS) worlds = worlds.flatMap((world) => lockReset(kernel, world, action, slot));
  for (const slot of DOUBLES_SLOTS) worlds = worlds.flatMap((world) => starfRise(kernel, world, slot));
  for (const world of worlds) applyCopies(kernel, world, action);
  // The action's Update (sim/battle.ts:2861): the `fling` volatile of a Fling that hit nothing takes the item (flingEnd).
  for (const world of worlds) for (const slot of DOUBLES_SLOTS) if (marked(world.mons[slot])?.flung) flingEnd(kernel, world, slot, action);
  return worlds;
}

/** A Champions Sheer Force move with secondaries (PS/data/mods/champions/abilities.ts:2-13): no AfterMoveSecondary, so no reset. */
function keepsLock(kernel: TurnKernel, w: World, action: PendingAction): boolean {
  if (!kernel.champions || !action.moveId) return false;
  const user = w.mons[action.slot]?.build;
  if (!user || user.abilityId !== "sheerforce") return false;
  const move = kernel.runtime.movesById.get(action.moveId);
  if (!move || move.category === "Status") return false;
  const info = kernel.moveInfo(w, action.slot, action.moveId, kernel.input.pokemon[action.slot]?.contexts[action.moveId]);
  return info.kind === "move" && !!info.secondaries;
}

function lockReset(kernel: TurnKernel, w: World, action: PendingAction, slot: DoublesSlotId): World[] {
  const mon = marked(w.mons[slot]);
  if (!mon?.lockReached) return [w];
  delete mon.lockReached;
  if (mon.fainted || !mon.vol.berryLocked || keepsLock(kernel, w, action)) return [w];
  // A suppressed Berserk or Anger Shell runs no AfterMoveSecondary: the lock stays (lockActs), and keeps nothing.
  if (lockActs(mon)) {
    const { berryLocked: _locked, ...rest } = mon.vol;
    void _locked;
    mon.vol = rest;
  }
  // The action's Update (sim/battle.ts runAction): the healing Berry at its line, unless a foe's Unnerve or As One stops it.
  return kernel.berryStopped(w, slot) ? [w] : kernel.berryDue(w, slot);
}

function starfRise(kernel: TurnKernel, w: World, slot: DoublesSlotId): World[] {
  const mon = marked(w.mons[slot]);
  if (!mon?.starfRise) return [w];
  const amount = mon.starfRise;
  delete mon.starfRise;
  if (!kernel.alive(w, slot)) return [w];
  const raised = STATS.filter((stat) => (mon.build.boosts[stat] ?? 0) < 6);
  if (!raised.length) return [w];
  const share = w.mass / raised.length;
  const worlds = raised.map((_, index) => (index === 0 ? w : cloneWorld(w, share)));
  w.mass = share;
  raised.forEach((stat, index) => kernel.selfBoost(worlds[index], slot, { [stat]: amount }, null));
  return worlds;
}

/** "Opportunist: Espathra copies +2 Attack, +1 Speed." (F4 §8), or that nothing went higher. */
function copyFact(by: string, name: string, changed: Partial<Record<Stage, number>>): string {
  const parts = (Object.entries(changed) as [Stage, number][]).filter(([, amount]) => amount).map(([stat, amount]) => `${signed(amount)} ${STAGE_NAMES[stat]}`);
  return parts.length ? `${by}: ${name} copies ${parts.join(", ")}.` : `${by}: ${name}'s stats cannot go higher.`;
}

function applyCopies(kernel: TurnKernel, w: World, action: PendingAction) {
  const copiers = DOUBLES_SLOTS.filter((slot) => !!w.mons[slot]?.copy && kernel.alive(w, slot));
  if (!copiers.length) return;
  // onAnyAfterMove by the holders' Speed (sim/battle.ts speedSort; the order matters only to an Eject Pack or Symbiosis, which
  // the turn guards: eventGuards); equal Speeds keep the slots' order.
  if (copiers.length > 1) copiers.sort((a, b) => kernel.speedOf(w, b) - kernel.speedOf(w, a));
  for (const slot of copiers) {
    const mon = w.mons[slot]!;
    const copy = mon.copy!;
    const name = kernel.names[slot];
    if (copy.by === "opportunist") {
      delete mon.copy;
      if (mon.build.abilityId !== "opportunist") continue;
      let changed: Partial<Record<Stage, number>>;
      copying++;
      try { changed = kernel.applyBoosts(w, slot, copy.stages, slot, { effect: "ability" }); } finally { copying--; }
      kernel.stepFact(action, copyFact(kernel.abilityName("opportunist"), name, changed), w.mass);
      continue;
    }
    if (mon.build.itemId !== "mirrorherb") { delete mon.copy; continue; }
    if (!kernel.itemWorks(w, mon.build)) continue;
    delete mon.copy;
    let changed: Partial<Record<Stage, number>>;
    copying++;
    // pokemon.useItem: the Use event's source is the AfterMove event's target (the action's user).
    try { changed = kernel.applyBoosts(w, slot, copy.stages, action.slot === slot ? slot : action.slot, { effect: "item" }); } finally { copying--; }
    mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
    kernel.noteItemUse(w, slot, "mirrorherb");
    kernel.stepFact(action, copyFact(kernel.itemName("mirrorherb"), name, changed), w.mass);
  }
}

/** `slot`'s HP through a deterministic `map` in place (mapHP's single world: no split). */
function shiftHP(w: World, slot: DoublesSlotId, map: (hp: number) => number) {
  const [next] = mapHP(w, slot, (hp) => ({ hp: map(hp), tag: "" }));
  w.factors = next.world.factors;
}

// ---------------- Symbiosis ----------------

/**
 * Symbiosis passing its item to a partner that used its own (data/abilities.ts symbiosis onAllyAfterUseItem; doubles-turn.ts
 * eventGuards): the item `slot` held before the action is gone, not by Trick or Switcheroo (World.itemsMoved: ADDENDUM T11).
 */
export function symbiosisAfterAction(kernel: TurnKernel, w: World, slot: DoublesSlotId, was: { itemId: string }) {
  const mon = w.mons[slot]!;
  const partner = allyOf(slot);
  if (was.itemId && !mon.build.itemId && !mon.fainted && !w.itemsMoved?.includes(slot) && kernel.alive(w, partner) && w.mons[partner]!.build.abilityId === "symbiosis" && w.mons[partner]!.build.itemId) {
    kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("symbiosis")));
  }
}

/** A received item its holder uses this action (doubles-items.ts receive: `used`, its usedThisAction) with a partner's Symbiosis that has an item. */
export function symbiosisReceived(kernel: TurnKernel, w: World, slot: DoublesSlotId, used: () => boolean) {
  const partner = allyOf(slot);
  if (used() && kernel.alive(w, partner) && w.mons[partner]!.build.abilityId === "symbiosis" && w.mons[partner]!.build.itemId) {
    kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("symbiosis")));
  }
}

/** The end of turn's Symbiosis guard (doubles-eot.ts afterChecks): an item held as the residual started is gone and the partner's Symbiosis has one. */
export function symbiosisEndOfTurn(kernel: TurnKernel, w: World, slot: DoublesSlotId, startItem: string | undefined) {
  const mon = w.mons[slot]!;
  const partner = allyOf(slot);
  if (startItem && !mon.build.itemId && kernel.alive(w, slot) && kernel.alive(w, partner) && w.mons[partner]!.build.abilityId === "symbiosis" && w.mons[partner]!.build.itemId) {
    kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("symbiosis")));
  }
}

// ---------------- The Berserk lock (F4 §4.8, Step 1 #2) ----------------

/**
 * The Berserk or Anger Shell lock (MoveVolatiles.berryLocked) acts: it keeps the healing Berry and a working ability's
 * handlers end it. The lock is the ability's state (PS/data/abilities.ts berserk, angershell: effectState.checkedBerserk), and
 * a suppressed ability runs no handler (Neutralizing Gas, Gastro Acid: the build holds GAS_STAND_IN), so there the lock
 * neither keeps the Berry (onTryEatItem) nor ends (onDamage, onAfterMoveSecondary). It stays, as pinned keeps abilityState,
 * and acts again when the ability does (the gas's end).
 */
export function lockActs(mon: MonState): boolean {
  return !!mon.vol.berryLocked && mon.build.abilityId !== GAS_STAND_IN;
}

/**
 * A Berserk or Anger Shell lock (MoveVolatiles.berryLocked: a confusion self-hit, a Champions Sheer Force hit, or carried) on
 * `slot` that a move reaches: in a step (doubles-turn.ts applyStep, before the pair's step) and after a status move's
 * effects (doubles-status.ts hitOne). Its AfterMoveSecondary resets the lock (PS/data/abilities.ts berserk, angershell
 * onAfterMoveSecondary: checkedBerserk true), and the action's Update eats the healing Berry (afterMoveCopies). The mark is
 * taken off a step's worlds in which no hit reached the Pokémon (flingAfter: only its Substitute). During a single-hit step
 * the held Berry reads as Leftovers (sheerForceLock); a multi-hit move's or (outside Champions) a Sheer Force move's
 * onDamage resets the lock at the hit, so its step eats the Berry there as any. A hit at the end of turn (a landing) is not
 * followed yet: not estimated where the locked Berry is due.
 */
export function lockedBerryGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  if (!mon?.vol.berryLocked || mon.fainted) return;
  if (!kernel.inEndOfTurn) { (mon as Marked).lockReached = true; return; }
  if (!lockActs(mon)) return;
  const item = mon.build.itemId;
  if (!BERSERK_BERRIES.has(item) || item === "enigmaberry" || !kernel.itemWorks(w, mon.build) || kernel.berryStopped(w, slot)) return;
  const { line } = berryArithmetic(item, { ...kernel.hp[slot], ability: mon.build.abilityId }, kernel.runtime.profile.generation);
  if (![...marginal(w, slot).keys()].some((hp) => hp > 0 && hp <= line)) return;
  const reason = mon.vol.berryLocked === "sheerforce" ? REASONS.berryLockedSheerForce : REASONS.berryLocked;
  kernel.notEstimated(reason(kernel.abilityName(mon.build.abilityId), kernel.itemName(item)));
}

/**
 * The healing Berry (BERSERK_BERRIES: not Berry Juice, which is used, not eaten) a step reads as Leftovers (searchFor
 * `healBlocked`, as psychicNoiseKeepsBerry), for the caller to put back with MoveVolatiles.berryLocked "sheerforce" where
 * the hit reached the Pokémon; else null.
 * - Champions (status2 Step 1 #2; F4 F2): a Sheer Force hit locks a Berserk or Anger Shell holder's Berry. Champions'
 *   onDamage (PS/data/mods/champions/abilities.ts:2-13) sets checkedBerserk / checkedAngerShell to `!(Move && !multihit)` with
 *   no Sheer Force clause, and a Sheer Force move with secondaries runs no AfterMoveSecondary (PS/sim/battle-actions.ts:811-816).
 * - A lock from before the step (F4 §4.8): a single hit (any but a Sheer Force one outside Champions, whose onDamage
 *   resets the lock) keeps the Berry held at the hit's Update; the move's AfterMoveSecondary then resets the lock and the
 *   action's Update eats it (afterMoveCopies). The Berserk / Anger Shell rise reads the HP before the Berry, as the step's
 *   Anger Shell rule does.
 */
export function sheerForceLock(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: TurnMoveInfo): string | null {
  if (attacker === target || info.effective.multihit) return null;
  const user = w.mons[attacker]?.build, receiver = w.mons[target]!, holder = receiver.build;
  if (!BERSERK_BERRIES.has(holder.itemId) || !kernel.itemWorks(w, holder)) return null;
  const sheerForce = !!user && user.abilityId === "sheerforce" && !!info.secondaries;
  if (kernel.champions && sheerForce && (holder.abilityId === "berserk" || holder.abilityId === "angershell")) return holder.itemId;
  if (lockActs(receiver) && !(sheerForce && !kernel.champions)) return holder.itemId;
  return null;
}

/**
 * Review 2 (R3-2): a hit whose target's HP Berry the step would read as Leftovers (a Berserk or Anger Shell lock, a Heal Block,
 * Psychic Noise's) but whose move takes or eats that Berry before the hit's Update: Bug Bite and Pluck (onHit: takeItem, then
 * the user's Eat) and Incinerate (onHit) into a Berry, Thief and Covet (onAfterHit, before the Update at sim/battle-actions.ts:966)
 * from an itemless user. The lock and Heal Block stop only the holder's own TryEatItem and TryHeal, so the step reads the real
 * item: true. Sticky Hold (unless the move breaks it) keeps the Berry with its holder: false, the stand-in stays. Not estimated:
 * Magician, which takes the item after the Update (the stand-in would be taken instead), and Thief or Covet whose user a Rough
 * Skin or Iron Barbs loss could knock out before AfterHit (the item goes back to its holder, sim/pokemon.ts setItem).
 */
export function berryTakenFirst(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: TurnMoveInfo): boolean {
  if (attacker === target || !w.mons[attacker]) return false;
  const user = w.mons[attacker]!.build, holder = w.mons[target]!.build;
  const item = holder.itemId, id = info.effective.id;
  const what = `${kernel.names[target]}'s ${kernel.itemName(item)}`;
  const sticky = holder.abilityId === "stickyhold" && !kernel.breaks(w, attacker, target, info);
  if (!info.transformed && ["bugbite", "pluck", "incinerate"].includes(id) && item.endsWith("berry")) return !sticky;
  if (!info.transformed && (id === "thief" || id === "covet") && !user.itemId) {
    if (sticky) return false;
    const barbs = (holder.abilityId === "roughskin" || holder.abilityId === "ironbarbs") && info.contact && user.abilityId !== "magicguard";
    if (barbs && [...marginal(w, attacker).keys()].some((hp) => hp <= Math.max(1, Math.floor(kernel.hp[attacker].baseMaxHP / 8)))) {
      kernel.notEstimated(REASONS.combo(kernel.moveName(id), what));
    }
    return true;
  }
  // Sticky Hold keeps the Berry from Magician's takeItem too (data/abilities.ts:4622-4630 stickyhold onTakeItem), so the
  // stand-in holds through the move.
  if (user.abilityId === "magician" && !user.itemId && id !== "fling" && !sticky) kernel.notEstimated(REASONS.combo(kernel.abilityName("magician"), what));
  return false;
}

/**
 * Thief or Covet whose user Gulp Missile can knock out first (data/abilities.ts:1745-1756 gulpmissile onDamagingHit:
 * damage(source.baseMaxhp / 4), with a Rocky Helmet's 1/6 on contact; sim/battle-actions.ts:1119-1125: DamagingHit, then
 * AfterHit only `if (pokemon.hp)`, so no item is taken): the pair's step (uses-to-ko.ts, shared with 1v1) takes the item at
 * AfterHit whatever the user's HP, and K applies Gulp Missile's loss after the step, so where some HP the user can have is at
 * most that loss, the turn is not estimated. Not where the move cannot take the item (Sticky Hold, a user with an item, Magic
 * Guard: no loss).
 */
export function thiefGulpGuard(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: TurnMoveInfo) {
  const id = info.effective.id;
  if (info.transformed || (id !== "thief" && id !== "covet") || attacker === target) return;
  const user = w.mons[attacker]?.build, holder = w.mons[target]?.build;
  if (!user || !holder || user.itemId || user.abilityId === "magicguard" || !holder.itemId) return;
  if (holder.abilityId !== "gulpmissile" || (holder.speciesId !== "cramorantgulping" && holder.speciesId !== "cramorantgorging")) return;
  const base = kernel.hp[attacker].baseMaxHP;
  const helmet = info.contact && holder.itemId === "rockyhelmet" && kernel.itemWorks(w, holder) ? Math.max(1, Math.floor(base / 6)) : 0;
  const loss = Math.max(1, Math.floor(base / 4)) + helmet;
  if ([...marginal(w, attacker).keys()].some((hp) => hp <= loss)) {
    kernel.notEstimated(REASONS.combo(kernel.moveName(id), `${kernel.names[target]}'s ${kernel.abilityName("gulpmissile")}`));
  }
}

/**
 * The holder's own No move (Splash) past its BeforeMove runs AfterMoveSecondary on itself (PS/sim/battle-actions.ts:1005;
 * PS/data/abilities.ts berserk, angershell onAfterMoveSecondary: checked true), so a lock ends and the action's Update eats
 * a healing Berry at its line (status2 Step 1 #2; GA2b); then its AfterMove: the onAnyAfterMove copies (afterMoveCopies; the
 * oracle's No move is Splash). The worlds after it.
 */
export function noMoveUnlock(kernel: TurnKernel, w: World, slot: DoublesSlotId): World[] {
  const mon = w.mons[slot];
  let worlds = [w];
  if (mon && lockActs(mon) && !mon.fainted) {
    const { berryLocked: _locked, ...rest } = mon.vol;
    void _locked;
    mon.vol = rest;
    worlds = kernel.berryDue(w, slot);
  }
  const action = executing?.slot === slot && executing.moveId === null ? executing : null;
  if (!action) return worlds;
  return worlds.flatMap((world) => afterMoveCopies(kernel, world, action) ?? [world]);
}

// ---------------- The hidden stages, Ripen, Glaive Rush ----------------

/**
 * Stored Power and Power Trip (data/moves.ts storedpower, powertrip basePowerCallback: 20 per positive stage of the user)
 * and Punishment (60 plus 20 per positive stage of the target) count accuracy and evasion stages (sim/pokemon.ts
 * positiveBoosts): the kernel's contextFor gives them as MoveContext.hiddenStages (MoveVolatiles.stages, carried.stages from
 * earlier turns) and Step 0b's countBoosts scope adds them, so nothing is guarded any more (F4 §4.4).
 */
export function hiddenStageGuard(kernel: TurnKernel, w: World, attacker: DoublesSlotId | null, target: DoublesSlotId, moveId: string, context: MoveContext | undefined) {
  void kernel; void w; void attacker; void target; void moveId; void context;
}

/**
 * Ripen's mark of an eaten Berry (data/abilities.ts ripen onEatItem: berryWeaken is whether it was a resist Berry): set on
 * its Ripen holder that ate one with Bug Bite or Pluck (doubles-turn.ts stolenFacts); the next damaging hit into it is
 * halved (onSourceModifyDamage, the calculation's takenMods.berryWeaken) and takes the mark off (flingAfter). A multi-hit move
 * into it is not followed (ohkoStep: only its first hit is halved).
 */
export function ripenGuard(kernel: TurnKernel, w: World, holder: DoublesSlotId, weakens: boolean) {
  const mon = w.mons[holder];
  if (!mon || !kernel.alive(w, holder) || mon.build.abilityId !== "ripen") return;
  if (weakens) mon.vol = { ...mon.vol, berryWeaken: true };
  else if (mon.vol.berryWeaken) { const { berryWeaken: _weaken, ...rest } = mon.vol; void _weaken; mon.vol = rest; }
}

/**
 * Glaive Rush (data/moves.ts glaiverush self volatile: onSourceModifyDamage 2x, removed at its holder's next BeforeMove at
 * priority 100): its user's MoveVolatiles.glaiveRush once the move hit something (a Substitute included: selfDrops), which
 * the calculations read as takenMods.glaiveRush (doubles-turn.ts turnMarks) until beforeFirst removes it.
 */
export function glaiveRushAfter(kernel: TurnKernel, w: World, action: PendingAction, ownAny: boolean) {
  void kernel;
  if (action.moveId !== "glaiverush" || !ownAny) return;
  const user = w.mons[action.slot]!;
  if (!user.fainted && !user.vol.glaiveRush) user.vol = { ...user.vol, glaiveRush: true };
}

// ---------------- Encore (F4 §6, SPEC2 §4.5; PS/sim/battle-actions.ts:223-234) ----------------

/** Encore landing on a Pokémon still to act whose queued move differs (doubles-status.ts lastMoveVolatile): its action is rewritten when it acts (encoreRewrite). */
export function encoreGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, last: string) {
  void kernel; void w; void slot; void last;
}

/** The action execute is running (encoreRewrite records it): a No move's AfterMove (noMoveUnlock) needs it for its facts. */
let executing: PendingAction | null = null;

/** Target types whose use has no target Pokémon to pick (getRandomTarget gives the user: PS/sim/battle.ts getRandomTarget). */
const NO_TARGET_PICK = new Set(["self", "all", "allySide", "allyTeam", "adjacentAllyOrSelf", "foeSide", "allAdjacent", "allAdjacentFoes", "randomNormal", "scripted"]);
/** Target types whose priority as used no other Pokémon's handler reads (Quick Guard, Psychic Terrain, the priority shields, Prankster's Dark immunity need a target Pokémon). */
const SELF_OR_FIELD = new Set(["self", "all", "allySide", "allyTeam", "foeSide"]);
/** The target-"all" moves the priority shields read (data/abilities.ts armortail onFoeTryMove targetAllExceptions). */
export const SHIELD_READ_FIELD_MOVES: ReadonlySet<string> = new Set(["perishsong", "flowershield", "rototiller"]);

/**
 * An Encore that changes the queued move (PS/sim/battle-actions.ts:223-234 runMove: OverrideAction; PS/data/moves.ts
 * encore onOverrideAction): the action becomes the encored move with the queued move's priority (baseMove.priority = priority)
 * and Prankster flag, aimed by getRandomTarget (a single-target move: a random living foe, 1/2 each with two; the ally for
 * an ally move; none for a move that picks no target). No change for a Z-Move, a Max Move or Struggle. The rewritten actions
 * with their shares of `w`'s mass (the worlds are `w` itself or clones), or null for the action unchanged. The step reads
 * the encored move's own priority and Prankster flag; not followed (REASONS.encoreChange) where that differs from the queued
 * move's and something reads it (review 2 R3-6): a priority on the other side of 0.1 with a reader in play (encorePriorityRead;
 * not in generation 7, whose frozen priority the step reads), a Prankster user's flag with a Dark-type foe in play (outside
 * Champions), a Champions priority difference (its Encore moves the queued action as it starts: PS/data/mods/champions/
 * moves.ts encore onStart), or an encored Z-Move context. Perish Song, Flower Shield and Rototiller carry the queued priority
 * (PendingAction.encoredPriority), which the shields read for them (review 2, round 2).
 */
export function encoreRewrites(kernel: TurnKernel, w: World, action: PendingAction): { world: World; action: PendingAction }[] | null {
  const mon = w.mons[action.slot];
  const encored = mon?.vol.encore;
  if (!mon || !encored || action.moveId === encored || action.moveId === "struggle" || action.external) return null;
  const entry = kernel.input.pokemon[action.slot]!;
  if (action.moveId && entry.contexts[action.moveId]?.useZ) return null;
  if (isMaxActive(mon.build)) return null;
  const move = kernel.runtime.movesById.get(encored);
  if (!move || entry.contexts[encored]?.useZ) kernel.notEstimated(REASONS.encoreChange(kernel.names[action.slot]));
  const before = action.frozen ? action.frozen.priority - action.fractional : kernel.priorityOf(w, action);
  // The three target-"all" moves the priority shields read (data/abilities.ts:216-227 armortail, :864 dazzling, :3716
  // queenlymajesty: targetAllExceptions) keep the queued priority (generation 7's frozen one already is; Champions' Encore
  // moves the queued action to the encored move's own priority as it starts).
  const kept = SHIELD_READ_FIELD_MOVES.has(encored) && !action.frozen && !kernel.champions;
  const rewritten: PendingAction = { ...action, moveId: encored, ...(kept ? { encoredPriority: before } : {}) };
  const after = kernel.priorityOf(w, rewritten);
  const pick = !NO_TARGET_PICK.has(move!.target);
  // The priority as used reaches no one else for any other move on its user, its side or the field.
  if (!SELF_OR_FIELD.has(move!.target)) {
    // Generation 7's frozen priority is the queued one, which the step reads (damagingMove, the status pipeline): exact there.
    const crosses = !action.frozen && (before > 0.1) !== (after > 0.1) && encorePriorityRead(kernel, w, action.slot);
    // Pinned keeps the queued move's pranksterBoosted; the step gives a status move its user's Prankster and an attack none.
    const queued = action.moveId ? kernel.runtime.movesById.get(action.moveId) : undefined;
    const prankster = !kernel.champions && generation(kernel) >= 7 && mon.build.abilityId === "prankster"
      && (queued?.category === "Status") !== (move!.category === "Status")
      && foesOf(action.slot).some((foe) => kernel.alive(w, foe) && kernel.typesIn(w, foe).includes("Dark"));
    if (crosses || prankster || (kernel.champions && before !== after)) kernel.notEstimated(REASONS.encoreChange(kernel.names[action.slot]));
  }
  kernel.stepFact(action, `Encore: ${kernel.names[action.slot]} uses ${move!.name}.`, w.mass);
  // getRandomTarget gives the user itself (null: the user for adjacentAllyOrSelf); a spread or side move reads no target.
  if (!pick) return [{ world: w, action: { ...rewritten, target: null } }];
  if (move!.target === "adjacentAlly") {
    const ally = allyOf(action.slot);
    return [{ world: w, action: { ...rewritten, target: kernel.alive(w, ally) ? ally : null } }];
  }
  // A single-target move: a random living foe (side.randomFoe), else the foe at the first position.
  const foes = foesOf(action.slot).filter((slot) => kernel.alive(w, slot));
  if (!foes.length) return [{ world: w, action: { ...rewritten, target: foesOf(action.slot)[0] } }];
  if (foes.length === 1) return [{ world: w, action: { ...rewritten, target: foes[0] } }];
  const share = w.mass / foes.length;
  const out = foes.map((foe, index) => ({ world: index === 0 ? w : cloneWorld(w, share), action: { ...rewritten, target: foe } }));
  w.mass = share;
  return out;
}

/**
 * Review 2 (R3-6): a reader in play of the priority an encored move is used with (pinned runMove keeps the queued move's,
 * PS/sim/battle-actions.ts:225-233; each reads only whether it is above 0.1): Quick Guard on a side (PS/data/moves.ts
 * quickguard onTryHit), Psychic Terrain (psychicterrain onTryHit), or an Armor Tail, Dazzling or Queenly Majesty holder in
 * play (PS/data/abilities.ts onFoeTryMove).
 */
function encorePriorityRead(kernel: TurnKernel, w: World, user: DoublesSlotId): boolean {
  if (w.sides.own.quickGuard || w.sides.opponent.quickGuard || w.field.terrain === "Psychic") return true;
  return DOUBLES_SLOTS.some((slot) => slot !== user && kernel.alive(w, slot) && PRIORITY_SHIELDS.has(w.mons[slot]!.build.abilityId));
}
const PRIORITY_SHIELDS = new Set(["armortail", "dazzling", "queenlymajesty"]);

/**
 * The action execute runs (doubles-turn.ts execute, before BeforeMove): an Encore that changes its move (encoreRewrites). One
 * action only: an encored single-target move with two living foes to pick from is not followed here (REASONS.encoreChange)
 * until the kernel takes encoreRewrites' worlds.
 */
export function encoreRewrite(kernel: TurnKernel, w: World, action: PendingAction): PendingAction {
  executing = action;
  if (!w.mons[action.slot]?.vol.encore) return action;
  const mass = w.mass;
  const rewrites = encoreRewrites(kernel, w, action);
  if (!rewrites) return action;
  if (rewrites.length > 1) { w.mass = mass; kernel.notEstimated(REASONS.encoreChange(kernel.names[action.slot])); }
  executing = rewrites[0].action;
  return rewrites[0].action;
}

// ---------------- D's other hooks ----------------

/**
 * BeforeMove priority 100 (C5; PS/data/moves.ts glaiverush condition onBeforeMove): Glaive Rush ends at its holder's next
 * BeforeMove, No move included, before sleep, freeze and flinch. The world goes on (null), the volatile gone.
 */
export function beforeFirst(kernel: TurnKernel, w: World, action: PendingAction): Gate | null {
  void kernel;
  const mon = w.mons[action.slot];
  if (mon?.vol.glaiveRush) { const { glaiveRush: _rush, ...rest } = mon.vol; void _rush; mon.vol = rest; }
  return null;
}

/** pinned Showdown's type chart factor of `attacking` into `defending` (PS/data/typechart.ts). */
function factorOf(kernel: TurnKernel, attacking: string, defending: string): number {
  const chart = Generations.get(generation(kernel) as never).types.get(toID(attacking) as never);
  const factor = (chart?.effectiveness as Record<string, number> | undefined)?.[defending];
  return factor ?? 1;
}

/** The -ate abilities' types (data/abilities.ts aerilate and its kin onModifyType: a Normal move's type). */
const ATE_TYPES: Readonly<Record<string, string>> = { aerilate: "Flying", pixilate: "Fairy", refrigerate: "Ice", galvanize: "Electric", dragonize: "Dragon" };

/** A one-hit KO move's type as used (Normalize from generation 7; an -ate ability on a Normal one): none of them is sound. */
function ohkoType(kernel: TurnKernel, user: BattleBuild, move: ChampionsMove): string {
  if (user.abilityId === "normalize" && generation(kernel) >= 7) return "Normal";
  return ATE_TYPES[user.abilityId] && move.type === "Normal" ? ATE_TYPES[user.abilityId] : move.type;
}

/**
 * A one-hit KO move's immunities (F4 §4.6; PS/sim/battle-actions.ts trySpreadMoveHit, after hitChecks' protection and
 * absorbers), in Showdown's order: TryHit — Sturdy (PS/data/abilities.ts:4673-4679) and Wonder Guard (not super effective, or
 * immune: :5553-5566), both breakable; the type immunity (runImmunity by the used type: Ground needs a grounded target
 * (Levitate broken by the user's Mold Breaker, a Flying type grounded by Ring Target); a Ghost type is hit by Normal with
 * Scrappy, Mind's Eye or Foresight; Ring Target negates any); then the accuracy step's [ohko] immunities (PS/sim/battle-
 * actions.ts:696-708: a Dynamaxed target, a higher level, Sheer Cold into an Ice type from generation 7). Facts:
 * "{Ability}: {Name} is immune." and "{Name} is immune to {Move}.". The world function for an immune target (no damage), or
 * null for the calculation's row. Also the pre-step guard of a multi-hit move into Ripen's weakened Berry (only its first
 * hit is halved: REASONS.notIn2v2("Ripen")).
 */
export function ohkoStep(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck): ((world: World) => World[]) | null {
  const target = check.slot;
  const receiver = w.mons[target];
  if (receiver?.vol.berryWeaken && info.effective.multihit) kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("ripen")));
  if (!info.effective.ohko || info.isZ || info.isMax || !receiver) return null;
  const attacker = action.slot;
  const user = w.mons[attacker]!.build, holder = receiver.build;
  const move = info.effective;
  const name = kernel.names[target];
  const immune = (text: string) => (world: World) => {
    const stats = kernel.hitStats(action, target);
    if (stats) stats.noDamage += world.mass;
    kernel.hitFact(action, target, text, world.mass);
    return [world];
  };
  const broken = kernel.breaks(w, attacker, target, info);
  const type = ohkoType(kernel, user, move);
  const types = kernel.typesIn(w, target);
  const ringTarget = holder.itemId === "ringtarget" && kernel.itemWorks(w, holder);
  const revealed = receiver.vol.revealed === "foresight" || user.abilityId === "scrappy" || user.abilityId === "mindseye";
  const negated = (defending: string) => ringTarget || (defending === "Ghost" && (type === "Normal" || type === "Fighting") && revealed);
  let typeImmune: boolean;
  if (type === "Ground") {
    const levitates = (holder.abilityId === "levitate" || holder.abilityId === "eelevate") && !broken;
    const flying = types.includes("Flying") && !ringTarget;
    const pinned = !!w.field.gravity || !!receiver.eot.ingrain || !!receiver.eot.smackedDown || (holder.itemId === "ironball" && kernel.itemWorks(w, holder));
    typeImmune = !pinned && (flying || levitates || !!receiver.eot.magnetRise || !!receiver.eot.telekinesis || (holder.itemId === "airballoon" && kernel.itemWorks(w, holder)));
  } else typeImmune = types.some((defending) => factorOf(kernel, type, defending) === 0 && !negated(defending));
  if (holder.abilityId === "sturdy" && !broken) return immune(`${kernel.abilityName("sturdy")}: ${name} is immune.`);
  if (holder.abilityId === "wonderguard" && !broken) {
    const effectiveness = types.reduce((product, defending) => product * (negated(defending) && factorOf(kernel, type, defending) === 0 ? 1 : factorOf(kernel, type, defending)), 1);
    if (typeImmune || effectiveness <= 1) return immune(`${kernel.abilityName("wonderguard")}: ${name} is immune.`);
  }
  if (typeImmune) return immune(`${name} is immune to ${move.name}.`);
  const level = (build: BattleBuild) => (build.game === "champions" ? 50 : build.native.level ?? 50);
  const iceProof = move.id === "sheercold" && generation(kernel) >= 7 && types.includes("Ice");
  if (isMaxActive(holder) || level(user) < level(holder) || iceProof) return immune(`${name} is immune to ${move.name}.`);
  return null;
}

/**
 * Review 2 (R3-4): Parental Bond with a one-hit KO move (PS/data/abilities.ts parentalbond onPrepareHit has no ohko exclusion;
 * PS/sim/battle-actions.ts:1606 each hit deals target.maxhp): its second hit lands where the first leaves the target in (a
 * Substitute, a Focus Sash or Focus Band, an intact Disguise or Ice Face, Endure). The calculation's row has one hit: not
 * followed there (only USUM's Mega Kangaskhan has both, with Fissure). A target the first hit knocks out, or one the move
 * does not affect (ohkoStep's immunities), is exact with the one hit. Called before the Substitute's path (doubles-turn.ts
 * singleStep).
 */
export function parentalOhkoGuard(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId) {
  if (!info.effective.ohko || info.isZ || info.isMax || w.mons[action.slot]?.build.abilityId !== "parentalbond") return;
  const receiver = w.mons[target];
  if (!receiver || receiver.fainted || ohkoStep(kernel, w, action, info, { slot: target, block: null })) return;
  const holder = receiver.build;
  // Focus Sash saves only from full HP (data/items.ts:2265-2276 focussash onDamage: target.hp === target.maxhp); Focus Band at any.
  const full = () => [...marginal(w, target).keys()].some((hp) => hp === kernel.hp[target].maxHP);
  const item = (holder.itemId === "focusband" || (holder.itemId === "focussash" && full())) && kernel.itemWorks(w, holder);
  const face = !!BUSTED_FORMS[holder.speciesId] && (holder.abilityId === "disguise" || holder.abilityId === "iceface");
  if (receiver.vol.substitute || receiver.vol.endure || item || face) kernel.notEstimated(REASONS.combo(info.effective.name, kernel.abilityName("parentalbond")));
}

/**
 * Fling's own Try (F4 §4.5; PS/data/moves.ts:5743-5771 onPrepareHit, after TryMove, before Protean): fling.ts flingFailure in
 * pinned Showdown's order (ignoringItem(true): Embargo, Magic Room, then Klutz from generation 5; no item; the item's TakeItem
 * or no fling data), named as the turn names it; not its Z-Move or Max Move. A Fling that goes on marks its user (Flung): the
 * `fling` volatile takes the item at the next Update (flingAfter, flingEnd); the pair's step leaves the thrown item out after
 * the hit (uses-to-ko.ts afterMove: no Life Orb recoil, no Shell Bell heal, no HP Berry of it: status2 integration 1b, D's ask 2),
 * as doubles-faces.ts does after a face's hit.
 */
export function flingTry(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, info: TurnMoveInfo): string | null {
  if (move.id !== "fling" || info.transformed || info.isZ || info.isMax) return null;
  const mon = w.mons[action.slot]!;
  const user = mon.build;
  const fails = flingFailure({
    itemId: user.itemId, speciesId: user.transformedFrom?.speciesId ?? user.speciesId, name: kernel.names[action.slot], klutz: user.abilityId === "klutz", embargo: !!user.itemSuppressed,
  }, !!w.field.magicRoom, kernel.runtime, usesHelpers(kernel.runtime).paradox);
  if (fails) return fails;
  const receiver = w.mons[target];
  (mon as Marked).flung = { item: user.itemId, target, before: receiver?.build ?? user, hurt: mon.hurt };
  return null;
}

/**
 * The hit's reactions D follows (doubles-turn.ts afterHit, last; each child world of a pair's step, with its outcome):
 * - a Berserk / Anger Shell lock mark (lockedBerryGuard) comes off where no hit reached the Pokémon (only its Substitute);
 * - Ripen's weakened Berry is used up by the hit (its damage calculation ran: onSourceModifyDamage), a Substitute's included;
 * - the attacker's Starf Berry eaten in the step (report.starf): its random stat at the action's end (afterMoveCopies);
 * - the step's rises (report.rises) into the foes' pending copies; a spread move's attacker's once, by doubles-spread.ts
 *   (its states, World.spread);
 * - Fling's hit (flingHit): the thrown item's effect on the target, then the item gone at the hit's Update.
 */
export function flingAfter(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  const receiver = marked(w.mons[target]);
  if (receiver?.lockReached && outcome.landed === 0) delete receiver.lockReached;
  if (receiver?.vol.berryWeaken && outcome.landed + outcome.subHits > 0) { const { berryWeaken: _weaken, ...rest } = receiver.vol; void _weaken; receiver.vol = rest; }
  const user = marked(w.mons[action.slot]);
  if (outcome.starf === "att" && user && !user.fainted) user.starfRise = user.build.abilityId === "ripen" ? 4 : 2;
  if (outcome.rises) {
    if (outcome.rises.def) stepRises(kernel, w, target, outcome.rises.def);
    if (outcome.rises.att) {
      if (w.spread) w.spread = [...w.spread, `${SPREAD_RISES}${JSON.stringify(outcome.rises.att)}`];
      else stepRises(kernel, w, action.slot, outcome.rises.att);
    }
  }
  const flung = user?.flung;
  if (flung && flung.target === target) flingHit(kernel, w, action, target, outcome, info, flung);
}

// ---------------- Fling's hit (F4 §4.5 2v2; guards.md §4.5) ----------------

/**
 * Fling's hit (PS/sim/battle-actions.ts spreadMoveHit, then hitStepMoveHitLoop's Update at :967): the item stays held through
 * the damage, which the pair's step calculated with it; the thrown item's effect on a target the hit reached and left in
 * (move.onHit, or a certain secondary: flungOn); then the hit's Update, where the `fling` volatile takes the item (flingEnd),
 * so the user's AfterMoveSecondarySelf finds none (the step left it out: uses-to-ko.ts afterMove). The step must still leave
 * the user its item (an item it used itself in the step, a Berry after a Jaboca Berry: not followed).
 */
function flingHit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo, flung: Flung) {
  const attacker = action.slot;
  const user = w.mons[attacker]!;
  const name = kernel.moveName("fling");
  if (user.build.itemId !== flung.item) kernel.notEstimated(REASONS.combo(name, kernel.itemName(flung.item)));
  const receiver = w.mons[target];
  const data = flingData(kernel.runtime, flung.item);
  if (data && outcome.landed > 0 && receiver && !receiver.fainted && target !== attacker) flungOn(kernel, w, action, target, info, flung, flungEffect(data));
  flingEnd(kernel, w, attacker, action);
}

/**
 * The `fling` volatile's onUpdate (PS/data/moves.ts:5774-5782): the item gone, lastItem and usedItemThisTurn (with item
 * history; a Cud Chew user's flung Berry counts as eaten: :5751-5753), AfterUseItem (Unburden; a partner's Symbiosis:
 * symbiosisPass). A Mirror Herb the user used before the action's Update (its copy at AfterMove) is not followed.
 */
function flingEnd(kernel: TurnKernel, w: World, slot: DoublesSlotId, action: PendingAction) {
  const mon = marked(w.mons[slot])!;
  const flung = mon.flung!;
  delete mon.flung;
  if (mon.build.itemId !== flung.item) kernel.notEstimated(REASONS.combo(kernel.moveName("fling"), kernel.itemName(flung.item)));
  mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  kernel.noteItemUse(w, slot, flung.item);
  symbiosisPass(kernel, w, action, slot);
}

/** The species takeItem's handlers read (data/items.ts onTakeItem: baseSpecies; a transformed Pokémon keeps its own). */
const takeSpecies = (build: BattleBuild) => build.transformedFrom?.speciesId ?? build.speciesId;

/**
 * Symbiosis after a Fling took its user's item (status2 integration 1b; data/abilities.ts symbiosis onAllyAfterUseItem, at the
 * `fling` volatile's AfterUseItem; guards.md §6 [E6], G4-FLG-09): the living partner's Symbiosis passes its own item to `slot`
 * at once: takeItem on the partner (no item history: no lastItem, no usedItemThisTurn), its item's TakeItem toward `slot` (an
 * item that cannot move stays, uses-to-ko.ts itemTakeable as Trick reads it), then setItem on `slot`, with the step fact.
 * `slot`'s Unburden keeps its volatile but doubles its Speed only while it holds nothing (abilityActive false while it holds the
 * item); both slots are World.itemsMoved (no Symbiosis guard reads the move). The passed item acts no sooner than the turn's
 * next Update unless it does at once or after Fling's hit, which the turn does not follow here and keeps narrow
 * (REASONS.combo("Fling", "Symbiosis")): a Berry its holder eats now (a due HP or pinch Berry, a curing one), a White Herb
 * with a lowered stage, a Mental Herb with a state it ends, a Terrain Seed in its terrain, Room Service under Trick Room,
 * Booster Energy for Protosynthesis or Quark Drive, and Life Orb or Shell Bell (their AfterMoveSecondarySelf after the hit).
 */
function symbiosisPass(kernel: TurnKernel, w: World, action: PendingAction, slot: DoublesSlotId) {
  const partner = allyOf(slot);
  const giver = w.mons[partner], mon = w.mons[slot]!;
  if (!giver || mon.fainted || !kernel.alive(w, partner) || giver.build.abilityId !== "symbiosis" || !giver.build.itemId) return;
  const item = giver.build.itemId;
  if (!itemTakeable(kernel.runtime, usesHelpers(kernel.runtime).paradox, item, takeSpecies(giver.build), takeSpecies(mon.build), true)) return;
  const received: BattleBuild = { ...mon.build, itemId: item, ...(mon.build.abilityId === "unburden" ? { abilityActive: false } : {}) };
  if (kernel.itemWorks(w, received)) {
    const narrow = () => kernel.notEstimated(REASONS.combo(kernel.moveName("fling"), kernel.abilityName("symbiosis")));
    const vol = mon.vol as typeof mon.vol & { encore?: unknown };
    const lowered = STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < 0) || Object.values(mon.vol.stages ?? {}).some((stage) => (stage ?? 0) < 0);
    const seeds: Record<string, string> = { electricseed: "Electric", grassyseed: "Grassy", mistyseed: "Misty", psychicseed: "Psychic" };
    if (item === "lifeorb" || item === "shellbell" || (item === "whiteherb" && lowered)) narrow();
    if (item === "mentalherb" && (vol.taunt || vol.disabled || vol.encore || mon.eot.healBlock || vol.attract)) narrow();
    if ((seeds[item] && seeds[item] === w.field.terrain) || (item === "roomservice" && w.field.trickRoom)) narrow();
    if (item === "boosterenergy" && (received.abilityId === "protosynthesis" || received.abilityId === "quarkdrive")) narrow();
    if ((item === "persimberry" || item === "lumberry") && mon.vol.confusion) narrow();
    if (item.endsWith("berry")) {
      const probe = cloneWorld(w);
      probe.mons[slot]!.build = received;
      if (kernel.berryDue(probe, slot).some((each) => each.mons[slot]!.build.itemId !== item)) narrow();
    }
  }
  giver.build = { ...giver.build, itemId: "" };
  mon.build = received;
  w.itemsMoved = [...new Set([...(w.itemsMoved ?? []), slot, partner])];
  kernel.stepFact(action, `${kernel.abilityName("symbiosis")}: ${kernel.names[partner]} passes ${kernel.names[slot]} its ${kernel.itemName(item)}.`, w.mass);
}

/** The status-preventing abilities a Mold Breaker user ignores (fling.ts BREAKABLE's), which the kernel's canStatus reads unbroken. */
const BROKEN_STATUS_GUARDS = new Set(["waterveil", "waterbubble", "thermalexchange", "immunity", "pastelveil", "limber", "flowerveil", "purifyingsalt", "leafguard", "sweetveil"]);
/** The items a target's Update eats at an HP line (the HP Berries, Berry Juice, the pinch Berries; Lansat and Starf come after flingAfter: applyStep). */
const UPDATE_LINE_ITEMS = new Set([...[...HEALING_BERRIES].filter((item) => item !== "enigmaberry"), ...Object.keys(PINCH_STAT_BERRIES)]);
/** The conditions Mental Herb's fling effect ends together (PS/data/items.ts mentalherb fling.effect: attract, taunt, encore, torment, disable, healblock). */
const MENTAL_VOLATILES = ["attract", "taunt", "encore", "disabled"] as const;

/**
 * The thrown item's effect on a target the hit reached (not its Substitute) and left in (guards.md §4.5; fling.ts flungEffect),
 * with fling.ts flungFact's facts:
 * - a Berry: the target eats it (flungBerry);
 * - a status (Flame Orb, Toxic Orb, Poison Barb, Light Ball) as a certain secondary added after Sheer Force's ModifyMove:
 *   Shield Dust and Covert Cloak stop it, Sheer Force does not; then the kernel's giveStatus (Synchronize, a curing Berry);
 * - flinch (King's Rock, Razor Fang) on a target with an action left: Shield Dust, Inner Focus, Covert Cloak, Dynamax and a
 *   focusing Focus Punch stop it;
 * - White Herb: the lowered stages to 0, accuracy and evasion too (setBoost: no boost event);
 * - Mental Herb: Taunt, Encore, Disable, Heal Block and attraction end, when one of them stands.
 */
function flungOn(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo, flung: Flung, effect: FlungEffect) {
  const attacker = action.slot;
  const mon = w.mons[target]!;
  const label = kernel.itemName(flung.item), name = kernel.names[target];
  const fact = () => { const text = flungFact(effect, label, name); if (text) kernel.hitFact(action, target, text, w.mass); };
  const broken = kernel.breaks(w, attacker, target, info);
  const shielded = (mon.build.abilityId === "shielddust" && !broken) || (mon.build.itemId === "covertcloak" && kernel.itemWorks(w, mon.build));
  if (effect.kind === "berry") {
    fact();
    flungBerry(kernel, w, action, target, flung, broken, (text) => kernel.hitFact(action, target, text, w.mass));
    return;
  }
  if (effect.kind === "status") {
    if (shielded) return;
    const holders = [target, allyOf(target)].filter((slot) => kernel.alive(w, slot));
    if (broken && holders.some((slot) => BROKEN_STATUS_GUARDS.has(w.mons[slot]!.build.abilityId))) kernel.notEstimated(REASONS.combo(kernel.moveName("fling"), kernel.abilityName(w.mons[attacker]!.build.abilityId)));
    const was = mon.build.status;
    kernel.giveStatus(w, target, effect.status, attacker);
    if (!was && w.mons[target]!.build.status === effect.status) fact();
    return;
  }
  if (effect.kind === "flinch") {
    const queued = w.remaining.find((entry) => entry.slot === target);
    if (!queued || shielded || (mon.build.abilityId === "innerfocus" && !broken) || isMaxActive(mon.build) || kernel.focuses(w, target, queued.moveId)) return;
    mon.flinched = kernel.moveName("fling");
    fact();
    return;
  }
  if (effect.kind === "whiteherb") {
    const lowered = STATS.filter((stat) => (mon.build.boosts[stat] ?? 0) < 0);
    const hidden = (["accuracy", "evasion"] as const).filter((stat) => (mon.vol.stages?.[stat] ?? 0) < 0);
    if (!lowered.length && !hidden.length) return;
    if (lowered.length) mon.build = { ...mon.build, boosts: { ...mon.build.boosts, ...Object.fromEntries(lowered.map((stat) => [stat, 0])) } };
    if (hidden.length) setVol(w, target, { stages: { ...mon.vol.stages, ...Object.fromEntries(hidden.map((stat) => [stat, 0])) } });
    fact();
    return;
  }
  if (effect.kind === "mentalherb") {
    if (!MENTAL_VOLATILES.some((key) => mon.vol[key] !== undefined) && !mon.eot.healBlock) return;
    setVol(w, target, { attract: undefined, taunt: undefined, encore: undefined, disabled: undefined });
    setEot(w, target, { healBlock: undefined, healBlockLeft: undefined, tauntLeft: undefined, encoreLeft: undefined, disableLeft: undefined });
    fact();
  }
}

/**
 * A flung Berry the target eats (PS/data/moves.ts:5754-5760: singleEvent Eat, then EatItem; no TryEatItem, so Unnerve does
 * not stop it; a target ignoring its own item eats with no effect but Cheek Pouch's: hit-loop.ts stolenEat): its heal (none
 * under Heal Block), Cheek Pouch's, each capped at the maximum; a pinch Berry's rise through boost() (the source the user:
 * Opportunist copies it); its cures (Lum and Persim confusion too); a Figy-family Berry's confusion; Lansat's focusenergy;
 * Starf's random rise at the action's end (the starfRise mark); Ripen's mark; Cud Chew's Berry (counter 2). The target's
 * lastItem is not set (it did not hold it). Its heal comes in onHit, before the hit's Update, which the step already ran: a
 * target's own Berry at an HP line that the step ate, or a Berserk or Anger Shell rise the heal would have stopped, is not
 * followed. A flung Custap Berry has no effect (PS/data/items.ts custapberry `onEat() { }`: the eater's queued action keeps its
 * place, FractionalPriority being read only as an action is queued, sim/battle-queue.ts). `fact` writes the
 * effects as doubles-items.ts forceEat words them ("Liechi Berry: +1 Attack.", "Its burn is cured.", "Figy Berry: it becomes
 * confused."); the heals go to the heals list.
 */
function flungBerry(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, flung: Flung, broken: boolean, fact: (text: string) => void) {
  const attacker = action.slot;
  const mon = w.mons[target]!;
  const build = mon.build, before = flung.before;
  const item = flung.item, label = kernel.itemName(item);
  const ignoresItem = !!build.itemSuppressed || (build.abilityId === "klutz" && !KLUTZ_IGNORED_ITEMS.has(build.itemId));
  const eat = stolenEat(item, { baseMaxHP: kernel.hp[target].baseMaxHP, ability: build.abilityId, ignoresItem }, kernel.runtime.profile.generation);
  const blocked = !!mon.eot.healBlock;
  const heal = blocked ? 0 : eat.heal, pouch = blocked ? 0 : eat.pouch;
  const maxHP = kernel.hp[target].maxHP;
  if (heal || pouch) {
    const reason = REASONS.combo(kernel.moveName("fling"), label);
    if (UPDATE_LINE_ITEMS.has(before.itemId) && build.itemId !== before.itemId) kernel.notEstimated(reason);
    const rose = STATS.some((stat) => (build.boosts[stat] ?? 0) !== (before.boosts[stat] ?? 0));
    if (rose && (build.abilityId === "berserk" || build.abilityId === "angershell") && [...marginal(w, target).keys()].some((hp) => hp > 0 && (hp + heal + pouch) * 2 > maxHP)) kernel.notEstimated(reason);
    shiftHP(w, target, (hp) => {
      if (hp <= 0) return hp;
      let next = hp;
      if (heal) { const to = Math.min(maxHP, next + heal); kernel.noteHeal(target, label, to - next); next = to; }
      if (pouch) { const to = Math.min(maxHP, next + pouch); kernel.noteHeal(target, kernel.abilityName("cheekpouch"), to - next); next = to; }
      return next;
    });
  }
  const status = mon.build.status;
  if (status && eat.cures.includes(status)) {
    mon.build = { ...mon.build, status: "" };
    if (status === "slp") setVol(w, target, { sleep: undefined });
    if (status === "frz") setVol(w, target, { freeze: undefined });
    if (status === "tox") setEot(w, target, { toxic: undefined });
    fact(`Its ${STATUS_NOUNS[status]} is cured.`);
  }
  if (eat.curesConfusion && mon.vol.confusion) { setVol(w, target, { confusion: undefined }); fact("Its confusion is cured."); }
  if (Object.keys(eat.stages).length) {
    const changed = kernel.applyBoosts(w, target, eat.stages, attacker, { effect: "item", broken });
    const parts = (Object.entries(changed) as [Stage, number][]).filter(([, amount]) => amount).map(([stat, amount]) => `${signed(amount)} ${STAGE_NAMES[stat]}`);
    if (parts.length) fact(`${label}: ${parts.join(", ")}.`);
  }
  if (eat.confuses && flungConfusion(kernel, w, target, eat.confuses, broken)) fact(`${label}: it becomes confused.`);
  if (eat.focusEnergy && !mon.build.focusEnergy && !mon.build.settledFocusEnergy && !mon.build.dragonCheer) {
    mon.build = { ...mon.build, settledFocusEnergy: true };
    fact(`${label}: Focus Energy, +2 critical-hit stages.`);
  }
  if (eat.starf) (mon as Marked).starfRise = eat.starf === 4 ? 4 : 2;
  // EatItem runs unless the Berry's Eat returned false (UNEATEN_BERRIES): Ripen's berryWeaken, Cud Chew's Berry.
  if (ignoresItem || !UNEATEN_BERRIES.has(item)) {
    ripenGuard(kernel, w, target, !!eat.weakens);
    if (mon.build.abilityId === "cudchew") setEot(w, target, { cudChew: { berry: item, counter: 2 } });
  }
}

/**
 * A flung Figy-family Berry's confusion (PS/data/items.ts figyberry and its kin onEat: addVolatile('confusion') when the
 * eater's Nature lowers that stat, with the Fling user as the source): Own Tempo (which the user's Mold Breaker ignores), an
 * existing confusion, Misty Terrain under a grounded eater that is not semi-invulnerable, and Safeguard on its side stop it
 * (onTryAddVolatile; doubles-items.ts berryConfuses' rules). Whether it was confused.
 */
function flungConfusion(kernel: TurnKernel, w: World, slot: DoublesSlotId, stat: CombatStat, broken: boolean): boolean {
  const mon = w.mons[slot]!;
  if (NATURES.find((nature) => nature.name === mon.build.nature)?.minus !== stat || mon.vol.confusion) return false;
  if (mon.build.abilityId === "owntempo" && !broken) return false;
  if (w.field.terrain === "Misty" && kernel.grounded(w, slot) && !mon.eot.hidden) return false;
  if (w.sides[slotSide(slot)].safeguard) return false;
  setVol(w, slot, { confusion: { attempts: 0, min: 2 } });
  return true;
}

/** Status names in the cure facts (doubles-items.ts, doubles-field.ts). */
const STATUS_NOUNS: Readonly<Record<string, string>> = { slp: "sleep", par: "paralysis", brn: "burn", psn: "poison", tox: "bad poison", frz: "freeze" };

/** A spread move's attacker's rises in one target's step (World.spread's entry; doubles-spread.ts applies them once). */
export const SPREAD_RISES = "rises:";

// ---------------- The readers (SPEC2 §4.9) ----------------

type Reads = { rises: boolean; starf: boolean };
const READS = new WeakMap<DoublesTurnInput, Reads>();

/**
 * What the turn's Pokémon can need of a step, from the input (a copier or a Starf Berry the turn can meet comes from one of
 * its Pokémon): `rises`, an Opportunist or Mirror Herb holder (its ability, Trace's copy, its item, its last item, a pending
 * copy), which a copy from any Pokémon of the turn (Skill Swap, Role Play, Transform, Trick, Pickup, Recycle...) starts from;
 * `starf`, a Starf Berry held or last used.
 */
function readsOf(input: DoublesTurnInput): Reads {
  let known = READS.get(input);
  if (known) return known;
  known = { rises: false, starf: false };
  for (const slot of DOUBLES_SLOTS) {
    const entry = input.pokemon[slot];
    if (!entry) continue;
    const build = entry.build;
    if (build.abilityId === "opportunist" || build.tracedAbility === "opportunist" || build.itemId === "mirrorherb" || entry.lastItem === "mirrorherb" || entry.carried?.copy) known.rises = true;
    if (build.itemId === "starfberry" || entry.lastItem === "starfberry") known.starf = true;
  }
  READS.set(input, known);
  return known;
}

/**
 * Whether the turn keeps item history (MonState.lastItem, usedItem; SPEC2 §4.9's readers rule, ADDENDUM2 §4.2): a Recycle or
 * Fling user, a Harvest, Pickup, Symbiosis or Cud Chew holder (its ability or Trace's copy), or in Sword/Shield a
 * Gigantamax Snorlax (G-Max Replenish).
 */
export function tracksItems(input: DoublesTurnInput): boolean {
  for (const slot of DOUBLES_SLOTS) {
    const entry = input.pokemon[slot];
    if (!entry) continue;
    const { abilityId, tracedAbility } = entry.build;
    const ability = abilityId === "trace" && tracedAbility ? tracedAbility : abilityId;
    if (ability === "harvest" || ability === "pickup" || ability === "symbiosis" || ability === "cudchew") return true;
    const moveId = entry.action.moveId;
    if (moveId === "recycle" || moveId === "fling") return true;
    if (entry.build.mechanic === "gigantamax" && entry.build.speciesId.startsWith("snorlax")) return true;
  }
  return false;
}

/** doubles-spread.ts's spread-heal searches ask the step for the damage each hit dealt (withDealt). */
let dealtAsked = 0;

/** `run` with the step's `dealt` report asked for (doubles-spread.ts, its draining and Shell Bell targets' searches). */
export function withDealt<T>(run: () => T): T {
  dealtAsked++;
  try { return run(); } finally { dealtAsked--; }
}

const REPORTS: readonly Readonly<{ rises?: true; used?: true; dealt?: true; starf?: true }>[] = Array.from({ length: 8 }, (_, bits) => Object.freeze({
  ...(bits & 1 ? { rises: true as const } : {}), ...(bits & 2 ? { starf: true as const } : {}), ...(bits & 4 ? { dealt: true as const } : {}),
}));

/**
 * What the pairwise step reports for the kernel (uses-to-ko.ts UsesEnv.report, Step 0b): `rises` with a copier in the turn
 * (the step copies nothing then: the kernel's ledger does), `starf` with a Starf Berry in the turn (the attacker's random
 * stat is the kernel's: afterMoveCopies), `dealt` for doubles-spread.ts's spread heals. Item use needs no report: applyStep
 * classes each lost item itself (stepItems). One frozen object per combination (the search's memo key reads it).
 */
export function stepReport(kernel: TurnKernel): { rises?: true; used?: true; dealt?: true; starf?: true } {
  const reads = readsOf(kernel.input);
  return REPORTS[(reads.rises ? 1 : 0) | (reads.starf ? 2 : 0) | (dealtAsked ? 4 : 0)];
}
