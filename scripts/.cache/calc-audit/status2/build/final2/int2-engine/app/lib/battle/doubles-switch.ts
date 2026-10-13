import { Generations, toID } from "@smogon/calc";
import { GAS_PROOF_ABILITIES, GAS_STAND_IN, turnHP } from "./calculate";
import { ANCHORING_ABILITIES, DRAG_MOVES, MOLD_BREAKERS, REASONS, STRONG_WEATHERS } from "./doubles-actions";
import {
  DOUBLES_SLOTS, SHOWDOWN_POSITION, sideCanSwitch, slotSide, startId, type DoublesBenchedMon, type DoublesBenchPokemon, type DoublesHazards,
  type DoublesSideId, type DoublesSlotId,
} from "./doubles-types";
import {
  cloneWorld, condition, mapHP, marginal, putIn, takeOut, withSpecies, type BenchedMon, type MonState, type PendingAction, type PendingSwitch, type World,
} from "./doubles-world";
import type { TurnKernel } from "./doubles-turn";
import * as abilityNs from "./doubles-abilities";
import * as fieldChangeNs from "./doubles-fieldchange";
import * as guardNs from "./doubles-guards";
import * as historyNs from "./doubles-history";
import * as presenceNs from "./doubles-presence";
import { whiteHerbAfterMove } from "./doubles-stages";
import { setEot, setVol, sleepTurnsLeft, type Use } from "./doubles-use";
import { UNNERVES } from "./hit-loop";
import { isMaxActive, specialTeraForm } from "./mechanics";
import { defaultAbilityActive, paradoxBestStat } from "./model";
import type { StatusEntry } from "./status-table";
import type { BattleBuild, CombatStat } from "./types";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const abilityHooks = { ...abilityNs };
const fieldChangeHooks = { ...fieldChangeNs };
const guardHooks = { ...guardNs };
const historyHooks = { ...historyNs };
const presenceHooks = { ...presenceNs };

// Switch-outs during the turn (status2 SPEC2 §3.5, §4.8; ADDENDUM2 §8.7): Track R's file (wave 2: R-E). Every
// switch-out site of the moves calls switchOut where today it decided between "not estimated" and the end of turn's
// leaving: Eject Pack, Emergency Exit and Wimp Out after an action (doubles-turn.ts eventGuards), Eject Button and Red Card
// (hitReactions; doubles-faces.ts for a face's hit), U-turn, Volt Switch, Flip Turn and the drag of Dragon Tail and Circle
// Throw (afterHit), the status moves' switches (doubles-status.ts switchOut: Baton Pass, Teleport, Shed Tail, Parting
// Shot, Roar, Whirlwind, Chilly Reception), and the end of turn's Eject Pack (doubles-eot.ts ejectPack: the switch after the
// turn). R models the replacement where the side's bench is given (DoublesTurnInput.bench).
//
// R-E (wave 2), pinned Showdown c23d2e94 (PS/ = node_modules/.cache/champions/pokemon-showdown-c23d2e942c9c0daadb13a7162a385bf78e3c9353):
// - A switch is set during the action (switchFlag, forceSwitchFlag: replaceSlot records it in World.switching, with the item
//   rules: Eject Button cancels its attacker's U-turn and waits for no switchFlag of `true`, Red Card needs its attacker not
//   being dragged, a drag in the hit comes before both, Emergency Exit clears every switchFlag, an Eject Pack waits while one
//   of `true` stands) and made as the action ends (PS/sim/battle.ts:2821-2914 runAction: the drags first, each with its
//   entry at once (dragIn, runSwitch), then the switch requests: every flagged Pokémon of both sides, leavers by Speed, one
//   SwitchIn event for the newcomers: betweenActions).
// - Leaving (PS/sim/battle-actions.ts:62-160 switchIn): the leaver's queued action cancelled, its SwitchOut (Regenerator's
//   third, Heal Block aside; Natural Cure; Zero to Hero's form), its ability's End (Neutralizing Gas: kernel.gasEnds; Unnerve
//   and As One: the foes' Berries at the next Update; Cloud Nine, Air Lock and a strong weather: the field re-settle), Baton
//   Pass's and Shed Tail's copy (copyVolatileFrom: the volatiles without noCopy), then clearVolatile (the stages, the
//   volatiles, the form and ability back: benchState) and the leaver to World.benched with its HP marginal.
// - Entering (runSwitch: fieldEvent('SwitchIn'), handlers by priority, then Speed, then subOrder: the side's hazards (4),
//   the ability's Start (7) and the item's (8) of each newcomer, every Pokémon's onAnySwitchIn (White Herb −2, an
//   Opportunist or Mirror Herb copy −3, Eject Pack −4)): Stealth Rock, Spikes, Toxic Spikes, Sticky Web and G-Max Steelsurge
//   (Heavy-Duty Boots, Magic Guard, grounding), the Starts through A1's abilityStart, Imposter through A1's Transform, the
//   paradox abilities and Booster Energy, the Terrain Seeds and Room Service, then the Update's Berries and Emergency Exit
//   (PS/sim/battle.ts:2870-2874 for a runSwitch action's Pokémon). What is not followed is not estimated with its reason.
// - Identity: MonState.id (the occupant); a leaver's references from the others end (a trap, Syrup Bomb, Attract, Lock-On,
//   the trappers, damagedBy); the slot conditions stay with the position (Wish, a Future Sight landing).

/** What makes the Pokémon leave (R reads it: the newcomer's entry, the drag's random bench pick). */
export type SwitchHow = "ejectpack" | "exit" | "ejectbutton" | "redcard" | "selfswitch" | "drag" | "status" | "residual";

/** The status moves whose user switches out by its player's choice (switchFlag = the move id), and the two that drag their target (forceSwitch). */
const DRAG_STATUS: ReadonlySet<string> = new Set(["roar", "whirlwind"]);
/** A switchFlag of `true` (Eject Button, Eject Pack, Emergency Exit): Eject Button and Eject Pack wait while one stands (PS/data/items.ts:1688-1692, 1737-1741). */
const flagTrue = (p: Pending) => !p.inert && (p.how === "ejectbutton" || (p.how === "ejectpack" && !!p.used) || p.how === "exit");
/** A forceSwitchFlag (Roar, Whirlwind, Dragon Tail, Circle Throw, Red Card): dragIn at the action's end, a random bench Pokémon. */
const isDrag = (p: Pending) => p.how === "drag" || p.how === "redcard";
/**
 * Pending switches are kept apart by Pokémon, not by how (one Pokémon has one switchFlag and one forceSwitchFlag). `by`: an
 * Eject Button's attacker (with `index`, its AfterMoveSecondary event: contested).
 */
type Pending = PendingSwitch & { inert?: true; item?: string; used?: true; by?: DoublesSlotId };

/** R-E: a switchFlag of `true` stands in `w` (the end of turn's Eject Pack waits then: doubles-eot.ts ejectPack). */
export function flagStanding(w: World): boolean {
  return ((w.switching ?? []) as Pending[]).some(flagTrue);
}

/** R-E: `slot`'s Pokémon is set to be dragged out in `w` (its forceSwitchFlag: Red Card, Roar, Whirlwind, Dragon Tail, Circle Throw). */
export function dragSet(w: World, slot: DoublesSlotId): boolean {
  return ((w.switching ?? []) as Pending[]).some((p) => p.slot === slot && isDrag(p) && !p.inert);
}

// ------------------------------------------------------------------------------------------------------------------
// The switch-out sites
// ------------------------------------------------------------------------------------------------------------------

/**
 * `slot` leaves (today's rule, moved verbatim from the five sites): with a later living action its replacement is not known
 * (REASONS.switchesOut); with none it leaves for the end of turn (kernel.leaving). The end of turn's own Eject Pack
 * ("residual") switches after the turn, which no input follows: nothing more. `action`: the action it happened in (null: at
 * the end of turn or outside an action). status2 R: with the leaver's side's bench given (DoublesTurnInput.bench), the
 * replacement point replaceSlot instead (R-E: the switch after the turn too). `holder`: Red Card's holder.
 */
export function switchOut(kernel: TurnKernel, w: World, slot: DoublesSlotId, how: SwitchHow, action: PendingAction | null, holder?: DoublesSlotId) {
  // A commanding Tatsugiri or its Dondozo cannot leave (PR, T2P §2.1).
  if (presenceHooks.cannotLeave(kernel, w, slot)) return;
  const bench = !!kernel.input.bench?.[slotSide(slot)];
  if (how === "residual") {
    // The end of turn's Eject Pack, used at order 29 (doubles-eot.ts ejectPack): its switchFlag, made after the residual.
    if (bench) w.switching = [...(w.switching ?? []), { slot, how: "ejectpack", moveId: null, index: -1, used: true } as Pending];
    return;
  }
  if (bench) { replaceSlot(kernel, w, slot, how, action, holder); return; }
  if (kernel.laterAction(w)) kernel.notEstimated(REASONS.switchesOut(kernel.names[slot]));
  // R-E: a drag Red Card sets on its attacker stops the attacker's Life Orb and Shell Bell, which the step applied.
  if (how === "redcard" && redCardDrags(kernel, w, slot, holder)) selfItemsAfterRedCard(kernel, w, slot);
  kernel.leaving(w, slot);
}

/**
 * R-E, a side without a bench: whether Red Card sets its attacker's forceSwitchFlag (PS/data/items.ts:5148-5160): a Pokémon left
 * to come in (canSwitch), its holder not being dragged out by the hit's own Dragon Tail or Circle Throw (forceSwitch in the hit,
 * before AfterMoveSecondary), and the attacker's DragOut not stopped (Suction Cups, Guard Dog, Ingrain, Dynamax, Commander).
 */
function redCardDrags(kernel: TurnKernel, w: World, attacker: DoublesSlotId, holder: DoublesSlotId | undefined): boolean {
  const mon = w.mons[attacker];
  if (!mon || mon.fainted || sideCanSwitch(kernel.baseInput, slotSide(attacker)) === false) return false;
  const anchored = (slot: DoublesSlotId) => {
    const build = w.mons[slot]!.build;
    return (ANCHORING_ABILITIES.has(build.abilityId) && !(slot !== attacker && MOLD_BREAKERS.has(mon.build.abilityId))) || !!w.mons[slot]!.eot.ingrain || isMaxActive(build) || presenceHooks.cannotLeave(kernel, w, slot);
  };
  const moveId = kernel.acting?.slot === attacker ? kernel.acting.moveId : null;
  if (holder && w.mons[holder] && moveId && DRAG_MOVES.has(moveId) && sideCanSwitch(kernel.baseInput, slotSide(holder)) !== false && !anchored(holder)) return false;
  return !anchored(attacker);
}

/**
 * R-E: Red Card's drag (the attacker's forceSwitchFlag, set in AfterMoveSecondary) comes before the attacker's own
 * AfterMoveSecondarySelf items, which then do nothing (PS/data/items.ts lifeorb: !source.forceSwitchFlag; shellbell:
 * !pokemon.forceSwitchFlag), while the step took the Life Orb loss and gave the Shell Bell heal with its hit: not followed.
 */
function selfItemsAfterRedCard(kernel: TurnKernel, w: World, attacker: DoublesSlotId) {
  const build = w.mons[attacker]?.build;
  if (!build || !kernel.itemWorks(w, build)) return;
  if ((build.itemId === "lifeorb" && build.abilityId !== "magicguard") || build.itemId === "shellbell") {
    kernel.notEstimated(REASONS.combo(kernel.itemName("redcard"), kernel.itemName(build.itemId)));
  }
}

/**
 * R-E (F4 §5.4's replaceSlot, SPEC2 §4.8): `slot`'s Pokémon is set to leave with its side's bench given: recorded in
 * World.switching (the leaver stays until the action ends: betweenActions makes the switch), with the items' rules of pinned
 * Showdown as the move sets the flags (PS/sim/battle-actions.ts:1290-1313 selfSwitch, :1353-1365 forceSwitch; PS/data/items.ts
 * ejectbutton, redcard, ejectpack; PS/data/abilities.ts emergencyexit). The kernel calls these in its own order (the hit's
 * items, then the user's switch, then the action's end): what Showdown sets earlier in the move is read here as it arrives.
 */
