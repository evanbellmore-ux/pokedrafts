import { REASONS } from "./doubles-actions";
import { slotSide, type DoublesBenchedMon, type DoublesSideId, type DoublesSlotId } from "./doubles-types";
import type { BenchedMon, PendingAction, World } from "./doubles-world";
import type { TurnKernel } from "./doubles-turn";
import * as presenceNs from "./doubles-presence";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const presenceHooks = { ...presenceNs };

// Switch-outs during the turn (status2 SPEC2 §3.5, §4.8; ADDENDUM2 §8.7): Track R's file (wave 2: R-E). Every
// switch-out site of the moves calls switchOut where today it decided between "not estimated" and the end of turn's
// leaving: Eject Pack, Emergency Exit and Wimp Out after an action (doubles-turn.ts eventGuards), Eject Button and Red Card
// (hitReactions; doubles-faces.ts for a face's hit), U-turn, Volt Switch, Flip Turn and the drag of Dragon Tail and Circle
// Throw (afterHit), the status moves' switches (doubles-status.ts switchOut: Baton Pass, Teleport, Shed Tail, Parting
// Shot, Roar, Whirlwind, Chilly Reception), and the end of turn's Eject Pack (doubles-eot.ts ejectPack: the switch after the
// turn). R models the replacement where the side's bench is given (DoublesTurnInput.bench).
//
// Step 2 (ADDENDUM2 §8.7 step 1; scripts/.cache/calc-audit/status2/build/STEP2.md has the hook map) wrote the contract and
// these stubs, keyed on the bench and the hazards, which nothing sets yet: replaceSlot keeps today's rule, betweenActions and
// the pending switches (World.switching) wait for R-E, benchedOutcome reports a leaver (World.benched) as E2 lists it, and
// hazardFails lets every hazard land as today.

/** What makes the Pokémon leave (R reads it: the newcomer's entry, the drag's random bench pick). */
export type SwitchHow = "ejectpack" | "exit" | "ejectbutton" | "redcard" | "selfswitch" | "drag" | "status" | "residual";

/**
 * `slot` leaves (today's rule, moved verbatim from the five sites): with a later living action its replacement is not known
 * (REASONS.switchesOut); with none it leaves for the end of turn (kernel.leaving). The end of turn's own Eject Pack
 * ("residual") switches after the turn, which no input follows: nothing more. `action`: the action it happened in (null: at
 * the end of turn or outside an action). status2 R: with the leaver's side's bench given (DoublesTurnInput.bench), the
 * replacement point replaceSlot instead.
 */
export function switchOut(kernel: TurnKernel, w: World, slot: DoublesSlotId, how: SwitchHow, action: PendingAction | null) {
  // R-E: with a bench, the switch after the turn too (E2's replacement before the next turn: F4 §5.4).
  if (how === "residual") return;
  // A commanding Tatsugiri or its Dondozo cannot leave (PR, T2P §2.1).
  if (presenceHooks.cannotLeave(kernel, w, slot)) return;
  if (kernel.input.bench?.[slotSide(slot)]) { replaceSlot(kernel, w, slot, how, action); return; }
  if (kernel.laterAction(w)) kernel.notEstimated(REASONS.switchesOut(kernel.names[slot]));
  kernel.leaving(w, slot);
}

/**
 * R-E (F4 §5.4's replaceSlot, SPEC2 §4.8): `slot`'s Pokémon leaves with its side's bench given. Showdown sets the switch
 * here (sim/pokemon.ts switchFlag; a drag's forceSwitchFlag: sim/battle-actions.ts:1312, 1360) and makes it as the action
 * ends (sim/battle.ts:2821-2914), so R-E records it in World.switching and betweenActions makes it: the leaver's queued action
 * removed, its switch-out effects, the newcomer (`replacement[slot]` or the first bench Pokémon not in play; a drag: one
 * world per living bench Pokémon), its entry. Step 2's stub: today's rule (switchOut's), so a bench given before R-E lands
 * changes no result.
 */
export function replaceSlot(kernel: TurnKernel, w: World, slot: DoublesSlotId, how: SwitchHow, action: PendingAction | null) {
  void how;
  void action;
  if (kernel.laterAction(w)) kernel.notEstimated(REASONS.switchesOut(kernel.names[slot]));
  kernel.leaving(w, slot);
}

/**
 * R-E: as an action ends (doubles-turn.ts walk, after execute), the switch-outs it set (World.switching), in Showdown's order
 * (sim/battle.ts:2821-2914: the drags, then the faints, the Update and Emergency Exit, then the switch requests): one world
 * per outcome, World.switching gone. null: this world goes on unchanged. Step 2's stub: null (nothing sets World.switching).
 */
export function betweenActions(kernel: TurnKernel, w: World): World[] | null {
  void kernel;
  void w;
  return null;
}

/**
 * R-E: a Pokémon that left (World.benched) as E2 lists it (DoublesOutcome.benched): Step 2 gives its build (status, item,
 * form), its HP as it left and whether its action was picked; R-E adds what it keeps on the bench (its sleep counter, the
 * once-a-battle effects).
 */
export function benchedOutcome(kernel: TurnKernel, w: World, entry: BenchedMon): DoublesBenchedMon {
  void kernel;
  void w;
  return { id: entry.id, slot: entry.slot, hp: entry.hp.map(([hp, chance]) => ({ hp, chance })), build: entry.mon.build, protected: false, moved: entry.mon.moved };
}

/**
 * R-E: why a hazard does not go up on `side` (null: it does), at every place one lands (doubles-status.ts sideOrField's
 * hazard moves, doubles-max.ts G-Max Steelsurge and Stonesurge, doubles-eot.ts Ceaseless Edge and Stone Axe): Stealth Rock,
 * Sticky Web and G-Max Steelsurge up already, Spikes at 3 layers, Toxic Spikes at 2 (PS/data/moves.ts spikes and
 * toxicspikes onSideRestart; the others have none, so sim/side.ts addSideCondition returns false), counting the hazards from
 * before the turn that the side holds now (DoublesTurnInput.hazards through SideState.hazardsFrom) and those that landed this
 * turn (SideState.hazards). A status move's text is its failure fact. Step 2's stub: null (each lands, as today).
 */
export function hazardFails(kernel: TurnKernel, w: World, side: DoublesSideId, hazard: string): string | null {
  void kernel;
  void w;
  void side;
  void hazard;
  return null;
}
