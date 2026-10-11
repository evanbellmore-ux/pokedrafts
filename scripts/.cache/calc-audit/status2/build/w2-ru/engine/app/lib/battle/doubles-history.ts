import { DANCE_MOVES, REASONS, REDIRECT_ABILITIES } from "./doubles-actions";
import { DOUBLES_SLOTS, type DoublesSlotId } from "./doubles-types";
import { cloneWorld, type PendingAction, type World } from "./doubles-world";
import type { TurnKernel, TurnMoveInfo } from "./doubles-turn";
import { setVol, type Gate } from "./doubles-use";
import { isMaxActive } from "./mechanics";
import type { ChampionsMove } from "./types";

// The turn's history from earlier turns (status2 ADDENDUM2 §3.5, §4.2 N; IN §4.2; T2E §4.7.1, §4.7.3; C23, C34, C37):
// Track N's file. The stall roll of a protecting move or Endure (PS/data/conditions.ts:439-462), a Destiny Bond from last
// turn (PS/data/moves.ts:3483-3526), the entry order's ties (PS/sim/battle.ts:413-419 compareRedirectOrder), a used Protean
// or Libero whose type is not given, the recharge (PS/data/conditions.ts:364-378) and Fake Out and First Impression after
// the first turn (PS/data/moves.ts:5097-5100, 5483-5486). The kernel (doubles-turn.ts, doubles-status.ts) calls each hook
// where Showdown runs it; every state is written only while something later in the turn reads it (SPEC2 §4.9).

// ------------------------------------------------------------------------------------------------------------------
// The stall counter (PS/data/conditions.ts stall: counter 3 on a first use, ×3 on each restart up to 729; onStallMove
// randomChance(1, counter), deleted on a failure)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Whether the stall counter has a reader later in this turn after a protecting move's or a guard's use: only a second
 * protecting use by the same Pokémon, which in these games only Instruct gives (CL; Protect, Detect, Endure and the guards
 * have no failinstruct flag). Without one the counter after the use is not kept (the readers rule: SPEC2 §4.9).
 */
function stallReader(kernel: TurnKernel): boolean {
  return DOUBLES_SLOTS.some((slot) => kernel.input.pokemon[slot]?.action.moveId === "instruct");
}

/**
 * A protecting move's or Endure's stall roll (doubles-status.ts earlyBranch, after the willAct check, before the protection
 * or Endure is set): PS/data/moves.ts protect, detect, endure... onPrepareHit `!!queue.willAct() && runEvent('StallMove')`,
 * which comes after the whole BeforeMove (a confusion self-hit first: IN-P02, TR03) and before the PrepareHit event (Protean,
 * Libero). With a counter c carried from last turn (MoveVolatiles.stall, from carried.stall: carriedState writes it only for a
 * Pokémon whose action is a protecting move or Endure), 1/c passes and 1 − 1/c fails: the counter is deleted and the move
 * fails with no protection and no Endure (IN-P01, CQ05). A pass restarts the counter (×3, at most 729: onHit's
 * addVolatile('stall')), kept only for a later reader. Without a counter the move always passes (its first use: counter 3,
 * kept only for a later reader).
 */
export function stallPrepare(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): { pass: World[]; fail: World[] } {
  const slot = action.slot;
  const counter = w.mons[slot]!.vol.stall;
  const reader = stallReader(kernel);
  if (counter === undefined || counter <= 1) {
    if (reader) setVol(w, slot, { stall: 3 });
    return { pass: [w], fail: [] };
  }
  const pass = cloneWorld(w, w.mass / counter);
  setVol(pass, slot, { stall: reader ? Math.min(729, counter * 3) : undefined });
  const fail = w;
  fail.mass *= 1 - 1 / counter;
  setVol(fail, slot, { stall: undefined });
  kernel.stepFact(action, `${move.name} fails.`, fail.mass);
  return { pass: [pass], fail: [fail] };
}

/**
 * Quick Guard's and Wide Guard's use (PS/data/moves.ts:14500-14505, 20819-20824: onTry reads willAct only; onHitSide
 * addVolatile('stall')): the counter starts at 3 or triples (at most 729) with no roll (CQ05a, CQ05b). Kept only for a later
 * reader in this turn (stallReader). For doubles-status.ts earlyBranch's guard branch, after the side condition is set.
 */
export function stallRaise(kernel: TurnKernel, w: World, action: PendingAction) {
  if (!stallReader(kernel)) return;
  const counter = w.mons[action.slot]!.vol.stall;
  setVol(w, action.slot, { stall: counter === undefined || counter <= 1 ? 3 : Math.min(729, counter * 3) });
}