export function replaceSlot(kernel: TurnKernel, w: World, slot: DoublesSlotId, how: SwitchHow, action: PendingAction | null, holder?: DoublesSlotId) {
  const acting = action ?? kernel.acting;
  const index = acting?.index ?? -1;
  const moveId = action?.moveId ?? acting?.moveId ?? null;
  const pending = (w.switching ?? []) as Pending[];
  const side = slotSide(slot);
  const add = (entry: Pending) => { w.switching = [...(w.switching ?? []), entry]; };
  const dragged = (target: DoublesSlotId) => (w.switching as Pending[] | undefined)?.some((p) => p.slot === target && isDrag(p) && !p.inert) ?? false;
  const mon = w.mons[slot];
  if (!mon) return;
  switch (how) {
    case "selfswitch":
      // An Eject Button its hit set off cancelled its switch (PS/data/items.ts:1694-1696: source.switchFlag = false; B8); not in
      // Champions, whose Eject Button leaves the attacker's switch (PS/data/mods/champions/items.ts:266-281).
      if (!kernel.champions && pending.some((p) => p.how === "ejectbutton" && p.index === index && !p.inert)) return;
      if (pending.some((p) => p.slot === slot && !isDrag(p))) return;
      add({ slot, how, moveId, index });
      return;
    case "status":
      if (moveId && DRAG_STATUS.has(moveId)) {
        // Roar and Whirlwind (forceSwitch): their DragOut was the move's (doubles-status.ts switchMove).
        if (dragged(slot)) return;
        add({ slot, how: "drag", moveId, index });
        return;
      }
      if (pending.some((p) => p.slot === slot && !isDrag(p))) return;
      add({ slot, how, moveId, index });
      return;
    case "drag": {
      // Dragon Tail and Circle Throw (forceSwitch in the hit: PS/sim/battle-actions.ts:1353-1365): Ingrain keeps it in
      // (PS/data/moves.ts ingrain onDragOut); the kernel checked Dynamax, Suction Cups and Guard Dog.
      if (mon.eot.ingrain) {
        if (acting) kernel.stepFact(acting, `${kernel.moveName("ingrain")}: ${kernel.names[slot]} stays in.`, w.mass);
        return;
      }
      if (dragged(slot)) return;
      // The drag's flag came first in the hit: this target's Eject Button and Red Card did not act (PS/data/items.ts:1689, 5149).
      w.switching = pending.filter((p) => !((p.how === "ejectbutton" && p.slot === slot) || (p.how === "redcard" && p.holder === slot)));
      add({ slot, how: "drag", moveId, index });
      return;
    }
    case "ejectbutton": {
      // PS/data/items.ts:1687-1700: a holder with HP, not being dragged, a Pokémon left to come in, no switchFlag of `true`
      // standing; it is used up and its attacker's own switch is cancelled. Another holder's Eject Button in the same
      // AfterMoveSecondary event (a spread move's other target) is not a standing flag yet: contested decides.
      if (mon.fainted || mon.build.itemId !== "ejectbutton" || !kernel.itemWorks(w, mon.build)) return;
      const attacker = acting?.slot;
      const rival = (p: Pending) => p.how === "ejectbutton" && p.index === index && p.by === attacker;
      if (sideCanSwitch(kernel.baseInput, side) === false || dragged(slot) || pending.some((p) => flagTrue(p) && !rival(p))) return;
      if (!kernel.champions) w.switching = pending.map((p) => (p.how === "selfswitch" && p.slot === attacker ? { ...p, inert: true } : p));
      add({ slot, how, moveId, index, item: "ejectbutton", ...(attacker ? { by: attacker } : {}) });
      return;
    }
    case "redcard": {
      // PS/data/items.ts:5148-5160: its attacker still in with a Pokémon left to come in, neither it nor the holder being
      // dragged; the card is used up even when the attacker stays in (DragOut: Suction Cups, Guard Dog, Ingrain, Dynamax).
      // Another holder's Red Card against the same attacker in the same event is not a standing drag yet: contested decides.
      const by = holder ?? DOUBLES_SLOTS.find((each) => kernel.isFoe(each, slot) && w.mons[each]?.build.itemId === "redcard");
      const rival = (p: Pending) => p.how === "redcard" && p.slot === slot && p.index === index;
      const draggedNow = pending.some((p) => p.slot === slot && isDrag(p) && !p.inert && !rival(p));
      if (!by || mon.fainted || sideCanSwitch(kernel.baseInput, side) === false || draggedNow || dragged(by)) return;
      // Its card already used this action (its use waits for the action's end with a bench).
      if (pending.some((p) => p.how === "redcard" && p.holder === by)) return;
      const card = w.mons[by]!;
      if (card.build.itemId !== "redcard" || !kernel.itemWorks(w, card.build)) return;
      const ability = mon.build.abilityId;
      const stays = (ability === "suctioncups" || ability === "guarddog") || !!mon.eot.ingrain || isMaxActive(mon.build) || presenceHooks.cannotLeave(kernel, w, slot);
      add({ slot, how, moveId, index, holder: by, item: "redcard", ...(stays ? { inert: true as const } : {}) });
      return;
    }
    case "ejectpack": {
      // The drop marked it (PS/data/items.ts:1711-1720 onAfterBoost); its use waits for the action's AfterMove, by Speed
      // among the holders (betweenActions).
      if (mon.fainted || mon.build.itemId !== "ejectpack") return;
      mon.ejectMarked = true;
      if (pending.some((p) => p.slot === slot && p.how === "ejectpack")) return;
      add({ slot, how, moveId, index });
      return;
    }
    case "exit": {
      // PS/data/abilities.ts:1250-1262 emergencyexit: where its HP is now at most half (the split is betweenActions').
      if (mon.fainted || pending.some((p) => p.slot === slot && p.how === "exit")) return;
      add({ slot, how, moveId, index, below: true });
      return;
    }
    case "residual":
      return;
  }
}

/**
 * R-E: an Emergency Exit or Wimp Out holder of a side with a bench, still in, whose HP straddles half while a damaging action
 * is still queued: one world each side of the line (the action reads whether it was above half: doubles-turn.ts eventGuards'
 * snapshot). `w` itself otherwise.
 */
