// Exact doubles-turn oracle on pinned Showdown c23d2e94 (SPEC §8.1), extending design/turnsim.ts.
//
// One turn of a case runs in the real simulator (scripts/.cache/calc-audit/showdown) with every random decision enumerated:
// the 16 damage rolls (randomizer), full paralysis / Quick Claw / Quick Draw (randomChance by effect), speed-tie shuffles
// (prng.shuffle, every permutation), random targets and hit counts (sample, random). These are forced as the app assumes:
// every move hits (accuracy checks pass), no critical hit unless certain or the case's Critical hit is on, added effects below
// 100% fail (random(100) gives 99, other randomChance calls fail unless certain). HP is read when the residual action is picked,
// before the end of the turn. One bench Pokémon per side keeps the turn going when both actives on a side faint.
//
// status-eot (SPEC §7, ADDENDUM §7): the walk then RUNS the residual action (fieldEvent('Residual'), the faints, the final
// Update and Emergency Exit) and records the state after the whole turn (WalkResult.afterTurn), the residual log by effect,
// and per action the lines on each Pokémon (StepResult.effects). The residual's random events (Healer, Shed Skin, Ally
// Switch's counter, residual tie shuffles, Yawn's sleep length) are enumerated as decisions appended to the path, so the
// after-the-moves fields are recorded once per moves path, exactly as before (byte-equal results). A case's carried state
// (CaseMon.carried, substitute, lastMove, moves; Case.weatherTurns, canSwitch) is applied in prepare(); hidden counters
// (sleep, confusion) consistent with the public attempts are expanded into weighted sub-cases (SPEC §7 step 3). Pokémon
// keep the slot they started in (p.m.caseSlot) through Ally Switch (ADDENDUM §7.1).
//
// The walk is exact and runs action by action: the battle is serialized (sim/state.ts) at every action boundary, equal states
// are merged with their masses added, and each state's next action is enumerated by replaying it from the snapshot with a
// decision prefix (DFS). `--validate` reruns the case as whole-turn replays without any merging or serialization and requires
// the same distributions.
//
// Run from the repo root:
//   npx --no-install tsx scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts [V01 V02 ...] [--validate] [--samples=10000] [--out=dir]
// Writes scripts/.cache/calc-audit/2v2/verify/results/<id>.json (OracleResult).
import fs from "node:fs";
import path from "node:path";
import * as sim from "../../showdown/sim/index.ts";
import { State } from "../../showdown/sim/state.ts";
import {
  DOUBLES_FORMAT, SLOTS, toID,
  type AfterTurn, type Case, type CaseMon, type Expected, type HitResult, type OracleResult, type ResidualResult, type SideKey, type SlotId,
  type SlotResult, type StepResult, type WalkResult,
} from "./case-types";
import { CASES } from "./cases";

const { Battle, Dex } = sim as any;
export type Mode = "all" | "lowest" | "highest";

/** SPEC §3.1 SHOWDOWN_POSITION: the far side is mirrored, so the screen-left foe is p2b. */
export const SD: Record<SlotId, { side: 0 | 1; position: 0 | 1 }> = {
  "own-left": { side: 0, position: 0 }, "own-right": { side: 0, position: 1 },
  "opponent-left": { side: 1, position: 1 }, "opponent-right": { side: 1, position: 0 },
};
const IDENT: Record<SlotId, string> = { "own-left": "p1a", "own-right": "p1b", "opponent-left": "p2b", "opponent-right": "p2a" };
const SIDE_OF: Record<SlotId, SideKey> = { "own-left": "own", "own-right": "own", "opponent-left": "opponent", "opponent-right": "opponent" };
/**
 * The slot a Pokémon started the turn in (ADDENDUM §7.1 identity: p.m.caseSlot, set by prepare(); the bench has null).
 * Battles not made by prepare() (fainted-engine/real-battle.ts) fall back to the position.
 */
export function slotOf(p: any): SlotId | null {
  if (!p?.side || typeof p.position !== "number") return null;
  if (p.m && "caseSlot" in p.m) return p.m.caseSlot ?? null;
  return SLOTS.find((slot) => SD[slot].side === p.side.n && SD[slot].position === p.position) ?? null;
}
/** Showdown targetLoc from `actor` to `target`: foes 1/2 by position, own side -1/-2. */
export function targetLoc(actor: SlotId, target: SlotId): number {
  const a = SD[actor], t = SD[target];
  return a.side === t.side ? -(t.position + 1) : t.position + 1;
}

const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
/** The set's moves, each once by id (the first spelling kept), in order. */
function uniqueMoves(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const id = toID(name);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
export function sdSet(m: CaseMon, move: string | null, name: string) {
  // status2 (T2E TR09): Struggle is no move slot; prepare() empties every slot's PP so the choice becomes Struggle.
  const first = move === null || toID(move) === "struggle" ? "Splash" : move;
  // status2: an Encore or Disable from an earlier turn needs its move in a slot (the volatile reads lastMove's slot).
  const carriedMoves = [m.carried?.encore?.move, m.carried?.disable?.move].filter((x): x is string => !!x);
  return {
    name, species: m.species, gender: m.gender ?? "", item: m.item ?? "", ability: m.ability,
    // status2 wave 1b (CaseMon.exactMoves): no Splash slot for a move that picks among its user's slots (Sleep Talk).
    moves: uniqueMoves(m.exactMoves ? [first, ...(m.moves ?? []), ...(m.lastMove ? [m.lastMove] : []), ...carriedMoves] : [first, "Splash", ...(m.moves ?? []), ...(m.lastMove ? [m.lastMove] : []), ...carriedMoves]), nature: m.nature ?? "Serious",
    evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs }, level: m.level ?? 50, teraType: m.teraType, happiness: 255,
    ...(m.gigantamax ? { gigantamax: true } : {}),
  };
}
export const BENCH: CaseMon = { species: "Snorlax", ability: "Thick Fat" };
export const WEATHER: Record<string, string> = {
  Sun: "sunnyday", Rain: "raindance", Sand: "sandstorm", Snow: "snowscape", Hail: "hail",
  "Harsh Sunshine": "desolateland", "Heavy Rain": "primordialsea", "Strong Winds": "deltastream",
};
export const TERRAIN: Record<string, string> = { Electric: "electricterrain", Grassy: "grassyterrain", Misty: "mistyterrain", Psychic: "psychicterrain" };

/** The Pokémon standing at the slot's start position now (positions, not identity). */
export function pokemonAt(b: any, slot: SlotId) {
  return b.sides[SD[slot].side].active[SD[slot].position];
}
/** The Pokémon that started the turn in `slot`, wherever it stands now (ADDENDUM §7.1 monOf). */
export function monOf(b: any, slot: SlotId) {
  const side = b.sides[SD[slot].side];
  // status2 Step 1 #14: a switch-in's Pokémon before it enters (on the bench behind its placeholder).
  return side.active.find((p: any) => p?.m && p.m.caseSlot === slot)
    ?? side.pokemon.find((p: any) => p?.m?.pendingSwitchIn === slot && !p.isActive && !p.activeTurns && !p.fainted)
    ?? pokemonAt(b, slot);
}

/** Hidden counters chosen for one sub-case: per slot the sleep length S or the confusion length T (SPEC §7 step 3). */
type Hidden = Partial<Record<SlotId, { sleep?: number; confusion?: number }>>;
const SLEEP_PRIOR: Record<"native" | "champions" | "rest", [number, number][]> = {
  native: [[2, 1 / 3], [3, 1 / 3], [4, 1 / 3]], champions: [[2, 1 / 3], [3, 2 / 3]], rest: [[3, 1]],
};
/**
 * Every hidden-counter assignment consistent with the case's public counts, with its prior weight (SPEC §7 step 3):
 * sleep S over its prior (SV/SwSh/USUM {2,3,4}; Champions {2: 1/3, 3: 2/3}; Rest 3) restricted to S > elapsed, elapsed =
 * attempts × (Early Bird ? 2 : 1), a status "slp" without carried.sleep counting as 0 attempts (the app's assumption);
 * confusion T uniform on min..5 (Axe Kick: 3) restricted to T > attempts.
 */
export function hiddenCases(c: Case): { hidden: Hidden; weight: number; label: string }[] {
  let out: { hidden: Hidden; weight: number; label: string }[] = [{ hidden: {}, weight: 1, label: "" }];
  for (const slot of SLOTS) {
    const m = c.slots[slot];
    if (m.absent) continue;
    const options: { key: "sleep" | "confusion"; value: number; weight: number }[][] = [];
    if (m.status === "slp") {
      const attempts = m.carried?.sleep?.attempts ?? 0;
      const rest = !!m.carried?.sleep?.rest;
      const d = toID(m.ability) === "earlybird" ? 2 : 1;
      const prior = SLEEP_PRIOR[rest ? "rest" : c.game === "champions" ? "champions" : "native"].filter(([s]) => s > attempts * d);
      const total = prior.reduce((sum, [, p]) => sum + p, 0);
      if (!total) throw new Error(`${c.id} ${slot}: no sleep length is consistent with ${attempts} attempts`);
      options.push(prior.map(([s, p]) => ({ key: "sleep", value: s, weight: p / total })));
    }
    const conf = m.carried?.confusion;
    if (conf) {
      const min = conf.axeKick ? 3 : 2;
      const values = [2, 3, 4, 5].filter((t) => t >= min && t > conf.attempts);
      if (!values.length) throw new Error(`${c.id} ${slot}: no confusion length is consistent with ${conf.attempts} attempts`);
      options.push(values.map((t) => ({ key: "confusion", value: t, weight: 1 / values.length })));
    }
    for (const list of options) {
      if (list.length === 1 && out.length === 1 && !out[0].label) {
        // A single option still names the value (the start state it sets).
      }
      out = out.flatMap((o) => list.map((opt) => ({
        hidden: { ...o.hidden, [slot]: { ...o.hidden[slot], [opt.key]: opt.value } },
        weight: o.weight * opt.weight,
        label: `${o.label ? `${o.label} ` : ""}${slot} ${opt.key} ${opt.value}`,
      })));
    }
  }
  return out;
}

/** The case's state from earlier turns (SPEC §7 step 2, ADDENDUM §7.1), applied after its stats, status and stages. */
function applyCarried(b: any, c: Case, slot: SlotId, p: any, hidden: Hidden) {
  const m = c.slots[slot];
  const carried = m.carried ?? {};
  const foe = () => SLOTS.filter((s) => SIDE_OF[s] !== SIDE_OF[slot] && !c.slots[s].absent).map((s) => monOf(b, s))[0] ?? null;
  // Sleep: the hidden length S and the BeforeMoves already spent asleep (pinned data/conditions.ts slp: time-- per BeforeMove,
  // twice with Early Bird; Rest sets time 3).
  if (m.status === "slp") {
    const s = hidden[slot]?.sleep;
    if (s === undefined) throw new Error(`${c.id} ${slot}: asleep with no hidden sleep length`);
    const d = toID(m.ability) === "earlybird" ? 2 : 1;
    p.statusState.startTime = s;
    p.statusState.time = s - (carried.sleep?.attempts ?? 0) * d;
  }
  // Champions freeze (mods/champions/conditions.ts frz): start 3, time-- per BeforeMove.
  if (m.status === "frz" && c.game === "champions") {
    p.statusState.startTime = 3;
    p.statusState.time = 3 - (carried.freeze?.attempts ?? 0);
  }
  if (m.status === "tox" && carried.toxic !== undefined) p.statusState.stage = carried.toxic;
  if (carried.confusion) {
    const t = hidden[slot]?.confusion;
    if (t === undefined) throw new Error(`${c.id} ${slot}: confused with no hidden length`);
    p.addVolatile("confusion");
    p.volatiles.confusion.time = t - carried.confusion.attempts;
  }
  if (m.substitute !== undefined) {
    p.addVolatile("substitute");
    p.volatiles.substitute.hp = m.substitute;
  }
  if (carried.leechSeed) p.addVolatile("leechseed", monOf(b, carried.leechSeed));
  if (carried.trap) {
    const source = monOf(b, carried.trap.source);
    p.addVolatile("partiallytrapped", source, b.dex.getActiveMove(toID(carried.trap.move ?? "Fire Spin")));
    p.volatiles.partiallytrapped.boundDivisor = carried.trap.bindingBand ? 6 : 8;
    p.volatiles.partiallytrapped.duration = 5;
  }
  if (carried.saltCure) p.addVolatile("saltcure", foe());
  if (carried.aquaRing) p.addVolatile("aquaring");
  if (carried.ingrain) p.addVolatile("ingrain");
  if (carried.curse) p.addVolatile("curse", foe());
  if (carried.syrupBomb) p.addVolatile("syrupbomb", monOf(b, carried.syrupBomb));
  // Yawn from last turn: duration 1, so it ends at this residual (moves.ts yawn duration 2, onEnd → trySetStatus slp).
  if (carried.yawn) {
    // It landed last turn: a terrain set now would refuse it at prepare (electricterrain onTryAddVolatile), so add it without.
    const terrain = b.field.terrain;
    b.field.terrain = "";
    p.addVolatile("yawn", foe());
    b.field.terrain = terrain;
    p.volatiles.yawn.duration = 1;
  }
  // The perish count shown before this turn is the volatile's duration: this residual lowers it, 0 faints.
  if (carried.perish) {
    p.addVolatile("perishsong");
    p.volatiles.perishsong.duration = carried.perish;
  }
  // Wish landing now (C15): startingTurn below this turn's overflowed count.
  if (carried.wish) {
    p.side.addSlotCondition(p, "wish", p);
    const state = p.side.slotConditions[p.position].wish;
    state.hp = carried.wish;
    state.startingTurn = b.getOverflowedTurnCount() - 1;
  }
  // Ally Switch used last turn (moves.ts allyswitch condition: duration 2, counter). 1: not used last turn (no volatile).
  if (carried.allySwitch && carried.allySwitch > 1) {
    p.addVolatile("allyswitch");
    p.volatiles.allyswitch.counter = carried.allySwitch;
    p.volatiles.allyswitch.duration = 1;
  }
  // status2: a move used last turn is both lastMove and lastMoveUsed (useMoveInner sets it; Conversion 2 reads it).
  if (m.lastMove) p.lastMove = p.lastMoveUsed = b.dex.getActiveMove(toID(m.lastMove));
  // status2: accuracy and evasion stages from earlier turns (DoublesCarried.stages).
  if (carried.stages?.accuracy) p.boosts.accuracy = carried.stages.accuracy;
  if (carried.stages?.evasion) p.boosts.evasion = carried.stages.evasion;
  applyCarried2(b, c, slot, p);
}

/**
 * status2 wave 1a (SPEC2 §7.1, ADDENDUM2 §7.1): the state from earlier turns the 2v2 status2 build reads, each as a real
 * battle leaves it at the start of the turn after (a volatile from last turn has one turn of its duration left; one with
 * turns left has that duration before this end of turn's countdown).
 */