// ------------------------------------------------------------------------------------------------------------------
// Destiny Bond from last turn (the destinybond volatile: MonState.destinyBond, from carried.destinyBond)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Destiny Bond's condition at its holder's BeforeMove, priority −1 (after paralysis, before Focus Punch's focus check):
 * removed unless the move it uses is Destiny Bond itself (onBeforeMove; a Dynamaxed holder's status move is Max Guard); on a
 * stopped world (`stopped`: sleep, freeze, flinch, a confusion self-hit, paralysis, the recharge... sim/battle-actions.ts
 * runMove's MoveAborted) removed whatever the move (onMoveAborted). No move is Splash, which removes it too. A foe's move
 * that knocks the holder out before then faints that foe (doubles-status.ts onKnockOut: CQ06a); after it, none does (CQ06b).
 */
export function destinyBondBefore(kernel: TurnKernel, w: World, action: PendingAction, stopped: boolean) {
  void kernel;
  const mon = w.mons[action.slot];
  if (!mon?.destinyBond) return;
  if (!stopped && action.moveId === "destinybond" && !isMaxActive(mon.build)) return;
  delete mon.destinyBond;
}

/**
 * Destiny Bond's own PrepareHit (PS/data/moves.ts destinybond onPrepareHit: `!pokemon.removeVolatile('destinybond')`): with
 * its Destiny Bond still up (from last turn: its BeforeMove −1 keeps it for this move) the volatile is removed and the move
 * fails (IN-P05b). For doubles-status.ts earlyBranch's Destiny Bond branch, before it sets the volatile: true when the move
 * fails there.
 */
export function destinyBondPrepare(kernel: TurnKernel, w: World, action: PendingAction): boolean {
  const mon = w.mons[action.slot]!;
  if (!mon.destinyBond) return false;
  delete mon.destinyBond;
  kernel.stepFact(action, "Destiny Bond fails: it was used last turn.", w.mass);
  return true;
}

// ------------------------------------------------------------------------------------------------------------------
// The entry order (abilityState.effectOrder: DoublesTurnInput.entryOrder ranks, MonState.entry; C37)
// ------------------------------------------------------------------------------------------------------------------

/** The centres of attention (doubles-turn.ts CENTRES): Follow Me, Rage Powder, Spotlight. */
const CENTRE_MOVES: ReadonlySet<string> = new Set(["followme", "ragepowder", "spotlight"]);

/** The input's highest entry rank (−1 without ranks): an entry above it is an ability state that began this turn (entryChanged). */
function inputTop(kernel: TurnKernel): number {
  let top = -1;
  for (const rank of Object.values(kernel.input.entryOrder ?? {})) if (rank !== undefined && rank > top) top = rank;
  return top;
}

/** A Pokémon's entry rank in this world: one written this turn (MonState.entry), else the input's (startWorld writes it only with a tie reader). */
function rankOf(kernel: TurnKernel, w: World, slot: DoublesSlotId): number | undefined {
  return w.mons[slot]?.entry ?? kernel.input.entryOrder?.[slot];
}

/**
 * Two holders `a` and `b` of one redirection at one priority and Speed (doubles-turn.ts redirect), Dancers at one stored
 * Speed (PR), Download's lead (ST): the one whose ability state is older (the smaller rank; PS/sim/battle.ts:413-419
 * compareRedirectOrder sorts the holders' abilityState.effectOrder ascending with no shuffle, Follow Me and Rage Powder
 * included: IN-P08, CQ09), or null when the order is not known: a rank missing or two equal ranks (C37). An ability state
 * that began this turn (entryChanged: a rank above every input rank) is newer than any Pokémon's that did not, rank or not.
 * The caller gives the reason when null (REASONS.needsEntryOrder) and picks the newest itself where that comes first (Dancer).
 */
export function entryTie(kernel: TurnKernel, w: World, a: DoublesSlotId, b: DoublesSlotId): DoublesSlotId | null {
  const first = rankOf(kernel, w, a), second = rankOf(kernel, w, b);
  if (first !== undefined && second !== undefined) return first < second ? a : second < first ? b : null;
  const top = inputTop(kernel);
  if (first !== undefined && first > top) return b;
  if (second !== undefined && second > top) return a;
  return null;
}

/**
 * Whether the entry order can decide a tie in this world (the readers rule; doubles-turn.ts entryReaders reads the input):
 * two possible redirectors (a Lightning Rod or Storm Drain holder, a Follow Me, Rage Powder or Spotlight user), two Dancers
 * with a dance move in the turn, or a Download holder, among the living Pokémon as their abilities are now.
 */
function tieReaders(kernel: TurnKernel, w: World): boolean {
  let redirectors = 0, dancers = 0;
  const dance = DOUBLES_SLOTS.some((slot) => DANCE_MOVES.has(kernel.input.pokemon[slot]?.action.moveId ?? ""));
  for (const slot of DOUBLES_SLOTS) {
    const mon = w.mons[slot];
    if (!mon || mon.fainted) continue;
    const ability = mon.build.abilityId;
    if (ability === "download") return true;
    if (REDIRECT_ABILITIES[ability] || mon.centre || CENTRE_MOVES.has(kernel.input.pokemon[slot]?.action.moveId ?? "")) redirectors++;
    if (ability === "dancer") dancers++;
  }
  return redirectors >= 2 || (dance && dancers >= 2);
}

/**
 * An ability state that began this turn (A1's setAbility, after the new ability is in the build; R's replaceSlot): its
 * MonState.entry is later than every input rank and every earlier change this turn (sim/pokemon.ts setAbility ->
 * initEffectState: a new effectOrder). Written only while a tie can read it (tieReaders).
 */
export function entryChanged(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  if (!mon || !tieReaders(kernel, w)) return;
  let top = inputTop(kernel);
  for (const each of DOUBLES_SLOTS) {
    const entry = w.mons[each]?.entry;
    if (entry !== undefined && entry > top) top = entry;
  }
  mon.entry = top + 1;
}

// ------------------------------------------------------------------------------------------------------------------
// A used Protean or Libero (IN §4.2)
// ------------------------------------------------------------------------------------------------------------------

/**
 * A Protean or Libero holder whose ability already acted this stint (abilityActive false: it changed its type on an earlier
 * turn) as the turn starts (doubles-turn.ts rootWorlds, once per present slot): with its types given (BuildBase.types: the
 * type it changed to, SPEC2 A2's state) nothing here; without them every move into or from it and every type check reads a
 * type the input does not give: not estimated (REASONS.typeUnknown). A Terastallized holder (not Stellar) has its Tera type.
 */
export function proteanUsed(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  const build = w.mons[slot]?.build;
  if (!build || (build.abilityId !== "protean" && build.abilityId !== "libero") || build.abilityActive || build.types?.length) return;
  if (build.mechanic === "tera" && build.configuration?.teraType && build.configuration.teraType !== "Stellar") return;
  kernel.notEstimated(REASONS.typeUnknown(kernel.names[slot], kernel.abilityName(build.abilityId)));
}

// ------------------------------------------------------------------------------------------------------------------
// The recharge and the first-turn moves (T2E §4.7.1, §4.7.3; C34)
// ------------------------------------------------------------------------------------------------------------------

/**
 * BeforeMove priority 11, after Glaive Rush's 100: mustrecharge (PS/data/conditions.ts:364-378, from carried.mustRecharge)
 * writes `cant … recharge`, ends itself and returns null, so nothing below 11 runs: no sleep counter moves (TR01), no
 * confusion self-hit and no confusion turn counted (TR11). The action (No move: validate allows nothing else) stops; the turn
 * fact `{Name} must recharge.` is the kernel's. Destiny Bond's MoveAborted follows (destinyBondBefore on the stopped world).
 */
export function beforeMoveStart(kernel: TurnKernel, w: World, action: PendingAction): Gate | null {
  void kernel;
  if (!w.mons[action.slot]!.vol.mustRecharge) return null;
  setVol(w, action.slot, { mustRecharge: undefined });
  return { go: [], stopped: [w] };
}

/** The moves whose own onTry fails after the user's first move action since it came in (sim/pokemon.ts activeMoveActions > 1). */
const FIRST_TURN_MOVES: ReadonlySet<string> = new Set(["fakeout", "firstimpression"]);

/**
 * A damaging move's own Try after D's flingTry (doubles-turn.ts damagingMove, per resolution, after BeforeMove: a confused
 * user can still hurt itself first, TR07): Fake Out and First Impression (not their Z-Move or Max Move) fail when this is not
 * the user's first move action since it came in: `firstTurn: false` in the input, or a second action of the turn (an
 * instructed move or a Dancer's copy: runMove counts each, PS/sim/battle-actions.ts:217).
 */
export function moveTry(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, info: TurnMoveInfo): string | null {
  void w; void target;
  if (info.transformed || !FIRST_TURN_MOVES.has(move.id)) return null;
  const again = action.source === "instruct" || !!action.external;
  if (kernel.input.pokemon[action.slot]?.firstTurn !== false && !again) return null;
  return `${move.name} fails: it is not ${kernel.names[action.slot]}'s first turn.`;
}