export function exitWorlds(kernel: TurnKernel, w: World): World[] {
  if (!kernel.baseInput.bench) return [w];
  let out = [w];
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon || mon.fainted || !kernel.baseInput.bench[slotSide(slot)] || (mon.build.abilityId !== "emergencyexit" && mon.build.abilityId !== "wimpout")) continue;
    if (!kernel.laterDamaging(w)) return out;
    const max = kernel.hp[slot].maxHP;
    const above = (hp: number) => hp * 2 > max;
    out = out.flatMap((world) => {
      const hps = [...marginal(world, slot).keys()];
      return hps.some(above) && hps.some((hp) => !above(hp)) ? condition(world, slot, above).map(({ world: part }) => part) : [world];
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// The switches as the action ends (PS/sim/battle.ts:2821-2914)
// ------------------------------------------------------------------------------------------------------------------

/**
 * R-E: as an action ends (doubles-turn.ts walk, after execute), the switch-outs it set (World.switching), in Showdown's order
 * (sim/battle.ts:2821-2914: the drags, then the faints, the Update and Emergency Exit, then the switch requests): one world
 * per outcome, World.switching gone. null: this world goes on unchanged.
 */
export function betweenActions(kernel: TurnKernel, w: World): World[] | null {
  if (!w.switching?.length) return null;
  const out = resolve(kernel, w, kernel.acting, false);
  kernel.occupy(w);
  return out;
}

/**
 * R-E: the switches after the residual (doubles-eot.ts run, after the final Update: Eject Pack at order 29, Emergency Exit and
 * Wimp Out after the residual, a Red Card drag from a landing): the same requests and entries as between actions, before the
 * next turn. null: nothing set.
 */
export function afterTurn(kernel: TurnKernel, w: World): World[] | null {
  if (!w.switching?.length) return null;
  const out = resolve(kernel, w, null, true);
  kernel.occupy(w);
  return out;
}

/** Every pending switch of `w0` made, in pinned order; the worlds after it (none of them with World.switching). */
function resolve(kernel: TurnKernel, w0: World, cause: PendingAction | null, after: boolean): World[] {
  const pending = (w0.switching ?? []) as Pending[];
  // A Red Card drag set in the action stopped its attacker's Life Orb and Shell Bell (selfItemsAfterRedCard); after the
  // residual the landing's own Life Orb reads the drag (doubles-eot.ts landing).
  if (!after) for (const p of pending) if (p.how === "redcard" && !p.inert) selfItemsAfterRedCard(kernel, w0, p.slot);
  const w = cloneWorld(w0);
  delete w.switching;
  // Several holders' Eject Buttons or Red Cards in one AfterMoveSecondary event: the first by Speed acts (contested).
  let parts = contested(kernel, w, pending).flatMap(({ world, pending: settled }) => {
    // The items the move used up (Eject Button, Red Card: used as they act, even where Emergency Exit then cleared the switch).
    for (const p of settled) if (p.item) consumeItem(kernel, world, p.item === "redcard" ? p.holder! : p.slot, p.item);
    const live = settled.filter((p) => !(p.how === "redcard" && p.inert)).map((p) => ({ ...p }));
    // Emergency Exit (in the move, after AfterMoveSecondary): where its HP is at most half and above 0, it clears every other
    // switchFlag and sets its own (an Eject Pack then waits: AfterMove comes after).
    return exits(kernel, world, live, cause);
  });
  // The Eject Packs at AfterMove (onAnyAfterMove), by their holders' Speed: the first used where no switchFlag of `true`
  // stands; the others stay marked (their next AfterMove or SwitchIn).
  parts = parts.flatMap((part) => ejectPacks(kernel, part.world, part.pending, cause));
  const done: World[] = [];
  for (const part of parts) done.push(...tail(kernel, part.world, part.pending, cause, after));
  return done;
}

/**
 * Eject Buttons or Red Cards that one AfterMoveSecondary event set off on several holders (a spread move's targets): pinned
 * runEvent('AfterMoveSecondary', targets) sorts the targets' handlers together (PS/sim/battle-actions.ts:811-818
 * afterMoveSecondaryEvent; speedSort: Eject Button's onAfterMoveSecondaryPriority 2 before Red Card's 0, then each holder's
 * Speed, a tie one world per order). The first Eject Button sets a switchFlag of `true`, so the others return
 * (PS/data/items.ts:1691-1693); the first Red Card that drags sets its attacker's forceSwitchFlag, so the others return
 * (:5150). Those holders keep their items. An Eject Button and a Red Card do not stop each other (the button sets no
 * forceSwitchFlag; the card comes after), and a Red Card that cannot drag (inert) does not stop the next.
 */
function contested(kernel: TurnKernel, w: World, pending: Pending[]): { world: World; pending: Pending[] }[] {
  const groups = new Map<string, Pending[]>();
  for (const p of pending) {
    if (p.inert) continue;
    const key = p.how === "ejectbutton" ? `eb|${p.index}|${p.by}` : p.how === "redcard" ? `rc|${p.index}|${p.slot}` : null;
    if (key) groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const holderOf = (p: Pending) => (p.how === "redcard" ? p.holder! : p.slot);
  let parts = [{ world: w, pending }];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    parts = parts.flatMap((part) => speedOrders(kernel, part.world, group.map(holderOf)).map(({ world, order }) => {
      const first = group.find((p) => holderOf(p) === order[0])!;
      return { world, pending: part.pending.filter((p) => p === first || !group.includes(p)) };
    }));
  }
  return parts;
}

/** Emergency Exit's split and its clearing of the other switchFlags (PS/data/abilities.ts:1250-1262). */
function exits(kernel: TurnKernel, w: World, pending: Pending[], cause: PendingAction | null): { world: World; pending: Pending[] }[] {
  const exiting = pending.filter((p) => p.how === "exit");
  if (!exiting.length) return [{ world: w, pending }];
  let parts: { world: World; pending: Pending[]; fired: DoublesSlotId[] }[] = [{ world: w, pending: pending.filter((p) => p.how !== "exit"), fired: [] }];
  for (const exit of exiting) {
    const slot = exit.slot;
    const max = kernel.hp[slot].maxHP;
    parts = parts.flatMap((part) => {
      const mon = part.world.mons[slot];
      if (!mon || mon.fainted) return [part];
      const below = (hp: number) => hp > 0 && hp * 2 <= max;
      return condition(part.world, slot, below).map(({ world, meets }) => {
        if (!meets) return { world, pending: part.pending, fired: part.fired };
        // Not while it is dragged or already has a switchFlag of its own (an Eject Button it used, a switch move).
        const own = part.pending.some((p) => p.slot === slot && !p.inert && (p.how !== "ejectpack" || p.used));
        if (own || sideCanSwitch(kernel.baseInput, slotSide(slot)) === false) return { world, pending: part.pending, fired: part.fired };
        const cleared = part.pending.map((p) => (!isDrag(p) && (p.how !== "ejectpack" || p.used) ? { ...p, inert: true as const } : p));
        return { world, pending: [...cleared, { ...exit }], fired: [...part.fired, slot] };
      });
    });
  }
  return parts.map((part) => {
    if (part.fired.length > 1) kernel.notEstimated(REASONS.notIn2v2("Two Emergency Exits in one move"));
    const slot = part.fired[0];
    if (slot && cause) {
      kernel.occupy(part.world);
      kernel.stepFact(cause, `${kernel.abilityName(part.world.mons[slot]!.build.abilityId)}: ${kernel.names[slot]} switches out.`, part.world.mass);
    }
    return { world: part.world, pending: part.pending };
  });
}

/** The action's AfterMove Eject Packs (onAnyAfterMove), in their holders' Speed order; a tie is one world per order. */
function ejectPacks(kernel: TurnKernel, w: World, pending: Pending[], cause: PendingAction | null): { world: World; pending: Pending[] }[] {
  const rest = pending.filter((p) => p.how !== "ejectpack" || p.used);
  const holders = DOUBLES_SLOTS.filter((slot) => w.mons[slot]?.ejectMarked && kernel.alive(w, slot));
  if (!holders.length) return [{ world: w, pending: rest }];
  return speedOrders(kernel, w, holders).map(({ world, order }) => {
    let next = rest;
    for (const slot of order) next = tryEjectPack(kernel, world, slot, next, cause);
    return { world, pending: next };
  });
}

/**
 * One marked Eject Pack's use (PS/data/items.ts:1721-1750: onUseItem needs a Pokémon to come in, its holder not commanding and
 * no switchFlag of `true` standing; onUse sets its own): the Pack used up and the switch set, or it stays marked.
 */
function tryEjectPack(kernel: TurnKernel, w: World, slot: DoublesSlotId, pending: Pending[], cause: PendingAction | null): Pending[] {
  const mon = w.mons[slot]!;
  if (mon.build.itemId !== "ejectpack" || !kernel.itemWorks(w, mon.build) || mon.fainted) { delete mon.ejectMarked; return pending; }
  if (sideCanSwitch(kernel.baseInput, slotSide(slot)) === false || presenceHooks.cannotLeave(kernel, w, slot) || pending.some(flagTrue)) return pending;
  delete mon.ejectMarked;
  consumeItem(kernel, w, slot, "ejectpack");
  // A Pokémon being dragged out leaves anyway (its switchFlag goes with clearVolatile).
  if (pending.some((p) => p.slot === slot && isDrag(p) && !p.inert)) return pending;
  if (cause) {
    kernel.occupy(w);
    kernel.stepFact(cause, `${kernel.names[slot]}'s ${kernel.itemName("ejectpack")} is used up.`, w.mass);
  }
  return [...pending.filter((p) => !(p.slot === slot && !isDrag(p))), { slot, how: "ejectpack", moveId: null, index: cause?.index ?? -1, used: true }];
}

/**
 * The action's tail with its flags set (PS/sim/battle.ts:2821-2914): the drags in Showdown's order (each Pokémon dragged out at
 * once with its newcomer's entry: dragIn runs runSwitch inside the tail), then the switch requests round by round (each round's
 * newcomers enter together; an entry can set off an Eject Pack or an Emergency Exit, which make the next round). The pending
 * switches of a world stand in its World.switching while the drags' and the rounds' entries add to it.
 */
function tail(kernel: TurnKernel, w: World, pending: Pending[], cause: PendingAction | null, after: boolean): World[] {
  const drags = pending.filter((p) => isDrag(p) && !p.inert).sort((a, b) => fieldOrder(kernel, w, a.slot) - fieldOrder(kernel, w, b.slot));
  w.switching = pending.filter((p) => !isDrag(p) && !p.inert);
  let worlds = [w];
  for (const drag of drags) {
    worlds = worlds.flatMap((world) => {
      const mon = world.mons[drag.slot];
      // dragIn needs the Pokémon to have HP still (PS/sim/battle.ts:2823-2826); its own switchFlag goes as it is dragged out.
      if (!mon || mon.fainted) return [world];
      world.switching = ((world.switching ?? []) as Pending[]).filter((p) => p.slot !== drag.slot);
      return dragIn(kernel, world, drag, cause);
    });
  }
  const out: World[] = [];
  for (let guard = 0; worlds.length; guard++) {
    if (guard > 8) kernel.notEstimated(REASONS.tooMany);
    const next: World[] = [];
    for (const world of worlds) {
      const chosen = ((world.switching ?? []) as Pending[]).filter((p) => !p.inert && !isDrag(p));
      delete world.switching;
      if (chosen.length) { next.push(...requestRound(kernel, world, chosen, cause)); continue; }
      // A marked Eject Pack still waiting (a later AfterMove, or the residual's order 29, would use it) is not followed.
      const waiting = DOUBLES_SLOTS.find((slot) => world.mons[slot]?.ejectMarked && kernel.alive(world, slot) && world.mons[slot]!.build.itemId === "ejectpack");
      if (waiting && !after) {
        kernel.occupy(world);
        kernel.notEstimated(REASONS.notIn2v2(`${kernel.names[waiting]}'s ${kernel.itemName("ejectpack")} waiting for a later move`));
      }
      for (const slot of DOUBLES_SLOTS) if (world.mons[slot]?.ejectMarked) delete world.mons[slot]!.ejectMarked;
      out.push(world);
    }
    worlds = next;
  }
  return out;
}

/** A Pokémon's place in pinned getAllActive order (side 1 then side 2, each by its Showdown position now). */
function fieldOrder(kernel: TurnKernel, w: World, slot: DoublesSlotId): number {
  const position = SHOWDOWN_POSITION[kernel.positionOf(w, slot)];
  return position.side * 2 + position.position;
}

/** The uses of `holders` in their Speed order (pinned speedSort): one world per order of each tied run, at equal mass. */
function speedOrders(kernel: TurnKernel, w: World, holders: DoublesSlotId[]): { world: World; order: DoublesSlotId[] }[] {
  if (holders.length <= 1) return [{ world: w, order: holders }];
  const speeds = new Map(holders.map((slot) => [slot, kernel.speedOf(w, slot)]));
  const sorted = [...holders].sort((a, b) => speeds.get(b)! - speeds.get(a)! || DOUBLES_SLOTS.indexOf(a) - DOUBLES_SLOTS.indexOf(b));
  let orders: DoublesSlotId[][] = [[]];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && speeds.get(sorted[j]) === speeds.get(sorted[i])) j++;
    const perms = permutations(sorted.slice(i, j));
    orders = orders.flatMap((order) => perms.map((perm) => [...order, ...perm]));
    i = j;
  }
  if (orders.length === 1) return [{ world: w, order: orders[0] }];
  return orders.map((order) => ({ world: cloneWorld(w, w.mass / orders.length), order }));
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

// ------------------------------------------------------------------------------------------------------------------
// A drag (PS/sim/battle-actions.ts:162-174 dragIn) and a switch request (PS/sim/battle.ts:2876-2914)
// ------------------------------------------------------------------------------------------------------------------

/**
 * A drag: one world per Pokémon on the side's bench (getRandomSwitchable: sample over the living bench, 1/k each), the
 * Pokémon dragged out (no BeforeSwitchOut) and its newcomer's entry at once (runSwitch inside the tail, with the drag's
 * move still active: its Mold Breaker would reach the hazards and the Starts, which is not followed).
 */
function dragIn(kernel: TurnKernel, w: World, drag: Pending, cause: PendingAction | null): World[] {
  const side = slotSide(drag.slot);
  const ids = benchOrder(kernel, w, side);
  if (!ids.length) return [w];
  const user = cause && w.mons[cause.slot];
  if (user && MOLD_BREAKERS.has(user.build.abilityId) && drag.how === "drag") {
    const hazards = hazardsOn(kernel, w, side);
    if (Object.keys(hazards).length || ids.some((id) => breakableStart(benchBuild(kernel, w, side, id)))) {
      kernel.notEstimated(REASONS.combo(kernel.moveName(drag.moveId ?? ""), kernel.abilityName(user.build.abilityId)));
    }
  }
  const by = drag.how === "redcard" ? kernel.itemName("redcard") : kernel.moveName(drag.moveId ?? "");
  return ids.flatMap((id) => {
    const world = ids.length > 1 ? cloneWorld(w, w.mass / ids.length) : w;
    kernel.occupy(world);
    const leaver = kernel.names[drag.slot];
    const unnerve = UNNERVES.has(world.mons[drag.slot]!.build.abilityId);
    return swapIn(kernel, world, drag.slot, id, null, true).flatMap((each) => {
      if (cause) kernel.stepFact(cause, `${by}: ${leaver} is dragged out; ${kernel.nameOf(each, drag.slot)} comes in.`, each.mass);
      // The Update after the tail (the newcomer's Unnerve is up by then): the Berries the leaver's Unnerve held back.
      return entry(kernel, each, [drag.slot], cause, false).flatMap((x) => (unnerve ? kernel.unnerveEnds(x, [drag.slot]) : [x]));
    });
  });
}

/**
 * One switch request: every flagged Pokémon of both sides (BeforeSwitchOut first: Pursuit in Ultra Sun/Ultra Moon,
 * beforeSwitchOut), each player's pick (`replacement` for the slot's starting Pokémon, else the first bench Pokémon in team order: a
 * turn fact), the leavers by their Speed (instaswitch actions), then one SwitchIn event for the newcomers (runSwitch) with
 * Emergency Exit for the first of them.
 */
function requestRound(kernel: TurnKernel, w: World, chosen: Pending[], cause: PendingAction | null): World[] {
  kernel.occupy(w);
  const slots = [...new Set(chosen.map((p) => p.slot))].filter((slot) => w.mons[slot] && !w.mons[slot]!.fainted);
  if (!slots.length) return [w];
  return beforeSwitchOut(kernel, w, slots, chosen).flatMap((world) => switchRound(kernel, world, chosen, cause));
}

/** One switch request's switches and entry (requestRound's, after BeforeSwitchOut): the flagged Pokémon still in. */
function switchRound(kernel: TurnKernel, w: World, chosen: Pending[], cause: PendingAction | null): World[] {
  kernel.occupy(w);
  const slots = [...new Set(chosen.map((p) => p.slot))].filter((slot) => w.mons[slot] && !w.mons[slot]!.fainted);
  if (!slots.length) return [w];
  return healthSplit(kernel, w, slots).flatMap((world) => switchPicked(kernel, world, slots, chosen, cause));
}

/**
 * The picks of a "healthiest" side (DoublesTurnInput.replacementOrder; Training's rollouts: sim/rollout.ts replacementChoice)
 * for its leavers in their positions' order: the bench Pokémon now by HP share, highest first, ties in team order. `hpOf`:
 * a leaver's HP where it left with more than one (healthSplit), else its own.
 */
function healthiestPicks(kernel: TurnKernel, w: World, side: DoublesSideId, count: number, hpOf: (id: string) => number | undefined): string[] {
  const ids = benchOrder(kernel, w, side);
  const share = (id: string) => {
    const left = w.benched?.[side]?.find((each) => each.id === id && !each.back);
    const build = left ? left.mon.build : benchInput(kernel, side, id)?.build;
    if (!build) return 0;
    const { maxHP, hp } = turnHP(build, kernel.runtime);
    const now = left ? hpOf(id) ?? left.hp[0][0] : hp;
    return maxHP ? now / maxHP : 0;
  };
  const shares = new Map(ids.map((id) => [id, share(id)]));
  return [...ids].sort((a, b) => shares.get(b)! - shares.get(a)! || ids.indexOf(a) - ids.indexOf(b)).slice(0, count);
}

/**
 * Training's "healthiest" picks read the HP of a Pokémon that left earlier this turn, a marginal on its bench entry: one world
 * per set of its HP values that gives the same picks (the world's mass split by that HP's chance; the entry's HP narrowed to
 * them). Two such Pokémon whose HP both decide: one world per pair of values. `w` itself where nothing splits it.
 */
function healthSplit(kernel: TurnKernel, w: World, slots: DoublesSlotId[]): World[] {
  let worlds = [w];
  for (const side of ["own", "opponent"] as const) {
    if (kernel.baseInput.replacementOrder?.[side] !== "healthiest") continue;
    const count = slots.filter((slot) => slotSide(slot) === side).length;
    if (!count) continue;
    worlds = worlds.flatMap((world) => {
      const ids = benchOrder(kernel, world, side);
      const multi = (world.benched?.[side] ?? []).filter((each) => !each.back && each.hp.length > 1 && ids.includes(each.id));
      if (!multi.length) return [world];
      // Every combination of the multi-valued leavers' HP, with its chance, grouped by the picks it gives.
      let combos: { values: Map<string, number>; chance: number }[] = [{ values: new Map(), chance: 1 }];
      for (const entry of multi) combos = combos.flatMap((combo) => entry.hp.map(([hp, chance]) => ({ values: new Map([...combo.values, [entry.id, hp]]), chance: combo.chance * chance })));
      if (combos.length > 256) kernel.notEstimated(REASONS.tooMany);
      const groups = new Map<string, typeof combos>();
      for (const combo of combos) {
        const key = healthiestPicks(kernel, world, side, count, (id) => combo.values.get(id)).join("|");
        groups.set(key, [...(groups.get(key) ?? []), combo]);
      }
      if (groups.size === 1) return [world];
      const parts = multi.length === 1 ? [...groups.values()] : combos.map((combo) => [combo]);
      return parts.map((part) => {
        const total = part.reduce((sum, combo) => sum + combo.chance, 0);
        const next = cloneWorld(world, world.mass * total);
        next.benched = {
          ...next.benched, [side]: next.benched![side]!.map((each) => {
            if (!multi.some((entry) => entry.id === each.id) || each.back) return each;
            const narrowed = new Map<number, number>();
            for (const combo of part) narrowed.set(combo.values.get(each.id)!, (narrowed.get(combo.values.get(each.id)!) ?? 0) + combo.chance / total);
            return { ...each, hp: [...narrowed].sort((a, b) => a[0] - b[0]) as [number, number][] };
          }),
        };
        return next;
      });
    });
  }
  return worlds;
}

/** switchRound's picks, switches and entry in one world. */
function switchPicked(kernel: TurnKernel, w: World, slots: DoublesSlotId[], chosen: Pending[], cause: PendingAction | null): World[] {
  kernel.occupy(w);
  // The picks, side by side: distinct Pokémon of the side's bench.
  const picks = new Map<DoublesSlotId, string>();
  for (const side of ["own", "opponent"] as const) {
    const order = kernel.baseInput.replacementOrder?.[side];
    let leavers = slots.filter((slot) => slotSide(slot) === side);
    if (!leavers.length) continue;
    // A side with a replacement order picks in its leavers' positions' order (as the rollouts answer a request).
    if (order) leavers = [...leavers].sort((a, b) => fieldOrder(kernel, w, a) - fieldOrder(kernel, w, b));
    const ids = benchOrder(kernel, w, side);
    const taken = new Set<string>();
    const ranked = order === "healthiest" ? healthiestPicks(kernel, w, side, ids.length, (id) => {
      const hp = w.benched?.[side]?.find((each) => each.id === id && !each.back)?.hp;
      return hp?.length === 1 ? hp[0][0] : undefined;
    }) : order ?? null;
    for (const slot of leavers) {
      const mon = w.mons[slot]!;
      const wanted = mon.id === undefined && !mon.entered ? kernel.baseInput.replacement?.[slot] : undefined;
      let id = wanted !== undefined && ids.includes(wanted) && !taken.has(wanted) ? wanted : undefined;
      // The side's replacement order (Training): no fact.
      if (id === undefined && ranked) id = ranked.find((each) => ids.includes(each) && !taken.has(each));
      if (id === undefined) {
        // The default: the first Pokémon of the input bench still on it (its order), else the first in team order (one that left).
        const inputOrder = (kernel.baseInput.bench?.[side] ?? []).map((each) => each.id);
        id = inputOrder.find((each) => ids.includes(each) && !taken.has(each)) ?? ids.find((each) => !taken.has(each));
        if (id === undefined) continue;
        kernel.turnFact(`Assumes ${monName(kernel, id)} comes in for ${kernel.names[slot]}.`);
      }
      taken.add(id);
      picks.set(slot, id);
    }
  }
  const leaving = [...picks.keys()];
  if (!leaving.length) return [w];
  // The instaswitch actions by the leavers' Speed (sim/battle-queue.ts order 3), then runSwitch for the newcomers.
  return speedOrders(kernel, w, leaving).flatMap(({ world, order }) => {
    let worlds = [world];
    for (const slot of order) {
      const p = chosen.find((each) => each.slot === slot)!;
      const copy = p.how === "status" && p.moveId === "batonpass" ? "copyvolatile" : p.how === "status" && p.moveId === "shedtail" ? "shedtail" : null;
      worlds = worlds.flatMap((each) => {
        kernel.occupy(each);
        const leaver = kernel.names[slot];
        return swapIn(kernel, each, slot, picks.get(slot)!, copy, false).map((next) => {
          if (cause) kernel.stepFact(cause, `${leaver} switches out; ${kernel.nameOf(next, slot)} comes in.`, next.mass);
          return next;
        });
      });
    }
    return worlds.flatMap((each) => entry(kernel, each, order, cause, true));
  });
}

/**
 * BeforeSwitchOut of each flagged Pokémon but a Baton Pass or Shed Tail user, side by side (PS/sim/battle.ts:2883-2900): Pursuit (Ultra Sun/Ultra Moon; PS/data/moves.ts
 * pursuit condition onBeforeSwitchOut): each foe whose queued action is Pursuit, faster first, has it cancelled and used now at
 * the leaver's position with its power doubled (basePowerCallback: target.switchFlag; doubles-presence.ts context reads
 * World.switching), after the leaver's Destiny Bond ends (pokemon.removeVolatile('destinybond')); a leaver that faints does
 * not switch. A switch the Pursuit sets off itself is not followed.
 */
function beforeSwitchOut(kernel: TurnKernel, w: World, slots: DoublesSlotId[], chosen: Pending[]): World[] {
  if (!w.remaining.some((queued) => queued.moveId === "pursuit")) return [w];
  // Baton Pass and Shed Tail set skipBeforeSwitchOutEventFlag on their user (PS/data/moves.ts:1108-1111, 16189-16192 self.onHit),
  // so its switch request runs no BeforeSwitchOut (PS/sim/battle.ts:2894-2896) and no Pursuit meets it as it leaves.
  const skips = (slot: DoublesSlotId) => chosen.some((p) => p.slot === slot && p.how === "status" && (p.moveId === "batonpass" || p.moveId === "shedtail"));
  const order = slots.filter((slot) => !skips(slot)).sort((a, b) => fieldOrder(kernel, w, a) - fieldOrder(kernel, w, b));
  let worlds = [w];
  for (const leaver of order) {
    worlds = worlds.flatMap((world) => {
      const pursuers = world.remaining.filter((queued) => queued.moveId === "pursuit" && kernel.isFoe(queued.slot, leaver) && kernel.alive(world, queued.slot))
        .sort((a, b) => kernel.speedOf(world, b.slot) - kernel.speedOf(world, a.slot));
      let out = [world];
      for (const queued of pursuers) {
        out = out.flatMap((x) => {
          if (!kernel.alive(x, queued.slot) || !kernel.alive(x, leaver) || !x.remaining.includes(queued)) return [x];
          x.remaining = x.remaining.filter((each) => each !== queued);
          // The leaver's Destiny Bond ends before the Pursuit (pokemon.removeVolatile('destinybond')).
          delete x.mons[leaver]!.destinyBond;
          x.switching = chosen.map((p) => ({ ...p }));
          kernel.occupy(x);
          return kernel.runAction(x, { ...queued, target: kernel.positionOf(x, leaver) }).map((after) => {
            if ((after.switching?.length ?? 0) !== chosen.length) kernel.notEstimated(REASONS.combo(kernel.moveName("pursuit"), "a switch it sets off"));
            delete after.switching;
            return after;
          });
        });
      }
      return out;
    });
  }
  return worlds;
}

// ------------------------------------------------------------------------------------------------------------------
// The bench
// ------------------------------------------------------------------------------------------------------------------

/** The side's bench now in Showdown's team order (World.bench; absent: the input's order). */
function benchOrder(kernel: TurnKernel, w: World, side: DoublesSideId): string[] {
  return w.bench?.[side] ?? (kernel.baseInput.bench?.[side] ?? []).map((each) => each.id);
}

/** The input's bench Pokémon with `id`. */
function benchInput(kernel: TurnKernel, side: DoublesSideId, id: string): DoublesBenchPokemon | undefined {
  return kernel.baseInput.bench?.[side]?.find((each) => each.id === id);
}

/** A bench Pokémon's build now: a leaver's as it left, else the input's. */
function benchBuild(kernel: TurnKernel, w: World, side: DoublesSideId, id: string): BattleBuild {
  const left = w.benched?.[side]?.find((each) => each.id === id && !each.back);
  return left ? left.mon.build : benchInput(kernel, side, id)!.build;
}

/** The text name of the Pokémon with `id` (a bench id, or a slot's startId). */
function monName(kernel: TurnKernel, id: string): string {
  if (id.startsWith("slot:")) return kernel.startNames[id.slice(5) as DoublesSlotId] ?? id;
  return kernel.benchNames[id] ?? id;
}

/** The ability of a build that would start as it came in and that a Mold Breaker move suppresses (flags.breakable). */
function breakableStart(build: BattleBuild): boolean {
  return ["flowergift", "iceface", "windrider", "pastelveil"].includes(build.abilityId);
}

// ------------------------------------------------------------------------------------------------------------------
// The switch itself (PS/sim/battle-actions.ts:62-160 switchIn)
// ------------------------------------------------------------------------------------------------------------------

/**
 * `slot`'s Pokémon leaves and `id` comes in (the newcomer's entry is the caller's): one world, or more where the leaver's
 * Unnerve ending lets a foe's Berry be eaten. `copy`: Baton Pass's ("copyvolatile") or Shed Tail's ("shedtail") copy. `drag`:
 * a drag (dragIn): the Update with the Berries an Unnerve held back comes after the newcomer's entry (the caller's).
 */
function swapIn(kernel: TurnKernel, w: World, slot: DoublesSlotId, id: string, copy: "copyvolatile" | "shedtail" | null, drag: boolean): World[] {
  const side = slotSide(slot);
  const leaver = w.mons[slot]!;
  const leaverId = leaver.id ?? startId(slot);
  if (isMaxActive(leaver.build)) kernel.notEstimated(REASONS.notIn2v2(`${kernel.names[slot]} switching out while Dynamaxed`));
  // The queued action is cancelled (cancelAction): its step's skip fact.
  for (const action of w.remaining) if (action.slot === slot && action.moveId !== null) kernel.skipFact(action, drag ? "Is dragged out before it moves." : "Switches out before it moves.", w.mass);
  w.remaining = w.remaining.filter((action) => action.slot !== slot);
  // SwitchOut: Regenerator (pokemon.heal: no TryHeal, so Heal Block does not stop it), Natural Cure, Zero to Hero.
  switchOutEffects(kernel, w, slot);
  // The ability's End: Neutralizing Gas ending (not followed while a Pokémon it suppressed is still in), a strong weather with
  // its last holder (PS/data/abilities.ts desolateland and its kin onEnd), Unnerve and As One (the foes' Berries).
  kernel.gasEnds(w, slot);
  const field = fieldKey(kernel, w);
  const ability = w.mons[slot]!.build.abilityId;
  const unnerve = UNNERVES.has(ability);
  if (STRONG_WEATHERS[w.field.weather] === ability && !DOUBLES_SLOTS.some((other) => other !== slot && kernel.alive(w, other) && w.mons[other]!.build.abilityId === ability)) {
    w.field = { ...w.field, weather: "" };
  }
  const passed = copy ? copiedState(kernel, w, slot, copy) : null;
  const mon = w.mons[slot]!;
  const hp = takeOut(w, slot);
  const benchMon = benchState(kernel, slot, mon);
  forget(w, slot);
  // The newcomer: a bench Pokémon from the input, or one that left earlier this turn (its state as it left).
  const left = w.benched?.[side]?.find((each) => each.id === id && !each.back);
  const fresh: MonState = left ? { ...left.mon, vol: { ...left.mon.vol }, eot: { ...left.mon.eot }, damagedBy: [] } : newcomer(kernel, benchInput(kernel, side, id)!);
  fresh.entered = true;
  fresh.moved = true;
  // After the residual (doubles-eot.ts afterTurn): the switch after the turn (DoublesEndOfTurn.replaced).
  if (kernel.inEndOfTurn) fresh.late = true; else delete fresh.late;
  if (id === startId(slot)) delete fresh.id; else fresh.id = id;
  // The slot conditions stay with the position: Wish, a Future Sight or Doom Desire landing.
  if (mon.eot.wish !== undefined) fresh.eot = { ...fresh.eot, wish: mon.eot.wish };
  if (mon.eot.futureMove) fresh.eot = { ...fresh.eot, futureMove: mon.eot.futureMove };
  const newHP: readonly (readonly [number, number])[] = left ? left.hp : [[turnHP(benchInput(kernel, side, id)!.build, kernel.runtime).hp, 1]];
  // The leaver to the bench (its team place is the newcomer's: sim/battle-actions.ts:126-132), the newcomer out of it.
  const order = benchOrder(kernel, w, side).map((each) => (each === id ? leaverId : each));
  const list = (w.benched?.[side] ?? []).map((each) => (each.id === id && !each.back ? { ...each, back: true as const } : each));
  w.benched = { ...w.benched, [side]: [...list, { id: leaverId, slot, mon: benchMon, hp, ...(kernel.inEndOfTurn ? { late: true as const } : {}) }] };
  w.bench = { ...w.bench, [side]: order };
  // An Unnerve or As One that left: the foes' Berries at the Update after this switch, before the newcomer's entry
  // (sim/battle.ts:2861; a drag's newcomer is in first: dragIn runs runSwitch at once, so its own Unnerve stops them).
  let worlds = [w];
  if (unnerve && !drag) {
    w.mons[slot] = { ...mon, fainted: true };
    worlds = kernel.unnerveEnds(w, [slot]);
  }
  for (const world of worlds) {
    world.mons[slot] = { ...fresh, vol: { ...fresh.vol }, eot: { ...fresh.eot }, damagedBy: [] };
    underGas(kernel, world, slot);
    putIn(world, slot, newHP);
    if (passed) passed(world);
    historyHooks.entryChanged(kernel, world, slot);
    kernel.occupy(world);
    // Cloud Nine, Air Lock and a strong weather leaving: the field re-settle (FC), with the newcomer in place (its own Start reads the same field).
    if (fieldKey(kernel, world) !== field) fieldChangeHooks.changed(kernel, world, field, kernel.acting ?? undefined);
  }
  return worlds;
}

/**
 * A newcomer under the turn's Neutralizing Gas, its holder still in (PS/sim/pokemon.ts ignoringAbility): its ability is
 * suppressed (the gas stand-in, its own kept in MonState.gassed for the kernel's gas view) unless it cannot be (a gas-proof
 * ability) or a working Ability Shield keeps it (the gas view's shielded).
 */
function underGas(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  delete mon.gassed;
  const gas = kernel.baseInput && gasHolders(kernel, w);
  if (!gas) return;
  const ability = mon.build.abilityId;
  if (GAS_PROOF_ABILITIES.has(ability) || ability === GAS_STAND_IN) return;
  if (mon.build.itemId === "abilityshield" && !w.field.magicRoom && !mon.build.itemSuppressed) return;
  mon.gassed = ability;
  mon.build = { ...mon.build, abilityId: GAS_STAND_IN };
}

/** The turn's Neutralizing Gas holders still in their slots (the gas as the turn started: doubles-turn.ts' base gas). */
function gasHolders(kernel: TurnKernel, w: World): boolean {
  const gas = kernel.gas;
  return !!gas && gas.holders.some((holder) => kernel.alive(w, holder) && w.mons[holder]!.id === undefined);
}

/** The field as A1's and FC's key reads it: weather, effective weather, terrain. */
const fieldKey = (kernel: TurnKernel, w: World) => `${w.field.weather}|${kernel.effectiveWeather(w)}|${w.field.terrain}`;

/** The leaver's SwitchOut handlers (PS/data/abilities.ts regenerator, naturalcure, zerotohero onSwitchOut), on its own ability. */
function switchOutEffects(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  const ability = mon.build.abilityId;
  if (ability === "regenerator") {
    const { maxHP, baseMaxHP } = kernel.hp[slot];
    const heal = Math.trunc(baseMaxHP / 3);
    const [only] = mapHP(w, slot, (hp) => {
      if (hp <= 0 || hp >= maxHP || heal <= 0) return { hp, tag: "" };
      const healed = Math.min(maxHP, hp + heal);
      kernel.noteHeal(slot, kernel.abilityName("regenerator"), healed - hp);
      return { hp: healed, tag: "" };
    });
    w.factors = only.world.factors;
  }
  if (ability === "naturalcure" && mon.build.status) {
    mon.build = { ...mon.build, status: "" };
    setVol(w, slot, { sleep: undefined, freeze: undefined });
    setEot(w, slot, { toxic: undefined });
  }
  if (ability === "zerotohero") {
    const species = kernel.runtime.speciesById.get(mon.build.speciesId);
    if (species?.baseSpecies?.toLowerCase() === "palafin" && mon.build.speciesId !== "palafinhero") {
      if (!kernel.runtime.speciesById.has("palafinhero")) kernel.notEstimated(REASONS.formChange(kernel.abilityName("zerotohero"), kernel.names[slot]));
      mon.build = withSpecies(mon.build, "palafinhero");
    }
  }
}

/** The forms a Pokémon leaves behind as it switches out (setSpecies(baseSpecies) in clearVolatile: the forms that are not permanent). */
const TEMPORARY_FORMS: Readonly<Record<string, string>> = {
  aegislashblade: "aegislash", darmanitanzen: "darmanitan", darmanitangalarzen: "darmanitangalar", wishiwashischool: "wishiwashi",
  castformsunny: "castform", castformrainy: "castform", castformsnowy: "castform", cherrimsunshine: "cherrim", morpekohangry: "morpeko",
  cramorantgulping: "cramorant", cramorantgorging: "cramorant", meloettapirouette: "meloetta",
};

/**
 * The leaver's state on the bench (PS/sim/pokemon.ts clearVolatile): its stages 0, every volatile gone (its sleep and freeze
 * counters and the once-a-battle effects stay with it), its ability, types and form back (a permanent form stays: Mega,
 * Primal, Terastallization, Busted Disguise, Ice Face's Noice, Palafin's Hero), its HP, status and item as they are.
 */
function benchState(kernel: TurnKernel, slot: DoublesSlotId, mon: MonState): MonState {
  const own = mon.id === undefined || mon.id.startsWith("slot:")
    ? kernel.baseInput.pokemon[mon.id === undefined ? slot : mon.id.slice(5) as DoublesSlotId]!.build
    : benchInput(kernel, slotSide(slot), mon.id)?.build ?? mon.build;
  let build: BattleBuild = mon.build;
  if (build.transformedFrom) build = { ...own, status: build.status, itemId: build.itemId, mechanic: build.mechanic, configuration: build.configuration };
  const form = TEMPORARY_FORMS[build.speciesId];
  if (form) build = withSpecies(build, form);
  // Its own ability (pokemon.baseAbility): under Gastro Acid or the gas stand-in its real one; after a change this turn its own.
  let ability = build.abilityId;
  if (mon.gassed !== undefined) ability = mon.gassed;
  else if (mon.vol.gastroAcid !== undefined) ability = mon.vol.gastroAcid;
  else if (ability === GAS_STAND_IN && mon.id === undefined) ability = kernel.gas?.abilities[slot] ?? own.abilityId;
  if (build.abilityChanged) ability = own.abilityId;
  const next: BattleBuild = { ...build, abilityId: ability, abilityActive: defaultAbilityActive(ability), currentHP: null, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };
  for (const key of ["types", "addedType", "storedStats", "weighthg", "tracedAbility", "settledDownload", "settledBoostedStat", "settledFocusEnergy", "focusEnergy",
    "dragonCheer", "abilityChanged", "itemSuppressed", "copiedIntimidateStored", "settledCustap", "transformedFrom"] as const) delete (next as Record<string, unknown>)[key];
  const vol: MonState["vol"] = {};
  if (next.status === "slp" && mon.vol.sleep) vol.sleep = mon.vol.sleep;
  if (next.status === "frz" && mon.vol.freeze) vol.freeze = mon.vol.freeze;
  if (mon.vol.onceUsed?.length) vol.onceUsed = mon.vol.onceUsed;
  return {
    build: next, fainted: false, moved: mon.moved, flinched: null, focusLost: false, charged: false, protect: null, centre: null, helpingHand: 0, hurt: false,
    damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false, vol, eot: {}, ...(mon.id !== undefined ? { id: mon.id } : {}),
  };
}

/**
 * A bench Pokémon coming in for the first time: its build (HP in the factors), its kept counters, no action. A Terastallized
 * Ogerpon is its mask's Tera form with that form's ability (PS/sim/battle-actions.ts terastallize: formeChange(…, true), a
 * permanent form; every Ogerpon form has the same stats), as the turn's start settles one in play (calculate.ts settleAbilities).
 */
function newcomer(kernel: TurnKernel, bench: DoublesBenchPokemon): MonState {
  let build: BattleBuild = { ...bench.build, currentHP: null };
  const form = build.mechanic === "tera" ? specialTeraForm(build, kernel.runtime) : null;
  const formSpecies = form?.startsWith("ogerpon") ? kernel.runtime.speciesById.get(form) : undefined;
  if (formSpecies) {
    const abilityId = formSpecies.abilities[0];
    build = { ...withSpecies(build, formSpecies.id), abilityId, abilityActive: defaultAbilityActive(abilityId) };
  }
  const carried = bench.carried ?? {};
  const vol: MonState["vol"] = {};
  if (build.status === "slp") vol.sleep = { elapsed: (carried.sleep?.attempts ?? 0) * (build.abilityId === "earlybird" ? 2 : 1), rest: carried.sleep?.rest ?? false };
  if (build.status === "frz" && kernel.champions) vol.freeze = { attempts: carried.freeze?.attempts ?? 0 };
  if (carried.onceUsed?.length) vol.onceUsed = [...carried.onceUsed];
  // Bad poison's stage restarts as it comes in (PS/data/conditions.ts tox onSwitchIn).
  const eot: MonState["eot"] = build.status === "tox" ? { toxic: 0 } : {};
  if (build.status === "slp" && !carried.sleep) kernel.turnFact(`Assumes ${monName(kernel, bench.id)} has not lost a turn to sleep yet.`);
  return {
    build, fainted: false, moved: true, flinched: null, focusLost: false, charged: false, protect: null, centre: null, helpingHand: 0, hurt: false,
    damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false, vol, eot, id: bench.id, entered: true,
  };
}

/**
 * The leaver's references from the other Pokémon end as it leaves (the volatiles whose source must be active, or linked to it):
 * a partial trap but G-Max Centiferno's and Sandblast's (PS/data/conditions.ts partiallytrapped onResidual), Syrup Bomb, Attract
 * (onUpdate), Lock-On, Octolock, the trappers of Block and its kin (linked volatiles), and the attackers its Revenge, Avalanche
 * and Assurance read (attackedBy is a Pokémon's).
 */
function forget(w: World, slot: DoublesSlotId) {
  for (const other of DOUBLES_SLOTS) {
    const mon = w.mons[other];
    if (!mon || other === slot) continue;
    if (mon.eot.trap?.source === slot && !mon.eot.trap.gmax) mon.eot = { ...mon.eot, trap: undefined };
    if (mon.eot.syrupBomb === slot) mon.eot = { ...mon.eot, syrupBomb: undefined };
    if (mon.eot.octolock === slot) mon.eot = { ...mon.eot, octolock: undefined };
    if (mon.vol.attract === slot) mon.vol = { ...mon.vol, attract: undefined };
    if (mon.vol.lockOn === slot) mon.vol = { ...mon.vol, lockOn: undefined };
    if (mon.vol.trappers?.includes(slot)) {
      const trappers = mon.vol.trappers.filter((each) => each !== slot);
      mon.vol = { ...mon.vol, trappers: trappers.length ? trappers : undefined, ...(trappers.length ? {} : { trapped: undefined }) };
    }
    if (mon.damagedBy.includes(slot)) mon.damagedBy = mon.damagedBy.filter((each) => each !== slot);
  }
}

/**
 * Baton Pass's and Shed Tail's copy (PS/sim/pokemon.ts copyVolatileFrom): Shed Tail passes only its Substitute; Baton Pass
 * the stages and every volatile without noCopy that the turn holds: confusion, Substitute, Leech Seed, a partial trap, Aqua
 * Ring, Ingrain, Curse, the perish count, Magnet Rise, Heal Block, Telekinesis, Embargo, Taunt, Focus Energy, Dragon Cheer,
 * Laser Focus, Charge, Tar Shot, No Retreat, Octolock. Gastro Acid, Power Trick and Power Shift passed are not followed.
 */
function copiedState(kernel: TurnKernel, w: World, slot: DoublesSlotId, copy: "copyvolatile" | "shedtail"): (world: World) => void {
  const mon = w.mons[slot]!;
  const { vol, eot, build } = mon;
  if (copy === "copyvolatile" && (vol.gastroAcid !== undefined || vol.powerTrick || vol.powerShift)) {
    kernel.notEstimated(REASONS.combo(kernel.moveName("batonpass"), vol.gastroAcid !== undefined ? kernel.moveName("gastroacid") : kernel.moveName(vol.powerTrick ? "powertrick" : "powershift")));
  }
  return (world) => {
    const to = world.mons[slot]!;
    if (vol.substitute) to.vol = { ...to.vol, substitute: vol.substitute };
    if (copy === "shedtail") return;
    to.build = { ...to.build, boosts: { ...build.boosts } };
    const stages = vol.stages;
    to.vol = {
      ...to.vol, ...(stages ? { stages: { ...stages } } : {}), ...(vol.confusion ? { confusion: vol.confusion } : {}), ...(vol.taunt ? { taunt: true as const } : {}),
      ...(vol.laserFocus ? { laserFocus: true as const } : {}), ...(vol.tarShot ? { tarShot: true as const } : {}), ...(vol.noRetreat ? { noRetreat: true as const } : {}),
    };
    const kept: MonState["eot"] = {};
    for (const key of ["leechSeed", "trap", "aquaRing", "ingrain", "curse", "perish", "magnetRise", "healBlock", "healBlockLeft", "telekinesis", "embargo", "tauntLeft", "octolock"] as const) {
      if (eot[key] !== undefined) (kept as Record<string, unknown>)[key] = eot[key];
    }
    to.eot = { ...to.eot, ...kept };
    if (eot.embargo !== undefined) to.build = { ...to.build, itemSuppressed: true };
    if (build.focusEnergy || build.settledFocusEnergy) to.build = { ...to.build, focusEnergy: true };
    if (build.dragonCheer) to.build = { ...to.build, dragonCheer: build.dragonCheer };
    if (mon.charged) to.charged = true;
  };
}

/** An item used up (useItem: gone, Unburden, item history). */
function consumeItem(kernel: TurnKernel, w: World, slot: DoublesSlotId, item: string) {
  const mon = w.mons[slot];
  if (!mon || mon.build.itemId !== item) return;
  mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  kernel.noteItemUse(w, slot, item);
}

// ------------------------------------------------------------------------------------------------------------------
// The entry (PS/sim/battle-actions.ts:175-191 runSwitch: fieldEvent('SwitchIn'))
// ------------------------------------------------------------------------------------------------------------------

/** One handler of the SwitchIn event: its holder, priority, subOrder, and its run on a world (more than one where random). */
type EntryHandler = { holder: DoublesSlotId; priority: number; subOrder: number; run: (w: World) => World[] };

/** The SwitchIn priority of an ability's Start or switch-in handler (PS/data/abilities.ts onSwitchInPriority; 0 when none). */
const ABILITY_PRIORITY: Readonly<Record<string, number>> = {
  neutralizinggas: 2, terashift: 2, unnerve: 1, asoneglastrier: 1, asonespectrier: 1, klutz: 1,
  mimicry: -1, schooling: -1, shieldsdown: -1,
  costar: -2, flowergift: -2, forecast: -2, hospitality: -2, iceface: -2, protosynthesis: -2, quarkdrive: -2,
};
/** The SwitchIn priority of an item's Start (PS/data/items.ts onSwitchInPriority). */
const ITEM_PRIORITY: Readonly<Record<string, number>> = {
  boosterenergy: -2, electricseed: -1, grassyseed: -1, mistyseed: -1, psychicseed: -1, roomservice: -1, blueorb: -1, redorb: -1,
};
/** The Terrain Seeds (PS/data/items.ts electricseed and its kin onStart: used in their terrain, +1 to the stat from itself). */
const SEEDS: Readonly<Record<string, { terrain: string; stat: CombatStat }>> = {
  electricseed: { terrain: "Electric", stat: "def" }, grassyseed: { terrain: "Grassy", stat: "def" }, mistyseed: { terrain: "Misty", stat: "spd" }, psychicseed: { terrain: "Psychic", stat: "spd" },
};

/**
 * The newcomers' entry in one SwitchIn event (`entrants`, the slots they came into): the handlers of every Pokémon in
 * Showdown's sort (priority, then Speed with each tie one world per order, then subOrder), then the Update's Berries of the
 * newcomers and, for a switch request's runSwitch (`request`), Emergency Exit on its first newcomer. Pending switches it sets
 * (an Eject Pack at −4, Emergency Exit) are left in World.switching for the next round.
 */
function entry(kernel: TurnKernel, w: World, entrants: DoublesSlotId[], cause: PendingAction | null, request: boolean): World[] {
  kernel.occupy(w);
  const present = entrants.filter((slot) => kernel.alive(w, slot));
  if (!present.length) return [w];
  // The leaders' HP as runSwitch starts (pokemonOriginalHP: Emergency Exit's line), the fastest newcomer's.
  const all = DOUBLES_SLOTS.filter((slot) => kernel.alive(w, slot));
  return speedOrders(kernel, w, all).flatMap(({ world, order }) => {
    kernel.occupy(world);
    const rank = (slot: DoublesSlotId) => order.length - order.indexOf(slot);
    const first = [...present].sort((a, b) => rank(b) - rank(a))[0];
    const above = request && ["emergencyexit", "wimpout"].includes(world.mons[first]!.build.abilityId)
      ? [...marginal(world, first).keys()].every((hp) => hp * 2 > kernel.hp[first].maxHP) : false;
    const handlers: (EntryHandler & { speed: number })[] = [];
    for (const slot of present) handlers.push(...entrantHandlers(kernel, world, slot, cause).map((handler) => ({ ...handler, speed: rank(slot) })));
    // Everyone's onAnySwitchIn: White Herb (−2), the copies (−3: D's ledger, applied in their holders' Speed order), Eject Pack (−4).
    handlers.push({ holder: first, priority: -2, subOrder: 8, speed: 0, run: (x) => { for (const slot of DOUBLES_SLOTS) if (kernel.alive(x, slot)) whiteHerbAfterMove(kernel, x, slot, undefined); return [x]; } });
    handlers.push({ holder: first, priority: -3, subOrder: 7, speed: 0, run: (x) => (cause ? guardHooks.afterMoveCopies(kernel, x, cause) : null) ?? [x] });
    handlers.push({ holder: first, priority: -4, subOrder: 8, speed: 0, run: (x) => ejectAtSwitchIn(kernel, x, cause) });
    handlers.sort((a, b) => b.priority - a.priority || b.speed - a.speed || a.subOrder - b.subOrder);
    let worlds = [world];
    const before = new Map(DOUBLES_SLOTS.map((slot) => [slot, world.mons[slot] ? { ...world.mons[slot]!.build.boosts } : null]));
    const fieldBefore = fieldKey(kernel, world);
    for (const handler of handlers) {
      worlds = worlds.flatMap((x) => {
        kernel.occupy(x);
        // A fainted holder's handlers do not run (sim/battle.ts fieldEvent), but onAnySwitchIn's (holder `first`, speed 0) of the others.
        if (handler.speed && !kernel.alive(x, handler.holder)) return [x];
        return handler.run(x);
      });
    }
    // The Update after the entry (sim/battle.ts:2861): each newcomer's Berry for its HP or status.
    worlds = worlds.flatMap((x) => {
      kernel.occupy(x);
      let out = [x];
      for (const slot of present) out = out.flatMap((y) => (kernel.alive(y, slot) && !kernel.berryStopped(y, slot) ? kernel.berryDue(y, slot) : [y]));
      return out;
    });
    // The entry's stage changes and field change as facts on the action that caused the switch.
    for (const x of worlds) entryFacts(kernel, x, before, fieldBefore, cause, present);
    // Emergency Exit after a switch request's runSwitch (sim/battle.ts:2870-2874), on its first newcomer only.
    if (request && above) {
      worlds = worlds.flatMap((x) => {
        const mon = x.mons[first];
        if (!mon || mon.fainted || sideCanSwitch(kernel.baseInput, slotSide(first)) === false) return [x];
        if ((x.switching as Pending[] | undefined)?.some((p) => p.slot === first)) return [x];
        const max = kernel.hp[first].maxHP;
        return condition(x, first, (hp) => hp > 0 && hp * 2 <= max).map(({ world: part, meets }) => {
          if (meets) {
            part.switching = [...((part.switching ?? []) as Pending[]).filter((p) => isDrag(p)), { slot: first, how: "exit", moveId: null, index: cause?.index ?? -1 }];
            if (cause) kernel.stepFact(cause, `${kernel.abilityName(mon.build.abilityId)}: ${kernel.nameOf(part, first)} switches out.`, part.mass);
          }
          return part;
        });
      });
    }
    // The ledger of this entry's boosts has no later reader (eventGuards reads the next action's own).
    for (const x of worlds) delete x.boosted;
    return worlds;
  });
}

/**
 * The SwitchIn handlers of one newcomer: its side's hazards (subOrder 4), its ability's Start or switch-in handler (7), its
 * item's Start (8), at their priorities.
 */
function entrantHandlers(kernel: TurnKernel, w: World, slot: DoublesSlotId, cause: PendingAction | null): EntryHandler[] {
  const mon = w.mons[slot]!;
  const out: EntryHandler[] = [];
  const side = slotSide(slot);
  if (Object.keys(hazardsOn(kernel, w, side)).length) out.push({ holder: slot, priority: 0, subOrder: 4, run: (x) => hazards(kernel, x, slot) });
  const ability = mon.build.abilityId;
  out.push({ holder: slot, priority: ABILITY_PRIORITY[ability] ?? 0, subOrder: 7, run: (x) => abilityEntry(kernel, x, slot, cause) });
  const item = mon.build.itemId;
  if (item && (SEEDS[item] || item === "roomservice" || item === "boosterenergy" || item === "blueorb" || item === "redorb")) {
    out.push({ holder: slot, priority: ITEM_PRIORITY[item] ?? 0, subOrder: 8, run: (x) => itemEntry(kernel, x, slot, item) });
  }
  return out;
}

/**
 * A newcomer's ability as it switches in: A1's Start (abilityStart "entered": Intimidate, Download, Trace, the weather and
 * terrain setters, Costar, Hospitality, Curious Medicine, Supersweet Syrup, Intrepid Sword, Dauntless Shield, Wind Rider, Screen
 * Cleaner, Pastel Veil, Air Lock, Cloud Nine, Mimicry, Klutz, Forecast, Flower Gift; A1's guards), Imposter through A1's
 * Transform, the paradox abilities (their field, else Booster Energy's own handler). Not followed: a Neutralizing Gas
 * newcomer (REASONS.entersWithGas), one under Neutralizing Gas, Commander forming a pair, Tera Shift, Zero to Hero's message.
 */
function abilityEntry(kernel: TurnKernel, w: World, slot: DoublesSlotId, cause: PendingAction | null): World[] {
  const mon = w.mons[slot]!;
  const ability = mon.build.abilityId;
  const name = kernel.names[slot];
  if (ability === "neutralizinggas") kernel.notEstimated(REASONS.entersWithGas(name));
  // Under the turn's Neutralizing Gas the newcomer's ability is suppressed (underGas: the stand-in): no Start.
  if (ability === GAS_STAND_IN) return [w];
  if (ability === "terashift") kernel.notEstimated(REASONS.abilityStart(kernel.abilityName(ability), name));
  // Commander: a Tatsugiri and a Dondozo side by side as one comes in (PS/data/abilities.ts commander onAnySwitchIn).
  const partner = DOUBLES_SLOTS.find((other) => other !== slot && slotSide(other) === slotSide(slot));
  const pair = partner && kernel.alive(w, partner) ? [w.mons[slot]!.build, w.mons[partner]!.build] : [];
  const tatsugiri = (build: BattleBuild) => build.abilityId === "commander" && build.speciesId.startsWith("tatsugiri");
  if (pair.length && ((tatsugiri(pair[0]) && pair[1].speciesId.startsWith("dondozo")) || (tatsugiri(pair[1]) && pair[0].speciesId.startsWith("dondozo")))) {
    kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("commander")));
  }
  // status2 integration 2: a Commander newcomer with no Dondozo beside it (PS/data/abilities.ts commander onStart → onUpdate:
  // no ally, or an ally that is not a Dondozo, returns with no effect; a fainted ally is no ally) does nothing as it comes in.
  if (ability === "commander") return [w];
  if (ability === "imposter") return imposter(kernel, w, slot, cause);
  if (ability === "protosynthesis" || ability === "quarkdrive") return paradoxEntry(kernel, w, slot);
  // Supreme Overlord (PS/data/abilities.ts supremeoverlord): its onStart only stores the side's faint count (effectState.fallen),
  // which only its own onBasePower reads, and a newcomer uses no move this turn (no action; Instruct fails on its null lastMove,
  // and no Kingambit has Dancer). The count it battles with is its build's (BattleBuild.faintedAllies). A1's guard stays for
  // the ability gained mid-turn.
  if (ability === "supremeoverlord") return [w];
  if (EMBODY[ability]) return embodyEntry(kernel, w, slot, EMBODY[ability]);
  // Generation 9's once-a-battle Starts on a bench Pokémon: it did not start the turn with them (A1's `once` reads the slot's
  // entry, which the input view gives the newcomer: so here, with Q12's fact).
  if (ONCE[ability] && (kernel.champions || kernel.runtime.profile.generation >= 9) && mon.id !== undefined && !mon.id.startsWith("slot:")) return onceEntry(kernel, w, slot, ONCE[ability]);
  return abilityHooks.abilityStart(kernel, w, slot, "entered");
}

