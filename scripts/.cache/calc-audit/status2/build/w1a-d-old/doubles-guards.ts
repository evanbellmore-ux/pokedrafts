import { REASONS } from "./doubles-actions";
import { allyOf, DOUBLES_SLOTS, slotSide, type DoublesSlotId, type DoublesTurnInput } from "./doubles-types";
import { marginal, type PendingAction, type Stage, type World } from "./doubles-world";
import type { HitCheck, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import type { Gate } from "./doubles-use";
import { berryArithmetic, BERSERK_BERRIES } from "./hit-loop";
import { isMaxActive } from "./mechanics";
import type { BattleBuild, ChampionsMove, MoveContext } from "./types";
import type { TurnStepOutcome } from "./uses-to-ko";

// The moves-phase guards (status2 SPEC2 §3.5, §4.5): Track D's file. Step 0 moves today's guards here verbatim (Opportunist
// and Mirror Herb copying a rise, the three Symbiosis guards, the Berserk lock, the hidden stages, Ripen's weakened Berry,
// Glaive Rush, Encore changing a queued move) and stubs D's hooks with today's behaviour. doubles-turn.ts, doubles-status.ts,
// doubles-eot.ts and doubles-items.ts call them; this file imports the kernel's type only and calls applyBoosts through the
// kernel (no import of doubles-stages.ts, which calls noteRise: no cycle).

// ---------------- The ledger ----------------

/**
 * The boost() table AfterBoost reads (after ChangeBoost, the cap and TryBoost; doubles-stages.ts applyBoosts): a rise for a
 * foe's Opportunist or Mirror Herb, a drop for Eject Pack, recorded for the action's eventGuards (doubles-turn.ts) whatever
 * the stages end at. `rose` sums the positive parts by stat of every table that reached the Pokémon in the action.
 */
export function noteRise(kernel: TurnKernel, w: World, slot: DoublesSlotId, boost: Partial<Record<Stage, number>>) {
  void kernel;
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
}

/**
 * Opportunist and Mirror Herb copying a foe's rise (onFoeAfterBoost), which the turn does not follow yet: not estimated
 * where a foe of the Pokémon that rose holds one (doubles-turn.ts eventGuards, for a slot that rose in the action).
 */
export function copierGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  for (const other of DOUBLES_SLOTS) {
    if (!kernel.isFoe(other, slot) || !kernel.alive(w, other)) continue;
    const copier = w.mons[other]!.build;
    if (copier.abilityId === "opportunist") kernel.notEstimated(REASONS.copiesRise(kernel.abilityName("opportunist")));
    if (copier.itemId === "mirrorherb" && kernel.itemWorks(w, copier)) kernel.notEstimated(REASONS.copiesRise(kernel.itemName("mirrorherb")));
  }
}

/** The end of turn's copy guard (doubles-eot.ts afterChecks): a stage of `slot` above its residual-start one, with a living foe's Opportunist or Mirror Herb. */
export function copierEndOfTurn(kernel: TurnKernel, w: World, slot: DoublesSlotId, startBoosts: BattleBuild["boosts"]) {
  const mon = w.mons[slot]!;
  const STATS = ["atk", "def", "spa", "spd", "spe"] as const;
  if (kernel.alive(w, slot) && STATS.some((stat) => (mon.build.boosts[stat] ?? 0) > (startBoosts[stat] ?? 0))) {
    for (const other of DOUBLES_SLOTS) {
      if (slotSide(other) === slotSide(slot) || !kernel.alive(w, other)) continue;
      const copier = w.mons[other]!.build;
      if (copier.abilityId === "opportunist") kernel.notEstimated(REASONS.copiesRise(kernel.abilityName("opportunist")));
      if (copier.itemId === "mirrorherb" && kernel.itemWorks(w, copier)) kernel.notEstimated(REASONS.copiesRise(kernel.itemName("mirrorherb")));
    }
  }
}

