import { REASONS } from "./doubles-actions";
import { allyOf, DOUBLES_SLOTS, doublesNames, slotSide, type DoublesOutcomeMon, type DoublesSlotId, type DoublesTurnInput } from "./doubles-types";
import { cloneWorld, type PendingAction, type World } from "./doubles-world";
import type { StartRoute, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import { turnSpeed } from "./calculate";
import { isMaxActive } from "./mechanics";
import type { BattleBuild, ChampionsMove, MoveDamageResult } from "./types";

// Ally Switch and positions (status-eot ADDENDUM §4.11): Track E's file. doubles-world.ts holds World.swapped,
// positionOf and occupant, and doubles-turn.ts reads every position through them (resolveTargets, spreadTargets,
// maxEffects, the across-fallback); Track B's end of turn reads Leech Seed's gainer and a Wish's receiver by occupant.
// Track A's doubles-status.ts calls allySwitchPrepare and allySwitchHit through the status table's handler key
// `allySwitch` (BeforeMove first, as for any status move). Pinned Showdown c23d2e94: data/moves.ts:302-354 (allyswitch),
// data/mods/gen8/moves.ts:2-6 (no PrepareHit in generations 8 and 7), sim/battle.ts:1588-1607 (swapPosition).

/** Scarlet/Violet and Champions roll Ally Switch's repeat counter at PrepareHit; Sword/Shield and Ultra Sun/Ultra Moon have none. */
function counted(kernel: Pick<TurnKernel, "champions" | "runtime">): boolean {
  return kernel.champions || kernel.runtime.profile.id === "scarlet_violet";
}

/**
 * Ally Switch's PrepareHit (data/moves.ts:311-313 addVolatile('allyswitch'); :333-352 the condition). Scarlet/Violet and
 * Champions only: with no counter (not used last turn) the volatile starts at 3 and the use is certain; with a carried
 * counter c, onRestart rolls randomChance(1, c): 1/c passes with the counter tripled (at most 729, counterMax), 1 − 1/c
 * fails, the volatile deleted, with the step fact. A world whose PrepareHit failed holds no counter, and allySwitchHit
 * passes it through unchanged (allySwitchStopped), so Track A may call it on every world this returns.
 */
export function allySwitchPrepare(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] {
  void move;
  if (!counted(kernel)) return [w];
  const mon = w.mons[action.slot]!;
  const counter = mon.vol.allySwitch;
  if (counter === undefined) {
    mon.vol = { ...mon.vol, allySwitch: 3 };
    return [w];
  }
  const pass = cloneWorld(w, w.mass / counter), fail = cloneWorld(w, w.mass * (1 - 1 / counter));
  const user = pass.mons[action.slot]!;
  user.vol = { ...user.vol, allySwitch: Math.min(729, counter * 3) };
  const loser = fail.mons[action.slot]!;
  const { allySwitch: _gone, ...rest } = loser.vol;
  void _gone;
  loser.vol = rest;
  kernel.stepFact(action, "Ally Switch fails: it was used last turn.", fail.mass);
  return [pass, fail];
}

/** Whether Ally Switch's PrepareHit failed in this world (Scarlet/Violet and Champions: the counter roll deleted the volatile). */
export function allySwitchStopped(kernel: Pick<TurnKernel, "champions" | "runtime">, w: World, slot: DoublesSlotId): boolean {
  return counted(kernel) && w.mons[slot]!.vol.allySwitch === undefined;
}

/**
 * Ally Switch's onHit (data/moves.ts:314-331): with its ally's slot empty or its ally fainted it fails (A9, A9b);
 * otherwise the two swap places (sim/battle.ts swapPosition: side.active, not the slot conditions), World.swapped toggled.
 * The counter already moved at PrepareHit (A11). A world whose PrepareHit failed is passed through.
 */
export function allySwitchHit(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] {
  void move;
  const slot = action.slot;
  if (allySwitchStopped(kernel, w, slot)) return [w];
  const partner = allyOf(slot);
  if (!w.mons[partner]) {
    kernel.stepFact(action, "Ally Switch fails: its ally has fainted.", w.mass);
    return [w];
  }
  if (w.mons[partner]!.fainted) {
    kernel.stepFact(action, `Ally Switch fails: ${kernel.names[partner]} has fainted.`, w.mass);
    return [w];
  }
  const side = slotSide(slot);
  const swapped = { ...w.swapped };
  if (swapped[side]) delete swapped[side]; else swapped[side] = true;
  if (Object.keys(swapped).length) w.swapped = swapped; else delete w.swapped;
  kernel.stepFact(action, `Ally Switch: ${kernel.names[slot]} and ${kernel.names[partner]} swap places.`, w.mass);
  return [w];
}

/** A row that is no calculation (doubles-turn.ts emptyRow's shape). */
function reasonRow(move: ChampionsMove, reason: string): MoveDamageResult {
  return {
    moveId: move.id, effectiveName: move.name, effectiveType: move.type, effectivePower: move.power, effectiveCategory: move.category,
    kind: "unsupported", min: null, max: null, minPercent: null, maxPercent: null, rolls: null, ohkoChance: null, description: move.description, assumptions: [], reason, hits: null,
  };
}

/**
 * The fractional priorities an action can have, fixed at queue time (doubles-turn.ts fractionalOutcomes: Stall, Lagging
 * Tail and Full Incense −0.1; Quick Draw 0.1 for attacks; Mycelium Might −0.1 for status moves; Quick Claw 0.1 while at
 * most 0; an eaten Custap Berry 0.1), the values only.
 */
function fractions(kernel: TurnKernel, build: BattleBuild, moveId: string | null, magicRoom: boolean): number[] {
  const status = !moveId || kernel.runtime.movesById.get(moveId)!.category === "Status";
  const items = !magicRoom && build.abilityId !== "klutz";
  let value = 0;
  if ((items && (build.itemId === "laggingtail" || build.itemId === "fullincense")) || build.abilityId === "stall") value = -0.1;
  let values = [value];
  if (build.abilityId === "quickdraw" && !status) values = [0.1, value];
  if (build.abilityId === "myceliummight" && status) values = values.map(() => -0.1);
  const blocked = status && build.abilityId === "myceliummight";
  if (items && build.itemId === "quickclaw" && !blocked) values = values.flatMap((each) => each <= 0 ? [0.1, each] : [each]);
  if (build.settledCustap && !blocked) values = values.map((each) => each <= 0 ? 0.1 : each);
  return [...new Set(values)];
}

/**
 * Whether `attacker`'s move can come after `user`'s Ally Switch as the turn starts (doubles-turn.ts mayComeAfter): not
 * when it moves first in every order the start allows (its priority bracket above, or the same bracket and faster, with
 * every fractional outcome of both; sim/battle.ts comparePriority). Generation 7 sorts once with the first-turn Speed
 * the start world holds. A tie reads as can.
 */
function mayComeAfter(kernel: TurnKernel, w: World, attacker: DoublesSlotId, user: DoublesSlotId): boolean {
  const key = (slot: DoublesSlotId) => {
    const moveId = kernel.input.pokemon[slot]!.action.moveId;
    const action: PendingAction = { index: -1, slot, moveId, target: null, fractional: 0 };
    // Generation 7 sorts with the first-turn Speed (doubles-turn.ts startOrder: speedOf with firstTurn).
    const speed = kernel.gen7 ? turnSpeed(kernel.calcBuild(w, slot), w.sides[slotSide(slot)].tailwind, kernel.conditionsFor(w, slot, slot, false), kernel.runtime, true) : kernel.speedOf(w, slot);
    return { priority: kernel.priorityOf(w, action), speed, fractions: fractions(kernel, w.mons[slot]!.build, moveId, w.field.magicRoom) };
  };
  const mine = key(attacker), theirs = key(user);
  return !mine.fractions.every((own) => theirs.fractions.every((other) => {
    const ours = mine.priority + own, its = theirs.priority + other;
    return ours > its || (ours === its && mine.speed > theirs.speed);
  }));
}

/**
 * A start row for `slot`'s damaging move aimed at `target` (going to `routed` as the turn starts) that an Ally Switch
 * chosen this turn can change (ADDENDUM §4.11.7; doubles-turn.ts startRoutes, inside the per-target loop, after the
 * centred-world rows: spread and tracking moves never reach here), only when the attacker can come after it:
 * - aimed at a Pokémon whose partner chose Ally Switch (no redirection taking the move as the turn starts): a conditional
 *   row into that partner, which then stands at the aimed position (A1), with the fact; Dragon Darts at a foe meets the
 *   same two Pokémon either way, so it has none;
 * - aimed at the attacker's own ally that chose Ally Switch: the attacker then stands at the aimed position and the move
 *   fails (A2), a row with that reason; Dragon Darts the row reason dartsAimSelf (A2, p1:149).
 */
export function startRoute(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove, info: TurnMoveInfo, target: DoublesSlotId, routed: DoublesSlotId): StartRoute | null {
  void info;
  const switcher = (each: DoublesSlotId) => {
    const entry = kernel.input.pokemon[each];
    return !!entry && !!w.mons[each] && entry.action.moveId === "allyswitch" && !isMaxActive(entry.build);
  };
  const darts = move.id === "dragondarts";
  if (!kernel.isFoe(slot, target)) {
    if (target === slot || !switcher(target) || !mayComeAfter(kernel, w, slot, target)) return null;
    const reason = darts ? REASONS.dartsAimSelf : `${move.name} fails if ${kernel.names[target]}'s Ally Switch comes first.`;
    return { target, row: reasonRow(move, reason), conditional: true };
  }
  const partner = allyOf(target);
  if (routed !== target || darts || !switcher(partner) || !mayComeAfter(kernel, w, slot, partner)) return null;
  return { target: partner, fact: `Ally Switch: ${kernel.names[partner]} takes ${move.name} if Ally Switch comes first.`, conditional: true };
}

/** Track E's position facts on `slot` in one world (DoublesHP.conditions): "Swapped places with {Partner}." while its side stands swapped. */
export function conditions(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  return w.swapped?.[slotSide(slot)] && w.mons[allyOf(slot)] ? [`Swapped places with ${kernel.names[allyOf(slot)]}.`] : [];
}

/**
 * Track E's part of an E2 outcome Pokémon (ADDENDUM §3.1): the "allyswitch" volatile and the counter after a use this
 * turn that passed its PrepareHit (Scarlet/Violet, Champions): its move this turn was Ally Switch (vol.usedMove) and the
 * counter stands (a failed roll deletes it). A carried counter it did not use again ends with this turn (duration 2).
 */
export function outcomeMon(kernel: TurnKernel, w: World, slot: DoublesSlotId): Pick<DoublesOutcomeMon, "volatiles" | "allySwitch"> {
  void kernel;
  const mon = w.mons[slot]!;
  // A fainted Pokémon's volatiles are cleared (sim/battle.ts faintMessages: clearVolatile).
  if (mon.fainted) return {};
  const vol = mon.vol;
  return vol.usedMove === "allyswitch" && vol.allySwitch !== undefined ? { volatiles: ["allyswitch"], allySwitch: vol.allySwitch } : {};
}

/**
 * The Ally Switch turn fact (ADDENDUM §2.5): Scarlet/Violet and Champions, for a Pokémon that chooses Ally Switch with no
 * counter from the last turn (carried.allySwitch): "Assumes {Name} did not use Ally Switch last turn."
 */
export function turnFacts(input: DoublesTurnInput): string[] {
  if (!counted({ champions: input.runtime.profile.id === "champions", runtime: input.runtime })) return [];
  const names = doublesNames(input.pokemon, input.runtime);
  return DOUBLES_SLOTS.filter((slot) => {
    const entry = input.pokemon[slot];
    return entry?.action.moveId === "allyswitch" && entry.carried?.allySwitch === undefined;
  }).map((slot) => `Assumes ${names[slot]} did not use Ally Switch last turn.`);
}