/** Embody Aspect's four abilities: the Tera form each acts on and the stat it raises (PS/data/abilities.ts:1198-1250). */
const EMBODY: Readonly<Record<string, { form: string; stat: CombatStat }>> = {
  embodyaspectteal: { form: "ogerpontealtera", stat: "spe" }, embodyaspecthearthflame: { form: "ogerponhearthflametera", stat: "atk" },
  embodyaspectwellspring: { form: "ogerponwellspringtera", stat: "spd" }, embodyaspectcornerstone: { form: "ogerponcornerstonetera", stat: "def" },
};

/**
 * Embody Aspect on a newcomer (PS/data/abilities.ts embodyaspect* onStart): its Tera form (baseSpecies) and Terastallized,
 * +1 to its stat from itself, once per ability state, which every entry makes fresh (PS/sim/battle-actions.ts:142): so at
 * each entry. Nothing on any other holder.
 */
function embodyEntry(kernel: TurnKernel, w: World, slot: DoublesSlotId, embody: { form: string; stat: CombatStat }): World[] {
  const build = w.mons[slot]!.build;
  if (build.speciesId !== embody.form || build.mechanic !== "tera" || build.transformedFrom) return [w];
  kernel.applyBoosts(w, slot, { [embody.stat]: 1 }, slot, { effect: "ability" });
  return [w];
}