/** D (SPEC2 §4.5): each copier's sum applied at the action's end, in Speed order: the worlds after it, or null for `w` unchanged. Step 0: null (the copier guards stand). */
export function afterMoveCopies(kernel: TurnKernel, w: World, action: PendingAction): World[] | null {
  void kernel; void w; void action;
  return null;
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

// ---------------- The Berserk lock, the hidden stages, Ripen, Glaive Rush, Encore ----------------

/**
 * A healing Berry a Berserk or Anger Shell lock (MoveVolatiles.berryLocked, after a confusion self-hit) keeps at or under
 * its line: a later hit on its holder (the pair's step reads a held Berry as due) and a status move that resets the lock
 * (doubles-status.ts hitOne) do not follow it: not estimated. The end of turn follows the lock (doubles-eot.ts updateSlot,
 * unlock: a residual's damage resets it).
 */
export function lockedBerryGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  if (!mon?.vol.berryLocked || mon.fainted) return;
  const item = mon.build.itemId;
  if (!BERSERK_BERRIES.has(item) || item === "enigmaberry" || !kernel.itemWorks(w, mon.build) || kernel.berryStopped(w, slot)) return;
  const { line } = berryArithmetic(item, { ...kernel.hp[slot], ability: mon.build.abilityId }, kernel.runtime.profile.generation);
  if (![...marginal(w, slot).keys()].some((hp) => hp > 0 && hp <= line)) return;
  // status2 Step 1 #2: the lock's source names it (a Champions Sheer Force hit's, sheerForceLock).
  const reason = mon.vol.berryLocked === "sheerforce" ? REASONS.berryLockedSheerForce : REASONS.berryLocked;
  kernel.notEstimated(reason(kernel.abilityName(mon.build.abilityId), kernel.itemName(item)));
}

/**
 * Champions (status2 Step 1 #2; F4 F2): a Sheer Force hit locks a Berserk or Anger Shell holder's healing Berry. Champions'
 * onDamage (PS/data/mods/champions/abilities.ts:2-13) sets checkedBerserk / checkedAngerShell to `!(Move && !multihit)` with
 * no Sheer Force clause, and a Sheer Force move with secondaries runs no AfterMoveSecondary (PS/sim/battle-actions.ts:811-816)
 * to reset it: the Berry's TryEatItem fails at the hit's Update and after (the other games' onDamage leaves a Sheer Force hit
 * unlocked: the Berry is eaten at that Update, as the step reads it). The held Berry (BERSERK_BERRIES: not Berry Juice, which is
 * used, not eaten) when this hit locks it: the step reads it as Leftovers (searchFor `healBlocked`, as psychicNoiseKeepsBerry)
 * and the caller puts it back with MoveVolatiles.berryLocked "sheerforce" where the hit reached the Pokémon. Else null.
 */
export function sheerForceLock(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, info: TurnMoveInfo): string | null {
  if (!kernel.champions || attacker === target || info.effective.multihit) return null;
  const user = w.mons[attacker]?.build, holder = w.mons[target]!.build;
  if (!user || user.abilityId !== "sheerforce" || !info.secondaries) return null;
  if (holder.abilityId !== "berserk" && holder.abilityId !== "angershell") return null;
  return BERSERK_BERRIES.has(holder.itemId) && kernel.itemWorks(w, holder) ? holder.itemId : null;
}

/**
 * The holder's own No move (Splash) past its BeforeMove runs AfterMoveSecondary on itself (PS/sim/battle-actions.ts:1005;
 * PS/data/abilities.ts berserk, angershell onAfterMoveSecondary: checked true), so a lock ends and the action's Update eats
 * a healing Berry at its line (status2 Step 1 #2; GA2b): the worlds after it.
 */
export function noMoveUnlock(kernel: TurnKernel, w: World, slot: DoublesSlotId): World[] {
  const mon = w.mons[slot];
  if (!mon?.vol.berryLocked || mon.fainted) return [w];
  const { berryLocked: _locked, ...rest } = mon.vol;
  void _locked;
  mon.vol = rest;
  return kernel.berryDue(w, slot);
}

/**
 * Stored Power and Power Trip (data/moves.ts storedpower, powertrip basePowerCallback: 20 per positive stage of the user)
 * and Punishment (60 plus 20 per positive stage of the target) count accuracy and evasion stages (sim/pokemon.ts
 * positiveBoosts), which no calculation reads (MoveVolatiles.stages): not estimated while the Pokémon they read has one
 * above 0 from this turn (Double Team; Contrary against Sand Attack). Their Z-Moves and Max Moves have a power of their own.
 * `attacker` null (a residual's hit from a Pokémon not in battle): no stage of its is read.
 */
