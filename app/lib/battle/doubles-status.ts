import {
  ABSORBING, CALLING_MOVES, CONFUSING_BERRIES, CONFUSING_MOVES, FIELD_MOVES, FUTURE_MOVES, GAS_CHANGING_MOVES, GRAVITY_MOVES, HP_STATUS_MOVES,
  PROTECT_MOVES, REASONS, REDIRECT_ABILITIES, SIDE_MOVES, STRONG_WEATHERS, TERRAIN_MOVES, WEATHER_MOVES,
} from "./doubles-actions";
import {
  allyOf, DOUBLES_SLOTS, foesOf, SHOWDOWN_POSITION, slotSide, turnNames, type DoublesOutcomeMon, type DoublesSideId, type DoublesSlotId, type DoublesTurnInput,
} from "./doubles-types";
import { cloneWorld, condition, endTrap, lossDist, mapHP, mapJoint, marginal, type EotState, type MoveVolatiles, type PendingAction, type World } from "./doubles-world";
import type { HitCheck, HitStats, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import * as positionHooks from "./doubles-positions";
import * as itemHooks from "./doubles-items";
import { berryArithmetic, BERSERK_BERRIES, eatBerry, HEALING_BERRIES, LANSAT_STARF, OWN_STATUS_CURES, ownMoveId, PINCH_STAT_BERRIES, UNNERVES } from "./hit-loop";
import { isMaxActive } from "./mechanics";
import { NATURES } from "./model";
import { everyUseStatus } from "./stat-moves";
import { CANTUSETWICE_MOVES, DEFROST_MOVES, FAILENCORE_MOVES, statusEntry, THAWING_MOVES, type StatusEntry, type StatusStages } from "./status-table";
import type { BattleBuild, BattleGame, BattleStatus, ChampionsMove, CombatStat } from "./types";
import type { TurnStepOutcome } from "./uses-to-ko";

// The 2v2 turn's status moves and BeforeMove (status-eot SPEC §4.2-4.6, ADDENDUM §4.11-4.12 dispatch): Track A's file.
// doubles-turn.ts (the kernel, frozen) calls the hooks below; every mechanic follows pinned Showdown c23d2e94 (cited as
// sim/... and data/...), every random event is branched exactly, and what is not followed is not estimated with a fact.
// status-table.ts holds every catalog Status move's pinned data and its kind (SPEC §2.2): M modelled, N no effect this
// turn, C modelled under a condition, L not modelled in this build, S switching, P presence guard, X today's handling.

const STATS: CombatStat[] = ["atk", "def", "spa", "spd", "spe"];
type Stage = keyof StatusStages;
const STAGE_NAMES: Record<Stage, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasion" };
const STATUS_WORDS: Record<string, string> = { slp: "asleep", par: "paralysed", brn: "burned", psn: "poisoned", tox: "badly poisoned", frz: "frozen" };
const STATUS_NOUNS: Record<string, string> = { slp: "sleep", par: "paralysis", brn: "burn", psn: "poison", tox: "bad poison", frz: "freeze" };
const STATUS_GIVEN: Record<string, string> = { slp: "Falls asleep.", par: "Is paralysed.", brn: "Is burned.", psn: "Is poisoned.", tox: "Is badly poisoned.", frz: "Is frozen." };
const STATUS_STATE: Record<string, string> = { slp: "Asleep.", par: "Paralysed.", brn: "Burned.", psn: "Poisoned.", tox: "Badly poisoned.", frz: "Frozen." };
/** U+2212 for a lowered stage, + for a raised one ("−2 Attack.", "+1 Speed."). */
const signed = (amount: number) => (amount < 0 ? `−${-amount}` : `+${amount}`);
const stageFact = (stat: Stage, amount: number) => `${signed(amount)} ${STAGE_NAMES[stat]}.`;
const range = (values: number[]) => { const least = Math.min(...values), most = Math.max(...values); return least === most ? `${least}` : `${least}–${most}`; };
/** Showdown's modify (sim/battle.ts): tr((tr(value × tr(ratio × 4096)) + 2047) / 4096). */
const modify = (value: number, ratio: number) => Math.trunc((Math.trunc(value * Math.trunc(ratio * 4096)) + 2047) / 4096);
/** Big Root's chainModify([5324, 4096]) on a heal (data/items.ts bigroot onTryHeal). */
const bigRoot = (amount: number) => Math.trunc((Math.trunc(amount * 5324) + 2047) / 4096);
/** The moves-phase volatiles this file writes (doubles-world.ts MoveVolatiles, Encore's move included). cloneMon copies them. */
type Vol = MoveVolatiles;
const setVol = (w: World, slot: DoublesSlotId, change: Partial<Vol>) => {
  const mon = w.mons[slot]!;
  const next = { ...mon.vol, ...change } as Vol;
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete (next as Record<string, unknown>)[key];
  mon.vol = next as MoveVolatiles;
};
const setEot = (w: World, slot: DoublesSlotId, change: Partial<EotState>) => {
  const mon = w.mons[slot]!;
  const next = { ...mon.eot, ...change } as Record<string, unknown>;
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete next[key];
  mon.eot = next as EotState;
};
const gameOf = (kernel: TurnKernel) => kernel.runtime.profile.id as BattleGame;
/** The mechanics' generation: Champions (profile generation 0) is generation 9's (data/mods/champions inherits gen9). */
const generation = (kernel: TurnKernel) => (kernel.champions ? 9 : kernel.runtime.profile.generation);
/** The move's status-table entry in this game (undefined: not a catalog Status move here). */
export function tableEntry(kernel: TurnKernel, moveId: string): StatusEntry | undefined {
  return statusEntry(moveId, gameOf(kernel));
}

// ------------------------------------------------------------------------------------------------------------------
// BeforeMove (SPEC §4.2; sim/battle-actions.ts runMove → runEvent('BeforeMove'), which stops at the first false)
// ------------------------------------------------------------------------------------------------------------------

/** The prior of a sleep's length S (its startTime): data/conditions.ts slp random(2, 5); Champions sample([2, 3, 3]); Rest 3. */
export function sleepPrior(champions: boolean, rest: boolean): [number, number][] {
  if (rest) return [[3, 1]];
  return champions ? [[2, 1 / 3], [3, 2 / 3]] : [[2, 1 / 3], [3, 1 / 3], [4, 1 / 3]];
}
/** The chance a sleeper wakes at this BeforeMove: P(e < S ≤ e + d) / P(S > e), e its counter's decrease so far, d 2 with Early Bird. */
export function wakeChance(champions: boolean, rest: boolean, elapsed: number, step: number): number {
  let alive = 0, wakes = 0;
  for (const [length, chance] of sleepPrior(champions, rest)) {
    if (length <= elapsed) continue;
    alive += chance;
    if (length <= elapsed + step) wakes += chance;
  }
  return alive > 0 ? (wakes === alive ? 1 : wakes / alive) : 1;
}
/** The expected sleep counter left, E[ceil((S − e) / d) | S > e] (DoublesOutcomeMon.sleepTurns). */
export function sleepTurnsLeft(champions: boolean, rest: boolean, elapsed: number, step: number): number {
  let alive = 0, sum = 0;
  for (const [length, chance] of sleepPrior(champions, rest)) {
    if (length <= elapsed) continue;
    alive += chance;
    sum += chance * Math.ceil((length - elapsed) / step);
  }
  return alive > 0 ? sum / alive : 0;
}
/** Confusion's snap-out chance at its attempt-th BeforeMove: P(T = a) / P(T ≥ a), T uniform on min..5 (data/conditions.ts confusion random(min, 6)). */
export function snapChance(attempt: number, min: 2 | 3): number {
  if (attempt < min) return 0;
  if (attempt >= 5) return 1;
  return 1 / (5 - attempt + 1);
}

/** What BeforeMove reads of the move a Pokémon is about to use (the Z-Move or Max Move it becomes, sim/battle-actions.ts runMove). */
type BeforeInfo = { id: string; name: string; category: string; isZ: boolean; isMax: boolean; sound: boolean; heal: boolean };
function beforeInfo(kernel: TurnKernel, w: World, action: PendingAction): BeforeInfo {
  if (action.moveId === null) return { id: "splash", name: "Splash", category: "Status", isZ: false, isMax: false, sound: false, heal: false };
  const move = kernel.runtime.movesById.get(action.moveId)!;
  const context = kernel.input.pokemon[action.slot]!.contexts[action.moveId];
  const info = move.category === "Status" && !context?.useZ ? null : kernel.moveInfo(w, action.slot, action.moveId, context);
  if (info?.kind === "move" && info.transformed) {
    return { id: info.effective.id, name: info.effective.name, category: info.effective.category, isZ: info.isZ, isMax: info.isMax, sound: !!info.flags.sound, heal: false };
  }
  const entry = tableEntry(kernel, move.id);
  const sound = entry ? !!entry.flags.sound : info?.kind === "move" ? !!info.flags.sound : false;
  // flags.heal: a status move's (the table's); of the damaging moves exactly the draining ones have it in the four games.
  const heal = entry ? !!entry.flags.heal : info?.kind === "move" && info.drain;
  return { id: move.id, name: move.name, category: move.category, isZ: false, isMax: false, sound, heal };
}
type Gate = { go: World[]; stopped: World[] };

/**
 * BeforeMove for a living Pokémon whose action is picked (doubles-turn.ts execute), by handler priority: sleep and freeze
 * (10), flinch (8), Disable (7), Gravity, Throat Chop and Heal Block (6), Taunt (5), Imprison (4), confusion (3), paralysis (1); then
 * Focus Punch's beforeMoveCallback. No move is Splash (status category, gravity flag) and runs it too, but for paralysis,
 * which changes nothing there. `go`: the worlds in which it uses its move (No move: does nothing more); `stopped`: those in
 * which its action ends here.
 */
export function beforeMove(kernel: TurnKernel, w: World, action: PendingAction): Gate {
  const info = beforeInfo(kernel, w, action);
  const stopped: World[] = [];
  let go: World[] = [w];
  const run = (check: (world: World) => Gate) => {
    const next: World[] = [];
    for (const world of go) { const gate = check(world); next.push(...gate.go); stopped.push(...gate.stopped); }
    go = next;
  };
  run((world) => sleepCheck(kernel, world, action, info));
  run((world) => freezeCheck(kernel, world, action, info));
  run((world) => flinchCheck(kernel, world, action));
  run((world) => disableCheck(kernel, world, action, info));
  run((world) => gravityCheck(kernel, world, action, info));
  run((world) => throatChopCheck(kernel, world, action, info));
  run((world) => healBlockCheck(kernel, world, action, info));
  run((world) => tauntCheck(kernel, world, action, info));
  run((world) => imprisonCheck(kernel, world, action, info));
  run((world) => confusionCheck(kernel, world, action, info));
  if (action.moveId !== null) run((world) => paralysisCheck(kernel, world, action));
  run((world) => focusCheck(kernel, world, action));
  // The move it used (sim/pokemon.ts moveUsed: lastMove, the Z-Move or Max Move it became), where something reads it: Ally
  // Switch's outcome (doubles-positions.ts outcomeMon), and Disable's or Encore's later this turn (lastMoveFailure). Kept
  // only then, so worlds that differ in nothing else still merge.
  if (action.moveId !== null && (action.moveId === "allyswitch" || readsLastMove(kernel))) for (const world of go) setVol(world, action.slot, { usedMove: info.id });
  return { go, stopped };
}
/** Whether a Pokémon of the turn uses Disable or Encore, which read their target's move this turn. */
const readsLastMove = (kernel: TurnKernel) => DOUBLES_SLOTS.some((slot) => { const id = kernel.input.pokemon[slot]?.action.moveId; return id === "disable" || id === "encore"; });

/** The abilities that cure their holder's own status at an Update (hit-loop.ts OWN_STATUS_CURES); Own Tempo ends a confusion. */
const OWN_CURES = OWN_STATUS_CURES;
/**
 * The turn's first Update (sim/battle.ts runAction: the Update after the beforeTurn action, before any move; doubles-turn.ts
 * walk runs it on each root world, after generation 7 froze its order and before a later generation sorts the first move):
 * a status or confusion a Pokémon brings into the turn is cured by its own ability (OWN_CURES, Own Tempo; its ability's
 * handlers come before its item's), else by the curing Berry it holds (Lum any and confusion, Persim confusion, Cheri,
 * Chesto, Pecha, Rawst, Aspear), unless a foe's Unnerve or As One stops it; Cheek Pouch. A Neutralizing Gas holder's
 * suppression stands in the build (GAS_STAND_IN). An Unburden holder's Berry is not followed.
 */
export function turnStartUpdate(kernel: TurnKernel, w: World) {
  const CURES: Record<string, string[]> = { lumberry: ["par", "brn", "psn", "tox", "slp", "frz"], cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"] };
  ownCuresAtStart(kernel, w);
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon || mon.fainted) continue;
    const item = mon.build.itemId, status = mon.build.status;
    const statusCured = !!status && !!CURES[item]?.includes(status);
    const confusionCured = !!mon.vol.confusion && (item === "lumberry" || item === "persimberry");
    if ((!statusCured && !confusionCured) || !kernel.itemWorks(w, mon.build) || kernel.berryStopped(w, slot)) continue;
    if (mon.build.abilityId === "unburden") kernel.notEstimated(REASONS.notIn2v2(kernel.itemName(item)));
    mon.build = { ...mon.build, itemId: "", ...(statusCured ? { status: "" } : {}) };
    if (statusCured) setVol(w, slot, { sleep: undefined, freeze: undefined });
    if (statusCured && status === "tox") setEot(w, slot, { toxic: undefined });
    if (item === "lumberry" || item === "persimberry") setVol(w, slot, { confusion: undefined });
    kernel.pouchHeal(w, slot);
  }
}

/**
 * The own-ability part of the turn's first Update (turnStartUpdate): a status its holder's own ability cures (OWN_CURES) and
 * Own Tempo's confusion go, with a turn fact. Pinned Showdown cannot start a turn with one: the same ability's SetStatus
 * or TryAddVolatile handler stops it from landing (data/abilities.ts limber, immunity, insomnia... onSetStatus; owntempo
 * onTryAddVolatile), so no order sees it. doubles-turn.ts rootWorlds runs this before generation 7 freezes the order
 * (the oracle sorts it at full Speed: verify-engine VE-UI-1); a Berry's cure waits for the Update after the sort (FX02b).
 */
export function ownCuresAtStart(kernel: TurnKernel, w: World) {
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon || mon.fainted) continue;
    const ability = mon.build.abilityId, own = mon.build.status;
    if (own && OWN_CURES[ability]?.includes(own)) {
      mon.build = { ...mon.build, status: "" };
      setVol(w, slot, { sleep: undefined, freeze: undefined });
      if (own === "tox") setEot(w, slot, { toxic: undefined });
      kernel.turnFact(`${kernel.abilityName(ability)}: ${kernel.names[slot]} is cured of its ${STATUS_NOUNS[own]} as the turn starts.`);
    }
    if (ability === "owntempo" && mon.vol.confusion) {
      setVol(w, slot, { confusion: undefined });
      kernel.turnFact(`${kernel.abilityName(ability)}: ${kernel.names[slot]} is no longer confused.`);
    }
  }
}

/** Sleep (data/conditions.ts slp onBeforeMove, priority 10): the counter goes down by 1 (2 with Early Bird); at 0 it wakes and moves. */
function sleepCheck(kernel: TurnKernel, w: World, action: PendingAction, info: BeforeInfo): Gate {
  const mon = w.mons[action.slot]!;
  if (mon.build.status !== "slp") return { go: [w], stopped: [] };
  const elapsed = mon.vol.sleep?.elapsed ?? 0, rest = mon.vol.sleep?.rest ?? false;
  const step = mon.build.abilityId === "earlybird" ? 2 : 1;
  const chance = wakeChance(kernel.champions, rest, elapsed, step);
  const go: World[] = [], stopped: World[] = [];
  if (chance > 0) {
    const woke = chance >= 1 ? w : cloneWorld(w, w.mass * chance);
    woke.mons[action.slot]!.build = { ...woke.mons[action.slot]!.build, status: "" };
    setVol(woke, action.slot, { sleep: undefined });
    kernel.stepFact(action, "Wakes up.", woke.mass);
    go.push(woke);
  }
  if (chance < 1) {
    if (chance > 0) w.mass *= 1 - chance;
    setVol(w, action.slot, { sleep: { elapsed: elapsed + step, rest } });
    // Snore and Sleep Talk are used asleep (move.sleepUsable); Sleep Talk calls a move (presence guard).
    if (info.id === "snore" || info.id === "sleeptalk") { kernel.stepFact(action, "Asleep.", w.mass); go.push(w); }
    else { kernel.skipFact(action, "Asleep.", w.mass); stopped.push(w); }
  }
  return { go, stopped };
}

/**
 * Freeze (data/conditions.ts frz onBeforeMove, priority 10): a defrost move thaws its user (Burn Up only a Fire type's);
 * otherwise 1/5 (Champions: the counter, 3 to start, goes down; at 0 it thaws, otherwise 1/4: data/mods/champions/conditions.ts).
 */
function freezeCheck(kernel: TurnKernel, w: World, action: PendingAction, info: BeforeInfo): Gate {
  const mon = w.mons[action.slot]!;
  if (mon.build.status !== "frz") return { go: [w], stopped: [] };
  const thaw = (world: World) => {
    world.mons[action.slot]!.build = { ...world.mons[action.slot]!.build, status: "" };
    setVol(world, action.slot, { freeze: undefined });
    kernel.stepFact(action, "Thaws.", world.mass);
    return world;
  };
  if (!info.isZ && !info.isMax && DEFROST_MOVES.has(info.id) && !(info.id === "burnup" && !kernel.typesOf(mon.build).includes("Fire"))) return { go: [thaw(w)], stopped: [] };
  let chance = 1 / 5;
  const attempts = mon.vol.freeze?.attempts ?? 0;
  if (kernel.champions) chance = 3 - attempts - 1 <= 0 ? 1 : 1 / 4;
  if (chance >= 1) return { go: [thaw(w)], stopped: [] };
  const thawed = thaw(cloneWorld(w, w.mass * chance));
  w.mass *= 1 - chance;
  if (kernel.champions) setVol(w, action.slot, { freeze: { attempts: attempts + 1 } });
  kernel.skipFact(action, "Frozen.", w.mass);
  return { go: [thawed], stopped: [w] };
}

/** Flinch (data/conditions.ts flinch onBeforeMove, priority 8); Steadfast's +1 Speed (onFlinch), a rise a foe's Opportunist or Mirror Herb copies. */
function flinchCheck(kernel: TurnKernel, w: World, action: PendingAction): Gate {
  const mon = w.mons[action.slot]!;
  if (!mon.flinched) return { go: [w], stopped: [] };
  kernel.skipFact(action, `Flinches (${mon.flinched}).`, w.mass);
  if (mon.build.abilityId === "steadfast") {
    const before = kernel.snapshot(w);
    selfBoost(kernel, w, action.slot, { spe: 1 }, action);
    kernel.eventGuards(before, w);
  }
  return { go: [], stopped: [w] };
}

/** Disable (data/moves.ts disable condition onBeforeMove, priority 7): the disabled move, not as a Z-Move; Champions passes cantusetwice moves. */
function disableCheck(kernel: TurnKernel, w: World, action: PendingAction, info: BeforeInfo): Gate {
  const disabled = w.mons[action.slot]!.vol.disabled;
  if (!disabled || info.isZ || info.id !== disabled || (kernel.champions && CANTUSETWICE_MOVES.has(info.id))) return { go: [w], stopped: [] };
  kernel.skipFact(action, `Disable: ${info.name} cannot be used.`, w.mass);
  return { go: [], stopped: [w] };
}