/** The once-a-battle Starts of generation 9 (PS/data/abilities.ts intrepidsword, dauntlessshield, supersweetsyrup) and their DoublesCarried.onceUsed ids. */
const ONCE: Readonly<Record<string, "intrepidsword" | "dauntlessshield" | "supersweetsyrup">> = {
  intrepidsword: "intrepidsword", dauntlessshield: "dauntlessshield", supersweetsyrup: "supersweetsyrup",
};

/**
 * A bench Pokémon's generation 9 once-a-battle Start (pokemon.swordBoost, shieldBoost, syrupTriggered; USER-DECISIONS Q12):
 * nothing when it had it before (its carried onceUsed), else once, with `Assumes {Name} has not had {Ability} before in this
 * battle.` when the bench does not say: Intrepid Sword +1 Attack, Dauntless Shield +1 Defense (from itself), Supersweet Syrup
 * −1 evasion on each foe in (a Substitute stops it).
 */
function onceEntry(kernel: TurnKernel, w: World, slot: DoublesSlotId, key: "intrepidsword" | "dauntlessshield" | "supersweetsyrup"): World[] {
  const mon = w.mons[slot]!;
  if (mon.vol.onceUsed?.includes(key)) return [w];
  const bench = benchInput(kernel, slotSide(slot), mon.id!);
  if (bench?.carried?.onceUsed === undefined) kernel.turnFact(`Assumes ${kernel.names[slot]} has not had ${kernel.abilityName(key)} before in this battle.`);
  setVol(w, slot, { onceUsed: [...(mon.vol.onceUsed ?? []), key] });
  if (key === "supersweetsyrup") {
    for (const foe of DOUBLES_SLOTS) {
      if (!kernel.isFoe(foe, slot) || !kernel.alive(w, foe) || w.mons[foe]!.vol.substitute) continue;
      kernel.applyBoosts(w, foe, { evasion: -1 }, slot, { effect: "ability" });
    }
    return [w];
  }
  kernel.applyBoosts(w, slot, key === "intrepidsword" ? { atk: 1 } : { def: 1 }, slot, { effect: "ability" });
  return [w];
}