function applyCarried2(b: any, c: Case, slot: SlotId, p: any) {
  const m = c.slots[slot];
  const carried = m.carried ?? {};
  const need = (ok: unknown, what: string) => {
    if (!ok) throw new Error(`${c.id} ${slot}: Showdown refused the carried ${what}`);
  };
  const add = (id: string, source: any = null, effect: any = null) => {
    need(p.addVolatile(id, source, effect), id);
    return p.volatiles[id];
  };
  // Stockpile: the layers and the counts its End reverses (moves.ts:17961-18008). The volatile is written directly (its
  // Start and Restart boost Defense and Sp. Def, which the case's boosts already hold, and a foe's Opportunist would copy).
  if (carried.stockpile) {
    const { layers } = carried.stockpile;
    p.volatiles.stockpile = b.initEffectState({ id: "stockpile", name: "Stockpile", target: p, source: p, sourceSlot: p.getSlot() });
    Object.assign(p.volatiles.stockpile, { layers, def: carried.stockpile.def ?? -layers, spd: carried.stockpile.spd ?? -layers });
  }
  // Power Trick / Power Shift: the condition's Start swaps the stored stats as the move did (moves.ts powertrick, powershift).
  if (carried.powerTrick) add("powertrick");
  if (carried.powerShift) add("powershift");
  if (carried.noRetreat) add("noretreat");
  if (carried.minimize) add("minimize");
  if (carried.gastroAcid) add("gastroacid");
  if (carried.trapped) add("trapped", foeOf(b, c, slot));
  // A two-turn move charged last turn: twoturnmove (conditions.ts:287-323) with the move's own volatile, aimed at the case's
  // target (lastMoveTargetLoc, read by onStart), one turn left of each; the choice is then locked into it.
  if (carried.charging) {
    const move = b.dex.getActiveMove(toID(carried.charging));
    const target = m.action.target ?? null;
    p.lastMoveTargetLoc = target && move.target !== "self" ? targetLoc(slot, target) : 0;
    const defender = target ? monOf(b, target) : p;
    add("twoturnmove", defender, move);
    p.volatiles.twoturnmove.duration = 1;
    if (p.volatiles[move.id]?.duration) p.volatiles[move.id].duration = 1;
  }
  if (carried.tarShot) add("tarshot");
  if (carried.foresight) add("foresight");
  if (carried.miracleEye) add("miracleeye");
  if (carried.telekinesis) add("telekinesis").duration = carried.telekinesis;
  if (carried.healBlock) add("healblock").duration = carried.healBlock;
  if (carried.embargo) add("embargo").duration = carried.embargo;
  if (carried.nightmare) add("nightmare");
  if (carried.octolock) add("octolock", monOf(b, carried.octolock));
  if (carried.attract) add("attract", monOf(b, carried.attract));
  // An Opportunist or Mirror Herb copy pending from last turn's final Update (abilities.ts opportunist, items.ts mirrorherb).
  if (carried.copy) {
    if (toID(m.ability) === "opportunist") p.abilityState.boosts = { ...carried.copy };
    else if (toID(m.item ?? "") === "mirrorherb") Object.assign(p.itemState, { boosts: { ...carried.copy }, ready: true });
    else throw new Error(`${c.id} ${slot}: a pending copy needs Opportunist or a Mirror Herb`);
  }
  if (carried.berryLocked) {
    const ability = toID(m.ability);
    if (ability === "berserk") p.abilityState.checkedBerserk = false;
    else if (ability === "angershell") p.abilityState.checkedAngerShell = false;
    else throw new Error(`${c.id} ${slot}: a locked Berry needs Berserk or Anger Shell`);
  }
  if (carried.glaiveRush) add("glaiverush");
  if (carried.berryWeaken) p.abilityState.berryWeaken = true;
  // Lock-On on the user, its source the Pokémon it locked on to (moves.ts lockon: duration 2, one turn left).
  if (carried.lockOn) add("lockon", monOf(b, carried.lockOn)).duration = 1;
  // The stall counter (conditions.ts:439-462): 1 is no volatile.
  if (carried.stall && carried.stall > 1) {
    const state = add("stall");
    state.counter = carried.stall;
    state.duration = 1;
  }
  if (carried.mustRecharge) add("mustrecharge").duration = 1;
  if (carried.destinyBond) add("destinybond");
  if (carried.laserFocus) add("laserfocus").duration = 1;
  if (carried.taunt) add("taunt").duration = carried.taunt;
  if (carried.encore) {
    p.lastMove = b.dex.getActiveMove(toID(carried.encore.move));
    const state = add("encore");
    state.duration = carried.encore.turns;
  }
  if (carried.disable) {
    p.lastMove = b.dex.getActiveMove(toID(carried.disable.move));
    const state = add("disable");
    state.duration = carried.disable.turns;
  }
  for (const once of carried.onceUsed ?? []) {
    const flag = { battlebond: "bondTriggered", intrepidsword: "swordBoost", dauntlessshield: "shieldBoost", supersweetsyrup: "syrupTriggered" }[once];
    p[flag] = true;
  }
  // Struggle (T2E TR09): every slot at 0 PP, so the choice is Struggle (sim/side.ts chooseMove: no moves with PP).
  if (m.action.move !== null && toID(m.action.move) === "struggle") for (const s of p.moveSlots) s.pp = 0;
  // ---- status2 wave 1b (Track V2; ADDENDUM2 §3.1's CL and PR fields, §7.1) ----
  // Uproar from an earlier turn: the volatile with its turns left (moves.ts uproar condition duration 3, onLockMove).
  if (carried.uproar) add("uproar").duration = carried.uproar;
  // Fury Cutter: n uses in a row ending last turn leave the volatile at multiplier min(4, 2^(n-1)), one turn left (moves.ts
  // furycutter condition duration 2, onRestart doubles to 4).
  if (carried.furyCutter) {
    const state = add("furycutter");
    state.multiplier = Math.min(4, 2 ** (carried.furyCutter - 1));
    state.duration = 1;
  }
  // Rollout / Ice Ball: the lock's hits so far (moves.ts rollout condition: hitCount, contactHitCount; duration 2 after a hit).
  if (carried.rollout) {
    const id = toID(m.action.move ?? "rollout") === "iceball" ? "iceball" : "rollout";
    const state = add(id);
    state.hitCount = carried.rollout;
    state.contactHitCount = carried.rollout;
    state.duration = 1;
    const target = m.action.target;
    if (target) p.lastMoveTargetLoc = targetLoc(slot, target);
  }
  if (carried.defenseCurl) add("defensecurl");
  // PP left before this turn's use (the use deducts one: Trump Card reads the slot after it).
  for (const [name, pp] of Object.entries(carried.ppLeft ?? {})) {
    const s = p.moveSlots.find((x: any) => x.id === toID(name));
    if (!s) throw new Error(`${c.id} ${slot}: no move slot ${name} for ppLeft`);
    s.pp = pp;
  }
  // A Bide from earlier turns (moves.ts bide condition: duration 3; it stores at duration 2 and releases at duration 1).
  if (carried.bide) {
    const state = add("bide");
    state.duration = carried.bide.release ? 1 : 2;
    state.totalDamage = carried.bide.stored;
    state.lastDamageSource = carried.bide.source ? monOf(b, carried.bide.source) : null;
  }
  // Cud Chew's Berry due now (abilities.ts cudchew: berry and counter 1 at this turn's start).
  if (typeof carried.cudChew === "string") {
    if (toID(m.ability) !== "cudchew") throw new Error(`${c.id} ${slot}: a Cud Chew Berry needs Cud Chew`);
    p.abilityState.berry = b.dex.items.get(toID(carried.cudChew));
    p.abilityState.counter = 1;
  }
  // The target of its last move (Instruct: lastMoveTargetLoc).
  if (m.lastMoveTarget !== undefined) p.lastMoveTargetLoc = m.lastMoveTarget === null ? 0 : targetLoc(slot, m.lastMoveTarget);
}
/** status2 wave 1b: the futuremove slot condition as Future Sight's / Doom Desire's onTry leaves it, landing now (T2E probes-1 land()). */
const LANDING_DATA = {
  futuresight: { id: "futuresight", name: "Future Sight", accuracy: 100, basePower: 120, category: "Special", priority: 0, flags: { allyanim: 1, metronome: 1, futuremove: 1 }, ignoreImmunity: false, effectType: "Move", type: "Psychic" },
  doomdesire: { id: "doomdesire", name: "Doom Desire", accuracy: 100, basePower: 140, category: "Special", priority: 0, flags: { metronome: 1, futuremove: 1 }, effectType: "Move", type: "Steel" },
} as const;
function land(b: any, target: any, source: any, move: "futuresight" | "doomdesire") {
  target.side.addSlotCondition(target, "futuremove", source);
  const st = target.side.slotConditions[target.position].futuremove;
  if (!st) throw new Error("Showdown refused the futuremove slot condition");
  Object.assign(st, { move, source, moveData: { ...LANDING_DATA[move], flags: { ...LANDING_DATA[move].flags } } });
  st.endingTurn = 0;
}
/** The bench Pokémon a landing's user is (CaseCarried.futureMove.bench), by side. */
function landingBench(c: Case, side: SideKey): { slot: SlotId; mon: CaseMon }[] {
  return SLOTS.flatMap((slot) => {
    const fm = c.slots[slot].carried?.futureMove;
    return fm && typeof fm === "object" && "bench" in fm && fm.benchSide === side ? [{ slot, mon: fm.bench }] : [];
  });
}
/** A foe in the case (the source of a carried volatile whose source does not matter). */
function foeOf(b: any, c: Case, slot: SlotId) {
  return SLOTS.filter((s) => SIDE_OF[s] !== SIDE_OF[slot] && !c.slots[s].absent).map((s) => monOf(b, s))[0] ?? null;
}

/** The Pokémon a slot's case sets up: the active one, or a switch-in's on the bench (status2 Step 1 #14). */
function startMon(b: any, c: Case, slot: SlotId) {
  return c.slots[slot].action.switchIn ? b.sides[SD[slot].side].pokemon.find((p: any) => p.m.caseSlot === slot) : pokemonAt(b, slot);
}