/** Gravity (data/moves.ts gravity condition onBeforeMove, priority 6): a move with the gravity flag, not a Z-Move (a Max Move has none); Splash included. */
function gravityCheck(kernel: TurnKernel, w: World, action: PendingAction, info: BeforeInfo): Gate {
  const mon = w.mons[action.slot]!;
  const context = action.moveId ? kernel.input.pokemon[action.slot]!.contexts[action.moveId] : undefined;
  if (!w.field.gravity || !GRAVITY_MOVES.has(action.moveId ?? "splash") || context?.useZ || isMaxActive(mon.build)) return { go: [w], stopped: [] };
  kernel.skipFact(action, `Gravity: ${info.name} cannot be used.`, w.mass);
  return { go: [], stopped: [w] };
}

/** Throat Chop (data/moves.ts throatchop condition onBeforeMove, priority 6): no sound move but a Z-Move or Max Move. */
function throatChopCheck(kernel: TurnKernel, w: World, action: PendingAction, info: BeforeInfo): Gate {
  if (!w.mons[action.slot]!.throatChopped || !info.sound || info.isZ || info.isMax) return { go: [w], stopped: [] };
  kernel.skipFact(action, `Throat Chop: ${kernel.moveName(action.moveId!)} cannot be used.`, w.mass);
  return { go: [], stopped: [w] };
}

/**
 * Heal Block (data/moves.ts healblock condition onBeforeMove, priority 6; Psychic Noise's this turn, doubles-eot.ts afterHit):
 * a move with the heal flag (a status heal, a draining move) but a Z-Move or Max Move.
 */
function healBlockCheck(kernel: TurnKernel, w: World, action: PendingAction, info: BeforeInfo): Gate {
  if (!w.mons[action.slot]!.eot.healBlock || !info.heal || info.isZ || info.isMax) return { go: [w], stopped: [] };
  kernel.skipFact(action, `Heal Block: ${info.name} cannot be used.`, w.mass);
  return { go: [], stopped: [w] };
}

/** Taunt (data/moves.ts taunt condition onBeforeMove, priority 5): a status move but a Z-Move and Me First; Splash included. */
function tauntCheck(kernel: TurnKernel, w: World, action: PendingAction, info: BeforeInfo): Gate {
  if (!w.mons[action.slot]!.vol.taunt || info.category !== "Status" || info.isZ || info.id === "mefirst") return { go: [w], stopped: [] };
  kernel.skipFact(action, `Taunt: ${info.name} cannot be used.`, w.mass);
  return { go: [], stopped: [w] };
}

/** Imprison (data/moves.ts imprison condition onFoeBeforeMove, priority 4): a move its living foe's Imprison user also has, not Struggle, a Z-Move or Max Move. */
function imprisonCheck(kernel: TurnKernel, w: World, action: PendingAction, info: BeforeInfo): Gate {
  if (info.isZ || info.isMax || info.id === "struggle") return { go: [w], stopped: [] };
  const holder = foesOf(action.slot).find((foe) => kernel.alive(w, foe) && foe !== w.ghost && w.mons[foe]!.vol.imprisoning && kernel.input.pokemon[foe]?.moves?.includes(info.id));
  if (!holder) return { go: [w], stopped: [] };
  kernel.skipFact(action, `Imprison: ${info.name} cannot be used.`, w.mass);
  return { go: [], stopped: [w] };
}

/**
 * Confusion (data/conditions.ts confusion onBeforeMove, priority 3): the counter goes down; at 0 it snaps out (the
 * posterior over T, uniform on min..5); otherwise it hurts itself with randomChance(33, 100) (confusionHit) and its action
 * ends there.
 */
function confusionCheck(kernel: TurnKernel, w: World, action: PendingAction, info: BeforeInfo): Gate {
  const confusion = w.mons[action.slot]!.vol.confusion;
  if (!confusion) return { go: [w], stopped: [] };
  void info;
  const attempt = confusion.attempts + 1;
  const snap = snapChance(attempt, confusion.min);
  const go: World[] = [], stopped: World[] = [];
  if (snap > 0) {
    const out = snap >= 1 ? w : cloneWorld(w, w.mass * snap);
    setVol(out, action.slot, { confusion: undefined });
    kernel.stepFact(action, "Snaps out of confusion.", out.mass);
    go.push(out);
  }
  if (snap >= 1) return { go, stopped };
  if (snap > 0) w.mass *= 1 - snap;
  setVol(w, action.slot, { confusion: { attempts: attempt, min: confusion.min } });
  const hurt = cloneWorld(w, w.mass * 0.33);
  w.mass *= 0.67;
  go.push(w);
  stopped.push(...confusionHit(kernel, hurt, action));
  return { go, stopped };
}

/** Full paralysis (data/conditions.ts par onBeforeMove, priority 1: randomChance(1, 4); Champions 1/8). */
function paralysisCheck(kernel: TurnKernel, w: World, action: PendingAction): Gate {
  if (w.mons[action.slot]!.build.status !== "par") return { go: [w], stopped: [] };
  const chance = kernel.champions ? 1 / 8 : 1 / 4;
  const still = cloneWorld(w, w.mass * chance);
  kernel.skipFact(action, "Fully paralysed.", still.mass);
  w.mass *= 1 - chance;
  return { go: [w], stopped: [still] };
}

/** Focus Punch's beforeMoveCallback: a focusing Focus Punch whose user was damaged loses its focus. */
function focusCheck(kernel: TurnKernel, w: World, action: PendingAction): Gate {
  if (!w.mons[action.slot]!.focusLost || !kernel.focuses(w, action.slot, action.moveId)) return { go: [w], stopped: [] };
  kernel.skipFact(action, "Loses its focus (Focus Punch).", w.mass);
  return { go: [], stopped: [w] };
}

/**
 * The 16 rolls of a confusion self-hit (sim/battle-actions.ts getConfusionDamage): 40 power from the stored Attack and
 * Defense with their stages (Wonder Room: the stored Sp. Def, sim/pokemon.ts calculateStat; no Unaware: its holder's own
 * stages), the level (50 in Champions), the 16-bit wrap, then tr(tr(base × r) / 100) for r 85..100, each at least 1.
 */
export function confusionRolls(kernel: TurnKernel, w: World, slot: DoublesSlotId): number[] {
  const build = w.mons[slot]!.build;
  const stored = kernel.buildStats(build);
  if (!stored) kernel.notEstimated(REASONS.notIn2v2("Confusion"));
  const stage = (value: number, boost: number) => {
    const table = [1, 1.5, 2, 2.5, 3, 3.5, 4];
    const b = Math.max(-6, Math.min(6, boost));
    return b >= 0 ? Math.floor(value * table[b]) : Math.floor(value / table[-b]);
  };
  const attack = stage(stored!.atk, build.boosts.atk ?? 0);
  const defense = stage(w.field.wonderRoom ? stored!.spd : stored!.def, build.boosts.def ?? 0);
  const level = kernel.champions ? 50 : build.native?.level ?? 50;
  const tr = Math.trunc;
  const base = (tr(tr(tr(tr(2 * level / 5 + 2) * 40 * attack) / defense) / 50) + 2) % 65536;
  return Array.from({ length: 16 }, (_, i) => Math.max(1, tr(tr(base * (85 + i)) / 100)));
}

/**
 * The confusion self-hit (data/conditions.ts confusion: this.damage with a typeless Move effect, through the Damage event):
 * Endure (−10) leaves 1 HP, then Sturdy and Focus Sash at full HP (the Sash is used); an intact Disguise is not followed
 * (Ice Face reads a Physical move: it takes none); Focus Band is not estimated where it can save; Magic Guard and
 * Multiscale do not stop it. It sets hurt (Assurance), no damagedBy or hit count, and no Emergency Exit (status-eot C7);
 * the action's Update then eats an HP or pinch Berry (a foe's Unnerve or As One stops it, not Berry Juice), but for a
 * Berserk or Anger Shell holder's healing Berry: the self-hit's effect is of type Move, so their onDamage leaves
 * TryEatItem failing (MoveVolatiles.berryLocked). The lowest and highest walks take the lowest and highest roll.
 */