/** Imposter (PS/data/abilities.ts imposter onSwitchIn): Transform into the foe across, through A1's Transform (its fails and its copied ability's Start). */
function imposter(kernel: TurnKernel, w: World, slot: DoublesSlotId, cause: PendingAction | null): World[] {
  const position = kernel.positionOf(w, slot);
  const across = DOUBLES_SLOTS.find((other) => kernel.isFoe(other, slot) && SHOWDOWN_POSITION[kernel.positionOf(w, other)].position === 1 - SHOWDOWN_POSITION[position].position);
  if (!across || !w.mons[across] || w.mons[across]!.fainted) return [w];
  if (w.mons[across]!.vol.substitute) return [w];
  const move = kernel.runtime.movesById.get("transform");
  if (!move || !abilityHooks.HANDLERS.transform?.onHit) kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName("imposter")));
  const info = kernel.moveInfo(w, slot, "transform", undefined);
  if (info.kind !== "move") kernel.notEstimated(info.reason);
  const use: Use = {
    action: cause ?? { index: -1, slot, moveId: "transform", target: across, fractional: 0 }, user: slot, move: move!, info,
    entry: { kind: "M", target: move!.target, priority: move!.priority, type: move!.type, flags: {}, games: {} } as unknown as StatusEntry,
    type: move!.type, priority: 0, prankster: false, bounced: false, infiltrates: false, targetType: move!.target, reached: new Set(),
  };
  return abilityHooks.HANDLERS.transform!.onHit!(kernel, w, use, across);
}