/** A started battle at turn 1 with the case's start state applied; warnings where Showdown's start differs from the case. */
export function prepare(c: Case, hidden: Hidden = hiddenCases(c)[0].hidden, opts: { keepEntryFlags?: boolean; startChooser?: Chooser } = {}) {
  const format = c.format ?? DOUBLES_FORMAT[c.game];
  const b = new Battle({ formatid: format, seed: [1, 2, 3, 4] });
  // status2 wave 1b (Case.startRandom): the start's random events (Trace's sample, a Speed tie's shuffle) follow the chooser,
  // so prepareAll() enumerates every start path; the overrides go once the leads are in.
  if (opts.startChooser) installStart(b, opts.startChooser);
  // status2 (Case.bench): the bench Pokémon's ability (its status is set below, directly).
  const bench = (side: SideKey) => [
    // status2 wave 1b: a landing's user not in battle (CaseCarried.futureMove.bench) is on its side's bench.
    ...landingBench(c, side).map(({ slot, mon }) => sdSet(mon, null, `Lander ${SLOTS.indexOf(slot)}`)),
    ...(c.canSwitch?.[side] === false ? [] : [sdSet({ ...BENCH, ...(c.bench?.[side]?.ability ? { ability: c.bench[side]!.ability! } : {}) }, null, "Bench")]),
  ];
  // status2 Step 1 #14 (T2E §4.7.5): a switch-in slot starts with a Splash placeholder (its Speed apart from the others') and
  // the case's Pokémon behind it on the bench, ahead of the bench Snorlax; its turn-1 choice is the switch (choice()).
  const placeholder = (slot: SlotId) => sdSet({ species: "Snorlax", ability: "Thick Fat", evs: { spe: SLOTS.indexOf(slot) * 4 + 2 } }, null, `Placeholder ${SLOTS.indexOf(slot)}`);
  const team = (slots: SlotId[], side: SideKey) => [
    ...slots.map((slot) => (c.slots[slot].action.switchIn ? placeholder(slot) : sdSet(c.slots[slot], c.slots[slot].action.move, c.slots[slot].species))),
    ...slots.filter((slot) => c.slots[slot].action.switchIn).map((slot) => sdSet(c.slots[slot], null, c.slots[slot].species)),
    ...bench(side),
  ];
  b.setPlayer("p1", { team: team(["own-left", "own-right"], "own") });
  b.setPlayer("p2", { team: team(["opponent-right", "opponent-left"], "opponent") });
  if (b.requestState === "teampreview") {
    const order = (n: number) => `team ${Array.from({ length: n }, (_, i) => i + 1).join("")}`;
    b.makeChoices(order(b.sides[0].pokemon.length), order(b.sides[1].pokemon.length));
  }
  if (opts.startChooser) for (const key of ["sample", "random", "randomChance"]) delete b[key];
  if (opts.startChooser) delete b.prng.shuffle;
  for (const side of b.sides) for (const p of side.pokemon) p.m.caseSlot = null;
  for (const slot of SLOTS) {
    if (!c.slots[slot].action.switchIn) { pokemonAt(b, slot).m.caseSlot = slot; continue; }
    // The switch-in's Pokémon (by its set name) carries the slot it takes this turn.
    const newcomer = b.sides[SD[slot].side].pokemon.find((p: any) => !p.isActive && p.name === c.slots[slot].species);
    if (!newcomer) throw new Error(`${c.id} ${slot}: no bench Pokémon to switch in`);
    newcomer.m.caseSlot = slot;
    newcomer.m.pendingSwitchIn = slot;
  }
  const warnings: string[] = [];
  const f = c.field ?? {};
  if (f.weather) b.field.setWeather(WEATHER[f.weather], "debug");
  if (f.terrain) b.field.setTerrain(TERRAIN[f.terrain], "debug");
  if (c.weatherTurns !== undefined) b.field.weatherState.duration = c.weatherTurns;
  for (const [flag, id] of [["trickRoom", "trickroom"], ["gravity", "gravity"], ["wonderRoom", "wonderroom"], ["magicRoom", "magicroom"]] as const) {
    if (f[flag]) b.field.addPseudoWeather(id, "debug");
  }
  for (const [i, side] of [f.own, f.opponent].entries()) {
    for (const [flag, id] of [["tailwind", "tailwind"], ["reflect", "reflect"], ["lightScreen", "lightscreen"], ["auroraVeil", "auroraveil"]] as const) {
      if (side?.[flag]) b.sides[i].addSideCondition(id, "debug");
    }
    // status2 Step 1 #7: pre-turn hazards (the leads are in already, so none hurts anyone at the start).
    for (const id of side?.hazards ?? []) b.sides[i].addSideCondition(id, "debug");
    // status2 (SPEC2 §3.2 SideConditions): Safeguard, Mist, Lucky Chant from an earlier turn.
    for (const [flag, id] of [["safeguard", "safeguard"], ["mist", "mist"], ["luckyChant", "luckychant"]] as const) {
      if (side?.[flag] && !b.sides[i].addSideCondition(id, "debug")) throw new Error(`${c.id}: Showdown refused ${id} on side ${i + 1}`);
    }
  }
  // status2 (USUM): Mud Sport and Water Sport from an earlier turn.
  for (const [flag, id] of [["mudSport", "mudsport"], ["waterSport", "watersport"]] as const) {
    if (f[flag] && !b.field.addPseudoWeather(id, "debug")) throw new Error(`${c.id}: Showdown refused ${id}`);
  }
  // status2 (DoublesTurnInput.fieldTurns): the effect's duration before this turn's countdown.
  for (const [key, n] of Object.entries(c.fieldTurns ?? {}) as [string, number][]) {
    const state = key === "terrain" ? (b.field.terrain ? b.field.terrainState : null) : b.field.pseudoWeather[key === "magicRoom" ? "magicroom" : key];
    if (!state) throw new Error(`${c.id}: fieldTurns.${key} without the effect up`);
    state.duration = n;
  }
  // status2 (Case.bench): the bench Pokémon's status, set directly (setStatus refuses an inactive Pokémon: K43).
  for (const [i, key] of (["own", "opponent"] as const).entries()) {
    const status = c.bench?.[key]?.status;
    if (!status) continue;
    const benched = b.sides[i].pokemon.find((p: any) => p.name === "Bench");
    if (!benched) throw new Error(`${c.id}: no bench Pokémon on side ${i + 1}`);
    benched.status = status;
    benched.statusState = b.initEffectState({ id: status, target: benched });
  }
  for (const slot of SLOTS) {
    const m = c.slots[slot], p = startMon(b, c, slot);
    if (m.absent) continue;
    if (m.action.switchIn) {
      // A bench Pokémon: HP and status set directly (setStatus refuses an inactive Pokémon: K43); its stages and volatiles
      // start at 0 as it enters (appBoosts are the app input's after the switch's entry effects).
      if (m.action.move !== null) throw new Error(`${c.id} ${slot}: a switch-in takes no move`);
      const kept = Object.keys(m.carried ?? {}).filter((key) => !["sleep", "freeze", "toxic"].includes(key));
      if (kept.length || m.substitute !== undefined || m.lastMove !== undefined || m.charged) throw new Error(`${c.id} ${slot}: a switch-in keeps only its status counters`);
      if (Object.values(m.boosts ?? {}).some((stage) => stage)) throw new Error(`${c.id} ${slot}: a switch-in's stages start at 0`);
      if (m.hp !== undefined) p.sethp(m.hp);
      if (m.status) { p.status = m.status; p.statusState = b.initEffectState({ id: m.status, target: p }); }
      continue;
    }
    if (toID(p.species.name) !== toID(m.species) && toID(p.baseSpecies.name) !== toID(m.species)) warnings.push(`${slot}: Showdown species ${p.species.name}`);
    if (m.hp !== undefined) p.sethp(m.hp);
    if (m.status && m.silentStatus) { p.status = m.status; p.statusState = b.initEffectState({ id: m.status, target: p }); }
    else if (m.status) p.setStatus(m.status, null, null, true);
    for (const stat of c.keepStartBoosts ? [] : ["atk", "def", "spa", "spd", "spe"] as const) {
      const want = m.boosts?.[stat] ?? 0;
      if (p.boosts[stat] !== want) {
        if (m.boosts?.[stat] === undefined) warnings.push(`${slot}: Showdown ${stat} stage ${p.boosts[stat]} at the start, case 0 (set to 0)`);
        p.boosts[stat] = want;
      }
    }
    if (m.charged) p.addVolatile("charge");
    if (p.item !== toID(m.item ?? "")) warnings.push(`${slot}: Showdown item ${p.item || "(none)"} at the start, case ${m.item ?? "(none)"}`);
    // status2 wave 1a: types and the added type from an earlier turn, the last item, not its first turn, a used Protean.
    if (m.types) p.setType(m.types, true);
    if (m.addedType) p.addedType = m.addedType;
    if (m.lastItem !== undefined) p.lastItem = m.lastItem === null ? "" : toID(m.lastItem);
    if (m.firstTurn === false) p.activeMoveActions = 1;
    const ability = toID(m.ability);
    if ((ability === "protean" || ability === "libero") && m.appBuild?.abilityActive === false) p.abilityState[ability] = true;
  }
  for (const slot of SLOTS) if (!c.slots[slot].absent) applyCarried(b, c, slot, startMon(b, c, slot), hidden);
  // ---- status2 wave 1b (Track V2) ----
  // A Future Sight / Doom Desire landing at this end of turn on the slot (ADDENDUM2 C33): from a Pokémon of the turn, or from
  // its user on the bench (fainted on an earlier turn: 0 HP; Terastallized earlier: kept).
  for (const slot of SLOTS) {
    const fm = c.slots[slot].carried?.futureMove;
    if (!fm || typeof fm !== "object" || c.slots[slot].absent) continue;
    let source: any;
    if ("source" in fm) source = monOf(b, fm.source);
    else {
      source = b.sides[fm.benchSide === "own" ? 0 : 1].pokemon.find((x: any) => x.name === `Lander ${SLOTS.indexOf(slot)}`);
      if (!source) throw new Error(`${c.id} ${slot}: no bench landing user`);
      if (fm.terastallized) { source.terastallized = fm.terastallized; source.teraType = fm.terastallized; }
      if (fm.fainted) { source.hp = 0; source.fainted = true; source.side.pokemonLeft--; }
    }
    land(b, pokemonAt(b, slot), source, fm.move);
  }
  // The battle's last move (Copycat: battle.lastMove), a side's faint last turn (Retaliate: side.faintedLastTurn), Echoed
  // Voice from last turn (the echoedvoice pseudo-weather, one turn left, its multiplier).
  if (c.battleLastMove !== undefined) b.lastMove = c.battleLastMove === null ? null : b.dex.getActiveMove(toID(c.battleLastMove));
  for (const [i, key] of (["own", "opponent"] as const).entries()) {
    if (!c.faintedLastTurn?.[key]) continue;
    const side = b.sides[i];
    side.faintedLastTurn = side.pokemon.find((x: any) => !x.isActive) ?? side.pokemon[side.pokemon.length - 1];
  }
  if (c.echoedVoice) {
    if (!b.field.addPseudoWeather("echoedvoice")) throw new Error(`${c.id}: Showdown refused echoedvoice`);
    Object.assign(b.field.pseudoWeather.echoedvoice, { multiplier: c.echoedVoice, duration: 1 });
  }
  // G-Max damage over time on a side from an earlier turn (C28; the side condition, 3 turns left).
  for (const [i, key] of (["own", "opponent"] as const).entries()) {
    for (const id of f[key]?.gmaxResidual ?? []) {
      if (!b.sides[i].addSideCondition(id, "debug")) throw new Error(`${c.id}: Showdown refused ${id}`);
      b.sides[i].sideConditions[id].duration = 3;
    }
  }
  // status2 (DoublesTurnInput.entryOrder, IN §8): the active Pokémon's ability states re-made in rank order (smaller first:
  // the older state, which wins a redirection tie, sim/battle.ts compareRedirectOrder); unranked ones after, in the leads'
  // order p1a, p1b, p2a, p2b.
  if (c.entryOrder) {
    const leads: SlotId[] = ["own-left", "own-right", "opponent-right", "opponent-left"];
    const order = leads.filter((slot) => !c.slots[slot].absent)
      .map((slot, i) => ({ slot, rank: c.entryOrder![slot] ?? Infinity, i }))
      .sort((x, y) => x.rank - y.rank || x.i - y.i);
    for (const { slot } of order) startMon(b, c, slot).abilityState.effectOrder = b.effectOrder++;
  }
  // status2 Step 1 #11 (ADDENDUM2 C19, §7.1): the turn is "a turn after these Pokémon came in", as the app's is. Pinned
  // nextTurn resets statsRaisedThisTurn, statsLoweredThisTurn, usedItemThisTurn and hurtThisTurn only from turn 2
  // (sim/battle.ts:1670-1683), so on the oracle's turn 1 the leads' entry effects (Intimidate and the Defiant it sets off, an
  // entry Seed) would count as this turn's. They are cleared on every active Pokémon, then set where the case's
  // earlierThisTurn says (in a case with a switch-in, that switch's entry effects set them during the turn instead).
  const switching = SLOTS.some((slot) => c.slots[slot].action.switchIn);
  // `keepEntryFlags`: the flags as the leads' entry left them (status2/build/step1-c19-scan.ts lists the stored cases they reach).
  for (const slot of SLOTS) {
    if (c.slots[slot].absent || opts.keepEntryFlags) continue;
    const p = pokemonAt(b, slot), earlier = switching ? undefined : c.slots[slot].earlierThisTurn;
    p.statsRaisedThisTurn = !!earlier?.statsRaised;
    p.statsLoweredThisTurn = !!earlier?.statsLowered;
    p.usedItemThisTurn = !!earlier?.usedItem;
    p.hurtThisTurn = null;
  }
  // An empty slot: fainted before the turn, so it takes no action and the bench stays out until the turn ends (probe 1c).
  for (const slot of SLOTS) if (c.slots[slot].absent) pokemonAt(b, slot).faint();
  b.faintMessages();
  // Equal speeds at the start multiply the runs (every sort of actions and handlers shuffles them) even when the order cannot
  // matter, so cases keep the four apart unless the tie is what they test.
  const speeds = SLOTS.filter((slot) => !c.slots[slot].absent).map((slot) => [slot, pokemonAt(b, slot).getActionSpeed()] as const);
  for (const [i, [slot, speed]] of speeds.entries()) {
    for (const [other, otherSpeed] of speeds.slice(i + 1)) if (speed === otherSpeed) warnings.push(`speed tie at the start: ${slot} and ${other} (${speed})`);
  }
  if ((b.field.weather || "") !== (f.weather ? WEATHER[f.weather] : "")) warnings.push(`weather ${b.field.weather || "(none)"} at the start, case ${f.weather || "(none)"}`);
  if ((b.field.terrain || "") !== (f.terrain ? TERRAIN[f.terrain] : "")) warnings.push(`terrain ${b.field.terrain || "(none)"} at the start, case ${f.terrain || "(none)"}`);
  return { b, format, warnings, choices: [choice(b, c, "own-left") + ", " + choice(b, c, "own-right"), choice(b, c, "opponent-right") + ", " + choice(b, c, "opponent-left")] as [string, string] };
}
/** Every hidden-counter sub-case of the case, prepared, with its prior weight (one, weight 1, without hidden counters). */
export function prepareAll(c: Case) {
  if (!c.startRandom) return hiddenCases(c).map((h) => ({ ...prepare(c, h.hidden), weight: h.weight, label: h.label }));
  // status2 wave 1b: each start path of a random start is a sub-case too, with its probability.
  const out: (ReturnType<typeof prepare> & { weight: number; label: string })[] = [];
  for (const h of hiddenCases(c)) {
    let prefix: number[] | null = [];
    while (prefix) {
      const ch: Chooser = new Chooser(prefix, "all", {});
      const p = prepare(c, h.hidden, { startChooser: ch });
      out.push({ ...p, weight: h.weight * ch.weight, label: `${h.label ? `${h.label} ` : ""}start ${ch.trail.join(".") || "-"}` });
      prefix = ch.next();
    }
  }
  return out;
}
/** status2 wave 1b: the start's random events through a chooser (install()'s rules for sample, random, randomChance, shuffle). */
function installStart(b: any, ch: Chooser) {
  b.sample = function (items: readonly unknown[]) {
    if (items.length === 1) return items[0];
    return items[ch.pick("start-sample", Array(items.length).fill(1 / items.length))];
  };
  b.random = function (m?: number, n?: number) {
    if (m === undefined) throw new Error("random() without a range is not enumerated");
    const [lo, hi] = n === undefined ? [0, m] : [m, n];
    if (hi - lo <= 1) return lo;
    return lo + ch.pick("start-random", Array(hi - lo).fill(1 / (hi - lo)));
  };
  b.randomChance = function (k: number, d: number) {
    if (k <= 0) return false;
    if (k >= d) return true;
    return ch.pick("start-chance", [1 - k / d, k / d]) === 1;
  };
  b.prng.shuffle = function (list: unknown[], start = 0, end = list.length) {
    const k = end - start;
    if (k < 2) return;
    const perms = factorial(k);
    permute(list, start, end, ch.pick(`start-tie${k}`, Array(perms).fill(1 / perms)));
  };
}

export function choice(b: any, c: Case, slot: SlotId): string {
  const m = c.slots[slot], move = m.action.move;
  if (m.absent) return "pass";
  // status2 wave 1b (T2P §2.1): a commanding Tatsugiri chooses nothing (sim/side.ts getChoiceIndex auto-passes it).
  if (pokemonAt(b, slot)?.volatiles?.commanding) return "pass";
  // status2 Step 1 #14: the switch to the case's Pokémon on the bench (prepare()).
  if (m.action.switchIn) return `switch ${b.sides[SD[slot].side].pokemon.findIndex((p: any) => !p.isActive && p.m.caseSlot === slot) + 1}`;
  let text = "move 1";
  // status2: No move is Splash wherever it stands now (a Pokémon transformed at the lead has its target's slots).
  if (move === null) {
    const at = (pokemonAt(b, slot)?.moveSlots ?? []).findIndex((s: any) => s.id === "splash");
    if (at > 0) text = `move ${at + 1}`;
  }
  if (move !== null) {
    let target = m.action.target;
    const dexMove = b.dex.moves.get(move);
    if (!dexMove.exists) throw new Error(`${c.id} ${slot}: unknown move ${move}`);
    if (!target && dexMove.target === "adjacentAlly") target = SLOTS.find((s) => s !== slot && SD[s].side === SD[slot].side);
    // A non-Ghost Curse targets its user (data/moves.ts curse nonGhostTarget): Showdown refuses a chosen target for it.
    if (dexMove.nonGhostTarget && !pokemonAt(b, slot).hasType("Ghost")) target = undefined;
    // status2: a two-turn move charged last turn is locked (its target is the volatile's targetLoc, set by prepare()).
    if (m.carried?.charging) target = undefined;
    // status2 wave 1b: a move locked from an earlier turn (Rollout, Ice Ball, Uproar, Bide) takes no chosen target.
    if (m.carried?.rollout || m.carried?.uproar || m.carried?.bide) target = undefined;
    // status2 wave 1b: a random-target move (Uproar, Outrage, Petal Dance) takes none in Showdown (side.ts chooseMove).
    if (dexMove.target === "randomNormal") target = undefined;
    if (target) text += ` ${targetLoc(slot, target)}`;
    if (m.choice) text += ` ${m.choice}`;
  } else if (m.choice === "terastallize" || m.choice === "mega") {
    // No move (Splash) still Terastallizes or Mega Evolves as the turn starts, as the app's build mechanic does; a
    // Dynamaxed or Z-Powered Splash would be Max Guard or Z-Splash, so those stay plain.
    text += ` ${m.choice}`;
  }
  return text;
}

/** Serialized state with the log and other per-path noise blanked: the string is both the resume point and the merge key. */
function snapshot(b: any): string {
  const state = State.serializeBattle(b);
  state.log = [];
  state.sentLogPos = 0;
  state.lastMoveLine = -1;
  state.inputLog = [];
  state.messageLog = [];
  state.hints = [];
  return JSON.stringify(state);
}