function confusionHit(kernel: TurnKernel, w: World, action: PendingAction): World[] {
  const slot = action.slot;
  const mon = w.mons[slot]!;
  const build = mon.build;
  const name = kernel.names[slot];
  if (build.abilityId === "disguise" && (build.speciesId === "mimikyu" || build.speciesId === "mimikyutotem") && !build.transformedFrom) {
    kernel.notEstimated(REASONS.faceSelfHit(kernel.abilityName("disguise")));
  }
  const rolls = confusionRolls(kernel, w, slot);
  const values = kernel.mode === "lowest" ? [rolls[0]] : kernel.mode === "highest" ? [rolls[15]] : rolls;
  const dist = new Map<number, number>();
  for (const value of values) dist.set(value, (dist.get(value) ?? 0) + 1 / values.length);
  const { maxHP, baseMaxHP } = kernel.hp[slot];
  const works = kernel.itemWorks(w, build);
  if (build.itemId === "focusband" && works && Math.max(...values) >= Math.min(...marginal(w, slot).keys())) kernel.notEstimated(REASONS.focusBand);
  const endure = !!mon.vol.endure, sturdy = build.abilityId === "sturdy", sash = build.itemId === "focussash" && works;
  const item = build.itemId;
  const locks = build.abilityId === "berserk" || build.abilityId === "angershell";
  const usable = works && (HEALING_BERRIES.has(item) || !!PINCH_STAT_BERRIES[item] || LANSAT_STARF.has(item)) && item !== "enigmaberry"
    && (item === "berryjuice" || !kernel.berryStopped(w, slot)) && !(locks && BERSERK_BERRIES.has(item));
  const berry = usable ? berryArithmetic(item, { maxHP, baseMaxHP, ability: build.abilityId }, generation(kernel)) : null;
  const text = `${range(values)} HP`;
  if (action.moveId === null) kernel.lossFact(slot, `${name} hurts itself in confusion: ${text}.`, w.mass);
  else kernel.skipFact(action, `Hurts itself in confusion: ${text}.`, w.mass);
  const before = kernel.snapshot(w);
  const parts = lossDist(w, slot, dist, (hp, loss) => {
    let damage = loss, used = false;
    if (endure && damage >= hp) damage = hp - 1;
    else if (hp >= maxHP && damage >= hp && (sturdy || sash)) { damage = hp - 1; used = !sturdy; }
    let after = Math.max(0, hp - damage), ate = false;
    if (berry && !used && after > 0 && after <= berry.line) { kernel.noteBerry(slot, item, berry, after); after = eatBerry(berry, after); ate = true; }
    return { hp: after, tag: `${after <= 0 ? "fainted" : "in"}|${ate ? "ate" : used ? "sash" : ""}` };
  });
  return parts.flatMap(({ world, tag }) => {
    const self = world.mons[slot]!;
    self.hurt = true;
    if (locks) setVol(world, slot, { berryLocked: true });
    if (tag.endsWith("sash")) self.build = { ...self.build, itemId: "", ...(self.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
    if (tag.startsWith("fainted")) kernel.faint(world, slot);
    return (tag.endsWith("ate") ? kernel.ateBerry(world, slot, item) : [world]).flatMap((next) => {
      kernel.eventGuards(before, next, false);
      return next.mons[slot]!.fainted && UNNERVES.has(next.mons[slot]!.build.abilityId) ? kernel.unnerveEnds(next, [slot]) : [next];
    });
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Hooks doubles-turn.ts calls besides BeforeMove
// ------------------------------------------------------------------------------------------------------------------

/**
 * The status part of the guards known before the walk (doubles-turn.ts presenceGuards), for a slot with a move that has a
 * target: a P move (Revival Blessing) and the L moves that change HP or eat or give an item during the moves (Purify,
 * Stuff Cheeks, Swallow, Teatime, Recycle, Bestow: the HP after the moves would not hold), Sleep Talk used asleep (it calls
 * a move), and Uproar while a Pokémon sleeps or a sleep can start (data/moves.ts uproar).
 */
export function presenceGuards(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const entry = kernel.input.pokemon[slot]!;
  const build = w.mons[slot]!.build;
  const moveId = entry.action.moveId!;
  if (HP_STATUS_MOVES.has(moveId) && !entry.contexts[moveId]?.useZ) kernel.notEstimated(REASONS.notModelled(kernel.moveName(moveId)));
  if (moveId === "sleeptalk" && build.status === "slp") {
    const sleep = w.mons[slot]!.vol.sleep;
    if (wakeChance(kernel.champions, sleep?.rest ?? false, sleep?.elapsed ?? 0, build.abilityId === "earlybird" ? 2 : 1) < 1) kernel.notEstimated(REASONS.notIn2v2(kernel.moveName("sleeptalk")));
  }
  if (moveId === "uproar") {
    const sleeps = DOUBLES_SLOTS.some((other) => {
      const mon = w.mons[other], id = kernel.input.pokemon[other]?.action.moveId;
      return !!mon && (mon.build.status === "slp" || mon.eot.yawn !== undefined || (!!id && (id === "rest" || id === "yawn" || tableEntry(kernel, id)?.status === "slp")));
    });
    if (sleeps) kernel.notEstimated(REASONS.notIn2v2(kernel.moveName("uproar")));
  }
}

/**
 * A move that knocked `target` out, as hitReactions sees it (doubles-turn.ts, after the target's faint): Destiny Bond
 * (data/moves.ts destinybond onFaint): a foe's move (not a future move) that knocks its user out faints that foe too, in
 * the same faint batch (Soul-Heart, the faint count, a strong weather), unless the foe is Dynamaxed.
 */
export function onKnockOut(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId) {
  const receiver = w.mons[target]!;
  if (!receiver.fainted || !receiver.destinyBond || !kernel.isFoe(attacker, target) || !kernel.alive(w, attacker)) return;
  const user = w.mons[attacker]!;
  const pseudo = actionOf(kernel, attacker);
  if (isMaxActive(user.build)) { if (pseudo) kernel.stepFact(pseudo, `Destiny Bond: ${kernel.names[attacker]} is Dynamaxed and does not faint.`, w.mass); return; }
  const [only] = mapHP(w, attacker, () => ({ hp: 0, tag: "" }));
  w.factors = only.world.factors;
  kernel.faint(w, attacker);
  if (pseudo) kernel.stepFact(pseudo, `Destiny Bond: ${kernel.names[attacker]} faints too.`, w.mass);
}
/** A slot's action as the statistics read it (index among the present slots: doubles-turn.ts createContext's actions). */
function actionOf(kernel: TurnKernel, slot: DoublesSlotId): PendingAction | null {
  const index = DOUBLES_SLOTS.filter((each) => kernel.input.pokemon[each]).indexOf(slot);
  if (index < 0) return null;
  const entry = kernel.input.pokemon[slot]!;
  return { index, slot, moveId: entry.action.moveId, target: entry.action.target, fractional: 0 };
}

/**
 * Whether doubles-turn.ts eventGuards checks Emergency Exit and Wimp Out after `action` (its runMove): only after a
 * damaging move (sim/battle-actions.ts:530,542,1015,1132,1395; status-eot C7). A status move's HP change does not.
 */
export function exitsAfter(kernel: TurnKernel, action: PendingAction, move: ChampionsMove): boolean {
  return !(move.category === "Status" && !kernel.input.pokemon[action.slot]?.contexts[move.id]?.useZ);
}

/** Whether `target` endures this turn's hits (data/moves.ts endure: UsesEnv.endure in doubles-turn.ts searchFor). */
export function endureFor(w: World, target: DoublesSlotId): boolean {
  return !!w.mons[target]?.vol.endure;
}

/**
 * Track A's reactions to one damaging hit on the Pokémon (doubles-turn.ts afterHit): Dynamic Punch's and Chatter's 100%
 * confusion (fresh; Own Tempo, Misty Terrain under a grounded target, Safeguard from a foe without Infiltrator, already
 * confused; Persim and Lum cure it at the hit's Update); a Fire hit or a thawing move thawing a frozen target
 * (data/conditions.ts frz onDamagingHit, onAfterMoveSecondary); and, as Safeguard set this turn is not the pair's: a status
 * the step gave a target behind its side's Safeguard.
 */
export function afterHit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  const attacker = action.slot;
  const receiver = w.mons[target]!;
  const id = ownMoveId(action.moveId!, info);
  if (outcome.landed <= 0 || receiver.fainted) return;
  if (CONFUSING_MOVES.has(id) && kernel.secondaryLands(w, attacker, target, info) && !receiver.vol.confusion) {
    const broken = kernel.breaks(w, attacker, target, info);
    const ownTempo = receiver.build.abilityId === "owntempo" && !broken;
    const misty = w.field.terrain === "Misty" && kernel.grounded(w, target) && !receiver.eot.hidden;
    const safeguard = w.sides[slotSide(target)].safeguard && attacker !== target && !(w.mons[attacker]!.build.abilityId === "infiltrator" && kernel.isFoe(attacker, target));
    if (!ownTempo && !misty && !safeguard) {
      setVol(w, target, { confusion: { attempts: 0, min: 2 } });
      cureConfusionBerry(kernel, w, target);
    }
  }
  if (receiver.build.status === "frz") {
    const type = kernel.usedType(w, attacker, action.moveId!, target, info, kernel.input.pokemon[attacker]!.contexts[action.moveId!]);
    if ((type === "Fire" && id !== "polarflare") || THAWING_MOVES.has(id)) receiver.build = { ...receiver.build, status: "" };
  }
  // Safeguard, set this turn, keeps a foe's move's status off its side (data/moves.ts safeguard onSetStatus), which the
  // pair's step does not read: a step whose every-use status the target now has is not followed.
  const given = id ? everyUseStatus(id, w.mons[attacker]!.build.abilityId === "serenegrace")?.status : undefined;
  if (given && w.sides[slotSide(target)].safeguard && kernel.isFoe(attacker, target) && receiver.build.status === given && w.mons[attacker]!.build.abilityId !== "infiltrator") {
    kernel.notEstimated(REASONS.notIn2v2(kernel.moveName("safeguard")));
  }
}
/** Persim or Lum Berry curing a confusion at the Update (data/items.ts persimberry, lumberry onUpdate), in place. */
function cureConfusionBerry(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const build = w.mons[slot]!.build;
  if ((build.itemId !== "persimberry" && build.itemId !== "lumberry") || !kernel.itemWorks(w, build) || kernel.berryStopped(w, slot)) return;
  w.mons[slot]!.build = { ...build, itemId: "", ...(build.itemId === "lumberry" ? { status: "" } : {}), ...(build.abilityId === "unburden" ? { abilityActive: true } : {}) };
  setVol(w, slot, { confusion: undefined });
  kernel.pouchHeal(w, slot);
}

/**
 * A damaging move's own Try failure Track A follows (doubles-turn.ts damagingMove, after moveFailure, before PrepareHit):
 * Snore once its user is awake (data/moves.ts snore onTry: asleep or Comatose); Pollen Puff at an ally from a user under Heal
 * Block (pollenpuff onTryMove).
 */
export function tryMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number, info: TurnMoveInfo): string | null {
  void priority;
  const user = w.mons[action.slot]!;
  const id = ownMoveId(move.id, info);
  if (id === "snore" && user.build.status !== "slp" && user.build.abilityId !== "comatose") return `${move.name} fails: ${kernel.names[action.slot]} is awake.`;
  if (id === "pollenpuff" && !info.transformed && target !== action.slot && !kernel.isFoe(action.slot, target) && user.eot.healBlock) return `Heal Block: ${move.name} cannot be used.`;
  return null;
}

/**
 * A damaging move that does something of its own to this target instead of damage (doubles-turn.ts singleStep, after the
 * block check): Pollen Puff on an ally (data/moves.ts pollenpuff onTryHit, onHit): no damage, it heals
 * floor(baseMaxhp / 2) (none at full HP, none under Heal Block); Bulletproof makes the ally immune. Life Orb then costs its
 * user a tenth when the heal happened (onAfterMoveSecondarySelf on a move that hit). Its worlds, or null.
 */
export function singleHit(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, check: HitCheck, attackerHP?: number): World[] | null {
  void attackerHP;
  const user = action.slot, target = check.slot;
  if (action.moveId !== "pollenpuff" || info.transformed || kernel.isFoe(user, target) || target === user) return null;
  const stats = kernel.hitStats(action, target);
  const receiver = w.mons[target]!.build;
  if (receiver.abilityId === "bulletproof" && !kernel.breaks(w, user, target, info)) {
    if (stats) stats.noDamage += w.mass;
    kernel.hitFact(action, target, `${kernel.abilityName("bulletproof")}: ${kernel.names[target]} is not affected.`, w.mass);
    return [w];
  }
  if (stats) stats.effect += w.mass;
  const amount = Math.max(1, Math.floor(kernel.hp[target].baseMaxHP / 2));
  return healWorlds(kernel, w, target, amount, { action, source: kernel.moveName("pollenpuff"), failFact: true }).flatMap(({ world, healed }) => {
    if (!healed) return [world];
    const build = world.mons[user]!.build;
    const lifeOrb = build.itemId === "lifeorb" && kernel.itemWorks(world, build) && build.abilityId !== "magicguard";
    return lifeOrb ? kernel.afterLoss(world, user, Math.max(1, Math.floor(kernel.hp[user].baseMaxHP / 10))) : [world];
  });
}

/**
 * A Figy-family Berry `slot` ate (data/items.ts figyberry and its kin onEat) confuses it when its Nature lowers that Berry's
 * stat (addVolatile('confusion'): a fresh confusion, SPEC §4.6), unless Own Tempo or Misty Terrain under it stops it
 * (onTryAddVolatile) or it is already confused.
 */
export function berryConfusion(kernel: TurnKernel, w: World, slot: DoublesSlotId, item: string) {
  const stat = CONFUSING_BERRIES[item];
  if (!stat || !kernel.alive(w, slot)) return;
  const mon = w.mons[slot]!;
  if (NATURES.find((nature) => nature.name === mon.build.nature)?.minus !== stat || mon.build.abilityId === "owntempo" || mon.vol.confusion) return;
  if (w.field.terrain === "Misty" && kernel.grounded(w, slot) && !mon.eot.hidden) return;
  setVol(w, slot, { confusion: { attempts: 0, min: 2 } });
}

/**
 * Track A's condition facts on `slot` in one world (DoublesHP.conditions): its status where it differs from how it
 * started the turn, and the moves-phase volatiles it has (confusion, Taunt, Disable, Encore).
 */
export function conditions(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  const mon = w.mons[slot]!;
  if (mon.fainted) return [];
  const out: string[] = [];
  const start = kernel.input.pokemon[slot]?.build.status ?? "";
  if (mon.build.status !== start) out.push(mon.build.status ? STATUS_STATE[mon.build.status] : "Status cured.");
  const vol = mon.vol as Vol;
  if (vol.confusion) out.push("Confused.");
  if (vol.taunt) out.push("Taunted.");
  if (vol.disabled) out.push(`Disabled: ${kernel.moveName(vol.disabled)}.`);
  if (vol.encore) out.push(`Encore: ${kernel.moveName(vol.encore)}.`);
  return out;
}

/**
 * Track A's part of an E2 outcome Pokémon: the volatiles of the moves phase the next turn reads (confusion, taunt, encore,
 * disable, imprison) and the sleep counter expected to be left (SPEC §4.9).
 */
export function outcomeMon(kernel: TurnKernel, w: World, slot: DoublesSlotId): Pick<DoublesOutcomeMon, "volatiles" | "sleepTurns"> {
  const mon = w.mons[slot]!;
  if (mon.fainted) return {};
  const vol = mon.vol as Vol;
  const volatiles = [
    ...(vol.confusion ? ["confusion"] : []), ...(vol.taunt ? ["taunt"] : []), ...(vol.encore ? ["encore"] : []),
    ...(vol.disabled ? ["disable"] : []), ...(vol.imprisoning ? ["imprison"] : []),
  ];
  const out: Pick<DoublesOutcomeMon, "volatiles" | "sleepTurns"> = volatiles.length ? { volatiles } : {};
  if (mon.build.status === "slp" && mon.build.abilityId !== "comatose") {
    const step = mon.build.abilityId === "earlybird" ? 2 : 1;
    out.sleepTurns = sleepTurnsLeft(kernel.champions, vol.sleep?.rest ?? false, vol.sleep?.elapsed ?? 0, step);
  }
  return out;
}

/**
 * Track A's turn facts read from the input (SPEC §2.5): sleep and freeze counters assumed (read at its BeforeMove, No move
 * included, unless its own ability cures the status as the turn starts: turnStartUpdate), Destiny Bond and Endure's last
 * turn. `suppressed`: the slots whose ability Neutralizing Gas suppresses from the turn's start.
 */
export function turnFacts(input: DoublesTurnInput, suppressed: readonly DoublesSlotId[] = []): string[] {
  const facts: string[] = [];
  const names = turnNames(input);
  const champions = input.runtime.profile.id === "champions";
  for (const slot of DOUBLES_SLOTS) {
    const entry = input.pokemon[slot];
    if (!entry) continue;
    const carried = entry.carried ?? {};
    // Cured at the turn's first Update by its own ability or its Berry (no foe's Unnerve or As One, the item working): no counter is read.
    const unnerved = DOUBLES_SLOTS.some((other) => slotSide(other) !== slotSide(slot) && UNNERVES.has(input.pokemon[other]?.build.abilityId ?? ""));
    const berry = !input.field.magicRoom && entry.build.abilityId !== "klutz" && !unnerved
      && (entry.build.itemId === "lumberry" || entry.build.itemId === (entry.build.status === "slp" ? "chestoberry" : "aspearberry"));
    const cured = berry || (!suppressed.includes(slot) && !!OWN_CURES[entry.build.abilityId]?.includes(entry.build.status));
    if (entry.build.status === "slp" && entry.build.abilityId !== "comatose" && !carried.sleep && !cured) facts.push(`Assumes ${names[slot]} lost no turns to sleep before this one.`);
    if (champions && entry.build.status === "frz" && !carried.freeze && !cured) facts.push(`Assumes ${names[slot]} lost no turns to freeze before this one.`);
    if (entry.action.moveId === "destinybond") facts.push(`Assumes ${names[slot]} did not use Destiny Bond last turn.`);
    if (entry.action.moveId === "endure") facts.push("Assumes no protecting move was used last turn.");
  }
  return facts;
}

// ------------------------------------------------------------------------------------------------------------------
// Status moves (SPEC §4.3)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Protean and Libero (data/abilities.ts protean, libero onPrepareHit; data/mods/gen8/abilities.ts on every move): the
 * user takes its move's one type as the move is about to hit (after Try: sim/battle-actions.ts trySpreadMoveHit,
 * tryMoveHit), unless the move is a future move or calls another, the user is Terastallized (sim/pokemon.ts setType)
 * or already of that type alone. The calculations read the species' types, so a later damaging action is not
 * estimated. `type`: the move's type after ModifyType, read only for a holder.
 */
export function proteanGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, moveId: string, type: () => string) {
  const build = w.mons[slot]!.build;
  if ((build.abilityId !== "protean" && build.abilityId !== "libero") || build.mechanic === "tera") return;
  if (FUTURE_MOVES.has(moveId) || CALLING_MOVES.has(moveId) || !kernel.laterDamaging(w)) return;
  const used = type();
  if (!used || used === "???" || kernel.typesOf(build).join() === used) return;
  kernel.notEstimated(REASONS.typeChange(kernel.abilityName(build.abilityId), kernel.names[slot]));
}

/** One use of a status move: who uses it, its data in this game, its type and priority as used. */
type Use = {
  /** The action the step statistics record it under (a bounced move's: the original action's). */
  action: PendingAction;
  user: DoublesSlotId;
  move: ChampionsMove;
  entry: StatusEntry;
  info: TurnMoveInfo;
  /** The move's type after ModifyType (Normalize, Liquid Voice, the -ate abilities). */
  type: string;
  /** move.priority (Prankster's +1, Triage's +3 included): Quick Guard, Psychic Terrain and the priority shields read it. */
  priority: number;
  /** pranksterBoosted (sim/battle-actions.ts hitStepTryImmunity): Prankster raised it; never for a bounced move. */
  prankster: boolean;
  bounced: boolean;
  /** Infiltrator (move.infiltrates): it passes Substitute, and a foe's Safeguard. */
  infiltrates: boolean;
  /** The target type it is used with (Curse's: the user's, or a random foe's). */
  targetType: string;
  /** The Pokémon it reached (its hit entries); a fact on another (its user, by Mirror Armor or Synchronize) is a step fact. */
  reached: Set<DoublesSlotId>;
};

/** A synthetic engine move for a status move (the engine's flags miss the pinned ones; the table has them). */
function statusInfo(move: ChampionsMove, entry: StatusEntry): TurnMoveInfo {
  return {
    kind: "move", effective: move, transformed: false, isZ: false, isMax: false, contact: false,
    flags: Object.fromEntries(Object.keys(entry.flags).map((flag) => [flag, 1])), drain: false, secondaries: false, recoil: false,
  };
}

/** The status move's type as used (data/abilities.ts normalize, liquidvoice, aerilate and its kin onModifyType). */
function statusType(kernel: TurnKernel, w: World, user: DoublesSlotId, move: ChampionsMove, entry: StatusEntry): string {
  const build = w.mons[user]!.build;
  const ability = build.abilityId;
  if (ability === "normalize" && generation(kernel) >= 7) return "Normal";
  if (ability === "liquidvoice" && entry.flags.sound && !isMaxActive(build)) return "Water";
  const ate: Record<string, string> = { aerilate: "Flying", pixilate: "Fairy", refrigerate: "Ice", galvanize: "Electric", dragonize: "Dragon" };
  if (move.type === "Normal" && ate[ability]) return ate[ability];
  return move.type;
}

/** The world's statuses and volatiles before an action (what its Update cures: only what the action gave). */
type Before = Partial<Record<DoublesSlotId, { status: string; confusion: boolean; taunt: boolean; disabled: string | undefined; encore: string | undefined }>>;
function beforeOf(w: World): Before {
  return Object.fromEntries(DOUBLES_SLOTS.filter((slot) => w.mons[slot]).map((slot) => {
    const mon = w.mons[slot]!;
    const vol = mon.vol as Vol;
    return [slot, { status: mon.build.status, confusion: !!vol.confusion, taunt: !!vol.taunt, disabled: vol.disabled, encore: vol.encore }];
  }));
}

export function statusMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] {
  const slot = action.slot;
  const mon = w.mons[slot]!;
  const name = kernel.names[slot];
  const entry = tableEntry(kernel, move.id);
  const partner = allyOf(slot);
  const targetType = entry?.target ?? move.target;
  // A move aimed at the ally (Helping Hand, Aromatic Mist, Coaching, Dragon Cheer, Hold Hands) with the ally fainted or its
  // slot empty: sim/battle.ts getTarget keeps a fainted ally, sim/pokemon.ts getMoveTargets then has no target and
  // sim/battle-actions.ts useMoveInner fails it (-fail, [notarget]) before any PrepareHit (Protean). After that ally's Ally
  // Switch the user stands at the aimed position: no target either (sim/battle.ts:2456-2462; ADDENDUM §4.11.4). A move
  // that can target its user too (Acupressure, Champions' Milk Drink) is targetsOf's.
  const atAlly = targetType === "adjacentAlly";
  if (atAlly && !kernel.alive(w, partner)) {
    kernel.stepFact(action, `${move.name} fails: ${w.mons[partner] ? kernel.names[partner] : "its ally"} has fainted.`, w.mass);
    return [w];
  }
  if (atAlly && kernel.occupant(w, partner) === slot) {
    kernel.stepFact(action, `${move.name} fails: after Ally Switch, ${name} stands in ${kernel.names[partner]}'s place.`, w.mass);
    return [w];
  }
  // Sleep Talk (data/moves.ts sleeptalk onTry): asleep it calls one of its moves (not followed); awake it fails.
  if (move.id === "sleeptalk") {
    if (mon.build.status === "slp" || mon.build.abilityId === "comatose") kernel.notEstimated(REASONS.notIn2v2(move.name));
    kernel.stepFact(action, `${move.name} fails: ${name} is awake.`, w.mass);
    return [w];
  }
  const kind = entry?.kind ?? "L";
  // The moves today's code models before the pipeline: the protecting moves, Endure, the guards, Helping Hand, the
  // centres of attention, Destiny Bond and the field moves.
  if (kind === "X" || move.id === "endure" || move.id === "destinybond") {
    const early = earlyBranch(kernel, w, action, move);
    if (early) return early;
  }
  // With Neutralizing Gas on the field these can end it or change what it suppresses, whether or not an action follows.
  if (kernel.gas && GAS_CHANGING_MOVES.has(move.id)) kernel.notEstimated(REASONS.withGas(move.name));
  if (kind === "M" || kind === "C" || kind === "N" || kind === "S") return runStatusMove(kernel, w, action, move, entry!);
  // Any other status move changes later moves in ways the turn does not follow (SPEC §2.2): not estimated before a later
  // living action; as the last action only the end of turn is not estimated.
  fieldGuard(kernel, w, slot, move);
  if (kernel.laterAction(w)) kernel.notEstimated(REASONS.notModelledBefore(move.name));
  // Bestow of an item its receiver uses at the Update, and Recycle without an item (the item it used before is not known),
  // change the turn after the moves too.
  if ((move.id === "bestow" && entry && bestowActs(kernel, w, action, move, entry)) || (move.id === "recycle" && !mon.build.itemId)) kernel.notEstimated(REASONS.notModelled(move.name));
  w.endGuard ??= REASONS.notModelled(move.name);
  return [w];
}

/** Items a holder uses at an Update whatever its HP (data/items.ts onUpdate, onAnyAfterMove...): the curing Berries, the Herbs, the Seeds, Booster Energy, Room Service. */
const UPDATE_ITEMS = new Set(["lumberry", "persimberry", "cheriberry", "chestoberry", "pechaberry", "rawstberry", "aspearberry", "mentalherb", "whiteherb", "mirrorherb",
  "electricseed", "grassyseed", "mistyseed", "psychicseed", "boosterenergy", "roomservice"]);
/** Pinch Berries eaten at a quarter of the maximum HP (half with Gluttony) besides the stat ones (data/items.ts lansatberry, starfberry, micleberry, custapberry). */
const OTHER_PINCH_BERRIES = new Set(["lansatberry", "starfberry", "micleberry", "custapberry"]);
/**
 * Whether Bestow (data/moves.ts bestow onHit: setItem on a target with no item) can give its user's item to a target (after
 * redirection) that uses it at the action's Update: an HP or pinch Berry on one at or below its line, or an item of UPDATE_ITEMS.
 */
function bestowActs(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, entry: StatusEntry): boolean {
  const user = action.slot;
  const item = w.mons[user]!.build.itemId;
  if (!item) return false;
  const targets = new Set(kernel.resolveTargets(cloneWorld(w, w.mass), action, statusInfo(move, entry)).flatMap((resolution) => resolution.targets));
  if (UPDATE_ITEMS.has(item)) return [...targets].some((slot) => slot !== user && !w.mons[slot]!.build.itemId);
  const pinch = !!PINCH_STAT_BERRIES[item] || OTHER_PINCH_BERRIES.has(item);
  if ((!HEALING_BERRIES.has(item) && !pinch) || item === "enigmaberry") return false;
  return [...targets].some((slot) => {
    if (slot === user || !kernel.alive(w, slot) || w.mons[slot]!.build.itemId) return false;
    const { maxHP, baseMaxHP } = kernel.hp[slot];
    const line = berryArithmetic(item, { maxHP, baseMaxHP, ability: w.mons[slot]!.build.abilityId }, generation(kernel)).line;
    return [...marginal(w, slot).keys()].some((hp) => hp > 0 && hp <= line);
  });
}

/** statusMove's moved branches (today's code): the protecting moves and Endure, the guards, Helping Hand, Follow Me and Rage Powder, Destiny Bond, the field moves. */
function earlyBranch(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] | null {
  const slot = action.slot;
  const mon = w.mons[slot]!;
  const partner = allyOf(slot);
  // A protecting move that fails stops in its own PrepareHit (data/moves.ts protect onPrepareHit), before Protean's:
  // it fails only with no action left, where nothing reads the type.
  proteanGuard(kernel, w, slot, move.id, () => move.type);
  const protect = PROTECT_MOVES[move.id];
  if (protect || move.id === "endure") {
    // onPrepareHit: !!this.queue.willAct() (data/moves.ts:13973-13974): an action, a fainted Pokémon's included, is still queued.
    if (!w.remaining.length) { kernel.stepFact(action, `${move.name} fails: no Pokémon moves after it.`, w.mass); return [w]; }
    if (protect) {
      mon.protect = protect;
      // Stance Change (data/abilities.ts stancechange onModifyMove): King's Shield gives Aegislash its Shield Forme.
      if (move.id === "kingsshield") stanceChange(kernel, w, slot, false);
      return [w];
    }
    // Endure (data/moves.ts endure condition onDamage, priority −10): a hit that would knock it out this turn leaves 1 HP.
    setVol(w, slot, { endure: true });
    kernel.stepFact(action, `Endure: ${kernel.names[slot]} keeps at least 1 HP this turn.`, w.mass);
    return [w];
  }
  if (move.id === "wideguard" || move.id === "quickguard") {
    if (!w.remaining.length) { kernel.stepFact(action, `${move.name} fails: no Pokémon moves after it.`, w.mass); return [w]; }
    w.sides[slotSide(slot)] = { ...w.sides[slotSide(slot)], [move.id === "wideguard" ? "wideGuard" : "quickGuard"]: true };
    return [w];
  }
  if (move.id === "helpinghand") {
    const ally = partner;
    // onTryHit: the ally must still have a move queued (data/moves.ts:8584-8585 queue.willMove).
    if (!w.remaining.some((entry) => entry.slot === ally)) {
      kernel.stepFact(action, `Helping Hand fails: ${kernel.names[ally]} has already moved.`, w.mass);
      return [w];
    }
    w.mons[ally]!.helpingHand += 1;
    if (w.mons[ally]!.helpingHand > 1) kernel.notEstimated(REASONS.notIn2v2("Helping Hand"));
    kernel.stepFact(action, `Helping Hand: ${kernel.names[ally]}'s move has 1.5x power.`, w.mass);
    return [w];
  }
  if (move.id === "followme" || move.id === "ragepowder") {
    mon.centre = move.id;
    return [w];
  }
  // Destiny Bond (data/moves.ts destinybond): a foe's move that knocks its user out this turn faints that foe too
  // (onKnockOut); its onPrepareHit fails it after a use last turn (a turn fact).
  if (move.id === "destinybond") {
    mon.destinyBond = true;
    kernel.stepFact(action, `Destiny Bond: a foe whose move knocks ${kernel.names[slot]} out faints too.`, w.mass);
    return [w];
  }
  if (fieldMove(kernel, w, action, move)) return [w];
  return null;
}

/**
 * Tailwind, the screens, Trick Room, Gravity and the weather and terrain moves (SPEC §4.4 step 9): each sets its side
 * or field state, which every later calculation and, from generation 8, the next sort read; or it fails where
 * Showdown's own check does. Whether `move` is one of them.
 */