/**
 * Protosynthesis and Quark Drive coming in (PS/data/abilities.ts protosynthesis, quarkdrive onStart: their WeatherChange or
 * TerrainChange handler; priority −2): their field up adds the boost to its best stat (getBestStat(false, true)). Booster
 * Energy's own handler (the item's, after) uses it with the field down.
 */
function paradoxEntry(kernel: TurnKernel, w: World, slot: DoublesSlotId): World[] {
  const mon = w.mons[slot]!;
  const sun = mon.build.abilityId === "protosynthesis";
  const up = sun ? kernel.effectiveWeather(w) === "Sun" : w.field.terrain === "Electric";
  if (!up || mon.build.settledBoostedStat || mon.build.transformedFrom) return [w];
  const stat = bestStat(kernel, w, slot);
  mon.build = { ...mon.build, settledBoostedStat: stat };
  if (kernel.acting) kernel.stepFact(kernel.acting, `${kernel.names[slot]}'s ${kernel.abilityName(mon.build.abilityId)} boosts its ${STAT_NAMES[stat]}.`, w.mass);
  return [w];
}
const STAT_NAMES: Record<CombatStat, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };

/** getBestStat(false, true) (model.ts paradoxBestStat: the stored stats with their stages, Wonder Room). */
function bestStat(kernel: TurnKernel, w: World, slot: DoublesSlotId): CombatStat {
  const build = w.mons[slot]!.build;
  const stats = kernel.buildStats(build);
  if (!stats) return "atk";
  return paradoxBestStat(stats, (stat) => build.boosts[stat] ?? 0, w.field.wonderRoom);
}

/**
 * A newcomer's item as it switches in: a Terrain Seed in its terrain (+1 Defense or Sp. Def from itself, used up), Room Service
 * under Trick Room (−1 Speed, used up), Booster Energy for a paradox holder whose field is down (used up: the boost), the Orbs'
 * Primal Reversion (not followed). An item that does not work (Magic Room, Klutz, Embargo) does nothing.
 */
function itemEntry(kernel: TurnKernel, w: World, slot: DoublesSlotId, item: string): World[] {
  const mon = w.mons[slot]!;
  if (mon.build.itemId !== item || !kernel.itemWorks(w, mon.build)) return [w];
  const name = kernel.names[slot];
  if (item === "blueorb" || item === "redorb") {
    const species = kernel.runtime.speciesById.get(mon.build.speciesId)?.baseSpecies?.toLowerCase();
    if ((item === "blueorb" && species === "kyogre") || (item === "redorb" && species === "groudon")) kernel.notEstimated(REASONS.formChange(kernel.itemName(item), name));
    return [w];
  }
  const seed = SEEDS[item];
  if (seed) {
    if (w.field.terrain !== seed.terrain) return [w];
    kernel.applyBoosts(w, slot, { [seed.stat]: 1 }, slot, { effect: "item" });
    consumeItem(kernel, w, slot, item);
    if (kernel.acting) kernel.stepFact(kernel.acting, `${name}'s ${kernel.itemName(item)} is used up on ${seed.terrain} Terrain.`, w.mass);
    return [w];
  }
  if (item === "roomservice") {
    if (!w.field.trickRoom) return [w];
    kernel.applyBoosts(w, slot, { spe: -1 }, slot, { effect: "item" });
    consumeItem(kernel, w, slot, item);
    if (kernel.acting) kernel.stepFact(kernel.acting, `${name}'s ${kernel.itemName(item)} is used up under ${kernel.moveName("trickroom")}.`, w.mass);
    return [w];
  }
  if (item === "boosterenergy") {
    const ability = mon.build.abilityId;
    if ((ability !== "protosynthesis" && ability !== "quarkdrive") || mon.build.transformedFrom) return [w];
    const up = ability === "protosynthesis" ? kernel.effectiveWeather(w) === "Sun" : w.field.terrain === "Electric";
    if (up) return [w];
    consumeItem(kernel, w, slot, item);
    if (!mon.build.settledBoostedStat) {
      const stat = bestStat(kernel, w, slot);
      mon.build = { ...w.mons[slot]!.build, settledBoostedStat: stat };
      if (kernel.acting) kernel.stepFact(kernel.acting, `${name}'s ${kernel.itemName("boosterenergy")} is used up: ${kernel.abilityName(ability)} boosts its ${STAT_NAMES[stat]}.`, w.mass);
    }
    return [w];
  }
  return [w];
}

/** Eject Pack at the SwitchIn (onAnySwitchIn −4): each marked holder by Speed, the first used where no switchFlag of `true` stands. */
function ejectAtSwitchIn(kernel: TurnKernel, w: World, cause: PendingAction | null): World[] {
  // The drops of the entry marked their holders (onAfterBoost), read from the entry's ledger.
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (mon && !mon.fainted && w.boosted?.[slot]?.fell && mon.build.itemId === "ejectpack") mon.ejectMarked = true;
  }
  const holders = DOUBLES_SLOTS.filter((slot) => w.mons[slot]?.ejectMarked && kernel.alive(w, slot));
  if (!holders.length) return [w];
  return speedOrders(kernel, w, holders).map(({ world, order }) => {
    let pending = (world.switching ?? []) as Pending[];
    for (const slot of order) pending = tryEjectPack(kernel, world, slot, pending, cause);
    world.switching = pending;
    return world;
  });
}

