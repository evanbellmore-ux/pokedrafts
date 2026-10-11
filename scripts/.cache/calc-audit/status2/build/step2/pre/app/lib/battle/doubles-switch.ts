import { REASONS } from "./doubles-actions";
import type { DoublesSlotId } from "./doubles-types";
import type { PendingAction, World } from "./doubles-world";
import type { TurnKernel } from "./doubles-turn";
import * as presenceNs from "./doubles-presence";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const presenceHooks = { ...presenceNs };

// Switch-outs during the turn (status2 SPEC2 §3.5, §4.8; ADDENDUM2 §8.7): Track R's file (wave 2; frozen in wave 1). Every
// switch-out site of the moves calls switchOut where today it decided between "not estimated" and the end of turn's
// leaving: Eject Pack, Emergency Exit and Wimp Out after an action (doubles-turn.ts eventGuards), Eject Button and Red Card
// (hitReactions), U-turn, Volt Switch, Flip Turn and the drag of Dragon Tail and Circle Throw (afterHit), the status moves'
// switches (doubles-status.ts switchOut: Baton Pass, Teleport, Shed Tail, Parting Shot, Roar, Whirlwind, Chilly Reception),
// and the end of turn's Eject Pack (doubles-eot.ts ejectPack: the switch after the turn). R models the replacement.

/** What makes the Pokémon leave (R reads it: the newcomer's entry, the drag's random bench pick). */
export type SwitchHow = "ejectpack" | "exit" | "ejectbutton" | "redcard" | "selfswitch" | "drag" | "status" | "residual";

/**
 * `slot` leaves (today's rule, moved verbatim from the five sites): with a later living action its replacement is not known
 * (REASONS.switchesOut); with none it leaves for the end of turn (kernel.leaving). The end of turn's own Eject Pack
 * ("residual") switches after the turn, which no input follows: nothing more. `action`: the action it happened in (null: at
 * the end of turn or outside an action).
 */
export function switchOut(kernel: TurnKernel, w: World, slot: DoublesSlotId, how: SwitchHow, action: PendingAction | null) {
  void action;
  if (how === "residual") return;
  // A commanding Tatsugiri or its Dondozo cannot leave (PR, T2P §2.1). Step 0: never.
  if (presenceHooks.cannotLeave(kernel, w, slot)) return;
  if (kernel.laterAction(w)) kernel.notEstimated(REASONS.switchesOut(kernel.names[slot]));
  kernel.leaving(w, slot);
}