export function fieldMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): boolean {
  const slot = action.slot;
  const side = slotSide(slot);
  const fail = (reason: string) => { kernel.stepFact(action, `${move.name} fails: ${reason}.`, w.mass); return true; };
  const done = (text: string) => { kernel.stepFact(action, text, w.mass); return true; };
  const flag = SIDE_MOVES[move.id];
  if (flag) {
    // sim/side.ts addSideCondition fails while the condition is up (none of the four has onSideRestart).
    if (w.sides[side][flag]) return fail(`it is already up on ${kernel.names[slot]}'s side`);
    // Aurora Veil's onTry: this.field.isWeather(['hail', 'snowscape']), through effectiveWeather.
    if (move.id === "auroraveil" && kernel.effectiveWeather(w) !== "Hail" && kernel.effectiveWeather(w) !== "Snow") return fail("there is no hail or snow");
    fieldGuard(kernel, w, slot, move);
    w.sides[side] = { ...w.sides[side], [flag]: true };
    return done(`${move.name} starts on ${kernel.names[slot]}'s side.`);
  }
  if (move.id === "trickroom") {
    fieldGuard(kernel, w, slot, move);
    // A Trick Room used while it is up ends it (data/moves.ts trickroom condition onFieldRestart).
    w.field = { ...w.field, trickRoom: !w.field.trickRoom };
    return done(w.field.trickRoom ? "Trick Room starts." : "Trick Room ends.");
  }
  if (move.id === "gravity") {
    // sim/field.ts addPseudoWeather fails while it is up (Gravity has no onFieldRestart).
    if (w.field.gravity) return fail("Gravity is already up");
    w.field = { ...w.field, gravity: true };
    return done("Gravity starts.");
  }
  const weather = WEATHER_MOVES[move.id];
  if (weather) {
    // sim/field.ts setWeather: the weather already up fails (generation 3 on); a living strong-weather holder stops
    // any other weather while its own is up (data/abilities.ts desolateland onAnySetWeather and its kin).
    if (w.field.weather === weather) return fail(`the weather is already ${weather}`);
    const keeper = STRONG_WEATHERS[w.field.weather];
    if (keeper && DOUBLES_SLOTS.some((other) => kernel.alive(w, other) && w.mons[other]!.build.abilityId === keeper)) return fail(`${w.field.weather} cannot be replaced`);
    fieldGuard(kernel, w, slot, move);
    w.field = { ...w.field, weather };
    return done(`The weather becomes ${weather}.`);
  }
  const terrain = TERRAIN_MOVES[move.id];
  if (terrain) {
    // sim/field.ts setTerrain: the terrain already up fails.
    if (w.field.terrain === terrain) return fail(`the terrain is already ${terrain} Terrain`);
    fieldGuard(kernel, w, slot, move);
    w.field = { ...w.field, terrain };
    return done(`The terrain becomes ${terrain} Terrain.`);
  }
  return false;
}

/**
 * A status move that changes the field changes what the battle settled from it (SPEC §2.2): a weather or a terrain
 * with a field-settled ability or item in (Protosynthesis, Quark Drive, Forecast, Mimicry, Flower Gift, Ice Face, a
 * Seed, Booster Energy), Tailwind with Wind Rider or Wind Power on its side, Trick Room with a Room Service holder.
 */
export function fieldGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove) {
  const living = DOUBLES_SLOTS.filter((other) => kernel.alive(w, other));
  if (FIELD_MOVES.has(move.id)) {
    for (const other of living) {
      const build = w.mons[other]!.build;
      if (kernel.fieldSettledAbilities.has(build.abilityId)) kernel.notEstimated(REASONS.fieldChange(kernel.abilityName(build.abilityId)));
      if (kernel.fieldSettledItems.has(build.itemId)) kernel.notEstimated(REASONS.fieldChange(kernel.itemName(build.itemId)));
    }
  }
  if (move.id === "tailwind") {
    for (const other of living) {
      const ability = w.mons[other]!.build.abilityId;
      if (slotSide(other) === slotSide(slot) && (ability === "windrider" || ability === "windpower")) kernel.notEstimated(REASONS.activates(move.name, kernel.abilityName(ability)));
    }
  }
  if (move.id === "trickroom") {
    for (const other of living) if (w.mons[other]!.build.itemId === "roomservice") kernel.notEstimated(REASONS.activates(move.name, kernel.itemName("roomservice")));
  }
}

export function stanceChange(kernel: TurnKernel, w: World, slot: DoublesSlotId, blade: boolean) {
  const mon = w.mons[slot]!;
  if (mon.build.abilityId !== "stancechange" || mon.build.transformedFrom || !mon.build.speciesId.startsWith("aegislash")) return;
  const form = blade ? "aegislashblade" : "aegislash";
  if (kernel.runtime.speciesById.has(form)) mon.build = { ...mon.build, speciesId: form };
}

/** The pipeline for an M, C, N or S status move used by its own action (SPEC §4.3 from step 3), then the action's Update (step 10). */
function runStatusMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, entry: StatusEntry): World[] {
  const user = action.slot;
  const priority = action.frozen ? action.frozen.priority - action.fractional : kernel.priorityOf(w, action);
  const use = makeUse(kernel, w, action, user, move, entry, priority, false, action.target);
  const before = beforeOf(w);
  return runUse(kernel, w, use, action.target).flatMap((world) => updateAll(kernel, world, before, use));
}

function makeUse(kernel: TurnKernel, w: World, action: PendingAction, user: DoublesSlotId, move: ChampionsMove, entry: StatusEntry, priority: number, bounced: boolean, aimed: DoublesSlotId | null): Use {
  const build = w.mons[user]!.build;
  let targetType = entry.target;
  // Curse (data/moves.ts curse onModifyMove): a user that is not a Ghost type uses it on itself; a Ghost type's aimed at
  // its ally goes to a random foe (generation 9; SwSh's own target is a random foe).
  if (move.id === "curse") {
    if (!kernel.typesOf(build).includes("Ghost")) targetType = "self";
    else if (generation(kernel) >= 9 && aimed && !kernel.isFoe(user, aimed) && aimed !== user) targetType = "randomNormal";
  }
  // Prankster (data/abilities.ts prankster onModifyPriority) on a status move, from generation 7 (hitStepTryImmunity).
  const prankster = !bounced && build.abilityId === "prankster" && generation(kernel) >= 7;
  return {
    action, user, move, entry, info: statusInfo(move, entry), type: statusType(kernel, w, user, move, entry), priority, prankster, bounced,
    infiltrates: build.abilityId === "infiltrator", targetType, reached: new Set(),
  };
}

/** A pseudo action for the kernel's target and TryMove helpers (a bounced move is its holder's). */
const kernelAction = (use: Use, aimed: DoublesSlotId | null): PendingAction => (use.bounced ? { ...use.action, slot: use.user, target: aimed } : use.action);

/** One use from its targets (SPEC §4.3 steps 4-9), without the action's Update. */
function runUse(kernel: TurnKernel, w: World, use: Use, aimed: DoublesSlotId | null): World[] {
  const { move } = use;
  const kind = use.entry.kind;
  // Side and field moves (sim/battle-actions.ts tryMoveHit): no Pokémon targets.
  if (use.targetType === "allySide" || use.targetType === "foeSide" || use.targetType === "all" || use.targetType === "allyTeam") {
    return sideOrField(kernel, w, use);
  }
  const out: World[] = [];
  for (const resolved of targetsOf(kernel, w, use, aimed)) {
    const world = resolved.world;
    for (const text of resolved.facts) kernel.stepFact(use.action, text, world.mass);
    if (!resolved.targets.length) {
      if (!resolved.failed) kernel.stepFact(use.action, `${move.name} fails: no target.`, world.mass);
      out.push(world);
      continue;
    }
    // TryMove (sim/battle-actions.ts useMoveInner): the priority shields read the last target (C6).
    const last = resolved.targets[resolved.targets.length - 1];
    const shield = kernel.priorityShield(world, kernelAction(use, aimed), move, last, use.priority, use.info);
    if (shield) { kernel.stepFact(use.action, shield, world.mass); out.push(world); continue; }
    // Try (the move's onTry, its onTryHit on the user for a self move), split where it reads HP.
    for (const tried of moveTry(kernel, world, use, resolved.targets)) {
      if (!tried.ok) { out.push(tried.world); continue; }
      // Where an Ally Switch sent it (doubles-turn.ts resolveTargets), once TryMove and Try pass.
      if (resolved.swap) kernel.stepFact(use.action, resolved.swap, tried.world.mass);
      // PrepareHit: Protean and Libero; Ally Switch's counter (Track E).
      for (const prepared of prepareHit(kernel, tried.world, use)) {
        if (prepared.fails) { out.push(prepared.world); continue; }
        if (kind === "N" && !use.entry.handler && move.id !== "torment") { out.push(prepared.world); continue; }
        out.push(...hitTargets(kernel, prepared.world, use, resolved.targets));
      }
    }
  }
  return out;
}

type Resolved = { world: World; targets: DoublesSlotId[]; facts: string[]; failed?: true; swap?: string };

/** The Pokémon a status move reaches (SPEC §4.3 step 4): self, allies and the ally take no redirection; the others go through the kernel's targeting. */
function targetsOf(kernel: TurnKernel, w: World, use: Use, aimed: DoublesSlotId | null): Resolved[] {
  const { user } = use;
  const ally = allyOf(user);
  switch (use.targetType) {
    case "self": return [{ world: w, targets: [user], facts: [] }];
    case "allies": {
      // sim/pokemon.ts alliesAndSelf: the living Pokémon of its side by position.
      const side = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === slotSide(user) && kernel.alive(w, slot) && slot !== w.ghost);
      side.sort((a, b) => SHOWDOWN_POSITION[kernel.positionOf(w, a)].position - SHOWDOWN_POSITION[kernel.positionOf(w, b)].position);
      return [{ world: w, targets: side, facts: [] }];
    }
    case "adjacentAlly": return [{ world: w, targets: kernel.alive(w, ally) ? [ally] : [], facts: [] }];
    case "adjacentAllyOrSelf": {
      // sim/battle.ts getTarget (generation 5 aside): the Pokémon standing at the aimed position now (after an Ally Switch
      // the user at its ally's, the ally at the user's); at a fainted ally, the user itself; at an empty position
      // (getRandomTarget), the user.
      const at = aimed ? kernel.occupant(w, aimed) : user;
      if (w.mons[at] && kernel.alive(w, at)) {
        const swap = aimed && at !== aimed && w.mons[aimed] ? `Ally Switch: ${use.move.name} hits ${kernel.names[at]} in ${kernel.names[aimed]}'s place.` : undefined;
        return [{ world: w, targets: [at], facts: [], ...(swap ? { swap } : {}) }];
      }
      return [{ world: w, targets: [user], facts: w.mons[at] && at !== user ? [`${kernel.names[at]} has fainted: ${kernel.names[user]} uses ${use.move.name} on itself.`] : [] }];
    }
  }
  if (use.targetType === "randomNormal" && use.move.id === "curse") {
    // Ghost-type Curse aimed at its ally: a random living foe (sim/battle.ts getRandomTarget), then redirection.
    const living = foesOf(user).filter((slot) => kernel.alive(w, slot));
    return living.map((target) => {
      const world = living.length > 1 ? cloneWorld(w, w.mass / living.length) : w;
      const taken = kernel.tracksTarget(world, user, use.move, use.info) ? null : kernel.redirect(world, user, target, use.info, use.move.id, undefined);
      const routed = taken?.slot ?? target;
      return { world, targets: kernel.alive(world, routed) ? [routed] : [], facts: taken && taken.slot !== target ? [`${taken.by}: ${kernel.names[taken.slot]} takes ${use.move.name}.`] : [] };
    });
  }
  const resolutions = kernel.resolveTargets(w, kernelAction(use, aimed), use.info);
  // A Lightning Rod or Storm Drain holder reads the move's type as used, which a type-changing ability made other than the
  // one the kernel's redirection reads (the move's own): not followed.
  if (use.type !== use.move.type) {
    for (const slot of DOUBLES_SLOTS) {
      const holder = w.mons[slot];
      if (slot === user || !holder || !kernel.alive(w, slot)) continue;
      const type = REDIRECT_ABILITIES[holder.build.abilityId];
      if (type && (type === use.type || type === use.move.type)) kernel.notEstimated(REASONS.notIn2v2(kernel.abilityName(w.mons[user]!.build.abilityId)));
    }
  }
  return resolutions.map((resolution) => ({
    world: resolution.world, targets: resolution.targets, facts: resolution.facts, ...(resolution.failed ? { failed: true as const } : {}), ...(resolution.swap ? { swap: resolution.swap } : {}),
  }));
}

/**
 * The move's own Try and its TryHit on the user (data/moves.ts onTry; a self move's onTryHit): the failures that do not
 * read a target, each world split where they read HP. `ok`: the use goes on.
 */
function moveTry(kernel: TurnKernel, w: World, use: Use, targets: DoublesSlotId[]): { world: World; ok: boolean }[] {
  const { user, move } = use;
  const mon = w.mons[user]!;
  const name = kernel.names[user];
  const { maxHP } = kernel.hp[user];
  const fail = (world: World, reason: string) => { kernel.stepFact(use.action, `${move.name} fails: ${reason}.`, world.mass); return { world, ok: false }; };
  const byHP = (failsAt: (hp: number) => boolean, reason: string) => condition(w, user, failsAt).map(({ world, meets }) => (meets ? fail(world, reason) : { world, ok: true }));
  switch (use.entry.fails) {
    case "darkrai": return mon.build.speciesId.startsWith("darkrai") || use.bounced ? [{ world: w, ok: true }] : [fail(w, `${name} is not Darkrai`)];
    case "rest": {
      if (mon.build.status === "slp" || mon.build.abilityId === "comatose") return [fail(w, `${name} is already asleep`)];
      if (mon.build.abilityId === "insomnia" || mon.build.abilityId === "vitalspirit") return [fail(w, `${name} has ${kernel.abilityName(mon.build.abilityId)}`)];
      return byHP((hp) => hp >= maxHP, `${name} is at full HP`);
    }
    case "halfHP": return byHP((hp) => hp <= maxHP / 2 || maxHP === 1, `${name} has too little HP`);
    case "clangorousSoul": return byHP((hp) => hp <= maxHP * 33 / 100 || maxHP === 1, `${name} has too little HP`);
    case "substitute": {
      if (mon.vol.substitute) return [fail(w, `${name} already has a Substitute`)];
      return byHP((hp) => hp <= maxHP / 4 || maxHP === 1, `${name} has too little HP`);
    }
    case "canSwitch": return canSwitch(kernel, slotSide(user)) ? [{ world: w, ok: true }] : [fail(w, "no Pokémon is left to switch in")];
    case "magnetRise": {
      if (mon.eot.smackedDown || mon.eot.ingrain) return [fail(w, `${name} is held to the ground`)];
      if (w.field.gravity) return [fail(w, "Gravity is up")];
      return [{ world: w, ok: true }];
    }
    case "queued": {
      // After You and Quash (data/moves.ts afteryou, quash onHit: queue.willMove).
      const target = targets[0];
      return target && w.remaining.some((entry) => entry.slot === target) ? [{ world: w, ok: true }] : [fail(w, `${target ? kernel.names[target] : "its target"} has already moved`)];
    }
  }
  if (move.id === "teleport") {
    // Generation 7's Teleport fails in a trainer battle (data/mods/gen7/moves.ts teleport onTry false; no switch).
    if (generation(kernel) <= 7) { kernel.stepFact(use.action, `${move.name} fails.`, w.mass); return [{ world: w, ok: false }]; }
    return canSwitch(kernel, slotSide(user)) ? [{ world: w, ok: true }] : [fail(w, "no Pokémon is left to switch in")];
  }
  // Shed Tail (data/moves.ts shedtail onTryHit): no Pokémon to switch in, a Substitute up, or ceil(maxhp / 2) HP or less.
  if (move.id === "shedtail") {
    if (!canSwitch(kernel, slotSide(user))) return [fail(w, "no Pokémon is left to switch in")];
    if (mon.vol.substitute) return [fail(w, `${name} already has a Substitute`)];
    return byHP((hp) => hp <= Math.ceil(maxHP / 2), `${name} has too little HP`);
  }
  return [{ world: w, ok: true }];
}

/** Whether `side` has a Pokémon left to switch in (DoublesTurnInput.canSwitch; absent: true, with a turn fact). */
function canSwitch(kernel: TurnKernel, side: DoublesSideId): boolean {
  const given = kernel.input.canSwitch?.[side];
  if (given !== undefined) return given;
  if (DOUBLES_SLOTS.some((slot) => slotSide(slot) === side && !kernel.input.pokemon[slot])) return false;
  kernel.turnFact(`Assumes ${side === "own" ? "your side" : "the opponent's side"} has a Pokémon left to switch in.`);
  return true;
}

/** PrepareHit (sim/battle-actions.ts trySpreadMoveHit): Protean and Libero; Ally Switch's repeat counter (Track E). `fails`: the move stops there. */
function prepareHit(kernel: TurnKernel, w: World, use: Use): { world: World; fails: boolean }[] {
  if (!use.bounced) proteanGuard(kernel, w, use.user, use.move.id, () => use.type);
  if (use.entry.handler === "allySwitch" && !use.bounced) {
    const before = { ...w.mons[use.user]!.vol };
    return positionHooks.allySwitchPrepare(kernel, w, use.action, use.move).map((world) => {
      // A failed roll deletes the counter (ADDENDUM §4.11.2): the move stops.
      const fails = before.allySwitch !== undefined && world.mons[use.user]!.vol.allySwitch === undefined;
      return { world, fails };
    });
  }
  return [{ world: w, fails: false }];
}

const hitStatsOf = (kernel: TurnKernel, use: Use, slot: DoublesSlotId): HitStats | null => kernel.hitStats(use.action, slot);
/** A fact on `slot`: on its hit entry where the use reached it, otherwise a step fact naming it (aboutSlot). */
const hitFact = (kernel: TurnKernel, use: Use, slot: DoublesSlotId, text: string, w: World) => {
  if (use.reached.has(slot)) kernel.hitFact(use.action, slot, text, w.mass);
  else kernel.stepFact(use.action, aboutSlot(kernel.names[slot], text), w.mass);
};
/** A hit fact as a step fact about `name`: "Is paralysed." → "Clefable is paralysed.", "Its Attack cannot go lower." → "Clefable's Attack cannot go lower.", "Defiant: +2 Attack." → "Kingambit's Defiant: +2 Attack.", "−2 Attack." → "Clefable: −2 Attack.". */
function aboutSlot(name: string, text: string): string {
  if (text.startsWith("Is ")) return `${name} is ${text.slice(3)}`;
  if (text.startsWith("Its ")) return `${name}'s ${text.slice(4)}`;
  const source = /^([^:]+): (.*)$/.exec(text);
  return source ? `${name}'s ${source[1]}: ${source[2]}` : `${name}: ${text}`;
}
const effect = (kernel: TurnKernel, use: Use, slot: DoublesSlotId, w: World) => { const stats = hitStatsOf(kernel, use, slot); if (stats) stats.effect += w.mass; };
const blocked = (kernel: TurnKernel, use: Use, slot: DoublesSlotId, w: World, text: string) => { const stats = hitStatsOf(kernel, use, slot); if (stats) stats.blocked += w.mass; hitFact(kernel, use, slot, text, w); };
const immune = (kernel: TurnKernel, use: Use, slot: DoublesSlotId, w: World, text: string) => { const stats = hitStatsOf(kernel, use, slot); if (stats) stats.noDamage += w.mass; hitFact(kernel, use, slot, text, w); };
/** A status move's HP change on a Pokémon, as DoublesHit.change. */
function noteChange(kernel: TurnKernel, use: Use, slot: DoublesSlotId, delta: number) {
  if (!delta) return;
  const stats = hitStatsOf(kernel, use, slot);
  if (!stats) return;
  stats.change = stats.change ? { min: Math.min(stats.change.min, delta), max: Math.max(stats.change.max, delta) } : { min: delta, max: delta };
}
/**
 * Whether the user's Mold Breaker passes `holder`'s breakable ability (its own never, from generation 8: sim/battle.ts
 * suppressingAbility), or its Mycelium Might on a status move (data/abilities.ts myceliummight onModifyMove: ignoreAbility),
 * but not through an Ability Shield that works (suppressingAbility: hasItem, not under Magic Room).
 */