class Chooser {
  trail: number[] = [];
  sizes: number[] = [];
  weight = 1;
  /** Decision counts of this run, the moves phase and the residual phase apart (merged by the walk after the run). */
  counts: Record<string, number> = {};
  resCounts: Record<string, number> = {};
  /** The residual phase started at this trail depth with this weight (null before it). */
  mark: number | null = null;
  weightAtMark = 1;
  constructor(readonly prefix: number[], readonly mode: Mode, readonly kinds: Record<string, number>, readonly rng?: () => number, readonly resRng?: () => number) {}
  count(kind: string) {
    const into = this.mark === null ? this.counts : this.resCounts;
    into[kind] = (into[kind] ?? 0) + 1;
  }
  startResidual() {
    this.mark = this.trail.length;
    this.weightAtMark = this.weight;
  }
  /** The moves part of the run is the one the old oracle ran: every residual decision at its first option. */
  firstVariant() {
    return this.mark === null || this.trail.slice(this.mark).every((i) => i === 0);
  }
  /** One decision among options with these weights (summing to 1). */
  pick(kind: string, weights: number[]): number {
    this.count(kind);
    if (weights.length === 1) return 0;
    let i = 0;
    const rng = this.mark === null ? this.rng : this.resRng;
    if (rng) {
      let u = rng();
      while (i < weights.length - 1 && u >= weights[i]) u -= weights[i++];
    } else {
      const depth = this.trail.length;
      i = depth < this.prefix.length ? this.prefix[depth] : 0;
    }
    this.trail.push(i);
    this.sizes.push(weights.length);
    this.weight *= weights[i];
    return i;
  }
  next(): number[] | null {
    if (this.rng) return null;
    for (let j = this.trail.length - 1; j >= 0; j--) {
      if (this.trail[j] + 1 < this.sizes[j]) return [...this.trail.slice(0, j), this.trail[j] + 1];
    }
    return null;
  }
}
const addCounts = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
};

/** The function that called the override (stack frame 3: Error, calledBy, the override, its caller). */
const calledBy = (name: string) => ((new Error().stack ?? "").split("\n")[3] ?? "").includes(name);
const inStack = (...names: string[]) => {
  const stack = new Error().stack ?? "";
  return names.some((name) => stack.includes(name));
};
function factorial(k: number) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return f;
}
/** The idx-th permutation (Lehmer code) of list[start..end). */
function permute(list: unknown[], start: number, end: number, idx: number) {
  const pool = list.slice(start, end);
  const out: unknown[] = [];
  for (let k = pool.length; k > 0; k--) {
    const f = factorial(k - 1);
    const j = Math.floor(idx / f);
    idx %= f;
    out.push(pool.splice(j, 1)[0]);
  }
  list.splice(start, end - start, ...out);
}
/**
 * randomChance calls that are random events of the turn, keyed by the effect running them. status-eot: Healer and Shed
 * Skin (the residual, SPEC §7 step 1) and Ally Switch's counter (ADDENDUM §7.1).
 */
const CHANCE_EFFECTS = new Set(["par", "quickclaw", "quickdraw", "confusion", "frz", "healer", "shedskin", "allyswitch",
  // status2 wave 1a (SPEC2 §7.1, ADDENDUM2 §7.1, T2M §5): Focus Band's 1/10 (items.ts focusband onDamage, every damage it
  // takes), the stall counter's roll (conditions.ts stall onStallMove), Harvest's 1/2 outside sun (abilities.ts harvest),
  // Attract's 1/2 at BeforeMove (moves.ts attract condition).
  "focusband", "stall", "harvest", "attract",
  // status2 wave 1b (Track V2): G-Max Replenish's one 1/2 for the whole move (moves.ts gmaxreplenish self.onHit).
  "gmaxreplenish"]);
/** status2 wave 1b: Magnitude's random(100) (moves.ts magnitude onModifyMove) by its seven bands of power (5/10/20/30/20/10/5 %). */
const MAGNITUDE_BANDS: [number, number][] = [[0, 5], [5, 15], [15, 35], [35, 65], [65, 85], [85, 95], [95, 100]];

function install(b: any, ch: Chooser, critical: boolean) {
  b.randomizer = function (base: number) {
    const outs = Array.from({ length: 16 }, (_, i) => this.trunc(this.trunc(base * (85 + i)) / 100));
    if (ch.mode === "lowest") return ch.count("roll"), outs[0];
    if (ch.mode === "highest") return ch.count("roll"), outs[15];
    const values = [...new Set(outs)];
    return values[ch.pick("roll", values.map((v) => outs.filter((o) => o === v).length / 16))];
  };
  b.random = function (m?: number, n?: number) {
    if (m === undefined) throw new Error("random() without a range is not enumerated");
    if (m === 100 && n === undefined && this.effect?.id === "magnitude") {
      return MAGNITUDE_BANDS[ch.pick("magnitude", MAGNITUDE_BANDS.map(([a, z]) => (z - a) / 100))][0];
    }
    if (m === 100 && n === undefined) return ch.count("secondary"), 99;
    const [lo, hi] = n === undefined ? [0, m] : [m, n];
    if (hi - lo <= 1) return lo;
    const hitCount = calledBy("hitStepMoveHitLoop");
    if (hitCount && ch.mode !== "all") {
      ch.count("hits");
      // 5 - random(2) (Loaded Dice) and 10 - random(7) (Population Bomb) count down; random(a, b + 1) counts up.
      const fewest = n === undefined ? hi - 1 : lo, most = n === undefined ? lo : hi - 1;
      return ch.mode === "lowest" ? fewest : most;
    }
    const size = hi - lo;
    return lo + ch.pick(hitCount ? "hits" : "random", Array(size).fill(1 / size));
  };
  b.randomChance = function (n: number, d: number) {
    if (this.forceRandomChance !== null && this.forceRandomChance !== undefined) return this.forceRandomChance;
    if (n <= 0) return false;
    if (n >= d) return true;
    // status2 wave 1b: G-Max Replenish's self.onHit runs with no effect set (this.effect is empty): its move names it.
    const id = this.effect?.id || (this.activeMove?.id === "gmaxreplenish" && n === 1 && d === 2 && calledBy("onHit") ? "gmaxreplenish" : undefined);
    if (CHANCE_EFFECTS.has(id)) return ch.pick(`chance:${id}`, [1 - n / d, n / d]) === 1;
    if (d === 100 && inStack("hitStepAccuracy", "hitStepMoveHitLoop")) return ch.count("accuracy"), true;
    ch.count(`fail:${id ?? "?"}`);
    return false;
  };
  b.sample = function (items: readonly unknown[]) {
    if (items.length === 1) return items[0];
    if (calledBy("hitStepMoveHitLoop") && items.every((x) => typeof x === "number")) {
      const nums = items as number[];
      if (ch.mode !== "all") return ch.count("hits"), ch.mode === "lowest" ? Math.min(...nums) : Math.max(...nums);
      const values = [...new Set(nums)];
      return values[ch.pick("hits", values.map((v) => nums.filter((x) => x === v).length / nums.length))];
    }
    return items[ch.pick("sample", Array(items.length).fill(1 / items.length))];
  };
  b.prng.shuffle = function (list: unknown[], start = 0, end = list.length) {
    const k = end - start;
    if (k < 2) return;
    const perms = factorial(k);
    permute(list, start, end, ch.pick(`tie${k}`, Array(perms).fill(1 / perms)));
  };
  // status2 wave 1b (T2P §3.13): Instruct's prioritised action (moves.ts instruct onHit) is the target's second use.
  const prio = b.queue.prioritizeAction;
  b.queue.prioritizeAction = function (action: any, sourceEffect?: any) {
    if (b.activeMove?.id === "instruct" && action && !action.v2copied) {
      action.v2copied = "Instruct";
      action.v2source = b.activePokemon ? slotOf(b.activePokemon) : null;
    }
    return prio.call(this, action, sourceEffect);
  };
  if (critical) {
    const gd = b.actions.getDamage;
    b.actions.getDamage = function (s: any, t: any, m: any, sup?: boolean) {
      if (typeof m === "object" && m && m.willCrit === undefined) m.willCrit = true;
      return gd.call(this, s, t, m, sup);
    };
  }
}

// ---------- Log lines as stable keys (status-eot SPEC §7 step 4) ----------

/** p1a/p1b/p2a/p2b → the slot of the Pokémon standing there (identity), from the battle. */
type PosMap = Record<string, SlotId | null>;
function posMapOf(b: any): PosMap {
  const out: PosMap = {};
  for (const [i, side] of b.sides.entries()) {
    for (const [pos, p] of side.active.entries()) out[`p${i + 1}${pos ? "b" : "a"}`] = p ? slotOf(p) : null;
  }
  return out;
}
const effectName = (text: string) => text.replace(/^(move|item|ability): /, "");
const eid = (text: string) => toID(effectName(text));
/** The secret (exact-HP) lines of a log slice, keeping the index of each in `lines`. */
function secretLines(lines: string[]): { line: string; index: number }[] {
  const out: { line: string; index: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("|split|")) {
      if (i + 1 < lines.length) out.push({ line: lines[i + 1], index: i + 1 });
      i += 2;
      continue;
    }
    out.push({ line: lines[i], index: i });
  }
  return out;
}
const hpOfText = (text: string | undefined): number | null => {
  if (!text) return null;
  if (/^0 fnt/.test(text) || text === "0") return 0;
  const m = /^(\d+)\/(\d+)/.exec(text);
  return m ? Number(m[1]) : null;
};
type ParsedLine = {
  /** The Pokémon the line is about (by identity), null for a side or field line. */
  slot: SlotId | null;
  /** "own" / "opponent" / "field" for side and field lines. */
  scope?: SideKey | "field";
  key: string;
  /** HP lines: the HP after it and the change. */
  hp?: number; delta?: number;
  from: string | null; of: SlotId | null;
};
/** Parses one action's (or the residual's) lines, tracking positions (|swap|) and each Pokémon's HP from its secret lines. */
function parseLines(lines: string[], pos: PosMap, hp: Record<SlotId, number>): (ParsedLine & { index: number })[] {
  const out: (ParsedLine & { index: number })[] = [];
  const identSlot = (text: string | undefined): SlotId | null => {
    const m = text ? /^(p[12][ab])(: |$)/.exec(text) : null;
    return m ? pos[m[1]] ?? null : null;
  };
  const sideOf = (text: string | undefined): SideKey | null => (text?.startsWith("p1") ? "own" : text?.startsWith("p2") ? "opponent" : null);
  for (const { line, index } of secretLines(lines)) {
    const parts = line.split("|");
    const type = parts[1];
    if (!type || type === "debug" || type === "" || type === "t:" || type === "upkeep") continue;
    const fromPart = parts.find((x) => x.startsWith("[from] "));
    const from = fromPart ? fromPart.slice(7) : null;
    const ofPart = parts.find((x) => x.startsWith("[of] "));
    const of = ofPart ? identSlot(ofPart.slice(5)) : null;
    const slot = identSlot(parts[2]);
    const push = (p: ParsedLine) => out.push({ ...p, index });
    const tail = (i: number) => (parts[i] && !parts[i].startsWith("[") ? `:${eid(parts[i])}` : "");
    switch (type) {
      case "-damage": case "-heal": case "-sethp": {
        if (!slot) break;
        const now = hpOfText(parts[3]);
        if (now === null) break;
        const delta = now - (hp[slot] ?? now);
        hp[slot] = now;
        const silent = parts.includes("[silent]");
        push({ slot, key: `${type.slice(1)}${from ? `:${eid(from)}` : silent ? ":silent" : ""}:${delta}`, hp: now, delta, from, of });
        break;
      }
      case "-status": if (slot) push({ slot, key: `status:${parts[3]}`, from, of }); break;
      case "-curestatus": if (slot) push({ slot, key: `curestatus:${parts[3]}`, from, of }); break;
      case "-start": if (slot) push({ slot, key: `start:${eid(parts[3])}`, from, of }); break;
      case "-end": if (slot) push({ slot, key: `end:${eid(parts[3])}`, from, of }); break;
      case "-boost": case "-unboost":
        if (slot) push({ slot, key: `boost:${parts[3]}:${type === "-unboost" ? -Number(parts[4]) : Number(parts[4])}`, from, of });
        break;
      case "-setboost": if (slot) push({ slot, key: `setboost:${parts[3]}:${parts[4]}`, from, of }); break;
      case "-activate": if (slot) push({ slot, key: `activate:${eid(parts[3] ?? "")}${parts.includes("[damage]") ? ":damage" : ""}`, from, of }); break;
      case "-immune": if (slot) push({ slot, key: `immune${from ? `:${eid(from)}` : ""}`, from, of }); break;
      case "-fail": if (slot) push({ slot, key: `fail${tail(3)}${from ? `:${eid(from)}` : ""}`, from, of }); break;
      case "-block": if (slot) push({ slot, key: `block${tail(3)}`, from, of }); break;
      case "-miss": if (slot) push({ slot, key: "miss", from, of }); break;
      case "cant": if (slot) push({ slot, key: `cant:${eid(parts[3] ?? "")}`, from, of }); break;
      case "-item": if (slot) push({ slot, key: `item:${eid(parts[3] ?? "")}`, from, of }); break;
      case "-enditem": if (slot) push({ slot, key: `enditem:${eid(parts[3] ?? "")}${parts.includes("[eat]") ? ":eat" : ""}`, from, of }); break;
      case "-ability": if (slot) push({ slot, key: `ability:${eid(parts[3] ?? "")}`, from, of }); break;
      case "-singleturn": if (slot) push({ slot, key: `singleturn:${eid(parts[3] ?? "")}`, from, of }); break;
      case "-singlemove": if (slot) push({ slot, key: `singlemove:${eid(parts[3] ?? "")}`, from, of }); break;
      case "-formechange": case "detailschange": if (slot) push({ slot, key: `forme:${toID((parts[3] ?? "").split(",")[0])}`, from, of }); break;
      case "-prepare": if (slot) push({ slot, key: `prepare:${eid(parts[3] ?? "")}`, from, of }); break;
      case "-hitcount": if (slot) push({ slot, key: `hitcount:${parts[3]}`, from, of }); break;
      case "faint": if (slot) push({ slot, key: "faint", from, of }); break;
      case "move": if (slot) push({ slot, key: `usedmove:${eid(parts[3] ?? "")}${from ? `:${eid(from)}` : ""}`, from, of }); break;
      case "swap": {
        const side = sideOf(parts[2]);
        if (!side) break;
        const n = side === "own" ? "p1" : "p2";
        for (const s of [pos[`${n}a`], pos[`${n}b`]]) if (s) push({ slot: s, key: "swap", from, of });
        [pos[`${n}a`], pos[`${n}b`]] = [pos[`${n}b`], pos[`${n}a`]];
        break;
      }
      case "-sidestart": case "-sideend": case "-swapsideconditions": {
        const side = sideOf(parts[2]);
        if (side) push({ slot: null, scope: side, key: `${type.slice(1)}${tail(3)}`, from, of });
        break;
      }
      case "-fieldstart": case "-fieldend": case "-weather": case "-clearallboost": case "-fieldactivate":
        push({ slot: null, scope: "field", key: `${type.slice(1)}${tail(2)}`, from, of });
        break;
      case "-supereffective": case "-resisted": case "-crit": case "-anim": case "-hint": case "-message": case "-nothing":
      case "-notarget": case "-center": case "-combine": case "-waiting": case "-zpower": case "-mustrecharge":
        if (slot && type === "-crit") push({ slot, key: "crit", from, of });
        break;
      default:
        if (type.startsWith("-") && slot) push({ slot, key: type.slice(1), from, of });
    }
  }
  return out;
}