/** The entry's facts: a weather or terrain it set, and each Pokémon's stages that changed, on the action that caused it. */
function entryFacts(kernel: TurnKernel, w: World, before: Map<DoublesSlotId, BattleBuild["boosts"] | null>, fieldBefore: string, cause: PendingAction | null, entrants: DoublesSlotId[]) {
  if (!cause) return;
  kernel.occupy(w);
  const [weather, , terrain] = fieldBefore.split("|");
  if (w.field.weather !== weather && w.field.weather) kernel.stepFact(cause, `${entrants.map((slot) => kernel.names[slot]).join(" and ")}: the weather becomes ${w.field.weather}.`, w.mass);
  if (w.field.terrain !== terrain && w.field.terrain) kernel.stepFact(cause, `${entrants.map((slot) => kernel.names[slot]).join(" and ")}: the terrain becomes ${w.field.terrain} Terrain.`, w.mass);
  for (const slot of DOUBLES_SLOTS) {
    const was = before.get(slot);
    const mon = w.mons[slot];
    if (!was || !mon) continue;
    const parts = (Object.keys(STAT_NAMES) as CombatStat[]).map((stat) => [stat, (mon.build.boosts[stat] ?? 0) - (was[stat] ?? 0)] as const).filter(([, by]) => by)
      .map(([stat, by]) => `${by < 0 ? `−${-by}` : `+${by}`} ${STAT_NAMES[stat]}`);
    if (parts.length) kernel.stepFact(cause, `${kernel.names[slot]}: ${parts.join(", ")}.`, w.mass);
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Hazards (PS/data/moves.ts stealthrock, spikes, toxicspikes, stickyweb, gmaxsteelsurge conditions' onSwitchIn)
// ------------------------------------------------------------------------------------------------------------------

/**
 * The hazards on `side` now: the pre-turn ones it holds (DoublesTurnInput.hazards through SideState.hazardsFrom: its own,
 * the other side's after Court Change, none once cleared) and those that landed this turn (SideState.hazards, Spikes and
 * Toxic Spikes counted by layer, capped).
 */
function hazardsOn(kernel: TurnKernel, w: World, side: DoublesSideId): DoublesHazards {
  const state = w.sides[side];
  const from = state.hazardsFrom === undefined ? side : state.hazardsFrom;
  const pre: DoublesHazards = from === null ? {} : kernel.baseInput?.hazards?.[from] ?? {};
  const landed = state.hazards;
  const count = (id: string) => landed.filter((each) => each === id).length;
  const out: DoublesHazards = {};
  if (pre.stealthRock || landed.includes("stealthrock")) out.stealthRock = true;
  const spikes = Math.min(3, (pre.spikes ?? 0) + count("spikes"));
  if (spikes) out.spikes = spikes as 1 | 2 | 3;
  const toxic = Math.min(2, (pre.toxicSpikes ?? 0) + count("toxicspikes"));
  if (toxic) out.toxicSpikes = toxic as 1 | 2;
  if (pre.stickyWeb || landed.includes("stickyweb")) out.stickyWeb = true;
  if (pre.steelsurge || landed.includes("gmaxsteelsurge")) out.steelsurge = true;
  return out;
}

/**
 * R-E: why a hazard does not go up on `side` (null: it does), at every place one lands (doubles-status.ts sideOrField's
 * hazard moves, doubles-max.ts G-Max Steelsurge and Stonesurge, doubles-eot.ts Ceaseless Edge and Stone Axe): Stealth Rock,
 * Sticky Web and G-Max Steelsurge up already, Spikes at 3 layers, Toxic Spikes at 2 (PS/data/moves.ts spikes and
 * toxicspikes onSideRestart; the others have none, so sim/side.ts addSideCondition returns false), counting the hazards from
 * before the turn that the side holds now (DoublesTurnInput.hazards through SideState.hazardsFrom) and those that landed this
 * turn (SideState.hazards). A status move's text is its failure fact.
 */
export function hazardFails(kernel: TurnKernel, w: World, side: DoublesSideId, hazard: string): string | null {
  const up = hazardsOn(kernel, w, side);
  const where = side === "own" ? "your side" : "the opponent's side";
  const fails = (layers: string) => `${kernel.moveName(hazard)} fails: ${layers} up on ${where}.`;
  switch (hazard) {
    case "stealthrock": return up.stealthRock ? fails("it is already") : null;
    case "stickyweb": return up.stickyWeb ? fails("it is already") : null;
    case "gmaxsteelsurge": return up.steelsurge ? fails("it is already") : null;
    case "spikes": return (up.spikes ?? 0) >= 3 ? fails("three layers are already") : null;
    case "toxicspikes": return (up.toxicSpikes ?? 0) >= 2 ? fails("two layers are already") : null;
  }
  return null;
}

/** The type chart's effectiveness steps of `type` into a Pokémon's types (typeMod: −1, 0, 1 per type; immunities do not apply: runEffectiveness). */
function typeMod(kernel: TurnKernel, w: World, slot: DoublesSlotId, type: string): number {
  const gen = Generations.get((kernel.champions ? 9 : kernel.runtime.profile.generation) as never);
  const chart = gen.types.get(toID(type) as never);
  let mod = 0;
  for (const defending of kernel.typesIn(w, slot)) {
    const factor = (chart?.effectiveness as Record<string, number> | undefined)?.[defending] ?? 1;
    if (factor > 1) mod += 1;
    else if (factor > 0 && factor < 1) mod -= 1;
  }
  return Math.max(-6, Math.min(6, mod));
}

/**
 * The side's hazards on a newcomer (each its own onSwitchIn, in the order they went up; the damage is one Update's): Stealth
 * Rock and G-Max Steelsurge (maxhp × 2^typeMod / 8), Spikes (1/8, 1/6, 1/4 of maxhp when grounded), each at least 1 and none
 * through Heavy-Duty Boots or Magic Guard; Toxic Spikes when grounded (a Poison type takes them away; Steel and Heavy-Duty Boots
 * nothing; else poison, bad poison at two layers, from the foe at position 0); Sticky Web when grounded and not in Boots (−1
 * Speed from the foe at position 0: its reactions through boost()).
 */
function hazards(kernel: TurnKernel, w: World, slot: DoublesSlotId): World[] {
  const side = slotSide(slot);
  const up = hazardsOn(kernel, w, side);
  const mon = w.mons[slot]!;
  const build = mon.build;
  const boots = build.itemId === "heavydutyboots" && kernel.itemWorks(w, build);
  const guard = build.abilityId === "magicguard";
  const grounded = kernel.grounded(w, slot);
  const { maxHP } = kernel.hp[slot];
  const name = kernel.names[slot];
  const losses: number[] = [];
  const texts: string[] = [];
  const cause = kernel.acting;
  if (!boots && !guard) {
    if (up.stealthRock) { const loss = Math.max(1, Math.trunc(maxHP * 2 ** typeMod(kernel, w, slot, "Rock") / 8)); losses.push(loss); texts.push(`${name} loses ${loss} HP (${kernel.moveName("stealthrock")}).`); }
    if (up.spikes && grounded) { const loss = Math.max(1, Math.trunc([0, 3, 4, 6][up.spikes] * maxHP / 24)); losses.push(loss); texts.push(`${name} loses ${loss} HP (${kernel.moveName("spikes")}).`); }
    if (up.steelsurge) { const loss = Math.max(1, Math.trunc(maxHP * 2 ** typeMod(kernel, w, slot, "Steel") / 8)); losses.push(loss); texts.push(`${name} loses ${loss} HP (${kernel.moveName("gmaxsteelsurge")}).`); }
  }
  let worlds = [w];
  if (losses.length) {
    for (const text of texts) kernel.lossFact(slot, text, w.mass);
    worlds = kernel.afterLoss(w, slot, losses);
  }
  const source = foeAtZero(kernel, w, side);
  return worlds.flatMap((x) => {
    kernel.occupy(x);
    if (!kernel.alive(x, slot)) return [x];
    if (up.toxicSpikes && grounded) toxicSpikes(kernel, x, slot, up.toxicSpikes, source);
    if (up.stickyWeb && grounded && !boots && kernel.alive(x, slot)) {
      kernel.applyBoosts(x, slot, { spe: -1 }, source, { effect: "move" });
      if (cause) kernel.stepFact(cause, `${kernel.moveName("stickyweb")}: ${name} is caught.`, x.mass);
    }
    return [x];
  });
}

/** The foe at Showdown position 0 of `side`'s foe side (pokemon.side.foe.active[0]): the source of Toxic Spikes and Sticky Web. */
function foeAtZero(kernel: TurnKernel, w: World, side: DoublesSideId): DoublesSlotId | null {
  const position = DOUBLES_SLOTS.find((slot) => slotSide(slot) !== side && SHOWDOWN_POSITION[slot].position === 0)!;
  const at = kernel.occupant(w, position);
  return w.mons[at] ? at : null;
}

/**
 * Toxic Spikes on a grounded newcomer (PS/data/moves.ts toxicspikes onSwitchIn): a Poison type takes them away (both the
 * layers from before the turn and this turn's); a Steel type or Heavy-Duty Boots: nothing; else trySetStatus psn (tox at two
 * layers) from the foe at position 0: an existing status, Comatose, Safeguard (its source is not the target), Misty Terrain,
 * Leaf Guard in its sun, Shields Down's Meteor Form, Purifying Salt, Immunity and Pastel Veil (and a partner's), Flower Veil
 * for a Grass type keep it off. No Synchronize (its own onAfterSetStatus ignores Toxic Spikes).
 */
function toxicSpikes(kernel: TurnKernel, w: World, slot: DoublesSlotId, layers: number, source: DoublesSlotId | null) {
  const mon = w.mons[slot]!;
  const build = mon.build;
  const types = kernel.typesIn(w, slot);
  const side = slotSide(slot);
  const cause = kernel.acting;
  const name = kernel.names[slot];
  if (types.includes("Poison")) {
    // The hazards from before the turn, but Toxic Spikes, become this turn's (SideState.hazards), so the side holds the rest.
    const state = w.sides[side];
    const from = state.hazardsFrom === undefined ? side : state.hazardsFrom;
    const pre: DoublesHazards = from === null ? {} : kernel.baseInput.hazards?.[from] ?? {};
    const kept = state.hazards.filter((each) => each !== "toxicspikes");
    const restored = [...(pre.stealthRock ? ["stealthrock"] : []), ...Array.from({ length: pre.spikes ?? 0 }, () => "spikes"), ...(pre.stickyWeb ? ["stickyweb"] : []), ...(pre.steelsurge ? ["gmaxsteelsurge"] : [])];
    w.sides[side] = { ...state, hazards: [...restored, ...kept], hazardsFrom: null };
    if (cause) kernel.stepFact(cause, `${name} takes away the ${kernel.moveName("toxicspikes")}.`, w.mass);
    return;
  }
  if (types.includes("Steel") || (build.itemId === "heavydutyboots" && kernel.itemWorks(w, build))) return;
  const status = layers >= 2 ? "tox" : "psn";
  if (build.status || build.abilityId === "comatose") return;
  if (w.sides[side].safeguard && source !== slot) return;
  if (w.field.terrain === "Misty") return;
  const ownWeather = build.itemId === "utilityumbrella" && kernel.itemWorks(w, build) ? "" : kernel.effectiveWeather(w);
  if (build.abilityId === "leafguard" && (ownWeather === "Sun" || ownWeather === "Harsh Sunshine")) return;
  if (build.abilityId === "shieldsdown" && build.speciesId === "miniormeteor") return;
  if (["purifyingsalt", "immunity", "pastelveil"].includes(build.abilityId)) return;
  for (const holder of DOUBLES_SLOTS) {
    if (holder === slot || slotSide(holder) !== side || !kernel.alive(w, holder)) continue;
    const held = w.mons[holder]!.build.abilityId;
    if (held === "pastelveil") return;
    if (held === "flowerveil" && types.includes("Grass")) return;
  }
  mon.build = { ...build, status };
  if (status === "tox") setEot(w, slot, { toxic: 0 });
  if (cause) kernel.stepFact(cause, `${kernel.moveName("toxicspikes")}: ${name} is ${status === "tox" ? "badly poisoned" : "poisoned"}.`, w.mass);
}

// ------------------------------------------------------------------------------------------------------------------
// E2
// ------------------------------------------------------------------------------------------------------------------

/**
 * R-E: a Pokémon that left (World.benched) as E2 lists it (DoublesOutcome.benched): its build (status, item, form) and HP as
 * it left, whether its action was picked, what it keeps on the bench: its sleep counter (sleepTurns), the once-a-battle effects.
 */
export function benchedOutcome(kernel: TurnKernel, w: World, entry: BenchedMon): DoublesBenchedMon {
  void w;
  const mon = entry.mon;
  const out: DoublesBenchedMon = { id: entry.id, slot: entry.slot, hp: entry.hp.map(([hp, chance]) => ({ hp, chance })), build: mon.build, protected: false, moved: mon.moved };
  if (mon.build.status === "slp" && mon.build.abilityId !== "comatose") {
    out.sleepTurns = sleepTurnsLeft(kernel.champions, mon.vol.sleep?.rest ?? false, mon.vol.sleep?.elapsed ?? 0, mon.build.abilityId === "earlybird" ? 2 : 1);
  }
  if (mon.vol.onceUsed?.length) out.onceUsed = [...mon.vol.onceUsed];
  return out;
}

/** Strong weathers' keepers (for the leaver's End: its weather ends with its last holder; A1's endAfter rule). */
export const WEATHER_KEEPERS = STRONG_WEATHERS;