export function hiddenStageGuard(kernel: TurnKernel, w: World, attacker: DoublesSlotId | null, target: DoublesSlotId, moveId: string, context: MoveContext | undefined) {
  if (!attacker) return;
  const reads = moveId === "storedpower" || moveId === "powertrip" ? attacker : moveId === "punishment" ? target : null;
  if (!reads || context?.useZ || isMaxActive(w.mons[attacker]!.build)) return;
  const stages = w.mons[reads]?.vol.stages;
  if (!stages || !((stages.accuracy ?? 0) > 0 || (stages.evasion ?? 0) > 0)) return;
  // status2 Step 1 #8: a positive stage carried from an earlier turn (DoublesCarried.stages) and not changed since names its time.
  const carried = kernel.input.pokemon[reads]?.carried?.stages ?? {};
  const positive = (["accuracy", "evasion"] as const).filter((stat) => (stages[stat] ?? 0) > 0);
  const earlier = positive.every((stat) => carried[stat] === stages[stat]);
  kernel.notEstimated((earlier ? REASONS.hiddenStagesEarlier : REASONS.hiddenStages)(kernel.moveName(moveId), kernel.names[reads]));
}

/**
 * Ripen's mark of an eaten resist Berry (data/abilities.ts ripen onSourceModifyDamage berryWeaken) halves the next damage
 * its holder takes: not followed while a later move can hit it (doubles-turn.ts stolenFacts, a Berry Bug Bite or Pluck ate).
 */
export function ripenGuard(kernel: TurnKernel, w: World, holder: DoublesSlotId, weakens: boolean) {
  if (weakens && kernel.alive(w, holder) && kernel.laterDamaging(w)) kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("ripen")));
}

/** Glaive Rush (data/moves.ts glaiverush self volatile, onSourceModifyDamage 2x) until the user's next move: not followed with a later damaging move (doubles-turn.ts afterHit). */
export function glaiveRushAfter(kernel: TurnKernel, w: World, action: PendingAction, ownAny: boolean) {
  const id = action.moveId!;
  const user = w.mons[action.slot]!;
  if (id === "glaiverush" && ownAny && !user.fainted && kernel.laterDamaging(w)) kernel.notEstimated(REASONS.takesDouble(kernel.moveName(id), kernel.names[action.slot]));
}

/** Encore on a Pokémon still to act whose queued move differs from its last one (doubles-status.ts lastMoveVolatile): not followed, unless a Mental Herb ends it at the Update. */
export function encoreGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, last: string) {
  const queued = w.remaining.find((each) => each.slot === slot);
  const mentalHerb = w.mons[slot]!.build.itemId === "mentalherb" && kernel.itemWorks(w, w.mons[slot]!.build);
  if (queued && queued.moveId !== last && !mentalHerb) kernel.notEstimated(REASONS.encoreChange(kernel.names[slot]));
}

// ---------------- D's hooks (stubs: today's behaviour) ----------------

/** BeforeMove priority 100 (C5): Glaive Rush ends at its holder's next BeforeMove, No move included: a Gate, or null for `w` going on unchanged. Step 0: null. */
export function beforeFirst(kernel: TurnKernel, w: World, action: PendingAction): Gate | null {
  void kernel; void w; void action;
  return null;
}

/**
 * One-hit KO moves (F4 §4.6): a fixed full-HP hit with every immunity, as the step to apply to each world in the target's
 * place in the hit order (singleStep applies it to its world; spreadStep's plans in turn), or null for the calculation's row.
 * Step 0: null (today's row reason).
 */
export function ohkoStep(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck): ((world: World) => World[]) | null {
  void kernel; void w; void action; void info; void check;
  return null;
}

/** Fling's own Try (F4 §4.5): no item, Klutz, Magic Room, Embargo, an unflingable item. Step 0: null. */
export function flingTry(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, info: TurnMoveInfo): string | null {
  void kernel; void w; void action; void move; void target; void info;
  return null;
}

/** Fling's effects after a hit (the user's item gone, the target's Berry, status or flinch). Step 0: nothing. */
export function flingAfter(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  void kernel; void w; void action; void target; void outcome; void info;
}

/** Whether the turn keeps item history (MonState.lastItem, usedItem; SPEC2 §4.9's readers rule). Step 0: false. */
export function tracksItems(input: DoublesTurnInput): boolean {
  void input;
  return false;
}

/** What the pairwise step reports for the kernel (uses-to-ko.ts UsesEnv.report, Step 0b): rises, items used, damage dealt, an attacker's Starf. Step 0: none. */
export function stepReport(kernel: TurnKernel): { rises?: true; used?: true; dealt?: true; starf?: true } {
  void kernel;
  return {};
}

/** An Encore that changes the queued move (PS/sim/battle-actions.ts:227-234): the action rewritten before BeforeMove. Step 0: the action unchanged. */
export function encoreRewrite(kernel: TurnKernel, w: World, action: PendingAction): PendingAction {
  void kernel; void w;
  return action;
}