/** What `p` is now, for the per-slot mixtures (status-eot SlotResult fields; status2's from `types`). */
type MonState = {
  hp: number; max: number; status: string; volatiles: string[]; boosts: string[]; item: string; sub: number | null;
  timesAttacked: number; perish: number | null; sleepTime: number | null; toxicStage: number | null; swapped: boolean; switchFlag: boolean;
  types: string; ability: string; forme: string; stored: string; weight: string; stockpile: string | null; lastItem: string;
  durations: string[]; pendingCopy: string | null; berryLocked: boolean;
  // status2 wave 1b (V2): E2's charging, Cud Chew, once-a-battle flags, Chi Strike layers.
  charging: string | null; cudChew: string | null; onceUsed: string | null; chiStrike: string | null;
};
/** status2: the volatiles whose turns left E2 reports (DoublesOutcomeMon.turnsLeft). */
const COUNTED_VOLATILES = ["healblock", "embargo", "telekinesis", "taunt", "encore", "disable", "uproar"];
/** One-turn markers and counters that say nothing about the next turn (left out of SlotResult.volatiles). */
const NOISE_VOLATILES = new Set(["stall", "flinch", "helpinghand", "followme", "ragepowder", "spotlight", "protect", "endure", "roost", "destinybond",
  "quickguard", "wideguard", "craftyshield", "matblock", "maxguard", "obstruct", "kingsshield", "spikyshield", "banefulbunker", "silktrap",
  "burningbulwark", "detect", "magiccoat", "snatch", "electrify", "powder", "laserfocus", "throatchop", "charge"]);