const breaks = (kernel: TurnKernel, w: World, use: Use, holder: DoublesSlotId) => {
  if (holder === use.user) return false;
  if (kernel.breaks(w, use.user, holder, use.info)) return true;
  const shielded = w.mons[holder]!.build.itemId === "abilityshield" && !w.field.magicRoom;
  return use.move.category === "Status" && w.mons[use.user]!.build.abilityId === "myceliummight" && !shielded;
};

/**
 * Every target's hit steps (sim/battle-actions.ts trySpreadMoveHit, step by step across the targets): TryHit, type
 * immunity, TryImmunity; then the hit (spreadMoveHit): the move's own TryHit, Substitute, the effects in runMoveEffects
 * order, then its self effects.
 */
function hitTargets(kernel: TurnKernel, w: World, use: Use, targets: DoublesSlotId[]): World[] {
  for (const slot of targets) { use.reached.add(slot); const stats = hitStatsOf(kernel, use, slot); if (stats) stats.reached += w.mass; }
  let flows: { world: World; targets: DoublesSlotId[] }[] = [{ world: w, targets: [] }];
  // 1. TryHit, each target in turn (a bounced move runs in full where its holder's TryHit is).
  for (const slot of targets) {
    flows = flows.flatMap(({ world, targets: passed }) => {
      const result = tryHit(kernel, world, use, slot);
      return result.worlds.map((next) => ({ world: next, targets: result.pass ? [...passed, slot] : passed }));
    });
  }
  // 2. Type immunity (ignoreImmunity false), 3. TryImmunity.
  flows = flows.map(({ world, targets: passed }) => ({ world, targets: passed.filter((slot) => typeImmunity(kernel, world, use, slot) && tryImmunity(kernel, world, use, slot)) }));
  // 4. The hit, target by target, then the user's own effects.
  return flows.flatMap(({ world, targets: passed }) => {
    if (!passed.length) return [world];
    let worlds = [world];
    for (const slot of passed) worlds = worlds.flatMap((each) => hitOne(kernel, each, use, slot, passed.length === 1));
    return worlds.flatMap((each) => selfEffects(kernel, each, use));
  });
}

/** TryHit for one target, by handler priority (SPEC §4.3 step 5). `pass`: it goes on to the next step; `worlds`: after an absorption or a bounce. */
function tryHit(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): { pass: boolean; worlds: World[] } {
  const { user, move, entry } = use;
  const mon = w.mons[slot]!;
  const build = mon.build;
  const side = w.sides[slotSide(slot)];
  const name = kernel.names[slot];
  const flags = entry.flags;
  const no = (text: string) => { blocked(kernel, use, slot, w, text); return { pass: false, worlds: [w] }; };
  // Wide Guard (spread moves) and Quick Guard (priority above 0.1), 4: moves with the protect flag (checkMoveBypassesProtect).
  if (side.wideGuard && (use.targetType === "allAdjacent" || use.targetType === "allAdjacentFoes") && flags.protect) return no(`Wide Guard blocks ${move.name}.`);
  if (side.quickGuard && use.priority > 0.1 && flags.protect) return no(`Quick Guard blocks ${move.name}.`);
  // Psychic Terrain, 4 (data/moves.ts psychicterrain onTryHit): a priority move from a foe into a grounded Pokémon.
  if (w.field.terrain === "Psychic" && use.priority > 0.1 && use.targetType !== "self" && kernel.isFoe(user, slot) && kernel.grounded(w, slot) && !w.mons[slot]!.eot.hidden) return no(`Psychic Terrain: ${name} is not affected.`);
  // The protecting moves, 3: Protect, Detect, Spiky Shield and Baneful Bunker stop status moves with the protect flag
  // (King's Shield, Obstruct, Silk Trap and Burning Bulwark only damaging ones: checkMoveBypassesProtect(…, false)).
  if (mon.protect && flags.protect && ["protect", "spikyshield", "banefulbunker"].includes(mon.protect)) {
    const by = kernel.moveName(Object.entries(PROTECT_MOVES).find(([, kind]) => kind === mon.protect)![0]);
    return no(`${by} blocks ${move.name}.`);
  }
  // Magic Bounce, 1 (data/abilities.ts magicbounce onTryHit, breakable): the holder uses the move back at its user.
  if (build.abilityId === "magicbounce" && slot !== user && !use.bounced && flags.reflectable && !breaks(kernel, w, use, slot)) {
    blocked(kernel, use, slot, w, `${kernel.abilityName("magicbounce")}: ${move.name} goes back to ${kernel.names[user]}.`);
    return { pass: false, worlds: bounce(kernel, w, use, slot) };
  }
  const ability = build.abilityId;
  const broken = breaks(kernel, w, use, slot);
  // Overcoat, 1 (breakable) and Safety Goggles: powder moves, from another Pokémon, a target powder does not already miss.
  const grass = kernel.typesOf(build).includes("Grass");
  if (flags.powder && slot !== user && !grass && ability === "overcoat" && !broken) return no(`${kernel.abilityName("overcoat")}: ${name} is not affected.`);
  // The absorbing abilities (Sap Sipper, 1; the others, 0): the move's type as used, the wind flag (breakable).
  const absorb = ABSORBING[ability];
  if (absorb && slot !== user && !broken && (absorb.wind ? !!flags.wind : absorb.type === use.type)) {
    return { pass: false, worlds: absorbStatus(kernel, w, use, slot, ability) };
  }
  // Good as Gold (status moves from another Pokémon), Soundproof (sound), Oblivious (Taunt), each breakable.
  if (ability === "goodasgold" && slot !== user && !broken) return no(`${kernel.abilityName("goodasgold")}: ${name} is not affected.`);
  if (ability === "soundproof" && slot !== user && flags.sound && !broken) return no(`${kernel.abilityName("soundproof")}: ${name} is not affected.`);
  if (ability === "oblivious" && move.id === "taunt" && !broken && generation(kernel) >= 6) return no(`${kernel.abilityName("oblivious")}: ${name} is not affected.`);
  if (flags.powder && slot !== user && !grass && build.itemId === "safetygoggles" && kernel.itemWorks(w, build)) return no(`${kernel.itemName("safetygoggles")}: ${name} is not affected.`);
  return { pass: true, worlds: [w] };
}

/** An absorbing ability taking a status move (data/abilities.ts onTryHit): a quarter of the base maximum HP (none at full HP or under Heal Block), a stat rise or Flash Fire. */
function absorbStatus(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, ability: string): World[] {
  const absorb = ABSORBING[ability];
  const stats = hitStatsOf(kernel, use, slot);
  if (stats) stats.blocked += w.mass;
  const name = kernel.abilityName(ability);
  if (absorb.heal) {
    const amount = Math.max(1, Math.floor(kernel.hp[slot].baseMaxHP / 4));
    hitFact(kernel, use, slot, `${name}: ${use.move.name} has no effect, and it regains HP.`, w);
    return healWorlds(kernel, w, slot, amount, { use, source: name }).map(({ world }) => world);
  }
  if (absorb.stages) {
    const result = applyBoosts(kernel, w, slot, absorb.stages, slot, { use, effect: "ability", report: true, by: name });
    if (!Object.keys(result).length) hitFact(kernel, use, slot, `${name}: ${use.move.name} has no effect.`, w);
    return [w];
  }
  w.mons[slot]!.build = { ...w.mons[slot]!.build, abilityActive: true };
  hitFact(kernel, use, slot, `${name}: its Fire moves have 1.5x power.`, w);
  return [w];
}

/**
 * Magic Bounce's reflected use (data/abilities.ts magicbounce: actions.useMove with hasBounced, pranksterBoosted false):
 * the holder uses the move with no BeforeMove at the original user (a spread move at the user's side), from its targets on.
 */
function bounce(kernel: TurnKernel, w: World, use: Use, holder: DoublesSlotId): World[] {
  const bounced = makeUse(kernel, w, use.action, holder, use.move, use.entry, use.priority, true, use.user);
  // (A bounced Parting Shot or Roar is its holder's: its switch is the holder's or drags the original user: switchMove.)
  return runUse(kernel, w, bounced, kernel.positionOf(w, use.user));
}

/**
 * Type immunity for a move with ignoreImmunity false (sim/battle-actions.ts hitStepTypeImmunity): Thunder Wave and Ground
 * types. A working Ring Target negates it (sim/pokemon.ts runImmunity: data/items.ts ringtarget onNegateImmunity false).
 */
function typeImmunity(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): boolean {
  if (use.entry.ignoreImmunity !== false) return true;
  const build = w.mons[slot]!.build;
  if (build.itemId === "ringtarget" && kernel.itemWorks(w, build)) return true;
  const IMMUNE: Record<string, string[]> = { Electric: ["Ground"], Normal: ["Ghost"], Fighting: ["Ghost"], Ground: ["Flying"], Ghost: ["Normal"], Psychic: ["Dark"], Dragon: ["Fairy"], Poison: ["Steel"] };
  const types = kernel.typesOf(build);
  if (!(IMMUNE[use.type] ?? []).some((type) => types.includes(type))) return true;
  immune(kernel, use, slot, w, `${kernel.names[slot]} is immune.`);
  return false;
}

/** TryImmunity (sim/battle-actions.ts hitStepTryImmunity): powder vs Grass (gen 6+), the move's own (Leech Seed vs Grass, Trick vs Sticky Hold), Prankster vs a Dark foe (gen 7+). */
function tryImmunity(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): boolean {
  const { user, move, entry } = use;
  const build = w.mons[slot]!.build;
  const types = kernel.typesOf(build);
  const name = kernel.names[slot];
  if (entry.flags.powder && slot !== user && types.includes("Grass")) { immune(kernel, use, slot, w, `${name} is immune.`); return false; }
  if (move.id === "leechseed" && types.includes("Grass")) { immune(kernel, use, slot, w, `${name} is immune.`); return false; }
  // Sticky Hold by hasAbility (data/moves.ts trick onTryImmunity): Mold Breaker does not pass it (ADDENDUM §4.12.1).
  if (entry.handler === "swapItems" && build.abilityId === "stickyhold") { immune(kernel, use, slot, w, `${kernel.abilityName("stickyhold")}: ${name} keeps its item.`); return false; }
  if (use.prankster && slotSide(slot) !== slotSide(user) && types.includes("Dark")) { immune(kernel, use, slot, w, `Prankster: ${name} is not affected.`); return false; }
  return true;
}

/** The hit on one target (sim/battle-actions.ts spreadMoveHit): the move's own TryHit, Substitute, then the effects. `single`: the move reaches one Pokémon (its own onTryHit runs). */
function hitOne(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, single: boolean): World[] {
  const { user, move } = use;
  const mon = w.mons[slot]!;
  const name = kernel.names[slot];
  const failsHere = (text: string) => { effect(kernel, use, slot, w); hitFact(kernel, use, slot, `${move.name} fails: ${text}.`, w); return [w]; };
  // The move's own TryHit (data/moves.ts onTryHit, a singleEvent on the target).
  if (single) {
    // Yawn's onTryHit reads only a status and the sleep immunity (data/moves.ts yawn): a Comatose target becomes drowsy,
    // and its sleep fails at the end of turn (canSleep).
    if (move.id === "yawn" && mon.build.status) return failsHere(`${name} is already ${STATUS_WORDS[mon.build.status]}`);
    if (move.id === "curse" && use.targetType !== "self" && mon.eot.curse) return failsHere(`${name} is already cursed`);
    if (move.id === "disable" || move.id === "encore") {
      const reason = lastMoveFailure(kernel, w, use, slot);
      if (reason) return failsHere(reason);
    }
  }
  // Substitute (data/moves.ts substitute onTryPrimaryHit): a move into another Pokémon's Substitute without bypasssub or Infiltrator fails.
  if (slot !== user && mon.vol.substitute && !use.entry.flags.bypasssub && !use.infiltrates) {
    immune(kernel, use, slot, w, `${name} is behind a Substitute.`);
    return [w];
  }
  effect(kernel, use, slot, w);
  // A move that reaches a Berserk or Anger Shell holder runs its AfterMoveSecondary (sim/battle-actions.ts:1005), which
  // resets the lock a confusion self-hit left (data/abilities.ts berserk, angershell: checkedBerserk true) wherever the move
  // did something to it, and the action's last Update then eats a healing Berry at its line (pinned Showdown: Spore,
  // Thunder Wave, Pain Split, a Sitrus Berry Tricked onto it): not followed where that Berry is then due.
  const locked = slot !== user && !!mon.vol.berryLocked;
  const out = effects(kernel, w, use, slot);
  if (locked) for (const world of out) kernel.lockedBerryGuard(world, slot);
  return out;
}

/**
 * Disable's and Encore's last move (data/moves.ts disable onTryHit, encore condition onStart): none, a Z-Move or Max Move,
 * Struggle (Disable) or a failencore move (Encore), or one it does not have; a Dynamaxed Encore target. Needs `lastMove`
 * for a Pokémon still to act (SPEC §4.5). The failure's text, or null.
 */
function lastMoveFailure(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): string | null {
  const entry = kernel.input.pokemon[slot]!;
  const still = w.remaining.some((each) => each.slot === slot);
  const name = kernel.names[slot];
  // A target that used its move this turn: its last move is that one (vol.usedMove: the Z-Move or Max Move it became);
  // otherwise the one from before the turn (DoublesPokemonInput.lastMove).
  const used = w.mons[slot]!.vol.usedMove;
  const last = used ?? entry.lastMove;
  if (last === undefined) {
    if (still) kernel.notEstimated(REASONS.needsLastMove(use.move.name, name));
    // A target that has acted: nothing changes this turn either way (SPEC §4.5); no volatile is kept for the next one.
    return `${name}'s last move is not known`;
  }
  if (last === null) return `${name} has used no move`;
  if (used && used !== entry.action.moveId) return `${name}'s last move was a Z-Move or Max Move`;
  if (use.move.id === "disable" && last === "struggle") return `${name}'s last move was Struggle`;
  if (use.move.id === "encore") {
    if (isMaxActive(w.mons[slot]!.build)) return `${name} is Dynamaxed`;
    if (FAILENCORE_MOVES.has(last)) return `${kernel.moveName(last)} cannot be encored`;
    if (entry.moves && !entry.moves.includes(last)) return `${name} does not have ${kernel.moveName(last)}`;
  }
  return null;
}

/** The effects on one target in runMoveEffects order (sim/battle-actions.ts): boosts, heal, status, volatile, side, slot, then the move's onHit, then selfdestruct. */
function effects(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const { user, move, entry } = use;
  // boosts (Growth's are +2/+2 in sun: data/moves.ts growth onModifyMove, the user's effectiveWeather; Fillet Away's and
  // Clangorous Soul's come in their onTryHit, onHit below; Parting Shot's in its onHit).
  let boosts = entry.boosts;
  if (entry.handler === "growth" && ["Sun", "Harsh Sunshine"].includes(userWeather(kernel, w, user))) boosts = { atk: 2, spa: 2 };
  if (entry.handler === "clangorousSoul" || entry.handler === "filletAway") boosts = undefined;
  if (boosts && !w.mons[slot]!.fainted) applyBoosts(kernel, w, slot, boosts, user, { use, effect: "move", report: true });
  // heal (moveData.heal: round(baseMaxhp × heal); none at full HP, which ends the effects on this target and its self effects).
  if (entry.heal) {
    const amount = Math.round(kernel.hp[slot].baseMaxHP * entry.heal[0] / entry.heal[1]);
    return healWorlds(kernel, w, slot, amount, { use, source: move.name, failFact: true })
      .flatMap(({ world, healed }) => (healed ? rest(world) : [world]));
  }
  return rest(w);
  function rest(w: World): World[] {
    // status (trySetStatus): a failure ends the effects on this target.
    if (entry.status) {
      const reason = canStatus(kernel, w, slot, entry.status, user, { move: true, primary: true, infiltrates: use.infiltrates, breaks: (holder) => breaks(kernel, w, use, holder) });
      // A type immunity is the status move's -immune (sim/pokemon.ts setStatus runStatusImmunity): a hit with no effect.
      if (reason === `${kernel.names[slot]} is immune.`) {
        const stats = hitStatsOf(kernel, use, slot);
        if (stats) stats.effect -= w.mass;
        immune(kernel, use, slot, w, reason);
        return [w];
      }
      if (reason) { hitFact(kernel, use, slot, reason.replace("{Move}", move.name), w); return [w]; }
      setStatus(kernel, w, slot, entry.status, user, { use });
    }
    // A user that is not a Ghost type: Curse's volatile and onHit are deleted (data/moves.ts curse onTryHit; selfEffects).
    if (move.id === "curse" && use.targetType === "self") return [w];
    // volatileStatus.
    if (entry.volatile && !volatile(kernel, w, use, slot, entry.volatile)) {
      if (entry.handler !== "curse" && entry.handler !== "substitute") return [w];
    }
    // Roost's self volatile (selfDrops after a heal): no Flying type this turn, unless Terastallized (data/moves.ts roost condition).
    if (entry.selfVolatile === "roost") roost(kernel, w, use, slot);
    // onHit, and the switching moves.
    let out = entry.kind === "S" ? switchMove(kernel, w, use, slot) : entry.handler ? onHit(kernel, w, use, slot) : [w];
    // selfdestruct "ifHit": Memento, Healing Wish, Lunar Dance (runMoveEffects: the user faints once a target reached its effects).
    if (entry.selfdestruct === "ifHit") out = out.flatMap((world) => faintUser(kernel, world, user));
    return out;
  }
}

/** Roost (data/moves.ts roost condition onType): a Flying user is not Flying this turn (then grounded, a type the later hits read). */
function roost(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) {
  const build = w.mons[slot]!.build;
  if (build.mechanic === "tera") return;
  if (kernel.typesOf(build).includes("Flying") && kernel.laterDamaging(w)) kernel.notEstimated(REASONS.typeChange(use.move.name, kernel.names[slot]));
  setEot(w, slot, { roosted: true });
}

/**
 * The switching moves (SPEC §2.2 S): Baton Pass (fails with no Pokémon to switch in), Teleport (its onTry checked it), Shed
 * Tail (no Pokémon to switch in, a Substitute up, or ceil(maxhp / 2) HP or less fail it; then that cost), Parting Shot (its
 * drops; no switch when no stage fell and the target has no Mirror Armor), Roar and Whirlwind (the target is dragged out:
 * its side needs a Pokémon to come in; Suction Cups and Guard Dog (breakable), Ingrain and Dynamax keep it in).
 */
function switchMove(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const { user, move } = use;
  const fail = (text: string) => { hitFact(kernel, use, slot, `${move.name} fails: ${text}.`, w); return [w]; };
  switch (move.id) {
    case "batonpass":
      return canSwitch(kernel, slotSide(user)) ? switchOut(kernel, w, use, user) : fail("no Pokémon is left to switch in");
    case "teleport":
      return switchOut(kernel, w, use, user);
    case "shedtail": {
      // Its Substitute (the volatile, above) goes to the Pokémon that comes in; then onHit's directDamage(ceil(maxhp / 2)).
      const max = kernel.hp[user].maxHP;
      return cost(kernel, w, use, user, Math.ceil(max / 2)).flatMap((next) => switchOut(kernel, next, use, user));
    }
    case "partingshot": {
      const stages = { atk: -1, spa: -1 };
      const result = applyBoosts(kernel, w, slot, stages, user, { use, effect: "move", report: true });
      const fell = Object.values(result).some((by) => by !== 0);
      if (!fell && w.mons[slot]!.build.abilityId !== "mirrorarmor") return [w];
      return canSwitch(kernel, slotSide(user)) ? switchOut(kernel, w, use, user) : [w];
    }
    case "roar": case "whirlwind": {
      const target = w.mons[slot]!;
      if (!canSwitch(kernel, slotSide(slot))) return fail(`no Pokémon is left to come in for ${kernel.names[slot]}`);
      const ability = target.build.abilityId;
      if ((ability === "suctioncups" || ability === "guarddog") && !breaks(kernel, w, use, slot)) { hitFact(kernel, use, slot, `${kernel.abilityName(ability)}: ${kernel.names[slot]} stays in.`, w); return [w]; }
      if (target.eot.ingrain) { hitFact(kernel, use, slot, `${kernel.moveName("ingrain")}: ${kernel.names[slot]} stays in.`, w); return [w]; }
      if (isMaxActive(target.build)) { hitFact(kernel, use, slot, `${kernel.names[slot]} is Dynamaxed and stays in.`, w); return [w]; }
      return switchOut(kernel, w, use, slot);
    }
  }
  return [w];
}

/** The user's own effects after the targets (sim/battle-actions.ts selfDrops): Curse's for a user that is not a Ghost type. */
function selfEffects(kernel: TurnKernel, w: World, use: Use): World[] {
  const { user, move } = use;
  if (move.id === "curse" && use.targetType === "self" && kernel.alive(w, user)) {
    // data/moves.ts curse onTryHit: move.self = { boosts: { spe: -1, atk: 1, def: 1 } } for a user that is not a Ghost type.
    const stages = { spe: -1, atk: 1, def: 1 };
    applyBoosts(kernel, w, user, stages, user, { use, effect: "move", report: true });
  }
  return [w];
}

/** The user's effectiveWeather for its own moves (sim/pokemon.ts effectiveWeather: Utility Umbrella; Mega Sol's sun for its moves). */
function userWeather(kernel: TurnKernel, w: World, user: DoublesSlotId): string {
  const build = w.mons[user]!.build;
  if (build.abilityId === "megasol") return "Sun";
  const weather = kernel.effectiveWeather(w);
  if (["Sun", "Rain", "Harsh Sunshine", "Heavy Rain"].includes(weather) && build.itemId === "utilityumbrella" && kernel.itemWorks(w, build)) return "";
  return weather;
}

/** The user faints (selfdestruct: Memento, Healing Wish, Lunar Dance). */
function faintUser(kernel: TurnKernel, w: World, user: DoublesSlotId): World[] {
  if (!kernel.alive(w, user)) return [w];
  return mapHP(w, user, () => ({ hp: 0, tag: "" })).map(({ world }) => { kernel.faint(world, user); return world; });
}

/**
 * A volatile a status move adds (sim/pokemon.ts addVolatile: already there fails without onRestart; runStatusImmunity;
 * TryAddVolatile: Own Tempo, Misty Terrain, Safeguard, Electric Terrain, Sweet Veil, Flower Veil, Insomnia, Vital Spirit,
 * Leaf Guard, Purifying Salt, Shields Down, Aroma Veil), then its Start. Whether it was added.
 */
function volatile(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, id: string): boolean {
  const { user, move } = use;
  const mon = w.mons[slot]!;
  const build = mon.build;
  const name = kernel.names[slot];
  const fail = (text: string) => { hitFact(kernel, use, slot, `${move.name} fails: ${text}.`, w); return false; };
  const no = (by: string) => { hitFact(kernel, use, slot, `${by}: ${name} is not affected.`, w); return false; };
  const broken = breaks(kernel, w, use, slot);
  const sideHolders = DOUBLES_SLOTS.filter((other) => slotSide(other) === slotSide(slot) && kernel.alive(w, other) && other !== w.ghost);
  const allyAbility = (ability: string) => sideHolders.find((other) => w.mons[other]!.build.abilityId === ability && !breaks(kernel, w, use, other));
  const safeguard = w.sides[slotSide(slot)].safeguard && slot !== user && !(use.infiltrates && kernel.isFoe(user, slot));
  // The terrains act on a grounded Pokémon that is not semi-invulnerable (data/moves.ts mistyterrain, electricterrain onTryAddVolatile).
  const grounded = kernel.grounded(w, slot);
  const onTerrain = grounded && !mon.eot.hidden;
  switch (id) {
    case "confusion": {
      if (mon.vol.confusion) return fail(`${name} is already confused`);
      if (build.abilityId === "owntempo" && !broken) return no(kernel.abilityName("owntempo"));
      if (w.field.terrain === "Misty" && onTerrain) return no("Misty Terrain");
      if (safeguard) return no(kernel.moveName("safeguard"));
      setVol(w, slot, { confusion: { attempts: 0, min: 2 } });
      hitFact(kernel, use, slot, "Becomes confused.", w);
      return true;
    }
    case "taunt": {
      if (mon.vol.taunt) return fail(`${name} is already taunted`);
      const veil = allyAbility("aromaveil");
      if (veil) return no(kernel.abilityName("aromaveil"));
      setVol(w, slot, { taunt: true });
      hitFact(kernel, use, slot, "Taunted.", w);
      return true;
    }
    case "yawn": {
      if (mon.eot.yawn !== undefined) return fail(`${name} is already drowsy`);
      if (safeguard) return no(kernel.moveName("safeguard"));
      if (w.field.terrain === "Electric" && onTerrain) return no("Electric Terrain");
      const sweet = allyAbility("sweetveil");
      if (sweet) return no(kernel.abilityName("sweetveil"));
      const flower = allyAbility("flowerveil");
      if (flower && kernel.typesOf(build).includes("Grass")) return no(kernel.abilityName("flowerveil"));
      if ((build.abilityId === "insomnia" || build.abilityId === "vitalspirit" || build.abilityId === "purifyingsalt") && !broken) return no(kernel.abilityName(build.abilityId));
      if (build.abilityId === "leafguard" && !broken && ["Sun", "Harsh Sunshine"].includes(targetWeather(kernel, w, slot))) return no(kernel.abilityName("leafguard"));
      if (build.abilityId === "shieldsdown" && build.speciesId === "miniormeteor" && !build.transformedFrom) return no(kernel.abilityName("shieldsdown"));
      setEot(w, slot, { yawn: 2 });
      hitFact(kernel, use, slot, "Becomes drowsy.", w);
      return true;
    }
    case "leechseed": {
      if (mon.eot.leechSeed !== undefined) return fail(`${name} is already seeded`);
      // Leech Seed heals whoever stands at the seeder's position (data/moves.ts leechseed: sourceSlot; ADDENDUM A6).
      setEot(w, slot, { leechSeed: kernel.positionOf(w, user) });
      hitFact(kernel, use, slot, "Is seeded.", w);
      return true;
    }
    case "curse": {
      setEot(w, slot, { curse: true });
      hitFact(kernel, use, slot, "Is cursed.", w);
      return true;
    }
    case "aquaring": case "ingrain": {
      if (mon.eot[id === "aquaring" ? "aquaRing" : "ingrain"]) return fail(`${move.name} is already up`);
      if (id === "ingrain") {
        // Ingrain grounds its user (sim/pokemon.ts isGrounded): later moves' hits are not followed when that changes (SPEC C).
        if (!grounded && kernel.laterDamaging(w)) kernel.notEstimated(REASONS.groundingChange(move.name, name));
        setEot(w, slot, { ingrain: true });
      } else setEot(w, slot, { aquaRing: true });
      hitFact(kernel, use, slot, `${move.name} starts.`, w);
      return true;
    }
    case "magnetrise": {
      if (mon.eot.magnetRise) return fail(`${move.name} is already up`);
      if (grounded && kernel.laterDamaging(w)) kernel.notEstimated(REASONS.groundingChange(move.name, name));
      setEot(w, slot, { magnetRise: true });
      hitFact(kernel, use, slot, `${move.name}: ${name} floats.`, w);
      return true;
    }
    case "substitute": {
      // data/moves.ts substitute condition onStart: hp floor(maxhp / 4); a partial trap on it ends.
      setVol(w, slot, { substitute: Math.floor(kernel.hp[slot].maxHP / 4) });
      endTrap(w, slot);
      hitFact(kernel, use, slot, `Substitute: ${Math.floor(kernel.hp[slot].maxHP / 4)} HP.`, w);
      return true;
    }
    case "imprison": {
      if (mon.vol.imprisoning) return fail(`${move.name} is already up`);
      // It stops a foe's later move its user also has: with a foe still to act, its user's moves are needed (SPEC §2.2 C).
      if (!kernel.input.pokemon[slot]!.moves && foesOf(slot).some((foe) => kernel.alive(w, foe) && w.remaining.some((each) => each.slot === foe && each.moveId !== null))) {
        kernel.notEstimated(REASONS.needsMoves(name));
      }
      setVol(w, slot, { imprisoning: true });
      hitFact(kernel, use, slot, `${move.name} starts.`, w);
      return true;
    }
    case "focusenergy": {
      if (build.focusEnergy || build.settledFocusEnergy || build.dragonCheer) return fail(`${name}'s critical-hit stages are already raised`);
      mon.build = { ...build, focusEnergy: true };
      hitFact(kernel, use, slot, `${move.name}: +2 critical-hit stages.`, w);
      return true;
    }
    case "dragoncheer": {
      if (build.focusEnergy || build.settledFocusEnergy || build.dragonCheer) return fail(`${name}'s critical-hit stages are already raised`);
      const stages = kernel.typesOf(build).includes("Dragon") ? 2 : 1;
      mon.build = { ...build, dragonCheer: stages };
      hitFact(kernel, use, slot, `${move.name}: +${stages} critical-hit stage${stages > 1 ? "s" : ""}.`, w);
      return true;
    }
    case "charge": {
      mon.charged = true;
      hitFact(kernel, use, slot, "Charged: its next Electric move has double power.", w);
      return true;
    }
    case "disable": case "encore": return lastMoveVolatile(kernel, w, use, slot, id);
    case "torment": {
      // Torment changes only the next choice (N); Aroma Veil blocks it, and Mental Herb ends it at the Update, used up.
      if (allyAbility("aromaveil")) return no(kernel.abilityName("aromaveil"));
      if (mentalHerbHeld(kernel, w, slot)) {
        mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
        hitFact(kernel, use, slot, `${kernel.itemName("mentalherb")}: its ${move.name} ends.`, w);
      }
      return true;
    }
  }
  return true;
}

/** The target's own effectiveWeather (sim/pokemon.ts: Utility Umbrella). */
function targetWeather(kernel: TurnKernel, w: World, slot: DoublesSlotId): string {
  const build = w.mons[slot]!.build;
  const weather = kernel.effectiveWeather(w);
  if (["Sun", "Rain", "Harsh Sunshine", "Heavy Rain"].includes(weather) && build.itemId === "utilityumbrella" && kernel.itemWorks(w, build)) return "";
  return weather;
}

/**
 * Disable and Encore landing (SPEC §4.5): on a target that has acted, no effect this turn (the volatile for the next one);
 * on one still to act, Disable stops a queued move equal to its last one at BeforeMove and Encore changes nothing then,
 * while Encore on a different queued move is not followed. Aroma Veil blocks both; Mental Herb ends them at the Update.
 */
function lastMoveVolatile(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, id: "disable" | "encore"): boolean {
  const { move } = use;
  const mon = w.mons[slot]!;
  const name = kernel.names[slot];
  const vol = mon.vol as Vol;
  if ((id === "disable" && vol.disabled) || (id === "encore" && vol.encore)) { hitFact(kernel, use, slot, `${move.name} fails: it is already up on ${name}.`, w); return false; }
  const veil = DOUBLES_SLOTS.find((other) => slotSide(other) === slotSide(slot) && kernel.alive(w, other) && w.mons[other]!.build.abilityId === "aromaveil" && !breaks(kernel, w, use, other));
  if (veil) { hitFact(kernel, use, slot, `${kernel.abilityName("aromaveil")}: ${name} is not affected.`, w); return false; }
  const entry = kernel.input.pokemon[slot]!;
  const queued = w.remaining.find((each) => each.slot === slot);
  const last = mon.vol.usedMove ?? entry.lastMove!;
  if (id === "disable") {
    setVol(w, slot, { disabled: last });
    hitFact(kernel, use, slot, `Disable: ${kernel.moveName(last)} is disabled.`, w);
    return true;
  }
  if (queued && queued.moveId !== last && !mentalHerbHeld(kernel, w, slot)) kernel.notEstimated(REASONS.encoreChange(name));
  setVol(w, slot, { encore: last } as Partial<Vol>);
  hitFact(kernel, use, slot, `Encore: ${kernel.moveName(last)}.`, w);
  return true;
}
const mentalHerbHeld = (kernel: TurnKernel, w: World, slot: DoublesSlotId) => w.mons[slot]!.build.itemId === "mentalherb" && kernel.itemWorks(w, w.mons[slot]!.build);

/** The move's own onHit (status-table.ts handler). */
function onHit(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const { user, move } = use;
  const name = kernel.names[slot];
  const fail = (text: string) => { hitFact(kernel, use, slot, `${move.name} fails: ${text}.`, w); return [w]; };
  const { maxHP, baseMaxHP } = kernel.hp[slot];
  switch (use.entry.handler) {
    case "weatherHeal": {
      // Moonlight, Morning Sun, Synthesis (data/moves.ts moonlight onHit): modify(maxhp, factor) by the user's effectiveWeather.
      const weather = userWeather(kernel, w, user);
      const factor = ["Sun", "Harsh Sunshine"].includes(weather) ? 0.667 : ["Rain", "Heavy Rain", "Sand", "Hail", "Snow"].includes(weather) ? 0.25 : 0.5;
      return healWorlds(kernel, w, slot, modify(maxHP, factor), { use, source: move.name, failFact: true }).map(({ world }) => world);
    }
    case "shoreUp": {
      const factor = kernel.effectiveWeather(w) === "Sand" ? 0.667 : 0.5;
      return healWorlds(kernel, w, slot, modify(maxHP, factor), { use, source: move.name, failFact: true }).map(({ world }) => world);
    }
    case "healPulse": {
      const amount = w.mons[user]!.build.abilityId === "megalauncher" ? modify(baseMaxHP, 0.75) : Math.ceil(baseMaxHP * 0.5);
      return healWorlds(kernel, w, slot, amount, { use, source: move.name, failFact: true }).map(({ world }) => world);
    }
    case "floralHealing": {
      const amount = w.field.terrain === "Grassy" ? modify(baseMaxHP, 0.667) : Math.ceil(baseMaxHP * 0.5);
      return healWorlds(kernel, w, slot, amount, { use, source: move.name, failFact: true }).map(({ world }) => world);
    }
    case "jungleHealing": {
      // Jungle Healing, Lunar Blessing (data/moves.ts junglehealing onHit): modify(maxhp, 0.25), then its status cured.
      return healWorlds(kernel, w, slot, modify(maxHP, 0.25), { use, source: move.name }).map(({ world }) => {
        cureStatus(kernel, world, use, slot);
        return world;
      });
    }
    case "takeHeart": {
      const stages = { spa: 1, spd: 1 };
      applyBoosts(kernel, w, slot, stages, user, { use, effect: "move", report: true });
      cureStatus(kernel, w, use, slot);
      return [w];
    }
    case "refresh": {
      const status = w.mons[slot]!.build.status;
      if (!status || status === "slp" || status === "frz") return fail(`${name} has no poison, paralysis or burn`);
      cureStatus(kernel, w, use, slot);
      return [w];
    }
    case "venomDrench": {
      const status = w.mons[slot]!.build.status;
      if (status !== "psn" && status !== "tox") return fail(`${name} is not poisoned`);
      const stages = { atk: -1, spa: -1, spe: -1 };
      applyBoosts(kernel, w, slot, stages, user, { use, effect: "move", report: true });
      return [w];
    }
    case "strengthSap": return strengthSap(kernel, w, use, slot);
    case "painSplit": return painSplit(kernel, w, use, slot);
    case "rest": return rest(kernel, w, use, slot);
    case "wish": {
      // A Wish already waiting at the user's position fails (sim/side.ts addSlotCondition); this one heals at the end of the next turn.
      const position = kernel.positionOf(w, user);
      if (w.mons[position]?.eot.wish !== undefined) return fail("a Wish is already waiting there");
      kernel.stepFact(use.action, `Wish: the Pokémon at ${kernel.names[user]}'s position regains HP at the end of the next turn.`, w.mass);
      return [w];
    }
    case "bellyDrum": {
      // data/moves.ts bellydrum onHit: fails at half HP or less, at +6 Attack or with 1 maximum HP; then directDamage(maxhp / 2), Attack +12.
      if ((w.mons[slot]!.build.boosts.atk ?? 0) >= 6) return fail(`${name}'s Attack is already +6`);
      return condition(w, slot, (hp) => hp <= maxHP / 2 || maxHP === 1).flatMap(({ world, meets }) => {
        if (meets) { hitFact(kernel, use, slot, `${move.name} fails: ${name} has too little HP.`, world); return [world]; }
        return cost(kernel, world, use, slot, Math.floor(maxHP / 2)).map((next) => {
          if (!kernel.alive(next, slot)) return next;
          applyBoosts(kernel, next, slot, { atk: 12 }, user, { use, effect: "move" });
          // sim/battle.ts boost: Belly Drum's message is a set boost (-setboost).
          hitFact(kernel, use, slot, `Attack ${signed(next.mons[slot]!.build.boosts.atk ?? 0)} (Belly Drum).`, next);
          return next;
        });
      });
    }
    case "filletAway": case "clangorousSoul": {
      // Their onTryHit raises the stats first (none raised: the move fails), then onHit's directDamage.
      const stages = use.entry.boosts!;
      const result = applyBoosts(kernel, w, slot, stages, user, { use, effect: "move", report: true });
      if (!Object.values(result).some((by) => by !== 0)) return fail("no stat can go higher");
      return cost(kernel, w, use, slot, use.entry.handler === "filletAway" ? Math.floor(maxHP / 2) : Math.floor(maxHP * 33 / 100));
    }
    case "curse": {
      // A Ghost type's Curse (data/moves.ts curse onHit): directDamage(source.maxhp / 2) to the user, which can faint it.
      const userMax = kernel.hp[user].maxHP;
      const loss = Math.max(1, Math.floor(userMax / 2));
      kernel.stepFact(use.action, `Curse: ${kernel.names[user]} loses ${loss} HP.`, w.mass);
      return cost(kernel, w, use, user, loss);
    }
    case "substitute": return cost(kernel, w, use, slot, Math.floor(maxHP / 4));
    case "afterYou": case "quash": return order(kernel, w, use, slot);
    case "haze": return [w];
    case "allySwitch": return positionHooks.allySwitchHit(kernel, w, use.action, move);
    case "swapItems": return itemHooks.swapItems(kernel, w, use.action, slot, move);
  }
  return [w];
}

/**
 * Strength Sap (data/moves.ts strengthsap onHit): fails at −6 Attack; the target's Attack with its stages (getStat boosted,
 * unmodified; Wonder Room does not touch Attack), Attack −1 from the user, then the user heals that much (Big Root
 * ×5324/4096; the target's Liquid Ooze deals the raw amount to the user instead, at full HP too; none at full HP).
 */
function strengthSap(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const { user, move } = use;
  const target = w.mons[slot]!;
  if ((target.build.boosts.atk ?? 0) <= -6) { hitFact(kernel, use, slot, `${move.name} fails: ${kernel.names[slot]}'s Attack is already −6.`, w); return [w]; }
  const stored = kernel.buildStats(target.build);
  if (!stored) kernel.notEstimated(REASONS.notIn2v2(move.name));
  const boost = target.build.boosts.atk ?? 0;
  const table = [1, 1.5, 2, 2.5, 3, 3.5, 4];
  const attack = boost >= 0 ? Math.floor(stored!.atk * table[boost]) : Math.floor(stored!.atk / table[-boost]);
  const stages = { atk: -1 };
  applyBoosts(kernel, w, slot, stages, user, { use, effect: "move", report: true });
  if (!kernel.alive(w, user)) return [w];
  if (target.build.abilityId === "liquidooze" && w.mons[user]!.build.abilityId !== "magicguard") {
    kernel.stepFact(use.action, `${kernel.abilityName("liquidooze")}: ${kernel.names[user]} loses ${attack} HP.`, w.mass);
    return kernel.afterLoss(w, user, attack);
  }
  if (target.build.abilityId === "liquidooze") return [w];
  const userBuild = w.mons[user]!.build;
  const amount = userBuild.itemId === "bigroot" && kernel.itemWorks(w, userBuild) ? bigRoot(attack) : attack;
  return healWorlds(kernel, w, user, amount, { use, source: move.name }).map(({ world }) => world);
}