// status2: glaiverush left the list (E2 carries it: DoublesOutcomeMon.volatiles, SPEC2 §3.1).
function stateOf(b: any, slot: SlotId): MonState {
  const p = monOf(b, slot);
  const st = p?.statusState ?? {};
  return {
    hp: hpOf(p), max: p?.maxhp ?? 0, status: p?.status ?? "",
    // status2: a transformed Pokémon (pokemon.ts transformInto sets `transformed`, no volatile) is E2's "transform".
    volatiles: [...Object.keys(p?.volatiles ?? {}).filter((v) => !NOISE_VOLATILES.has(v)), ...(p?.transformed ? ["transform"] : [])].sort(),
    boosts: Object.entries(p?.boosts ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`),
    item: p?.item ?? "", sub: p?.volatiles?.substitute ? p.volatiles.substitute.hp : null, timesAttacked: p?.timesAttacked ?? 0,
    perish: p?.volatiles?.perishsong ? p.volatiles.perishsong.duration : null,
    sleepTime: p?.status === "slp" ? st.time : null, toxicStage: p?.status === "tox" ? st.stage : null,
    swapped: !!p && p.position !== SD[slot].position, switchFlag: !!p?.switchFlag,
    types: p ? p.getTypes().join("/") : "", ability: p?.ability ?? "", forme: p?.species?.id ?? "",
    stored: p ? ["atk", "def", "spa", "spd", "spe"].map((k) => p.storedStats[k]).join("/") : "", weight: String(p?.weighthg ?? ""),
    stockpile: p?.volatiles?.stockpile ? `${p.volatiles.stockpile.layers}:${p.volatiles.stockpile.def}:${p.volatiles.stockpile.spd}` : null,
    lastItem: p?.lastItem ?? "",
    durations: COUNTED_VOLATILES.filter((v) => p?.volatiles?.[v]).map((v) => `${v}:${p.volatiles[v].duration ?? "-"}`),
    pendingCopy: pendingCopyOf(p), berryLocked: p?.abilityState?.checkedBerserk === false || p?.abilityState?.checkedAngerShell === false,
    charging: p?.volatiles?.twoturnmove ? String(p.volatiles.twoturnmove.move ?? "") : null,
    cudChew: p?.abilityState?.berry && toID(p.ability ?? "") === "cudchew" ? `${p.abilityState.berry.id}:${p.abilityState.counter ?? "-"}` : null,
    onceUsed: onceUsedOf(p), chiStrike: p?.volatiles?.gmaxchistrike ? String(p.volatiles.gmaxchistrike.layers ?? "-") : null,
  };
}
/** status2 wave 1b: generation 9's once-a-battle flags (E2 onceUsed), null when none. */
function onceUsedOf(p: any): string | null {
  if (!p) return null;
  const had = [["battlebond", p.bondTriggered], ["intrepidsword", p.swordBoost], ["dauntlessshield", p.shieldBoost], ["supersweetsyrup", p.syrupTriggered]].filter(([, v]) => v).map(([k]) => k);
  return had.length ? had.join(",") : null;
}
/** An Opportunist or Mirror Herb copy still pending ("atk:1,spe:1"), null when none. */
function pendingCopyOf(p: any): string | null {
  const boosts = p?.abilityState?.boosts ?? (p?.itemState?.ready ? p.itemState.boosts : null);
  if (!boosts) return null;
  const parts = Object.entries(boosts).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).sort();
  return parts.length ? parts.join(",") : null;
}
function statesOf(b: any): Record<SlotId, MonState> {
  return Object.fromEntries(SLOTS.map((slot) => [slot, stateOf(b, slot)])) as Record<SlotId, MonState>;
}
/** The side conditions standing on each side (hazards, Safeguard, screens...). */
function sideConditionsOf(b: any): Record<SideKey, string[]> {
  return { own: Object.keys(b.sides[0].sideConditions).sort(), opponent: Object.keys(b.sides[1].sideConditions).sort() };
}

type ActionRec = {
  slot: SlotId; moveId: string; pos: number; faintedAtPick: boolean; moved: boolean; cant: string | null;
  reached: Set<SlotId>; landed: Set<SlotId>; dmg: Map<SlotId, number>; kos: SlotId[]; lines: string[]; effective: string | null;
  /** Targets whose knockout stopped a multi-hit move before its planned last hit (sim/battle-actions.ts:890-895 move.lastHit). */
  truncated: Set<SlotId>;
  /** status-eot: the lines on each Pokémon as keys, its HP change, the side lines, its Substitute's loss. */
  effects: Map<SlotId, Set<string>>; change: Map<SlotId, number>; sides: Map<SideKey | "field", Set<string>>;
  sub: Map<SlotId, { taken: number; broke: boolean }>;
  /** A No-move (Splash) action: only its lines are kept (WalkResult.noMove: a confusion self-hit, Gravity, Taunt). */
  pass?: true;
  /** The HP the move's own lines changed per Pokémon (no item, ability or confusion line): a status move's DoublesHit.change. */
  moveChange: Map<SlotId, number>;
  /** Its raw confusion self-hit damage (getConfusionDamage), when it hurt itself. */
  selfHit: number | null;
  /** status2 wave 1b: a Dancer's copy (inside the dance's action) or an instructed move (its own queue action). */
  copied?: "Dancer" | "Instruct";
  /** The slot of the Pokémon whose dance it copies (or whose Instruct made it). */
  source?: SlotId;
};
type Ctx = { c: Case; pass: Set<SlotId>; absent: Set<SlotId>; totalMoves: number; critical: boolean; switching: Set<SlotId>; commanding?: Set<SlotId> };

const hpOf = (p: any) => (p.fainted || !p.hp ? 0 : p.hp);
function hpNow(b: any): Record<SlotId, number> {
  return Object.fromEntries(SLOTS.map((slot) => [slot, hpOf(monOf(b, slot))])) as Record<SlotId, number>;
}
function maxNow(b: any): Record<SlotId, number> {
  return Object.fromEntries(SLOTS.map((slot) => [slot, monOf(b, slot).maxhp])) as Record<SlotId, number>;
}
function subNow(b: any): Record<SlotId, number | null> {
  return Object.fromEntries(SLOTS.map((slot) => [slot, monOf(b, slot)?.volatiles?.substitute ? monOf(b, slot).volatiles.substitute.hp : null])) as Record<SlotId, number | null>;
}

/** Records each move action of a run: picks, |move| and |cant| lines, the targets its hit steps met, damage and KOs. */
class Recorder {
  recs: ActionRec[] = [];
  current: (ActionRec & { hpBefore: Record<SlotId, number>; logStart: number; ident: string; posBefore: PosMap; subBefore: Record<SlotId, number | null>;
    /** status2 wave 1b: where a Dancer's first copy began (the action's own record ends there). */
    frozen?: { log: number; hp: Record<SlotId, number>; sub: Record<SlotId, number | null> } }) | null = null;
  firstMoveHP: { hp: Record<SlotId, number>; max: Record<SlotId, number> } | null = null;
  constructor(readonly b: any, readonly ctx: Ctx) {
    const rec = this;
    const acts = b.actions;
    const inv = acts.hitStepInvulnerabilityEvent;
    acts.hitStepInvulnerabilityEvent = function (targets: any[], pokemon: any, move: any) {
      for (const t of targets) { const s = slotOf(t); if (s && rec.current) rec.current.reached.add(s); }
      return inv.call(this, targets, pokemon, move);
    };
    const loop = acts.hitStepMoveHitLoop;
    acts.hitStepMoveHitLoop = function (targets: any[], pokemon: any, move: any) {
      for (const t of targets) { const s = slotOf(t); if (s && rec.current) rec.current.landed.add(s); }
      const out = loop.call(this, targets, pokemon, move);
      if (rec.current && move.multihit && !move.lastHit) for (const t of targets) { const s = slotOf(t); if (s && !t.hp) rec.current.truncated.add(s); }
      return out;
    };
    const gcd = acts.getConfusionDamage;
    acts.getConfusionDamage = function (p: any, basePower: number) {
      const out = gcd.call(this, p, basePower);
      if (rec.current && typeof out === "number") rec.current.selfHit = out;
      return out;
    };
    const gd = acts.getDamage;
    acts.getDamage = function (s: any, t: any, m: any, sup?: boolean) {
      const out = gd.call(this, s, t, m, sup);
      const slot = slotOf(t);
      // status2 wave 1b: a damage callback's fraction (Metal Burst, Comeuppance: damage × 1.5) is floored where it is dealt
      // (spreadDamage's clampIntRange): the recorded damage is the HP it takes.
      if (rec.current && slot && typeof out === "number") rec.current.dmg.set(slot, (rec.current.dmg.get(slot) ?? 0) + Math.floor(out));
      return out;
    };
    // status2 wave 1b (T2P §2.3): a Dancer's copy (battle-actions.ts runMove's dance block: runMove(…, { externalMove: true,
    // sourceEffect: Dancer })) is the Dancer's own record; the dance's record ends where the first copy starts.
    const runMove = acts.runMove;
    acts.runMove = function (moveOrId: any, pokemon: any, targetLoc: number, options?: any) {
      const outer = rec.current;
      const dancer = options?.externalMove && options?.sourceEffect?.id === "dancer" ? slotOf(pokemon) : null;
      if (!outer || !dancer) return runMove.call(this, moveOrId, pokemon, targetLoc, options);
      if (!outer.frozen) outer.frozen = { log: rec.b.log.length, hp: hpNow(rec.b), sub: subNow(rec.b) };
      rec.current = rec.open(dancer, toID(typeof moveOrId === "string" ? moveOrId : moveOrId.id), pokemon, "Dancer");
      rec.current.source = outer.slot;
      try {
        return runMove.call(this, moveOrId, pokemon, targetLoc, options);
      } finally {
        rec.close();
        rec.current = outer;
      }
    };
  }
  /** A record for one use by the Pokémon of `slot` (an action's, or a copy's). */
  open(slot: SlotId, moveId: string, pokemon: any, copied?: "Dancer" | "Instruct", pos = 0, pass = false, faintedAtPick = false) {
    return {
      slot, moveId, pos, ...(pass ? { pass: true as const } : {}), ...(copied ? { copied } : {}),
      faintedAtPick, moved: false, cant: null,
      reached: new Set<SlotId>(), landed: new Set<SlotId>(), dmg: new Map<SlotId, number>(), kos: [] as SlotId[], lines: [] as string[], effective: null, truncated: new Set<SlotId>(),
      effects: new Map(), change: new Map(), sides: new Map(), sub: new Map(), moveChange: new Map(), selfHit: null,
      hpBefore: hpNow(this.b), logStart: this.b.log.length,
      // The actor's log ident where it stands now (identity: a Pokémon keeps its slot after Ally Switch).
      ident: pokemon.getSlot(), posBefore: posMapOf(this.b), subBefore: subNow(this.b),
    } as NonNullable<Recorder["current"]>;
  }
  /** Called with the action just shifted from the queue. */
  begin(action: any) {
    this.finish();
    if (action.choice !== "move") return;
    const slot = slotOf(action.pokemon);
    if (!slot) return;
    const remainingMoves = this.b.queue.list.filter((a: any) => a.choice === "move").length;
    if (!this.firstMoveHP && remainingMoves === this.ctx.totalMoves - 1) this.firstMoveHP = { hp: hpNow(this.b), max: maxNow(this.b) };
    // status2 wave 1b: an instructed action (install() tags it) is a copied use; it takes no position.
    if (action.v2copied) {
      this.current = this.open(slot, toID(action.moveid ?? action.move?.id ?? ""), action.pokemon, action.v2copied, 0, false, !!action.pokemon.fainted || !action.pokemon.hp);
      this.current.source = action.v2source ?? undefined;
      return;
    }
    const pass = this.ctx.pass.has(slot);
    const remaining = this.b.queue.list.filter((a: any) => a.choice === "move" && !a.v2copied && !this.ctx.pass.has(slotOf(a.pokemon)!)).length;
    const nonPass = SLOTS.filter((s) => !this.ctx.pass.has(s) && !this.ctx.absent.has(s) && !this.ctx.switching.has(s) && !this.ctx.commanding?.has(s)).length;
    this.current = this.open(slot, pass ? "splash" : toID(this.ctx.c.slots[slot].action.move!), action.pokemon, undefined, nonPass - remaining, pass, !!action.pokemon.fainted || !action.pokemon.hp);
  }
  /** Ends a Dancer copy's record (the action's record goes on). */
  close() {
    const cur = this.current;
    this.current = null;
    if (cur) this.finishRec(cur);
  }
  finish() {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    this.finishRec(cur);
  }
  finishRec(cur: NonNullable<Recorder["current"]>) {
    // status2 wave 1b: an action whose dance was copied ends where the first copy started (frozen).
    const lines = this.b.log.slice(cur.logStart, cur.frozen?.log) as string[];
    const ident = cur.ident;
    const moveLine = lines.find((l) => l.startsWith(`|move|${ident}: `));
    // status2 wave 1b (C41): a Bide release has no |move| line (moves.ts bide onBeforeMove: '-end … move: Bide', then
    // tryMoveHit, then false): the use is its unsilenced -end line.
    const bideRelease = !moveLine && lines.some((l) => l.startsWith(`|-end|${ident}: `) && l.endsWith("|move: Bide"));
    cur.moved = !!moveLine || bideRelease;
    cur.effective = moveLine ? moveLine.split("|")[3] : bideRelease ? "Bide" : null;
    // tryMoveHit has no hit steps: the Pokémon its damage was computed for was reached and hit.
    if (bideRelease) for (const t of cur.dmg.keys()) { cur.reached.add(t); cur.landed.add(t); }
    const cant = lines.find((l) => l.startsWith(`|cant|${ident}: `));
    cur.cant = cant ? cant.split("|")[3] : null;
    const after = cur.frozen?.hp ?? hpNow(this.b);
    cur.kos = [...cur.reached].filter((s) => cur.hpBefore[s] > 0 && after[s] === 0);
    cur.lines = lines.filter((l) => /^\|(-fail|-activate|-immune|-miss|-block|cant|-enditem|-ability|-heal|-boost|-unboost|-start|-singleturn|-sidestart|-fieldstart|-weather|-status|-clearallboost)\||\[from\]|\[notarget\]|\[still\]/.test(l) && !/^\|debug\|/.test(l))
      .map((l) => l.replace(/\|\d+\/\d+( [a-z]+)?/g, "|hp").replace(/\|\[of\] /g, "|[of] "));
    // status-eot: the lines on each Pokémon (its own |move| line left out: `moved` says it), HP changes and Substitutes.
    const parsed = parseLines(lines, { ...cur.posBefore }, { ...cur.hpBefore });
    for (const p of parsed) {
      if (p.slot) {
        if (p.slot === cur.slot && p.key.startsWith("usedmove:") && !p.from) continue;
        let set = cur.effects.get(p.slot);
        if (!set) cur.effects.set(p.slot, set = new Set());
        set.add(p.key);
      } else if (p.scope) {
        let set = cur.sides.get(p.scope);
        if (!set) cur.sides.set(p.scope, set = new Set());
        set.add(p.key);
      }
    }
    for (const p of parsed) {
      if (!p.slot || p.delta === undefined) continue;
      if (p.from && /^(item|ability): |^confusion$/.test(p.from)) continue;
      if (p.key.startsWith("damage:confusion")) continue;
      cur.moveChange.set(p.slot, (cur.moveChange.get(p.slot) ?? 0) + p.delta);
    }
    for (const s of SLOTS) {
      const delta = after[s] - cur.hpBefore[s];
      if (delta !== 0 || cur.reached.has(s) || s === cur.slot) cur.change.set(s, delta);
    }
    const subAfter = cur.frozen?.sub ?? subNow(this.b);
    for (const s of SLOTS) {
      const before = cur.subBefore[s];
      if (before === null) continue;
      const now = subAfter[s];
      const broke = now === null && !!cur.effects.get(s)?.has("end:substitute");
      // Gone without its -end line: its holder fainted (faintMessages clears the volatiles), e.g. to a sound move that
      // passed it; no hit met it (status-eot integration, INT05).
      if (now === null && !broke) continue;
      const taken = before - (now ?? 0);
      if (taken > 0 || broke) cur.sub.set(s, { taken, broke });
    }
    this.recs.push(cur);
  }
}

/** The residual's lines by effect on each Pokémon, for one path (status-eot SPEC §7 step 1). */
type ResidualEntry = { slot: SlotId; effect: string; other: SlotId | null; amount: number | null; ko: boolean; facts: Set<string>; index: number; role: string };
type HandlerTag = { name: string; holder: SlotId | null } | null;
/** Wraps the residual fieldEvent's handlers so each log line knows the handler that wrote it. */
function tagResidualLines(b: any): HandlerTag[] {
  const tags: HandlerTag[] = [];
  let current: HandlerTag = null;
  let wrapNext = false;
  const fe = b.fieldEvent;
  b.fieldEvent = function (eventid: string, targets?: any[]) {
    if (eventid === "Residual") wrapNext = true;
    return fe.call(this, eventid, targets);
  };
  const ss = b.speedSort;
  b.speedSort = function (list: any[], comparator?: any) {
    ss.call(this, list, comparator);
    if (!wrapNext) return;
    wrapNext = false;
    for (const h of list) {
      const tag: HandlerTag = { name: h.effect?.name ?? h.effect?.id ?? "?", holder: slotOf(h.effectHolder) };
      for (const key of ["callback", "end"] as const) {
        const fn = h[key];
        if (typeof fn !== "function") continue;
        h[key] = function (this: any, ...args: any[]) {
          const outer = current;
          current = tag;
          try { return fn.apply(this, args); } finally { current = outer; }
        };
      }
    }
  };
  const add = b.add;
  b.add = function (...args: any[]) {
    const before = this.log.length;
    const out = add.apply(this, args);
    for (let i = before; i < this.log.length; i++) tags[i] = current;
    return out;
  };
  return tags;
}
function residualEntries(lines: string[], tags: HandlerTag[], logStart: number, pos: PosMap, hpStart: Record<SlotId, number>, hpEnd: Record<SlotId, number>): ResidualEntry[] {
  const hp = { ...hpStart };
  const parsed = parseLines(lines, pos, hp);
  const entries = new Map<string, ResidualEntry>();
  let lastLeechSeeded: SlotId | null = null;
  /** A line with no [from] and no residual handler (a faint's side effects: Soul-Heart's boost) takes its Pokémon's last effect. */
  const lastName = new Map<SlotId, string>();
  const now = { ...hpStart };
  for (const p of parsed) {
    if (!p.slot) continue;
    if (p.key === "faint") continue;
    const tag = tags[logStart + p.index] ?? null;
    const parts = lines[p.index].split("|");
    let name = p.from ? effectName(p.from)
      : ["-enditem", "-item", "-activate", "-ability"].includes(parts[1]) || /^(ability|item|move): /.test(parts[3] ?? "") ? effectName(parts[3] ?? "?")
      : tag?.name ?? lastName.get(p.slot) ?? "?";
    let other: SlotId | null = p.of ?? (tag?.holder && tag.holder !== p.slot ? tag.holder : null);
    if (p.key.startsWith("damage:leechseed")) lastLeechSeeded = p.slot;
    let role = "";
    if (p.key.startsWith("heal:silent") && tag?.name === "Leech Seed") {
      name = "Leech Seed";
      other = lastLeechSeeded;
      role = ":gain";
    }
    lastName.set(p.slot, name);
    const id = `${p.slot}|${name}|${other ?? ""}${role}`;
    let e = entries.get(id);
    if (!e) entries.set(id, e = { slot: p.slot, effect: name, other, amount: null, ko: false, facts: new Set(), index: p.index, role });
    if (p.delta !== undefined) {
      e.amount = (e.amount ?? 0) + p.delta;
      if (p.hp === 0 && p.delta < 0) e.ko = true;
      now[p.slot] = p.hp!;
    } else e.facts.add(p.key);
    // Perish Song's count 0 faints its holder with no HP line (moves.ts perishsong onEnd → faint()): its HP to 0.
    if (p.key === "start:perish0" && hpEnd[p.slot] === 0) {
      e.ko = true;
      e.amount = (e.amount ?? 0) - now[p.slot];
      now[p.slot] = 0;
    }
  }
  return [...entries.values()];
}

/** status2: the field's and sides' durations and the bench's statuses after the turn. */
type AfterExtra = { pseudo: string[]; sides: string[]; benchStatus: Record<SideKey, string | null> };
function afterExtra(b: any): AfterExtra {
  const pseudo = Object.entries(b.field.pseudoWeather).map(([id, st]: [string, any]) => `${id}:${st.duration ?? "-"}`);
  if (b.field.terrain) pseudo.push(`terrain:${b.field.terrain}:${b.field.terrainState.duration ?? "-"}`);
  if (b.field.weather) pseudo.push(`weather:${b.field.weather}:${b.field.weatherState.duration ?? "-"}`);
  const sides = (["own", "opponent"] as const).flatMap((key, i) => Object.entries(b.sides[i].sideConditions).map(([id, st]: [string, any]) => `${key}|${id}:${st.duration ?? "-"}`));
  const benchStatus = Object.fromEntries((["own", "opponent"] as const).map((key, i) => {
    const benched = b.sides[i].pokemon.find((p: any) => p.name === "Bench");
    return [key, benched ? benched.status || "" : null];
  })) as Record<SideKey, string | null>;
  return { pseudo: pseudo.sort(), sides: sides.sort(), benchStatus };
}

const STOP = { stop: true };
type SegmentEnd = {
  kind: "end"; hp: Record<SlotId, number>; max: Record<SlotId, number>; state: Record<SlotId, MonState>; sides: Record<SideKey, string[]>;
  /** After the whole turn; null: a switch request came after the last action, so there was no residual. */
  after: { state: Record<SlotId, MonState>; residuals: ResidualEntry[]; field: string[]; extra: AfterExtra } | null;
};
type SegmentOut = { recs: ActionRec[]; weightPath: number; firstMoveHP: Recorder["firstMoveHP"] } & ({ kind: "boundary"; json: string } | SegmentEnd);

function runSegment(json: string, first: boolean, choices: [string, string], ch: Chooser, ctx: Ctx, whole = false): SegmentOut {
  const b = State.deserializeBattle(json);
  install(b, ch, ctx.critical);
  const rec = new Recorder(b, ctx);
  let calls = 0;
  let out: SegmentOut | null = null;
  const ra = b.runAction;
  b.runAction = function (action: any) {
    calls++;
    const boundary = !whole && (first || calls === 2);
    if (action.choice === "residual" || boundary) {
      rec.finish();
      if (action.choice === "residual") {
        const end: SegmentEnd = { kind: "end", hp: hpNow(this), max: maxNow(this), state: statesOf(this), sides: sideConditionsOf(this), after: null };
        // status-eot: run the residual action (fieldEvent('Residual'), faints, the final Update, Emergency Exit) and read
        // the turn's end; its random events are decisions after the mark.
        ch.startResidual();
        const tags = tagResidualLines(this);
        const logStart = this.log.length;
        const pos = posMapOf(this);
        ra.call(this, action);
        const lines = this.log.slice(logStart) as string[];
        const hpEnd = hpNow(this);
        end.after = {
          state: statesOf(this), residuals: residualEntries(lines, tags, logStart, pos, end.hp, hpEnd),
          field: [`weather:${this.field.weather || ""}`, `terrain:${this.field.terrain || ""}`], extra: afterExtra(this),
        };
        out = { ...end, recs: rec.recs, weightPath: ch.weight, firstMoveHP: rec.firstMoveHP };
      } else {
        this.queue.list.unshift(action);
        out = { kind: "boundary", json: snapshot(this), recs: rec.recs, weightPath: ch.weight, firstMoveHP: rec.firstMoveHP };
        this.queue.list.shift();
      }
      throw STOP;
    }
    rec.begin(action);
    return ra.call(this, action);
  };
  try {
    if (first) {
      for (const [i, text] of choices.entries()) {
        if (!b.sides[i].choose(text)) throw new Error(`choice "${text}" for p${i + 1}: ${b.sides[i].choice.error}`);
      }
      b.commitChoices();
    } else {
      b.turnLoop();
    }
  } catch (e) {
    if (e !== STOP) throw e;
  }
  if (!out && b.requestState === "switch" && !b.queue.list.some((a: any) => a.choice === "move")) {
    // status-eot: a switch request after the last action (U-turn, Eject Button, Emergency Exit...): the moves are done,
    // the replacement comes in before the residual, so there is no end of turn to read (SPEC §2.3).
    rec.finish();
    out = { kind: "end", hp: hpNow(b), max: maxNow(b), state: statesOf(b), sides: sideConditionsOf(b), after: null, recs: rec.recs, weightPath: ch.weight, firstMoveHP: rec.firstMoveHP };
  }
  if (!out && b.ended) {
    // status-eot integration: a side with no Pokémon left was wiped out (checkWin after faintMessages): the battle ends, no
    // later action and no residual run, so the turn ends as the moves left it.
    rec.finish();
    out = {
      kind: "end", hp: hpNow(b), max: maxNow(b), state: statesOf(b), sides: sideConditionsOf(b),
      after: { state: statesOf(b), residuals: [], field: [`weather:${b.field.weather || ""}`, `terrain:${b.field.terrain || ""}`], extra: afterExtra(b) },
      recs: rec.recs, weightPath: ch.weight, firstMoveHP: rec.firstMoveHP,
    };
  }
  if (!out) throw new Error(`the turn stopped before the end of the moves (requestState "${b.requestState}", ended ${b.ended}): a mid-turn switch is not supported`);
  return out;
}

/** Per-slot state mixtures (status-eot SlotResult fields). */
class StateTally {
  status: Record<SlotId, Map<string, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  volatiles: Record<SlotId, Map<string, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  boosts: Record<SlotId, Map<string, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  item: Record<SlotId, Map<string, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  sub: Record<SlotId, Map<number, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  timesAttacked: Record<SlotId, Map<string, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  perish: Record<SlotId, Map<string, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  sleepTime: Record<SlotId, Map<string, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  toxicStage: Record<SlotId, Map<string, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  swapped: Record<SlotId, number> = Object.fromEntries(SLOTS.map((s) => [s, 0])) as any;
  switchFlag: Record<SlotId, number> = Object.fromEntries(SLOTS.map((s) => [s, 0])) as any;
  sideSwapped: Record<SideKey, number> = { own: 0, opponent: 0 };
  // status2 wave 1a.
  extra: Record<SlotId, Record<"types" | "ability" | "forme" | "stored" | "weight" | "stockpile" | "lastItem" | "durations" | "pendingCopy" | "charging" | "cudChew" | "onceUsed" | "chiStrike", Map<string, number>>> =
    Object.fromEntries(SLOTS.map((s) => [s, Object.fromEntries(["types", "ability", "forme", "stored", "weight", "stockpile", "lastItem", "durations", "pendingCopy", "charging", "cudChew", "onceUsed", "chiStrike"].map((k) => [k, new Map()]))])) as any;
  berryLocked: Record<SlotId, number> = Object.fromEntries(SLOTS.map((s) => [s, 0])) as any;
  add(states: Record<SlotId, MonState>, w: number, absent: Set<SlotId>) {
    const bump = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + w);
    const sideHit: Record<SideKey, boolean> = { own: false, opponent: false };
    for (const slot of SLOTS) {
      const s = states[slot];
      const x = this.extra[slot];
      bump(x.types, s.types); bump(x.ability, s.ability); bump(x.forme, s.forme); bump(x.stored, s.stored); bump(x.weight, s.weight);
      if (s.stockpile !== null) bump(x.stockpile, s.stockpile);
      bump(x.lastItem, s.lastItem);
      for (const d of s.durations) bump(x.durations, d);
      if (s.pendingCopy !== null) bump(x.pendingCopy, s.pendingCopy);
      // status2 wave 1b.
      if (s.charging !== null) bump(x.charging, s.charging);
      if (s.cudChew !== null) bump(x.cudChew, s.cudChew);
      if (s.onceUsed !== null) bump(x.onceUsed, s.onceUsed);
      if (s.chiStrike !== null) bump(x.chiStrike, s.chiStrike);
      if (s.berryLocked) this.berryLocked[slot] += w;
      bump(this.status[slot], s.status);
      for (const v of s.volatiles) bump(this.volatiles[slot], v);
      for (const k of s.boosts) bump(this.boosts[slot], k);
      bump(this.item[slot], s.item);
      if (s.sub !== null) bump(this.sub[slot], s.sub);
      bump(this.timesAttacked[slot], String(s.timesAttacked));
      if (s.perish !== null) bump(this.perish[slot], String(s.perish));
      if (s.sleepTime !== null) bump(this.sleepTime[slot], String(s.sleepTime));
      if (s.toxicStage !== null) bump(this.toxicStage[slot], String(s.toxicStage));
      if (s.swapped) this.swapped[slot] += w;
      if (s.switchFlag) this.switchFlag[slot] += w;
      if (s.swapped && !absent.has(slot)) sideHit[SIDE_OF[slot]] = true;
    }
    for (const side of ["own", "opponent"] as const) if (sideHit[side]) this.sideSwapped[side] += w;
  }
  fields(slot: SlotId): Partial<SlotResult> {
    const rec = (m: Map<string, number>) => Object.fromEntries([...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
    return {
      status: rec(this.status[slot]), volatiles: rec(this.volatiles[slot]), boosts: rec(this.boosts[slot]), item: rec(this.item[slot]),
      sub: [...this.sub[slot]].sort((a, b) => a[0] - b[0]), timesAttacked: rec(this.timesAttacked[slot]), perish: rec(this.perish[slot]),
      sleepTime: rec(this.sleepTime[slot]), toxicStage: rec(this.toxicStage[slot]), swapped: this.swapped[slot], switchFlag: this.switchFlag[slot],
      ...Object.fromEntries(Object.entries(this.extra[slot]).map(([k, m]) => [k, rec(m)])), berryLocked: this.berryLocked[slot],
    };
  }
}

/** Accumulates a walk's marginals. */
class Tally {
  dist: Record<SlotId, Map<number, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  max: Record<SlotId, Map<number, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  start: Record<SlotId, Map<number, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  startMax: Record<SlotId, number> = {} as any;
  steps: Partial<Record<SlotId, StepResult>> = {};
  states = new StateTally();
  sideConditions: Record<SideKey, Map<string, number>> = { own: new Map(), opponent: new Map() };
  noMove: Partial<Record<SlotId, Partial<Record<SlotId, Record<string, number>>>>> = {};
  /** status2 wave 1b: the copied uses (WalkResult.copies). */
  copies: NonNullable<WalkResult["copies"]> = {};
  runs = 0;
  constructor(readonly ctx: Ctx) {
    for (const slot of SLOTS) {
      if (ctx.pass.has(slot) || ctx.absent.has(slot) || ctx.switching.has(slot)) continue;
      this.steps[slot] = { moveId: toID(ctx.c.slots[slot].action.move!), picked: 0, faintedAtPick: 0, moved: 0, cant: {}, orderAll: {}, orderMoved: {}, hits: {}, lines: {}, effects: {}, change: {}, sides: {} };
    }
  }
  add(recs: ActionRec[], w: number) {
    for (const r of recs) {
      if (r.pass) {
        // status-eot: the lines of a No-move action (C5: its confusion self-hit, or Gravity / Taunt stopping its Splash).
        const into = this.noMove[r.slot] ??= {};
        for (const [t, keys] of r.effects) {
          const m = into[t] ??= {};
          for (const k of keys) m[k] = (m[k] ?? 0) + w;
        }
        continue;
      }
      let s = this.steps[r.slot]!;
      if (r.copied) {
        const key = `${r.copied}:${r.slot}:${r.moveId}:${r.source ?? "?"}`;
        s = this.copies[key] ??= { slot: r.slot, copied: r.copied, ...(r.source ? { source: r.source } : {}), moveId: r.moveId, picked: 0, faintedAtPick: 0, moved: 0, cant: {}, orderAll: {}, orderMoved: {}, hits: {}, lines: {}, effects: {}, change: {}, sides: {} };
      }
      if (!s) throw new Error(`${this.ctx.c.id}: a second action of ${r.slot} (${r.moveId}) that is no copy`);
      s.picked += w;
      if (r.faintedAtPick) s.faintedAtPick += w;
      if (r.moved) s.moved += w;
      if (r.cant) s.cant[r.cant] = (s.cant[r.cant] ?? 0) + w;
      if (!r.copied) s.orderAll[r.pos] = (s.orderAll[r.pos] ?? 0) + w;
      if (r.moved && !r.copied) s.orderMoved[r.pos] = (s.orderMoved[r.pos] ?? 0) + w;
      if (r.effective && toID(r.effective) !== s.moveId) s.lines[`|effective|${r.effective}`] = (s.lines[`|effective|${r.effective}`] ?? 0) + w;
      for (const t of new Set([...r.reached, ...r.dmg.keys()])) {
        const h: HitResult = s.hits[t] ??= { reached: 0, landed: 0, ko: 0, dmgMin: null, dmgMax: null, truncated: 0 };
        if (r.reached.has(t)) h.reached += w;
        if (r.truncated.has(t)) h.truncated = (h.truncated ?? 0) + w;
        if (r.landed.has(t)) h.landed += w;
        if (r.kos.includes(t)) h.ko += w;
        const d = r.dmg.get(t);
        if (d !== undefined && w > 0) {
          h.dmgMin = h.dmgMin === null ? d : Math.min(h.dmgMin, d);
          h.dmgMax = h.dmgMax === null ? d : Math.max(h.dmgMax, d);
        }
      }
      for (const line of new Set(r.lines)) s.lines[line] = (s.lines[line] ?? 0) + w;
      // status-eot.
      for (const [t, keys] of r.effects) {
        const into = s.effects![t] ??= {};
        for (const k of keys) into[k] = (into[k] ?? 0) + w;
      }
      for (const [scope, keys] of r.sides) {
        const into = s.sides![scope] ??= {};
        for (const k of keys) into[k] = (into[k] ?? 0) + w;
      }
      if (w > 0) for (const [t, delta] of r.change) {
        const c = s.change![t];
        s.change![t] = c ? { min: Math.min(c.min, delta), max: Math.max(c.max, delta) } : { min: delta, max: delta };
      }
      if (w > 0 && r.moved) for (const [t, delta] of r.moveChange) {
        const mc = (s.moveChange ??= {});
        const c = mc[t];
        mc[t] = c ? { min: Math.min(c.min, delta), max: Math.max(c.max, delta), mass: c.mass + w } : { min: delta, max: delta, mass: w };
      }
      if (r.selfHit !== null) {
        const c = s.selfHit;
        s.selfHit = c ? { mass: c.mass + w, min: w > 0 ? Math.min(c.min, r.selfHit) : c.min, max: w > 0 ? Math.max(c.max, r.selfHit) : c.max } : { mass: w, min: r.selfHit, max: r.selfHit };
      }
      for (const [t, sub] of r.sub) {
        const h: HitResult = s.hits[t] ??= { reached: 0, landed: 0, ko: 0, dmgMin: null, dmgMax: null, truncated: 0 };
        const prev = h.sub;
        h.sub = {
          mass: (prev?.mass ?? 0) + w,
          takenMin: prev && w > 0 ? Math.min(prev.takenMin, sub.taken) : prev ? prev.takenMin : sub.taken,
          takenMax: prev && w > 0 ? Math.max(prev.takenMax, sub.taken) : prev ? prev.takenMax : sub.taken,
          breaks: (prev?.breaks ?? 0) + (sub.broke ? w : 0),
        };
      }
    }
  }
  addStart(first: SegmentOut["firstMoveHP"], w: number) {
    if (!first) return;
    for (const slot of SLOTS) {
      this.start[slot].set(first.hp[slot], (this.start[slot].get(first.hp[slot]) ?? 0) + w);
      this.startMax[slot] = first.max[slot];
    }
  }
  end(hp: Record<SlotId, number>, max: Record<SlotId, number>, w: number) {
    for (const slot of SLOTS) {
      this.dist[slot].set(hp[slot], (this.dist[slot].get(hp[slot]) ?? 0) + w);
      this.max[slot].set(max[slot], (this.max[slot].get(max[slot]) ?? 0) + w);
    }
  }
  /** status-eot: the state mixtures after the moves. */
  endState(out: SegmentEnd, w: number) {
    this.states.add(out.state, w, this.ctx.absent);
    for (const side of ["own", "opponent"] as const) for (const id of out.sides[side]) this.sideConditions[side].set(id, (this.sideConditions[side].get(id) ?? 0) + w);
  }
  slots(): Record<SlotId, SlotResult> {
    return slotResults(this.ctx, this.dist, this.max, this.start, this.states);
  }
}
function slotResults(ctx: Ctx, distOf: Record<SlotId, Map<number, number>>, maxOf: Record<SlotId, Map<number, number>>, startOf: Record<SlotId, Map<number, number>>, states: StateTally): Record<SlotId, SlotResult> {
  return Object.fromEntries(SLOTS.map((slot) => {
    const dist = [...distOf[slot]].sort((a, b) => a[0] - b[0]);
    const total = dist.reduce((sum, [, p]) => sum + p, 0);
    const top = Math.max(...dist.map(([, p]) => p));
    const near = (p: number) => Math.abs(p - top) <= 1e-12;
    const modes = dist.filter(([, p]) => near(p)).map(([hp]) => hp);
    const start = [...startOf[slot]].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN;
    const maximum = [...maxOf[slot]].sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN;
    const r: SlotResult = {
      species: ctx.c.slots[slot].species, start, maximum,
      dist, koChance: dist.find(([hp]) => hp === 0)?.[1] ?? 0,
      average: dist.reduce((sum, [hp, p]) => sum + hp * p, 0) / total,
      min: dist[0][0], max: dist[dist.length - 1][0], modeTieUp: Math.max(...modes), modeTieDown: Math.min(...modes),
      ...states.fields(slot),
    };
    if (Math.abs(total - 1) > 1e-9) throw new Error(`${slot}: masses sum to ${total}`);
    return [slot, r];
  })) as Record<SlotId, SlotResult>;
}

/** The residual phase's marginals (status-eot). */
class AfterTally {
  dist: Record<SlotId, Map<number, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  max: Record<SlotId, Map<number, number>> = Object.fromEntries(SLOTS.map((s) => [s, new Map()])) as any;
  states = new StateTally();
  residuals = new Map<string, { r: ResidualResult; indexMass: number }>();
  field = new Map<string, number>();
  // status2 wave 1a.
  pseudo = new Map<string, number>();
  sides = new Map<string, number>();
  benchCured: Partial<Record<SideKey, number>> = {};
  runs = 0;
  noResidual = 0;
  kinds: Record<string, number> = {};
  constructor(readonly ctx: Ctx) {}
  add(out: SegmentEnd, w: number) {
    if (!out.after) {
      this.noResidual += w;
      return;
    }
    for (const slot of SLOTS) {
      const s = out.after.state[slot];
      this.dist[slot].set(s.hp, (this.dist[slot].get(s.hp) ?? 0) + w);
      this.max[slot].set(s.max, (this.max[slot].get(s.max) ?? 0) + w);
    }
    this.states.add(out.after.state, w, this.ctx.absent);
    for (const f of out.after.field) this.field.set(f, (this.field.get(f) ?? 0) + w);
    for (const f of out.after.extra.pseudo) this.pseudo.set(f, (this.pseudo.get(f) ?? 0) + w);
    for (const f of out.after.extra.sides) this.sides.set(f, (this.sides.get(f) ?? 0) + w);
    for (const side of ["own", "opponent"] as const) {
      if (!this.ctx.c.bench?.[side]?.status) continue;
      this.benchCured[side] = (this.benchCured[side] ?? 0) + (out.after.extra.benchStatus[side] === "" ? w : 0);
    }
    for (const e of out.after.residuals) {
      const id = `${e.slot}|${e.effect}|${e.other ?? ""}${e.role}`;
      let a = this.residuals.get(id);
      if (!a) this.residuals.set(id, a = { r: { slot: e.slot, effect: e.effect, ...(e.other ? { other: e.other } : {}), chance: 0, min: null, max: null, koChance: 0, facts: {}, index: 0 }, indexMass: 0 });
      a.r.chance += w;
      if (e.amount !== null && w > 0) {
        a.r.min = a.r.min === null ? e.amount : Math.min(a.r.min, e.amount);
        a.r.max = a.r.max === null ? e.amount : Math.max(a.r.max, e.amount);
      }
      if (e.ko) a.r.koChance += w;
      for (const f of e.facts) a.r.facts[f] = (a.r.facts[f] ?? 0) + w;
      a.indexMass += e.index * w;
    }
  }
  result(t0: number, classes: number): AfterTurn {
    const total = (slot: SlotId) => [...this.dist[slot].values()].reduce((s, p) => s + p, 0);
    const empty = SLOTS.some((slot) => total(slot) === 0);
    const start = Object.fromEntries(SLOTS.map((s) => [s, new Map<number, number>()])) as Record<SlotId, Map<number, number>>;
    return {
      runs: this.runs, classes, ms: Math.round(performance.now() - t0), decisions: this.kinds,
      slots: empty ? ({} as Record<SlotId, SlotResult>) : normalisedSlots(this.ctx, this.dist, this.max, start, this.states),
      residuals: [...this.residuals.values()].map(({ r, indexMass }) => ({ ...r, index: r.chance > 0 ? indexMass / r.chance : 0 }))
        .sort((a, b) => a.index - b.index),
      noResidual: this.noResidual,
      field: Object.fromEntries([...this.field].sort()),
      pseudo: Object.fromEntries([...this.pseudo].sort()), sides: Object.fromEntries([...this.sides].sort()),
      ...(Object.keys(this.benchCured).length ? { benchCured: this.benchCured } : {}),
    };
  }
}
/** Slot results of a partial mass (paths without a residual left out): the distributions as conditional on having one. */
function normalisedSlots(ctx: Ctx, dist: Record<SlotId, Map<number, number>>, max: Record<SlotId, Map<number, number>>, start: Record<SlotId, Map<number, number>>, states: StateTally): Record<SlotId, SlotResult> {
  const totalOf = (slot: SlotId) => [...dist[slot].values()].reduce((s, p) => s + p, 0);
  const scaled = Object.fromEntries(SLOTS.map((slot) => {
    const total = totalOf(slot);
    return [slot, new Map([...dist[slot]].map(([hp, p]) => [hp, Math.abs(total - 1) <= 1e-9 ? p : p / total]))];
  })) as Record<SlotId, Map<number, number>>;
  return slotResults(ctx, scaled, max, start, states);
}

function context(c: Case, b?: any): Ctx {
  const absent = new Set(SLOTS.filter((slot) => c.slots[slot].absent));
  // status2 wave 1b (T2P §2.1): a commanding Tatsugiri (Commander at the lead) has no action at all (side.ts auto-passes it).
  const commanding = new Set(b ? SLOTS.filter((slot) => !absent.has(slot) && pokemonAt(b, slot)?.volatiles?.commanding) : []);
  // status2 Step 1 #14: a switch-in slot makes no move action (its switch is not a step).
  const switching = new Set(SLOTS.filter((slot) => !absent.has(slot) && c.slots[slot].action.switchIn));
  const pass = new Set(SLOTS.filter((slot) => !absent.has(slot) && !switching.has(slot) && c.slots[slot].action.move === null));
  return { c, pass, absent, totalMoves: SLOTS.length - absent.size - switching.size - commanding.size, critical: !!c.field?.critical, switching, commanding };
}

/** The status-eot fields of a walk, from its tallies. */
function extraFields(tally: Tally, after: AfterTally, t0: number, residualClasses: number): Pick<WalkResult, "swapped" | "afterTurn" | "noMove"> & { sideConditions: Record<SideKey, Record<string, number>> } {
  const swapped: Partial<Record<SideKey, number>> = {};
  for (const side of ["own", "opponent"] as const) if (tally.states.sideSwapped[side] > 0) swapped[side] = tally.states.sideSwapped[side];
  return {
    ...(Object.keys(swapped).length ? { swapped } : {}),
    sideConditions: { own: Object.fromEntries([...tally.sideConditions.own].sort()), opponent: Object.fromEntries([...tally.sideConditions.opponent].sort()) },
    ...(Object.keys(tally.noMove).length ? { noMove: tally.noMove } : {}),
    afterTurn: after.result(t0, residualClasses),
  };
}

type Start = ReturnType<typeof prepare> & { weight?: number; label?: string };
/** The exact walk: BFS over action boundaries, equal serialized states merged. */
export function walk(c: Case, mode: Mode, options: { merge?: boolean; maxRuns?: number; start?: (c: Case) => ReturnType<typeof prepare> } = {}): WalkResult {
  const t0 = performance.now();
  // `start`: another way to reach the case's start (fainted-engine/real-battle.ts: a real battle's turn before).
  const starts: Start[] = options.start ? [options.start(c)] : prepareAll(c);
  const { choices } = starts[0];
  const ctx = context(c, starts[0].b);
  const tally = new Tally(ctx);
  const after = new AfterTally(ctx);
  const kinds: Record<string, number> = {};
  let frontier = new Map<string, { json: string; w: number; first: boolean }>(starts.map((s, i) => [`pre${i}`, { json: snapshot(s.b), w: s.weight ?? 1, first: true }]));
  let classes = 0, unique = 0, residualClasses = 0;
  while (frontier.size) {
    const next = new Map<string, { json: string; w: number; first: boolean }>();
    for (const cls of frontier.values()) {
      classes++;
      let prefix: number[] | null = [];
      let sawResidual = false;
      while (prefix) {
        const ch = new Chooser(prefix, mode, kinds);
        const out = runSegment(cls.json, cls.first, choices, ch, ctx);
        const firstVariant = ch.firstVariant();
        if (firstVariant) {
          tally.runs++;
          if (options.maxRuns && tally.runs > options.maxRuns) throw new Error(`over ${options.maxRuns} runs`);
          addCounts(kinds, ch.counts);
          const w = cls.w * (ch.mark === null ? out.weightPath : ch.weightAtMark);
          tally.add(out.recs, w);
          tally.addStart(out.firstMoveHP, w);
          if (out.kind === "end") {
            tally.end(out.hp, out.max, w);
            tally.endState(out, w);
          } else {
            const key = options.merge === false ? String(unique++) : out.json;
            const had = next.get(key);
            if (had) had.w += w;
            else next.set(key, { json: out.json, w, first: false });
          }
        }
        if (out.kind === "end") {
          after.runs++;
          addCounts(after.kinds, ch.resCounts);
          after.add(out, cls.w * out.weightPath);
          sawResidual = true;
        }
        prefix = ch.next();
      }
      if (sawResidual) residualClasses++;
    }
    frontier = next;
  }
  return {
    mode, exact: true, runs: tally.runs, classes, ms: Math.round(performance.now() - t0), decisions: kinds, slots: tally.slots(), steps: tally.steps,
    ...(Object.keys(tally.copies).length ? { copies: tally.copies } : {}),
    ...extraFields(tally, after, t0, residualClasses),
  };
}

/** Whole-turn replays from the pre-turn snapshot, no merging: the reference for walk(). */
export function walkReplay(c: Case, mode: Mode, maxRuns = 200_000, start?: (c: Case) => ReturnType<typeof prepare>): WalkResult {
  const t0 = performance.now();
  const starts: Start[] = start ? [start(c)] : prepareAll(c);
  const ctx = context(c, starts[0].b);
  const tally = new Tally(ctx);
  const after = new AfterTally(ctx);
  const kinds: Record<string, number> = {};
  for (const s of starts) {
    const json = snapshot(s.b);
    const sw = s.weight ?? 1;
    let prefix: number[] | null = [];
    while (prefix) {
      const ch = new Chooser(prefix, mode, kinds);
      const out = runSegment(json, true, s.choices, ch, ctx, true);
      if (out.kind !== "end") throw new Error("replay ended at a boundary");
      if (ch.firstVariant()) {
        if (++tally.runs > maxRuns) throw new Error(`over ${maxRuns} runs`);
        addCounts(kinds, ch.counts);
        const w = sw * (ch.mark === null ? out.weightPath : ch.weightAtMark);
        tally.add(out.recs, w);
        tally.addStart(out.firstMoveHP, w);
        tally.end(out.hp, out.max, w);
        tally.endState(out, w);
      }
      after.runs++;
      addCounts(after.kinds, ch.resCounts);
      after.add(out, sw * out.weightPath);
      prefix = ch.next();
    }
  }
  return {
    mode, exact: true, runs: tally.runs, classes: tally.runs, ms: Math.round(performance.now() - t0), decisions: kinds, slots: tally.slots(), steps: tally.steps,
    ...(Object.keys(tally.copies).length ? { copies: tally.copies } : {}),
    ...extraFields(tally, after, t0, after.runs),
  };
}

function mulberry(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A Monte Carlo of the decision RNG (forced events stay forced), seeded. The residual and the sub-case pick use their own streams. */
export function walkSample(c: Case, samples: number, seed = 1): WalkResult {
  const t0 = performance.now();
  const starts: Start[] = prepareAll(c);
  const ctx = context(c, starts[0].b);
  const tally = new Tally(ctx);
  const after = new AfterTally(ctx);
  const kinds: Record<string, number> = {};
  const jsons = starts.map((s) => snapshot(s.b));
  const rng = mulberry(seed), resRng = mulberry(seed + 0x5eed), pickRng = mulberry(seed + 0x9e37);
  for (let i = 0; i < samples; i++) {
    let k = 0;
    if (starts.length > 1) {
      let u = pickRng();
      while (k < starts.length - 1 && u >= (starts[k].weight ?? 1)) u -= starts[k++].weight ?? 1;
    }
    const ch = new Chooser([], "all", kinds, rng, resRng);
    const out = runSegment(jsons[k], true, starts[k].choices, ch, ctx, true);
    tally.runs++;
    addCounts(kinds, ch.counts);
    tally.add(out.recs, 1 / samples);
    tally.addStart(out.firstMoveHP, 1 / samples);
    if (out.kind !== "end") throw new Error("sample ended at a boundary");
    tally.end(out.hp, out.max, 1 / samples);
    tally.endState(out, 1 / samples);
    after.runs++;
    addCounts(after.kinds, ch.resCounts);
    after.add(out, 1 / samples);
  }
  return {
    mode: "all", exact: false, samples, runs: tally.runs, classes: 0, ms: Math.round(performance.now() - t0), decisions: kinds, slots: tally.slots(), steps: tally.steps,
    ...(Object.keys(tally.copies).length ? { copies: tally.copies } : {}),
    ...extraFields(tally, after, t0, 0),
  };
}

export function oracle(c: Case, options: { samples?: number; validate?: boolean } = {}): OracleResult {
  const starts = prepareAll(c);
  const { format } = starts[0];
  const warnings = [...new Set(starts.flatMap((s) => s.warnings))];
  const lowest = walk(c, "lowest"), highest = walk(c, "highest");
  const all = c.oracle === "modes" ? walkSample(c, options.samples ?? 10_000) : walk(c, "all");
  if (options.validate) {
    for (const [mode, fast] of [["lowest", lowest], ["highest", highest], ...(c.oracle === "modes" ? [] : [["all", all]])] as [Mode, WalkResult][]) {
      const ref = walkReplay(c, mode);
      const diff = compareWalks(fast, ref);
      if (diff.length) warnings.push(`validate ${mode}: ${diff.join("; ")}`);
      else warnings.push(`validate ${mode}: equal to ${ref.runs} whole-turn replays`);
    }
  }
  const expectedOf = (a: Record<SlotId, SlotResult>, lo: Record<SlotId, SlotResult>, hi: Record<SlotId, SlotResult>): Record<SlotId, Expected> =>
    Object.fromEntries(SLOTS.map((slot) => {
      const x = a[slot];
      return [slot, {
        start: x.start, maximum: x.maximum, low: lo[slot].modeTieUp, high: hi[slot].modeTieDown,
        average: x.average, min: x.min, max: x.max, koChance: x.koChance, dist: x.dist,
      }];
    })) as Record<SlotId, Expected>;
  const expected = expectedOf(all.slots, lowest.slots, highest.slots);
  // After the whole turn: only when every path had a residual (no switch request after the last action).
  const whole = [all, lowest, highest].every((w) => w.afterTurn && w.afterTurn.noResidual === 0 && Object.keys(w.afterTurn.slots).length);
  const afterTurn = whole ? Object.fromEntries(Object.entries(expectedOf(all.afterTurn!.slots, lowest.afterTurn!.slots, highest.afterTurn!.slots))
    .map(([slot, e]) => [slot, { ...e, start: expected[slot as SlotId].start, maximum: expected[slot as SlotId].maximum }])) as Record<SlotId, Expected> : null;
  return {
    id: c.id, title: c.title, game: c.game, format, checks: c.checks, walks: { all, lowest, highest }, expected, warnings,
    afterTurn, residuals: all.afterTurn?.residuals ?? [], ...(starts.length > 1 || starts[0].label ? { hidden: starts.map((s) => ({ label: s.label, weight: s.weight })) } : {}),
  };
}

/** Differences between two walks' slot distributions and step marginals (|Δp| ≤ 1e-12), after the moves and after the turn. */
export function compareWalks(a: WalkResult, b: WalkResult): string[] {
  const out: string[] = [];
  const close = (x: number, y: number) => Math.abs(x - y) <= 1e-12;
  for (const slot of SLOTS) {
    const da = new Map(a.slots[slot].dist), db = new Map(b.slots[slot].dist);
    for (const hp of new Set([...da.keys(), ...db.keys()])) {
      if (!close(da.get(hp) ?? 0, db.get(hp) ?? 0)) out.push(`${slot} hp ${hp}: ${da.get(hp) ?? 0} vs ${db.get(hp) ?? 0}`);
    }
    const ta = a.afterTurn?.slots[slot], tb = b.afterTurn?.slots[slot];
    if (ta && tb) {
      const ea = new Map(ta.dist), eb = new Map(tb.dist);
      for (const hp of new Set([...ea.keys(), ...eb.keys()])) {
        if (!close(ea.get(hp) ?? 0, eb.get(hp) ?? 0)) out.push(`${slot} after the turn hp ${hp}: ${ea.get(hp) ?? 0} vs ${eb.get(hp) ?? 0}`);
      }
    }
    const sa = a.steps[slot], sb = b.steps[slot];
    if (!sa || !sb) continue;
    for (const key of ["picked", "faintedAtPick", "moved"] as const) if (!close(sa[key], sb[key])) out.push(`${slot} ${key}: ${sa[key]} vs ${sb[key]}`);
    for (const pos of new Set([...Object.keys(sa.orderAll), ...Object.keys(sb.orderAll)])) {
      if (!close(sa.orderAll[pos] ?? 0, sb.orderAll[pos] ?? 0)) out.push(`${slot} order ${pos}: ${sa.orderAll[pos] ?? 0} vs ${sb.orderAll[pos] ?? 0}`);
    }
    for (const t of new Set([...Object.keys(sa.hits), ...Object.keys(sb.hits)]) as Set<SlotId>) {
      const ha = sa.hits[t], hb = sb.hits[t];
      for (const key of ["reached", "landed", "ko"] as const) if (!close(ha?.[key] ?? 0, hb?.[key] ?? 0)) out.push(`${slot}→${t} ${key}: ${ha?.[key]} vs ${hb?.[key]}`);
    }
  }
  return out;
}

export const RESULTS_DIR = path.resolve("scripts/.cache/calc-audit/2v2/verify/results");

if (process.argv[1]?.replace(/\\/g, "/").endsWith("verify/sim-dfs.ts")) {
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !a.startsWith("--"));
  const validate = args.includes("--validate");
  const samples = Number(args.find((a) => a.startsWith("--samples="))?.split("=")[1] ?? 10_000);
  const outDir = args.find((a) => a.startsWith("--out="))?.split("=")[1];
  const dir = outDir ? path.resolve(outDir) : RESULTS_DIR;
  const exact = args.includes("--exact");
  // --all: also the cases the app does not estimate (their moves still run in Showdown), e.g. to recheck stale results.
  const everyCase = args.includes("--all");
  fs.mkdirSync(dir, { recursive: true });
  for (const c of CASES) {
    if (ids.length && !ids.some((id) => exact ? c.id === id : (c.id === id || c.id.startsWith(`${id}-`) || c.id.startsWith(`${id}`)))) continue;
    if (c.notEstimated && !everyCase) continue;
    try {
      const r = oracle(c, { samples, validate });
      fs.writeFileSync(path.join(dir, `${c.id}.json`), JSON.stringify(r, null, 1));
      const summary = SLOTS.map((slot) => {
        const e = r.expected[slot];
        const t = r.afterTurn?.[slot];
        return `${slot} ${r.walks.all.slots[slot].species} ${e.start}→ low ${e.low} avg ${e.average.toFixed(3)} high ${e.high} [${e.min}–${e.max}] ko ${(e.koChance * 100).toFixed(3)}%${t ? ` | turn ${t.low}/${t.average.toFixed(3)}/${t.high} ko ${(t.koChance * 100).toFixed(3)}%` : ""}`;
      }).join(" | ");
      console.log(`${c.id} (${r.walks.all.runs}+${r.walks.lowest.runs}+${r.walks.highest.runs} runs, ${r.walks.all.ms + r.walks.lowest.ms + r.walks.highest.ms} ms): ${summary}`);
      for (const w of r.warnings) console.log(`  ! ${w}`);
    } catch (e) {
      console.log(`${c.id} FAILED: ${(e as Error).stack}`);
    }
  }
}