/**
 * Pain Split (data/moves.ts painsplit onHit): both to floor((a + b) / 2), at least 1, each capped at its maximum (sim/pokemon.ts
 * sethp); a Dynamaxed Pokémon's HP is not followed. Their HP or pinch Berries at the Update.
 */
function painSplit(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const { user, move } = use;
  if (isMaxActive(w.mons[user]!.build) || isMaxActive(w.mons[slot]!.build)) kernel.notEstimated(REASONS.withDynamax(move.name));
  const maxUser = kernel.hp[user].maxHP, maxTarget = kernel.hp[slot].maxHP;
  const parts = mapJoint(w, [user, slot], (a, b) => {
    const average = Math.floor((a + b) / 2) || 1;
    const toUser = Math.min(maxUser, average), toTarget = Math.min(maxTarget, average);
    noteChange(kernel, use, slot, toTarget - b);
    if (toUser > a) kernel.noteHeal(user, move.name, toUser - a);
    if (toTarget > b) kernel.noteHeal(slot, move.name, toTarget - b);
    return { hp: [toUser, toTarget] as const, tag: "" };
  });
  return parts.flatMap(({ world }) => [user, slot].reduce<World[]>((worlds, each) => worlds.flatMap((next) => {
    const was = next.mons[each]!.build;
    return was.itemId !== "berryjuice" && kernel.berryStopped(next, each) ? [next] : ateFacts(kernel, use, each, was, kernel.berryDue(next, each));
  }), [world]));
}

/**
 * Rest (data/moves.ts rest onHit): setStatus('slp') (it replaces another status; Electric and Misty Terrain under it, Sweet
 * Veil, Leaf Guard in sun, Purifying Salt and Shields Down stop it), 3 turns, then full HP.
 */
function rest(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const reason = canStatus(kernel, w, slot, "slp", slot, { move: true, rest: true, breaks: () => false });
  if (reason) { hitFact(kernel, use, slot, reason.replace("{Move}", use.move.name), w); return [w]; }
  setStatus(kernel, w, slot, "slp", slot, { use, rest: true });
  const max = kernel.hp[slot].maxHP;
  return healWorlds(kernel, w, slot, max, { use, source: use.move.name }).map(({ world }) => world);
}

/**
 * After You and Quash (data/moves.ts afteryou: queue.prioritizeAction, order 3; quash: order 201): the target's queued
 * action moves next or last. Generation 7's frozen queue keeps their order of use: a later After You's action before an
 * earlier one's, a later Quash's after (data/mods/gen7/moves.ts quash: inserted before the residual).
 */
function order(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const queued = w.remaining.find((each) => each.slot === slot)!;
  const after = use.entry.handler === "afterYou";
  const orders = w.remaining.map((each) => each.order ?? 200);
  let value = after ? 3 : 201;
  if (kernel.gen7) value = after ? Math.min(3, ...orders.filter((each) => each < 200).map((each) => each - 0.001)) : Math.max(201, ...orders.filter((each) => each > 200).map((each) => each + 0.001));
  w.remaining = w.remaining.map((each) => (each === queued ? { ...each, order: value } : each));
  kernel.stepFact(use.action, after ? `After You: ${kernel.names[slot]} moves next.` : `Quash: ${kernel.names[slot]} moves last.`, w.mass);
  return [w];
}

/** Side and field moves (sim/battle-actions.ts tryMoveHit: TryHitSide, TryHitField): Safeguard, the hazards, Haze, Perish Song, Chilly Reception. */
function sideOrField(kernel: TurnKernel, w: World, use: Use): World[] {
  const { user, move, entry } = use;
  const userSide = slotSide(user);
  const name = kernel.names[user];
  // TryMove: Perish Song meets the priority shields of any foe (data/abilities.ts dazzling onFoeTryMove; C6).
  if (move.id === "perishsong" && use.priority > 0.1) {
    for (const foe of foesOf(user)) {
      if (!kernel.alive(w, foe)) continue;
      const shield = kernel.priorityShield(w, kernelAction(use, foe), move, foe, use.priority, use.info);
      if (shield) { kernel.stepFact(use.action, shield, w.mass); return [w]; }
    }
  }
  if (!use.bounced) proteanGuard(kernel, w, user, move.id, () => use.type);
  if (entry.side === "safeguard") {
    if (w.sides[userSide].safeguard) { kernel.stepFact(use.action, `${move.name} fails: it is already up on ${name}'s side.`, w.mass); return [w]; }
    w.sides[userSide] = { ...w.sides[userSide], safeguard: true };
    kernel.stepFact(use.action, `${move.name} starts on ${name}'s side.`, w.mass);
    return [w];
  }
  if (use.targetType === "foeSide") {
    // The hazards (data/moves.ts spikes and its kin): the foe side's Magic Bounce holder sends them back (onAllyTryHitSide).
    const foeSide: DoublesSideId = userSide === "own" ? "opponent" : "own";
    const bouncer = !use.bounced && entry.flags.reflectable
      ? DOUBLES_SLOTS.find((slot) => slotSide(slot) === foeSide && kernel.alive(w, slot) && w.mons[slot]!.build.abilityId === "magicbounce" && !breaks(kernel, w, use, slot)) : undefined;
    const lands = bouncer ? userSide : foeSide;
    if (bouncer) kernel.stepFact(use.action, `${kernel.abilityName("magicbounce")}: ${move.name} goes back to ${name}'s side.`, w.mass);
    w.sides[lands] = { ...w.sides[lands], hazards: [...w.sides[lands].hazards, move.id] };
    return [w];
  }
  if (move.id === "haze") {
    // data/moves.ts haze onHitField: every active Pokémon's stages to 0 (clearBoosts: no boost event).
    for (const slot of DOUBLES_SLOTS) {
      const mon = w.mons[slot];
      if (!mon || mon.fainted) continue;
      mon.build = { ...mon.build, boosts: Object.fromEntries(STATS.map((stat) => [stat, 0])) as BattleBuild["boosts"] };
      if (mon.vol.stages) setVol(w, slot, { stages: undefined });
    }
    kernel.stepFact(use.action, "Haze: every Pokémon's stat changes are removed.", w.mass);
    return [w];
  }
  if (move.id === "perishsong") return perishSong(kernel, w, use);
  if (move.id === "chillyreception") {
    // Snow (fieldMove), then the switch (SPEC §2.2 S).
    fieldMove(kernel, w, use.action, { ...move, id: "snowscape" });
    return switchOut(kernel, w, use, user);
  }
  return [w];
}

/**
 * Perish Song (data/moves.ts perishsong onHitField): each active Pokémon that passes TryHit (Soundproof but on its user,
 * Good as Gold, Psychic Terrain against a priority use, the absorbing abilities) and is not already counting gets the
 * perish count (4: 3 after this end of turn). It fails when none did.
 */
function perishSong(kernel: TurnKernel, w: World, use: Use): World[] {
  let any = false;
  const heard = DOUBLES_SLOTS.filter((slot) => kernel.alive(w, slot) && slot !== w.ghost);
  let worlds = [w];
  for (const slot of heard) {
    use.reached.add(slot);
    const stats = hitStatsOf(kernel, use, slot);
    if (stats) stats.reached += w.mass;
    const result = tryHit(kernel, worlds[0], use, slot);
    worlds = result.worlds;
    // A TryHit that stopped it counts as a result (onHitField: result = true); a perish count already running does not.
    if (!result.pass) { any = true; continue; }
    const mon = worlds[0].mons[slot]!;
    effect(kernel, use, slot, worlds[0]);
    if (mon.eot.perish !== undefined) { hitFact(kernel, use, slot, "Its perish count goes on.", worlds[0]); continue; }
    any = true;
    setEot(worlds[0], slot, { perish: 4 });
    hitFact(kernel, use, slot, "Perish count 3.", worlds[0]);
  }
  if (!any) kernel.stepFact(use.action, `${use.move.name} fails.`, w.mass);
  return worlds;
}

/** A switch the move makes (SPEC §2.2 S): with a later living action not followed; with none the end of turn is not estimated (doubles-eot.ts leaving). */
function switchOut(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  if (!kernel.alive(w, slot)) return [w];
  kernel.gasEnds(w, slot);
  if (kernel.laterAction(w)) kernel.notEstimated(REASONS.switchesOut(kernel.names[slot]));
  kernel.leaving(w, slot);
  kernel.stepFact(use.action, `${kernel.names[slot]} switches out.`, w.mass);
  return [w];
}

/** The status cure of Take Heart, Refresh, Jungle Healing and Lunar Blessing (cureStatus). */
function cureStatus(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId) {
  const mon = w.mons[slot]!;
  const status = mon.build.status;
  if (!status) return;
  mon.build = { ...mon.build, status: "" };
  if (status === "slp") setVol(w, slot, { sleep: undefined });
  if (status === "frz") setVol(w, slot, { freeze: undefined });
  if (status === "tox") setEot(w, slot, { toxic: undefined });
  hitFact(kernel, use, slot, `Its ${STATUS_NOUNS[status]} is cured.`, w);
}

/** directDamage on `slot` (Belly Drum, Fillet Away, Clangorous Soul, Substitute, Curse): no Damage event (Magic Guard, Sturdy), no hurt; its Berry at the Update, faint at 0. */
function cost(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, amount: number): World[] {
  const loss = Math.max(1, amount);
  const hurt = w.mons[slot]!.hurt;
  const was = w.mons[slot]!.build;
  for (const hp of marginal(w, slot).keys()) noteChange(kernel, use, slot, -Math.min(hp, loss));
  return ateFacts(kernel, use, slot, was, kernel.afterLoss(w, slot, loss)).map((world) => { world.mons[slot]!.hurt = hurt; return world; });
}

/**
 * The facts of a pinch Berry `slot` ate at the use's Update (its HP Berry's heal is the heals list): a stat Berry's rise,
 * Starf Berry's random one (a world each), Lansat Berry's focusenergy volatile. `was`: its build before. Returns `worlds`.
 */
function ateFacts(kernel: TurnKernel, use: Use, slot: DoublesSlotId, was: BattleBuild, worlds: World[]): World[] {
  const item = was.itemId;
  if (!PINCH_STAT_BERRIES[item] && !LANSAT_STARF.has(item)) return worlds;
  for (const world of worlds) {
    const now = world.mons[slot]!.build;
    if (now.itemId === item) continue;
    const changes = STATS.filter((stat) => (now.boosts[stat] ?? 0) !== (was.boosts[stat] ?? 0)).map((stat) => stageFact(stat, (now.boosts[stat] ?? 0) - (was.boosts[stat] ?? 0)).slice(0, -1));
    if (now.settledFocusEnergy && !was.settledFocusEnergy) changes.push("Focus Energy, +2 critical-hit stages");
    if (changes.length) hitFact(kernel, use, slot, `${kernel.itemName(item)}: ${changes.join(", ")}.`, world);
  }
  return worlds;
}

/**
 * A heal of `amount` on `slot` (sim/battle.ts heal: at least 1, truncated; TryHeal: Heal Block; none at 0 HP or full HP;
 * capped at the maximum). `healed`: false where it healed nothing (full HP, Heal Block). `failFact`: the failure is a hit fact (the heal itself is the hit's change and a heal fact).
 */
function healWorlds(kernel: TurnKernel, w: World, slot: DoublesSlotId, amount: number, opts: { use?: Use; action?: PendingAction; source: string; failFact?: boolean }): { world: World; healed: boolean }[] {
  const heal = Math.trunc(amount && amount <= 1 ? 1 : amount);
  const { maxHP } = kernel.hp[slot];
  const action = opts.use?.action ?? opts.action!;
  const name = kernel.names[slot];
  if (w.mons[slot]!.eot.healBlock) {
    if (opts.failFact) kernel.hitFact(action, slot, `${opts.source} fails: ${name} cannot heal.`, w.mass);
    return [{ world: w, healed: false }];
  }
  return mapHP(w, slot, (hp) => {
    if (hp <= 0 || hp >= maxHP) return { hp, tag: "full" };
    const after = Math.min(maxHP, hp + heal);
    kernel.noteHeal(slot, opts.source, after - hp);
    const stats = kernel.hitStats(action, slot);
    if (stats) stats.change = stats.change ? { min: Math.min(stats.change.min, after - hp), max: Math.max(stats.change.max, after - hp) } : { min: after - hp, max: after - hp };
    return { hp: after, tag: "healed" };
  }).map(({ world, tag }) => {
    if (tag === "full" && opts.failFact) kernel.hitFact(action, slot, `${opts.source} fails: ${name} is at full HP.`, world.mass);
    return { world, healed: tag === "healed" };
  });
}

/**
 * The action's Update (sim/battle.ts eachEvent('Update') after the move and after the action): curing Berries for what the
 * action gave (Lum any status and confusion, Persim confusion, Cheri, Chesto, Pecha, Rawst, Aspear; a foe's Unnerve or As One
 * stops them; Cheek Pouch), Mental Herb ending Taunt, Encore and Disable (Unnerve does not stop it), and the abilities
 * that cure their own status at an Update once a breaker passed them (Limber, Immunity, Insomnia, Vital Spirit, Water Veil,
 * Water Bubble, Thermal Exchange, Own Tempo, Oblivious, Pastel Veil). HP and pinch Berries are eaten where the HP changed.
 */
function updateAll(kernel: TurnKernel, w: World, before: Before, use: Use): World[] {
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon || mon.fainted) continue;
    const was = before[slot];
    const vol = mon.vol as Vol;
    const gained = !!mon.build.status && mon.build.status !== was?.status;
    const confused = !!vol.confusion && !was?.confusion;
    const build = mon.build;
    const item = build.itemId;
    const works = kernel.itemWorks(w, build);
    const stopped = kernel.berryStopped(w, slot);
    const pouch = () => { mon.build = { ...mon.build, ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}) }; kernel.pouchHeal(w, slot); };
    const cures: Record<string, string[]> = { lumberry: ["par", "brn", "psn", "tox", "slp", "frz"], cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"] };
    // The Berries come first: the Update inside the move (sim/battle-actions.ts hitStepMoveHitLoop) runs while the move is
    // active, when the breaker that gave the status still suppresses the holder's breakable curing ability
    // (sim/battle.ts suppressingAbility); that ability cures at the action's Update after the move (FX01).
    if (works && !stopped && gained && cures[item]?.includes(build.status)) {
      mon.build = { ...build, itemId: "", status: "" };
      if (build.status === "slp") setVol(w, slot, { sleep: undefined });
      if (build.status === "frz") setVol(w, slot, { freeze: undefined });
      if (build.status === "tox") setEot(w, slot, { toxic: undefined });
      if (item === "lumberry") setVol(w, slot, { confusion: undefined });
      pouch();
    } else if (works && !stopped && confused && (item === "persimberry" || item === "lumberry")) {
      mon.build = { ...build, itemId: "" };
      setVol(w, slot, { confusion: undefined });
      pouch();
    }
    const now = w.mons[slot]!;
    const nowVol = now.vol as Vol;
    if (now.build.itemId === "mentalherb" && kernel.itemWorks(w, now.build) && ((nowVol.taunt && !was?.taunt) || (nowVol.disabled && !was?.disabled) || (nowVol.encore && !was?.encore))) {
      now.build = { ...now.build, itemId: "", ...(now.build.abilityId === "unburden" ? { abilityActive: true } : {}) };
      setVol(w, slot, { taunt: undefined, disabled: undefined, encore: undefined } as Partial<Vol>);
    }
    // The abilities' own onUpdate cures, for what a breaker gave this action.
    const status = now.build.status, ability = now.build.abilityId;
    if (status && status !== was?.status && OWN_CURES[ability]?.includes(status)) {
      now.build = { ...now.build, status: "" };
      if (status === "slp") setVol(w, slot, { sleep: undefined });
      if (status === "frz") setVol(w, slot, { freeze: undefined });
      if (status === "tox") setEot(w, slot, { toxic: undefined });
    }
    if (ability === "owntempo" && (now.vol as Vol).confusion && !was?.confusion) setVol(w, slot, { confusion: undefined });
    if (ability === "oblivious" && now.vol.taunt && !was?.taunt) setVol(w, slot, { taunt: undefined });
  }
  // The items Trick or Switcheroo moved this action (World.itemsMoved, doubles-items.ts swapItems) act on what their receiver
  // already has, the target first, then the user.
  let worlds = [w];
  for (const slot of w.itemsMoved ?? []) worlds = worlds.flatMap((world) => receivedItem(kernel, world, slot, use));
  return worlds;
}

/**
 * A received item at the action's Update (data/items.ts onUpdate): a curing Berry on its status or confusion (Lum both,
 * Persim confusion), Mental Herb on a Taunt, Encore, Disable or Heal Block (Unnerve does not stop it), an HP or pinch Berry
 * at its line (kernel.berryDue, a Figy-family Berry's confusion included); a foe's Unnerve or As One stops the Berries.
 */
function receivedItem(kernel: TurnKernel, w: World, slot: DoublesSlotId, use: Use): World[] {
  const mon = w.mons[slot];
  if (!mon || !kernel.alive(w, slot)) return [w];
  const build = mon.build, item = build.itemId, status = build.status;
  if (!item || !kernel.itemWorks(w, build)) return [w];
  const vol = mon.vol as Vol;
  const unburden = build.abilityId === "unburden" ? { abilityActive: true } : {};
  if (item === "mentalherb") {
    if (!vol.taunt && !vol.disabled && !vol.encore && !mon.eot.healBlock) return [w];
    mon.build = { ...build, itemId: "", ...unburden };
    setVol(w, slot, { taunt: undefined, disabled: undefined, encore: undefined } as Partial<Vol>);
    setEot(w, slot, { healBlock: undefined });
    return [w];
  }
  // A foe's Unnerve or As One stops a Berry's TryEatItem; Berry Juice is used, not eaten (data/items.ts berryjuice: useItem).
  if (item !== "berryjuice" && kernel.berryStopped(w, slot)) return [w];
  const CURES: Record<string, string[]> = { lumberry: ["par", "brn", "psn", "tox", "slp", "frz"], cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"] };
  const curesStatus = !!status && !!CURES[item]?.includes(status);
  const curesConfusion = !!vol.confusion && (item === "lumberry" || item === "persimberry");
  if (curesStatus || curesConfusion) {
    mon.build = { ...build, itemId: "", ...(curesStatus ? { status: "" as const } : {}), ...unburden };
    if (curesStatus && status === "slp") setVol(w, slot, { sleep: undefined });
    if (curesStatus && status === "frz") setVol(w, slot, { freeze: undefined });
    if (curesStatus && status === "tox") setEot(w, slot, { toxic: undefined });
    if (item === "lumberry" || item === "persimberry") setVol(w, slot, { confusion: undefined });
    kernel.pouchHeal(w, slot);
    return [w];
  }
  if (!HEALING_BERRIES.has(item) && !PINCH_STAT_BERRIES[item] && !LANSAT_STARF.has(item)) return [w];
  const confused = !!vol.confusion;
  return ateFacts(kernel, use, slot, build, kernel.berryDue(w, slot)).map((world) => {
    if (!confused && world.mons[slot]!.vol.confusion) hitFact(kernel, use, slot, `${kernel.itemName(item)}: it becomes confused.`, world);
    return world;
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Statuses (SPEC §4.4: canStatus, setStatus; sim/pokemon.ts setStatus)
// ------------------------------------------------------------------------------------------------------------------

/** What sets a status, as SetStatus handlers read it. */
export type StatusSource = {
  /** A move's (effectType Move): Safeguard lets an Infiltrator foe's pass. */
  move?: boolean;
  /** The move's own status (Thunder Wave...): a failure to set it fails the move. */
  primary?: boolean;
  infiltrates?: boolean;
  /** Yawn's sleep at the end of turn (Safeguard and Flower Veil let it pass). */
  yawn?: boolean;
  /** Synchronize passing a status back. */
  synchronize?: boolean;
  /** Rest's own sleep (setStatus, not trySetStatus: another status is replaced). */
  rest?: boolean;
  /** Whether the active move's Mold Breaker passes this holder's breakable ability (none: false). */
  breaks?: (holder: DoublesSlotId) => boolean;
};

/**
 * Why `status` cannot be set on `slot` by `source` (sim/pokemon.ts trySetStatus, setStatus), or null: an existing status
 * (Rest replaces one), Comatose, the type immunities (Fire–burn, Electric–paralysis from generation 6, Poison and Steel–
 * poison unless the source has Corrosion, Ice–freeze), and the SetStatus handlers: Safeguard (another Pokémon's, an
 * Infiltrator foe's move passes, Yawn passes), Misty Terrain (grounded), Electric Terrain (sleep, grounded), Leaf Guard
 * (its own effectiveWeather sun), Shields Down (Meteor), Purifying Salt, Insomnia and Vital Spirit (sleep), Limber, Water
 * Veil, Water Bubble and Thermal Exchange (burn), Immunity and Pastel Veil (poison; Pastel Veil its ally's too), Sweet Veil
 * (sleep, its side), Flower Veil (a Grass type on its side, from another Pokémon). "{Move}" in the text is the caller's.
 */
export function canStatus(kernel: TurnKernel, w: World, slot: DoublesSlotId, status: BattleStatus, source: DoublesSlotId | null, from: StatusSource): string | null {
  const mon = w.mons[slot]!;
  const build = mon.build;
  const name = kernel.names[slot];
  const broken = (holder: DoublesSlotId) => !!from.breaks?.(holder);
  if (build.status && !(from.rest && build.status !== "slp")) return `{Move} fails: ${name} is already ${STATUS_WORDS[build.status]}.`;
  if (build.abilityId === "comatose") return `${kernel.abilityName("comatose")}: ${name} is not affected.`;
  const types = kernel.typesOf(build);
  const corrosion = (status === "psn" || status === "tox") && !!source && w.mons[source]?.build.abilityId === "corrosion";
  const typeImmune = (status === "brn" && types.includes("Fire")) || (status === "par" && types.includes("Electric") && generation(kernel) >= 6)
    || ((status === "psn" || status === "tox") && !corrosion && (types.includes("Poison") || types.includes("Steel"))) || (status === "frz" && types.includes("Ice"));
  if (typeImmune) return `${name} is immune.`;
  const other = !!source && source !== slot;
  const sideOf = slotSide(slot);
  if (w.sides[sideOf].safeguard && other && !from.yawn && !(from.move && from.infiltrates && kernel.isFoe(source!, slot))) return `${kernel.moveName("safeguard")}: ${name} is not affected.`;
  // The terrains act on a grounded Pokémon that is not semi-invulnerable (data/moves.ts mistyterrain, electricterrain onSetStatus).
  const grounded = kernel.grounded(w, slot) && !mon.eot.hidden;
  if (w.field.terrain === "Misty" && grounded) return `Misty Terrain: ${name} is not affected.`;
  if (w.field.terrain === "Electric" && grounded && status === "slp") return `Electric Terrain: ${name} is not affected.`;
  const ability = build.abilityId;
  const own = (blocks: boolean) => blocks && !broken(slot) ? `${kernel.abilityName(ability)}: ${name} is not affected.` : null;
  const blocker = own(ability === "leafguard" && ["Sun", "Harsh Sunshine"].includes(targetWeather(kernel, w, slot)))
    ?? (ability === "shieldsdown" && build.speciesId === "miniormeteor" && !build.transformedFrom ? `${kernel.abilityName(ability)}: ${name} is not affected.` : null)
    ?? own(ability === "purifyingsalt")
    ?? own(status === "slp" && (ability === "insomnia" || ability === "vitalspirit"))
    ?? own(status === "par" && ability === "limber")
    ?? own(status === "brn" && (ability === "waterveil" || ability === "waterbubble" || ability === "thermalexchange"))
    ?? own((status === "psn" || status === "tox") && (ability === "immunity" || ability === "pastelveil"));
  if (blocker) return blocker;
  for (const holder of DOUBLES_SLOTS) {
    if (slotSide(holder) !== sideOf || !kernel.alive(w, holder) || holder === w.ghost) continue;
    const held = w.mons[holder]!.build.abilityId;
    if (broken(holder)) continue;
    const by = `${kernel.abilityName(held)}: ${name} is not affected.`;
    if (held === "pastelveil" && (status === "psn" || status === "tox")) return by;
    if (held === "sweetveil" && status === "slp") return by;
    if (held === "flowerveil" && types.includes("Grass") && other && !from.yawn) return by;
  }
  return null;
}

/** Whether `slot` can fall asleep from a Yawn at the end of turn (status-eot SPEC §4.4: canSleep; Track B, order 23). */
export function canSleep(kernel: TurnKernel, w: World, slot: DoublesSlotId, source: DoublesSlotId | null): boolean {
  return canStatus(kernel, w, slot, "slp", source, { yawn: true }) === null;
}

/**
 * Set `status` on `slot` (after canStatus): bad poison starts at stage 0, sleep's counter at 0 (Rest's 3 turns); Synchronize
 * passes psn, tox, par or brn back to a living source (data/abilities.ts synchronize onAfterSetStatus). The curing Berry eats
 * at the Update (updateAll), for a damaging path's status at once (giveStatus).
 */
export function setStatus(kernel: TurnKernel, w: World, slot: DoublesSlotId, status: BattleStatus, source: DoublesSlotId | null, opts: { use?: Use; rest?: boolean }) {
  const mon = w.mons[slot]!;
  const was = mon.build.status;
  mon.build = { ...mon.build, status };
  if (was === "tox") setEot(w, slot, { toxic: undefined });
  if (status === "tox") setEot(w, slot, { toxic: 0 });
  if (status === "slp") setVol(w, slot, { sleep: { elapsed: 0, rest: !!opts.rest } });
  if (opts.use) hitFact(kernel, opts.use, slot, STATUS_GIVEN[status], w);
  if (mon.build.abilityId === "synchronize" && source && source !== slot && kernel.alive(w, source) && ["psn", "tox", "par", "brn"].includes(status)) {
    const reason = canStatus(kernel, w, source, status, slot, { synchronize: true, breaks: opts.use ? (holder) => holder !== opts.use!.user && kernel.breaks(w, opts.use!.user, holder, opts.use!.info) : undefined });
    if (!reason) {
      if (opts.use) hitFact(kernel, opts.use, slot, `${kernel.abilityName("synchronize")}: the status goes back to ${kernel.names[source]}.`, w);
      setStatus(kernel, w, source, status, slot, { use: opts.use });
    }
  }
}

/** Bad poison only from a Serene Grace user's Poison Fang or Malignant Chain (stat-moves.ts SERENE_GRACE_MOVES). */
export type GivenStatus = "psn" | "tox" | "brn" | "par";

/** Whether a status from a damaging path (a protecting move's contact, a Max Move, a face's hit) lands (canStatus). */
export function statusLands(kernel: TurnKernel, w: World, slot: DoublesSlotId, status: GivenStatus, source: DoublesSlotId): boolean {
  const infiltrates = w.mons[source]?.build.abilityId === "infiltrator";
  return canStatus(kernel, w, slot, status, source, { move: true, infiltrates }) === null;
}

/**
 * A status set on `slot` by `source` from a damaging path (sim/pokemon.ts trySetStatus): Synchronize passes it back to its
 * source, then a curing Berry eats it (data/items.ts lumberry and its kin) unless a foe's Unnerve or As One stops the Berry
 * (onFoeTryEatItem); Cheek Pouch.
 */
export function giveStatus(kernel: TurnKernel, w: World, slot: DoublesSlotId, status: GivenStatus, source: DoublesSlotId) {
  if (!statusLands(kernel, w, slot, status, source)) return;
  setStatus(kernel, w, slot, status, source, {});
  const mon = w.mons[slot]!;
  const item = mon.build.itemId;
  const cures = item === "lumberry" || ((status === "psn" || status === "tox") && item === "pechaberry") || (status === "brn" && item === "rawstberry") || (status === "par" && item === "cheriberry");
  if (cures && kernel.itemWorks(w, mon.build) && !kernel.berryStopped(w, slot)) {
    mon.build = { ...mon.build, itemId: "", status: "" };
    if (status === "tox") setEot(w, slot, { toxic: undefined });
    kernel.pouchHeal(w, slot);
  }
  if (source !== slot && w.mons[source]?.build.status === status && w.mons[source]!.build.abilityId !== "synchronize") {
    const back = w.mons[source]!;
    const held = back.build.itemId;
    const backCures = held === "lumberry" || ((status === "psn" || status === "tox") && held === "pechaberry") || (status === "brn" && held === "rawstberry") || (status === "par" && held === "cheriberry");
    if (backCures && kernel.itemWorks(w, back.build) && !kernel.berryStopped(w, source) && mon.build.abilityId === "synchronize") {
      back.build = { ...back.build, itemId: "", status: "" };
      if (status === "tox") setEot(w, source, { toxic: undefined });
      kernel.pouchHeal(w, source);
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Stages (SPEC §4.4 applyBoosts; sim/battle.ts boost)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Stages on `slot` from `source` (sim/battle.ts boost): none while the target's foes have no Pokémon left (generation 6+);
 * ChangeBoost (Contrary, Simple; breakable), the ±6 cap, TryBoost on a change from another Pokémon (Clear Amulet first;
 * Clear Body, White Smoke, Hyper Cutter, Big Pecks, Keen Eye, Mind's Eye, Flower Veil on a Grass type of its side, all
 * breakable; Full Metal Body; Mirror Armor turning each drop not already at −6 back onto a living source, once); then per
 * stat that changed, AfterEachBoost: Defiant (+2 Attack) and Competitive (+2 Sp. Atk) for a drop from a foe; then White
 * Herb (after the move: data/items.ts whiteherb onAnyAfterMove), which restores accuracy and evasion too. Accuracy and evasion
 * are this turn's stages (MoveVolatiles.stages, from 0); no calculation reads them (Stored Power, Power Trip and Punishment are
 * guarded where one is positive: doubles-turn.ts applyStep). `report`: each stat's fact on the use, before its reactions ("−2 Attack.",
 * "Its Attack cannot go higher."; `by`, the ability that raised it: "Defiant: +2 Attack."). The stages that changed, by how much.
 */
export function applyBoosts(kernel: TurnKernel, w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId | null,
  opts: { use?: Use; effect?: "move" | "ability" | "item" | null; reflected?: boolean; broken?: boolean; report?: boolean; by?: string } = {}): Partial<Record<Stage, number>> {
  const mon = w.mons[slot]!;
  if (mon.fainted) return {};
  if (generation(kernel) > 5 && !foesLeft(kernel, w, slot)) return {};
  const use = opts.use;
  const breaksHolder = (holder: DoublesSlotId) => opts.broken !== undefined ? opts.broken && holder !== source : !!use && breaks(kernel, w, use, holder);
  const ability = mon.build.abilityId;
  const suppressed = breaksHolder(slot);
  let boost: Partial<Record<Stage, number>> = { ...changes };
  // ChangeBoost: Contrary, Simple.
  if (!suppressed && ability === "contrary") for (const stat of Object.keys(boost) as Stage[]) boost[stat] = -boost[stat]!;
  if (!suppressed && ability === "simple") for (const stat of Object.keys(boost) as Stage[]) boost[stat] = boost[stat]! * 2;
  const wanted = { ...boost };
  // getCappedBoost (accuracy and evasion: this turn's stages, MoveVolatiles.stages).
  const current = (stat: Stage) => (stat === "accuracy" || stat === "evasion" ? mon.vol.stages?.[stat] ?? 0 : mon.build.boosts[stat as CombatStat] ?? 0);
  const capped: Partial<Record<Stage, number>> = {};
  for (const [stat, amount] of Object.entries(boost) as [Stage, number][]) {
    if (!amount) continue;
    capped[stat] = Math.max(-6, Math.min(6, current(stat) + amount)) - current(stat);
  }
  boost = capped;
  // TryBoost from another Pokémon.
  const other = !!source && source !== slot;
  const facts: string[] = [];
  const dropAll = (by: string) => { if (Object.values(boost).some((amount) => amount! < 0)) facts.push(`${by}: its stats are not lowered.`); for (const stat of Object.keys(boost) as Stage[]) if (boost[stat]! < 0) delete boost[stat]; };
  if (other) {
    if (mon.build.itemId === "clearamulet" && kernel.itemWorks(w, mon.build)) dropAll(kernel.itemName("clearamulet"));
    if ((ability === "clearbody" || ability === "whitesmoke") && !suppressed) dropAll(kernel.abilityName(ability));
    if (ability === "fullmetalbody") dropAll(kernel.abilityName(ability));
    const single = (stat: Stage, held: string) => { if (ability === held && !suppressed && (boost[stat] ?? 0) < 0) { delete boost[stat]; facts.push(`${kernel.abilityName(held)}: its ${STAGE_NAMES[stat]} is not lowered.`); } };
    single("atk", "hypercutter"); single("def", "bigpecks"); single("accuracy", "keeneye"); single("accuracy", "mindseye");
    // Illuminate's onTryBoost keeps accuracy from falling from generation 9 (data/abilities.ts illuminate; data/mods/gen8 has none).
    if (generation(kernel) >= 9) single("accuracy", "illuminate");
    if (kernel.typesOf(mon.build).includes("Grass")) {
      const veil = DOUBLES_SLOTS.find((holder) => slotSide(holder) === slotSide(slot) && kernel.alive(w, holder) && holder !== w.ghost && w.mons[holder]!.build.abilityId === "flowerveil" && !breaksHolder(holder));
      if (veil) dropAll(kernel.abilityName("flowerveil"));
    }
    if (ability === "mirrorarmor" && !suppressed && !opts.reflected) {
      const back: Partial<Record<Stage, number>> = {};
      for (const [stat, amount] of Object.entries(boost) as [Stage, number][]) {
        if (amount >= 0 || current(stat) === -6) continue;
        back[stat] = amount;
        delete boost[stat];
      }
      if (Object.keys(back).length && source && w.mons[source] && !w.mons[source]!.fainted) {
        facts.push(`${kernel.abilityName("mirrorarmor")}: the drop goes back to ${kernel.names[source]}.`);
        applyBoosts(kernel, w, source, back, slot, { ...opts, reflected: true, effect: "ability", broken: false, report: true, by: undefined });
      }
    }
  }
  if (use) for (const text of facts) hitFact(kernel, use, slot, text, w);
  // The table AfterBoost reads (after ChangeBoost, the cap and TryBoost): a rise for a foe's Opportunist or Mirror Herb, a
  // drop for Eject Pack, recorded for the action's eventGuards (doubles-turn.ts) whatever the stages end at.
  const rises = Object.values(boost).some((amount) => amount! > 0), drops = Object.values(boost).some((amount) => amount! < 0);
  if (rises || drops) w.boosted = { ...w.boosted, [slot]: { ...w.boosted?.[slot], ...(rises ? { rose: true as const } : {}), ...(drops ? { fell: true as const } : {}) } };
  // Apply, stat by stat, with AfterEachBoost.
  const boosts = { ...mon.build.boosts };
  const hidden = { ...mon.vol.stages };
  const changed: Partial<Record<Stage, number>> = {};
  let raised = false, lowered = false;
  for (const [stat, amount] of Object.entries(boost) as [Stage, number][]) {
    changed[stat] = amount;
    if (!amount) continue;
    if (stat !== "accuracy" && stat !== "evasion") boosts[stat as CombatStat] = current(stat) + amount;
    else hidden[stat] = current(stat) + amount;
    if (amount > 0) raised = true; else lowered = true;
  }
  mon.build = { ...mon.build, boosts };
  if (Object.keys(hidden).length) setVol(w, slot, { stages: hidden });
  if (raised) mon.statsRaised = true;
  if (lowered) mon.statsLowered = true;
  // Each stat's message (`by`: the ability or item that raised it), then its reactions (sim/battle.ts boost: AfterEachBoost).
  if (use && opts.report) {
    for (const [stat, amount] of Object.entries(changed) as [Stage, number][]) {
      const text = amount ? stageFact(stat, amount) : `its ${STAGE_NAMES[stat]} cannot go ${(wanted[stat] ?? 0) > 0 ? "higher" : "lower"}.`;
      hitFact(kernel, use, slot, opts.by ? `${opts.by}: ${text}` : amount ? text : `I${text.slice(1)}`, w);
    }
  }
  // Defiant and Competitive (data/abilities.ts defiant, competitive onAfterEachBoost: each stat a foe lowered).
  if (source && kernel.isFoe(source, slot)) {
    for (const amount of Object.values(changed)) {
      if (!(amount! < 0)) continue;
      const rise = ability === "defiant" ? { atk: 2 } : ability === "competitive" ? { spa: 2 } : null;
      if (!rise) continue;
      applyBoosts(kernel, w, slot, rise, slot, { ...opts, effect: "ability", broken: false, report: true, by: kernel.abilityName(ability) });
    }
  }
  // White Herb (after the move: data/items.ts whiteherb onStart reads every stage, accuracy and evasion included).
  const lowHidden = (["accuracy", "evasion"] as const).filter((stat) => (mon.vol.stages?.[stat] ?? 0) < 0);
  if (mon.build.itemId === "whiteherb" && kernel.itemWorks(w, mon.build) && (STATS.some((stat) => (mon.build.boosts[stat] ?? 0) < 0) || lowHidden.length)) {
    mon.build = { ...mon.build, itemId: "", ...(mon.build.abilityId === "unburden" ? { abilityActive: true } : {}), boosts: Object.fromEntries(STATS.map((stat) => [stat, Math.max(0, mon.build.boosts[stat] ?? 0)])) as BattleBuild["boosts"] };
    if (lowHidden.length) setVol(w, slot, { stages: Object.fromEntries(Object.entries(mon.vol.stages ?? {}).map(([stat, stage]) => [stat, Math.max(0, stage!)])) });
    if (use) hitFact(kernel, use, slot, `${kernel.itemName("whiteherb")}: its lowered stats are restored.`, w);
  }
  return changed;
}

/** Whether `slot`'s foes have a Pokémon left (sim/side.ts foePokemonLeft): one in, or a bench (an empty slot means none, DoublesTurnInput.pokemon). */
function foesLeft(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean {
  const foes = foesOf(slot);
  if (foes.some((foe) => kernel.alive(w, foe))) return true;
  if (foes.some((foe) => !kernel.input.pokemon[foe])) return false;
  return canSwitch(kernel, slotSide(foes[0]));
}

/** A boost the Pokémon gives itself (sim/battle.ts boost: Contrary, Simple, the ±6 cap): an ability's or an item's (no facts). */
export function selfBoost(kernel: TurnKernel, w: World, slot: DoublesSlotId, changes: Partial<Record<CombatStat, number>>, action: PendingAction | null) {
  void action;
  applyBoosts(kernel, w, slot, changes, slot, { effect: null, broken: false });
}

/**
 * A drop on `slot` from `source` from a damaging path (a protecting move's contact effect, a Max Move, Mud-Slap's accuracy
 * drop): applyBoosts with `broken` the source's Mold Breaker passing the target's breakable abilities; `reflected`: a drop
 * Mirror Armor sent back.
 */
export function foeDrop(kernel: TurnKernel, w: World, slot: DoublesSlotId, changes: StatusStages, source: DoublesSlotId | null, broken = false, reflected = false) {
  applyBoosts(kernel, w, slot, changes, source, { effect: "move", broken, reflected });
}
