import { ABSORBING, CHOICE_ITEMS, DANCE_MOVES, PLEDGE_MOVES, REASONS, REDIRECT_ABILITIES } from "./doubles-actions";
import { allyOf, DOUBLES_SLOTS, SHOWDOWN_POSITION, sideCanSwitch, slotSide, type DoublesSideId, type DoublesSlotId } from "./doubles-types";
import { cloneWorld, mapHP, type MonState, type MoveVolatiles, type PendingAction, type World } from "./doubles-world";
import type { Resolution, TurnKernel, TurnMoveInfo } from "./doubles-turn";
import * as fieldChangeNs from "./doubles-fieldchange";
import * as historyNs from "./doubles-history";
import * as typingNs from "./doubles-typing";
import { setVol, type Use } from "./doubles-use";
import { isMaxActive } from "./mechanics";
import type { BattleStatus, ChampionsMove, MoveContext } from "./types";
import type { TurnStepOutcome } from "./uses-to-ko";

// The hook namespaces are copied once into plain objects (as the kernel's: a namespace member under tsx is a getter).
const historyHooks = { ...historyNs };
const fieldChangeHooks = { ...fieldChangeNs };
const typingHooks = { ...typingNs };

// Presence abilities and moves (status2 ADDENDUM2 §4.3 PR; T2P §2, §3.1-§3.8, §3.17, §6.1; pinned Showdown c23d2e94): Track
// PR's file (wave 1b). Commander, Poison Puppeteer, Dancer (copies as inserted actions), Round, Beak Blast, Shell Trap, Beat
// Up, Fusion Bolt and Fusion Flare, Flame Burst, the Pledges (the wait, the combined move, the sea of fire, the swamp, the
// rainbow), and the history rows the turn's inputs answer (Present, Magnitude, Pursuit, Retaliate, Fury Cutter, Rollout, Ice
// Ball, Echoed Voice, Trump Card, a first or storing Bide). Kept not estimated, each with its fact (the kernel plumbing they
// need is listed in status2/build/W1B-PR.md): Spotlight, the Counter family and a releasing Bide.

// ---------------- per-action marks ----------------

/**
 * PR's marks on an action's user, for the rest of that action only (afterAction clears them, so worlds merge as before):
 * `power` a random base power Present or Magnitude rolled (ModifyMove), `pull` the Round a tied pull takes (aim, then
 * tryMove), `did` moveDidSomething (afterHit: a hit of the move landed or met a Substitute; danceEffect: a status dance's own
 * effect applied), `dance` a status dance a Dancer could copy, `target` the last Pokémon a dance hit (activeTarget).
 */
/**
 * An action's marks on its user (cleared at its afterAction): Present's and Magnitude's power, Round's pull, moveDidSomething, a
 * status dance a Dancer could copy and its target. `idle`: kept on a Fusion user past its action, the No-move Pokémon still to act.
 */
type Marks = { power?: number; pull?: DoublesSlotId; did?: true; dance?: true; target?: DoublesSlotId; idle?: DoublesSlotId[] };
type MarkedVol = MoveVolatiles & { pr?: Marks };
const marksOf = (w: World, slot: DoublesSlotId): Marks | undefined => (w.mons[slot]?.vol as MarkedVol | undefined)?.pr;
function mark(w: World, slot: DoublesSlotId, change: Marks) {
  const mon = w.mons[slot]!;
  mon.vol = { ...mon.vol, pr: { ...(mon.vol as MarkedVol).pr, ...change } } as MoveVolatiles;
}
function unmark(w: World, slot: DoublesSlotId) {
  const mon = w.mons[slot];
  if (!mon || !(mon.vol as MarkedVol).pr) return;
  const { pr: _pr, ...rest } = mon.vol as MarkedVol;
  void _pr;
  mon.vol = rest;
}

// ---------------- shared reads ----------------

const sideName = (side: DoublesSideId) => (side === "own" ? "your side" : "the opponent's side");
const queuedOf = (w: World, slot: DoublesSlotId) => w.remaining.find((each) => each.slot === slot);
/** The move an action uses is its Z-Move or Max Move (a queued Round, a Pledge or Beak Blast so used is not that move). */
function zOrMax(kernel: TurnKernel, w: World, action: { slot: DoublesSlotId; moveId: string | null }): boolean {
  if (!action.moveId || !w.mons[action.slot]) return false;
  return !!kernel.input.pokemon[action.slot]?.contexts[action.moveId]?.useZ || isMaxActive(w.mons[action.slot]!.build);
}
/** sim/battle-queue.ts comparePriority's key (doubles-turn.ts keyOf): order ascending, then priority and Speed descending. */
function keyOf(kernel: TurnKernel, w: World, action: PendingAction): [number, number, number] {
  const order = action.order ?? 200;
  if (action.frozen) return [order, action.frozen.priority, action.frozen.speed];
  return [order, kernel.priorityOf(w, action) + action.fractional, kernel.speedOf(w, action.slot)];
}
const ahead = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
const same = (a: [number, number, number], b: [number, number, number]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** The actions first in the queue's sort among `actions` (one when no tie: a shuffled tie is one world each, 1/k). */
function firstQueued(kernel: TurnKernel, w: World, actions: PendingAction[]): PendingAction[] {
  let best: PendingAction[] = [], top: [number, number, number] | null = null;
  for (const action of actions) {
    const key = keyOf(kernel, w, action);
    if (!top || ahead(key, top)) { top = key; best = [action]; } else if (same(key, top)) best.push(action);
  }
  return best;
}
/** One world per choice, `w` split evenly (each a clone; the same world when there is one). */
function evenly<T>(w: World, choices: T[]): { world: World; choice: T }[] {
  if (choices.length === 1) return [{ world: w, choice: choices[0] }];
  return choices.map((choice) => ({ world: cloneWorld(w, w.mass / choices.length), choice }));
}
/** The battle is over in this world (doubles-turn.ts battleOver's rule): a side with no Pokémon left to switch in has every Pokémon it had fainted. */
function battleOver(kernel: TurnKernel, w: World): boolean {
  return (["own", "opponent"] as const).some((side) => {
    if (sideCanSwitch(kernel.input, side) !== false) return false;
    const present = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side && w.mons[slot]);
    return present.length > 0 && present.every((slot) => w.mons[slot]!.fainted);
  });
}

// ---------------- Commander (SV; T2P §2.1; PS/data/abilities.ts:604-640, PS/data/conditions.ts:807-844) ----------------

/**
 * The Dondozo a Tatsugiri commands as the turn starts, or null: Training's carried pair, or (the calculator, as entered: Q8's
 * rule, with its turn fact) a Tatsugiri (base species) whose Commander works (not under Neutralizing Gas, which comes out
 * first at the lead: TP1·C6) beside a Dondozo (base species).
 */
function commandedBy(kernel: TurnKernel, slot: DoublesSlotId): DoublesSlotId | null {
  const entry = kernel.input.pokemon[slot], ally = allyOf(slot);
  const partner = kernel.input.pokemon[ally];
  if (!entry || !partner || !partner.build.speciesId.startsWith("dondozo")) return null;
  if (entry.carried?.commanding) return ally;
  if (entry.build.abilityId !== "commander" || !entry.build.speciesId.startsWith("tatsugiri") || entry.build.transformedFrom) return null;
  if (kernel.gas?.suppressed.includes(slot)) return null;
  return ally;
}

/**
 * As entered: Commander is modelled (the pair from the start); a pair formed by a newcomer keeps notIn2v2("Commander")
 * (doubles-switch.ts abilityEntry).
 */
export function commanderGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void kernel; void w; void slot;
}

/** The invulnerability step, first (C27): a commanding Tatsugiri is missed by every move but Helping Hand (PS/sim/battle-actions.ts:621-627). */
export function invulnerable(kernel: TurnKernel, w: World, attacker: DoublesSlotId, slot: DoublesSlotId): string | null {
  void kernel; void attacker;
  return w.mons[slot]?.commanding ? "Commander" : null;
}

/** Whether `slot` cannot leave (Commander's pair: onDragOut false; Eject Button, Eject Pack and Red Card do nothing; a switching move does not switch). */
export function cannotLeave(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean {
  void kernel;
  const mon = w.mons[slot];
  return !!mon && !mon.fainted && (mon.commanding !== undefined || mon.commanded !== undefined);
}

/** A Pokémon fainting: a commanded Dondozo's Tatsugiri stops commanding at the next Update (TP1·C2), before any later action. */
export function onFaint(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void kernel;
  const mon = w.mons[slot]!;
  const other = mon.commanded ?? mon.commanding;
  if (other === undefined) return;
  delete mon.commanded; delete mon.commanding;
  const partner = w.mons[other];
  if (partner) { delete partner.commanding; delete partner.commanded; }
}

/** E2's volatiles of PR's states (doubles-turn.ts outcomeOf, with the integrator's line): "commanding" and "commanded". */
export function outcomeVolatiles(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] {
  void kernel;
  const mon = w.mons[slot];
  if (!mon || mon.fainted) return [];
  return [...(mon.commanding !== undefined ? ["commanding"] : []), ...(mon.commanded !== undefined ? ["commanded"] : [])];
}

/** The actions the turn's root worlds queue (doubles-turn.ts rootWorlds): a commanding Tatsugiri takes none (onBeforeTurn cancelAction). */
export function rootActions<T extends { slot: DoublesSlotId }>(kernel: TurnKernel, actions: T[]): T[] {
  const out = actions.filter((action) => commandedBy(kernel, action.slot) === null);
  return out.length === actions.length ? actions : out;
}

// ---------------- Poison Puppeteer (SV; T2P §2.2; PS/data/abilities.ts:3357-3368) ----------------

/**
 * A presence third party on the field: none is left (status2 integration 1b emptied PRESENCE_THIRD_PARTY: Poison Puppeteer is
 * modelled, afterSetStatus; Imposter is the settle's, doubles-start.ts). Kept as the hook presenceGuards names.
 */
export function thirdPartyGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId) {
  void kernel; void w; void slot;
}

/**
 * After a status is set (doubles-status.ts setStatus's end): Pecharunt's Poison Puppeteer (onAnyAfterSetStatus) confuses a
 * Pokémon other than itself that its move poisoned or badly poisoned (Toxic, Poison Gas, a flung Toxic Orb: the effect a
 * Move). addVolatile('confusion') with no source: Own Tempo (breakable by no move here) and a confusion already up stop it;
 * Misty Terrain cannot (a grounded target in it was not poisoned); Safeguard does not (no source). `use`: the status move's
 * use, for the hit fact (the kernel passes it with the integrator's line; without it the confusion lands with no fact).
 */
export function afterSetStatus(kernel: TurnKernel, w: World, slot: DoublesSlotId, status: BattleStatus, source: DoublesSlotId | null, use?: Use) {
  if (status !== "psn" && status !== "tox") return;
  if (source === null || source === slot || !kernel.alive(w, source)) return;
  const holder = w.mons[source]!.build;
  if (holder.abilityId !== "poisonpuppeteer" || !holder.speciesId.startsWith("pecharunt")) return;
  const mon = w.mons[slot]!;
  if (mon.fainted || mon.vol.confusion || mon.build.abilityId === "owntempo") return;
  setVol(w, slot, { confusion: { attempts: 0, min: 2 } });
  const text = `${kernel.abilityName("poisonpuppeteer")}: ${kernel.names[slot]} becomes confused.`;
  if (use) {
    if (use.reached.has(slot)) kernel.hitFact(use.action, slot, text, w.mass);
    else kernel.stepFact(use.action, text, w.mass);
  }
}

// ---------------- Dancer (SV, USUM; T2P §2.3; PS/sim/battle-actions.ts:310-345) ----------------

/** Dancer copies the dance moves (afterAction); a tie of stored Speed with the entry order unknown is its narrow reason there. */
export function dancerGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, moveId: string) {
  void kernel; void w; void slot; void moveId;
}

/**
 * A status dance's own effect applied (doubles-status.ts effects and onHit): its boost changed a stage (sim/battle.ts boost's
 * success: Feather Dance's drop before the target's Defiant or Competitive and White Herb at AfterMove), Teeter Dance's
 * confusion was added to a target (before a Persim or Lum Berry cures it at the Update), Lunar Dance's user fainted. That is
 * moveDidSomething, useMove's own result (PS/sim/battle-actions.ts:304, read at :319; runMoveEffects' didSomething). A +6 or
 * −6 cap, Clear Body, Mirror Armor, Own Tempo or a confusion already up applies nothing. Only the action's own dance a Dancer
 * could copy (statusMove's `dance` mark) is marked; a bounced or snatched use is another Pokémon's.
 */
export function danceEffect(kernel: TurnKernel, w: World, use: Use) {
  void kernel;
  if (use.bounced || use.snatched || use.action.moveId !== use.move.id || !DANCE_MOVES.has(use.move.id)) return;
  if (marksOf(w, use.action.slot)?.dance) mark(w, use.action.slot, { did: true });
}
/** A Dancer that can copy a dance of `user` in this world (hasAbility, alive, not semi-invulnerable). */
const dancersOf = (w: World, user: DoublesSlotId) => DOUBLES_SLOTS.filter((slot) => slot !== user && !!w.mons[slot] && !w.mons[slot]!.fainted
  && w.mons[slot]!.build.abilityId === "dancer" && !w.mons[slot]!.eot.hidden && w.mons[slot]!.commanding === undefined);

/**
 * The Dancers' copies of `action`'s dance (PS/sim/battle-actions.ts:317-345, after the dance's AfterMove): every other active
 * Dancer that is not semi-invulnerable, slowest stored Speed first (storedStats.spe: Speed Swap and Power Trick in, stages and
 * items out), equal stored Speed newest ability state first (history.entryTie; unknown: needsEntryOrder). The battle-over
 * check runs before each; a fainted Dancer is skipped. Its target: the dance's last target (activeTarget) when that is not the
 * Dancer's ally and the dance's user is, else the dance's user. Each copy is an external use (kernel.externalUse: its own
 * BeforeMove, no PP, no last move), its own step (DoublesStep.copied "Dancer").
 */
function dancerCopies(kernel: TurnKernel, w: World, action: PendingAction, did: boolean, hit: DoublesSlotId | undefined): World[] | null {
  const moveId = action.moveId;
  if (!did || action.external || !moveId || !DANCE_MOVES.has(moveId)) return null;
  const move = kernel.runtime.movesById.get(moveId)!;
  // A damaging dance's Z-Move or Max Move has no dance flag; a status Z-Move keeps the move's (getActiveZMove); a Dynamaxed
  // Pokémon's status move is Max Guard.
  if (isMaxActive(w.mons[action.slot]!.build)) return null;
  if (move.category !== "Status" && kernel.input.pokemon[action.slot]?.contexts[moveId]?.useZ) return null;
  const dancers = dancersOf(w, action.slot);
  if (!dancers.length) return null;
  const stored = (slot: DoublesSlotId) => kernel.buildStats(w.mons[slot]!.build)?.spe ?? 0;
  // Ties of stored Speed are read in slot order (the narrow reason names the pair so), then sorted newest first.
  const older = new Map<string, DoublesSlotId>();
  for (const [at, a] of dancers.entries()) for (const b of dancers.slice(at + 1)) if (stored(a) === stored(b)) older.set(`${a}|${b}`, entryOlder(kernel, w, a, b));
  dancers.sort((a, b) => stored(a) - stored(b) || ((older.get(`${a}|${b}`) ?? older.get(`${b}|${a}`)) === a ? 1 : -1));
  const user = action.slot;
  const last = hit ?? user;
  let worlds = [w];
  for (const dancer of dancers) {
    const next: World[] = [];
    for (const world of worlds) {
      if (battleOver(kernel, world) || !kernel.alive(world, dancer)) { next.push(world); continue; }
      const target = kernel.isFoe(last, dancer) && !kernel.isFoe(user, dancer) ? last : user;
      // One step per copied action (its source) and per Pokémon (status2 R: a newcomer's copy is its own step, DoublesStep.id).
      const index = kernel.extraStep("Dancer", dancer, moveId, action.index, world.mons[dancer]!.id);
      const copy: PendingAction = { index, slot: dancer, moveId, target: kernel.positionOf(world, target), fractional: 0, external: true };
      kernel.stepFact(copy, `${kernel.abilityName("dancer")}: ${kernel.names[dancer]} copies ${move.name}.`, world.mass);
      carriedChoiceLock(kernel, world, dancer, moveId);
      next.push(...kernel.externalUse(world, dancer, moveId, copy.target, index));
    }
    worlds = next;
  }
  return worlds;
}
/**
 * A Choice lock from an earlier turn on a Dancer that copies `moveId` with no lock from this turn yet (data/conditions.ts
 * choicelock stays while its holder stays in; doubles-status.ts beforeMove follows this turn's). One that came in this turn
 * or has used no move since it came in (lastMove null) has none; one whose action this turn is not its last move cannot be
 * locked (the lock lets it pick no other). Otherwise it may be locked into its last move (its action's when lastMove is not
 * given and firstTurn is false), whether it held the item then is not given: not estimated where that move is not the
 * dance. With neither lastMove nor firstTurn given, its first turn is assumed (as for Fake Out): no lock, stated. A Choice
 * item that reached it this turn (choiceFresh: Trick, Switcheroo, Bestow, Recycle) ended any earlier lock: none.
 */
function carriedChoiceLock(kernel: TurnKernel, w: World, dancer: DoublesSlotId, moveId: string) {
  const mon = w.mons[dancer]!;
  if (mon.vol.choiceLock || mon.vol.choiceFresh || !CHOICE_ITEMS.has(mon.build.itemId) || !kernel.itemWorks(w, mon.build) || isMaxActive(mon.build)) return;
  const entry = kernel.input.pokemon[dancer];
  if (!entry || entry.switchedIn || entry.lastMove === null) return;
  const own = entry.action.moveId ?? "splash";
  if (entry.lastMove !== undefined && entry.lastMove !== own) return;
  if ((entry.lastMove ?? own) === moveId) return;
  const item = kernel.itemName(mon.build.itemId);
  if (entry.lastMove === undefined && entry.firstTurn !== false) {
    kernel.turnFact(`Assumes ${kernel.names[dancer]} is not locked into a move by ${item} from an earlier turn.`);
    return;
  }
  kernel.notEstimated(REASONS.needsChoiceLock(kernel.abilityName("dancer"), kernel.names[dancer], item));
}
/** Which of two Dancers at one stored Speed has the older ability state (N's history.entryTie: it copies after the newer); unknown: not estimated. */
function entryOlder(kernel: TurnKernel, w: World, a: DoublesSlotId, b: DoublesSlotId): DoublesSlotId {
  const older = historyHooks.entryTie(kernel, w, a, b);
  if (older === null) kernel.notEstimated(REASONS.needsEntryOrder(kernel.abilityName("dancer"), kernel.names[a], kernel.names[b]));
  return older;
}

// ---------------- the presence moves' guard ----------------

/**
 * The presence moves (Spotlight, Round, Beak Blast, Shell Trap, Beat Up, Fusion Bolt and Flare, the Counter family, Flame
 * Burst): every one is modelled (status2 integration 1b emptied PRESENCE_MOVES). Kept as the hook presenceGuards names.
 */
export function movesGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove) {
  void kernel; void w; void slot; void move;
}

/** Two different Pledges from partners combine (prepareHit, context, afterHit): modelled. */
export function pledgeGuard(kernel: TurnKernel, w: World, slot: DoublesSlotId, move: ChampionsMove) {
  void kernel; void w; void slot; void move;
}

// ---------------- the turn's start ----------------

/**
 * As the walk starts, after the turn's first Update (doubles-turn.ts walk): Beak Blast's heat and Shell Trap's set on each user
 * whose action is the move, not its Z-Move or Max Move (priorityChargeCallback, PS/data/moves.ts:1128, 16287), whatever then
 * stops it; Commander's pair (MonState.commanding / commanded) for a pair as entered, with its turn fact, and a skip fact for
 * a commanding Tatsugiri's chosen move.
 */
export function turnStart(kernel: TurnKernel, w: World) {
  for (const action of w.remaining) {
    if ((action.moveId !== "beakblast" && action.moveId !== "shelltrap") || zOrMax(kernel, w, action)) continue;
    setVol(w, action.slot, action.moveId === "beakblast" ? { beakBlast: true } : { shellTrap: { hit: false } });
  }
  const present = DOUBLES_SLOTS.filter((slot) => kernel.input.pokemon[slot]);
  for (const slot of DOUBLES_SLOTS) {
    const dondozo = commandedBy(kernel, slot);
    if (dondozo === null || !w.mons[slot] || !w.mons[dondozo] || w.mons[dondozo]!.fainted) continue;
    w.mons[slot]!.commanding = dondozo;
    w.mons[dondozo]!.commanded = slot;
    if (!kernel.input.pokemon[slot]!.carried?.commanding) kernel.turnFact(`Assumes ${kernel.names[slot]} went inside ${kernel.names[dondozo]} as they came in.`);
    const moveId = kernel.input.pokemon[slot]!.action.moveId;
    if (moveId !== null) kernel.skipFact({ index: present.indexOf(slot), slot, moveId, target: null, fractional: 0 }, `Inside ${kernel.names[dondozo]} (${kernel.abilityName("commander")}).`, w.mass);
  }
}

// ---------------- the action's own handling ----------------

/**
 * A presence status move's own handling (doubles-status.ts statusMove, first): none takes the move over (Spotlight is
 * guarded). A status dance a Dancer could copy is marked, for danceEffect's success mark; null.
 */
export function statusMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): World[] | null {
  copyMoves(kernel, w, action);
  if (action.external || !DANCE_MOVES.has(move.id) || !dancersOf(w, action.slot).length) return null;
  mark(w, action.slot, { dance: true });
  // Feather Dance's target as hit (activeTarget: the aimed Pokémon after redirection), which a Dancer partner copies it at.
  if (move.id === "featherdance" && action.target !== null) {
    const aimed = kernel.occupant(w, action.target);
    const info = kernel.moveInfo(w, action.slot, move.id, kernel.input.pokemon[action.slot]?.contexts[move.id]);
    const taken = info.kind === "move" && kernel.isFoe(action.slot, aimed) ? kernel.redirect(w, action.slot, aimed, info, move.id, undefined, move.type) : null;
    mark(w, action.slot, { target: taken?.slot ?? aimed });
  }
  return null;
}

/** Present's ModifyMove (PS/data/moves.ts:13920-13940): random(10): heal a quarter (2/10), 40 (4/10), 80 (3/10), 120 (1/10). */
const PRESENT: { power: number; chance: number }[] = [{ power: 0, chance: 0.2 }, { power: 40, chance: 0.4 }, { power: 80, chance: 0.3 }, { power: 120, chance: 0.1 }];
/** Magnitude's ModifyMove (PS/data/moves.ts:10891-10925): random(100): 10, 30, 50, 70, 90, 110, 150 at 5, 10, 20, 30, 20, 10, 5 %. */
const MAGNITUDE: { power: number; chance: number }[] = [
  { power: 10, chance: 0.05 }, { power: 30, chance: 0.1 }, { power: 50, chance: 0.2 }, { power: 70, chance: 0.3 }, { power: 90, chance: 0.2 }, { power: 110, chance: 0.1 }, { power: 150, chance: 0.05 },
];
/** The abilities whose ModifyType changes a move the turn's 2v2 contexts give a power (the kernel's usedType reads the move's dex type for them). */
const ATE: Readonly<Record<string, string>> = { aerilate: "Flying", pixilate: "Fairy", refrigerate: "Ice", galvanize: "Electric", dragonize: "Dragon" };
/** The history rows a 2v2 context answers (calculate.ts HISTORY_MOVES): their power or modifiers come from the turn's inputs. */
const ROW_MOVES: ReadonlySet<string> = new Set(["present", "magnitude", "pursuit", "retaliate", "furycutter", "rollout", "iceball", "echoedvoice", "trumpcard"]);

/**
 * Where a damaging move goes before resolveTargets (doubles-turn.ts damagingMove): the worlds a random power splits into
 * (Present, Magnitude: ModifyMove before TryMove, one roll per use), a Round pull tied in the queue (one world each), and the
 * guards of the moves this turn cannot follow: Pursuit after a foe switched in (C30), a later move of a side under the rainbow
 * with an added effect, Gyro Ball and Electro Ball reading a swamped Speed, a history row whose type its user's ability
 * changes. Present's heal is prepareHit's. null: the kernel's resolution.
 */
export function aim(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo): Resolution[] | null {
  const id = action.moveId!;
  const user = w.mons[action.slot]!;
  const move = kernel.runtime.movesById.get(id)!;
  const name = kernel.names[action.slot];
  copyMoves(kernel, w, action);
  // The rainbow (waterpledge's onModifyMove: the added effects' chances ×2) on the user's side from this turn: a move with
  // an added effect is not followed (a doubled chance can reach 100%).
  if (w.sides[slotSide(action.slot)].pledge?.water && info.secondaries) kernel.notEstimated(REASONS.combo(info.effective.name, "the rainbow"));
  // Gyro Ball and Electro Ball read Speed the calculation does not swamp (grasspledge onModifySpe ×0.25).
  if (!info.transformed && (id === "gyroball" || id === "electroball") && DOUBLES_SLOTS.some((slot) => w.sides[slotSide(slot)].pledge?.grass && kernel.alive(w, slot))) {
    kernel.notEstimated(REASONS.combo(move.name, "the swamp"));
  }
  if (info.transformed) return null;
  // Pursuit (USUM, C30): a foe that switched in this turn left past an adjacent Pursuit user, which used its action on it.
  // The switch before the moves (the turn's input, baseInput); a newcomer of this turn's switches (status2 R, its input view's
  // switchedIn) came in after the leaver's BeforeSwitchOut, which R follows (doubles-switch.ts beforeSwitchOut).
  if (id === "pursuit" && DOUBLES_SLOTS.some((slot) => kernel.isFoe(slot, action.slot) && kernel.baseInput.pokemon[slot]?.switchedIn)) {
    kernel.notEstimated(REASONS.combo(move.name, "a Pokémon that switched in this turn"));
  }
  if (ROW_MOVES.has(id)) {
    // The calculation types the row's move as used (its 2v2 context gives the power); the kernel's hit steps read its dex
    // type for it (usedType: the row's own calculation answers no history), which differs only where its user's ability or
    // Electrify retypes it: not followed where an absorbing or redirecting ability of that type is in the turn.
    const ability = user.build.abilityId;
    const retype = user.vol.electrify ? { type: "Electric", by: kernel.moveName("electrify") }
      : move.type === "Normal" && ATE[ability] ? { type: ATE[ability], by: kernel.abilityName(ability) }
      : ability === "normalize" && move.type !== "Normal" ? { type: "Normal", by: kernel.abilityName(ability) }
      : ability === "liquidvoice" && id === "echoedvoice" ? { type: "Water", by: kernel.abilityName(ability) }
      : w.field.ionDeluge && move.type === "Normal" ? { type: "Electric", by: kernel.moveName("iondeluge") } : null;
    const reads = !!retype && DOUBLES_SLOTS.some((slot) => {
      if (slot === action.slot || !kernel.alive(w, slot)) return false;
      const held = w.mons[slot]!.build.abilityId;
      return ABSORBING[held]?.type === retype.type || REDIRECT_ABILITIES[held] === retype.type;
    });
    if (retype && reads) kernel.notEstimated(REASONS.combo(move.name, retype.by));
  }
  // Bide (USUM, PS/data/moves.ts:1264-1338): a first use starts storing (its volatile; the move is used); a storing turn's
  // BeforeMove activates it and its beforeMoveCallback ends the action (no move used); a release (bide's onBeforeMove at
  // duration 1) is bideRelease.
  if (id === "bide") {
    const carried = kernel.input.pokemon[action.slot]!.carried?.bide;
    if (carried?.release) return bideRelease(kernel, w, action, info, move, carried);
    if (!carried) {
      kernel.turnFact(`Assumes ${name} did not use ${move.name} on an earlier turn.`);
      return [{ world: w, targets: [], spread: false, facts: [`${name} stores energy (${move.name}).`], failed: true }];
    }
    unused(kernel, w, action, `${name} stores energy (${move.name}).`);
    return [{ world: w, targets: [], spread: false, facts: [], failed: true }];
  }
  const kind = COUNTERS[id];
  if (kind) return counterAim(kernel, w, action, info, move, kind);
  let worlds: World[] | null = null;
  if (id === "present" || id === "magnitude") {
    worlds = (id === "present" ? PRESENT : MAGNITUDE).map(({ power, chance }) => {
      const world = cloneWorld(w, w.mass * chance);
      mark(world, action.slot, { power });
      return world;
    });
  } else if (id === "round") {
    // Round's onTry pulls the first queued Round (not a Z-Move or Max Move; a fainted Pokémon's too: TP5·E4) in queue order.
    const rounds = w.remaining.filter((each) => each.moveId === "round" && !zOrMax(kernel, w, each));
    const first = rounds.length > 1 ? firstQueued(kernel, w, rounds) : [];
    if (first.length > 1) worlds = evenly(w, first).map(({ world, choice }) => { mark(world, action.slot, { pull: choice.slot }); return world; });
  }
  if (!worlds) return null;
  return worlds.flatMap((world) => {
    const resolutions = kernel.resolveTargets(world, action, info);
    if (id !== "present" || marksOf(world, action.slot)?.power !== 0) return resolutions;
    // Present's heal: the whole use here (its TryMove cannot fail: priority 0, no Z-Move), the kernel's steps then skipped.
    return resolutions.flatMap((resolution) => {
      if (!resolution.targets.length) return [resolution];
      if (resolution.swap) kernel.stepFact(action, resolution.swap, resolution.world.mass);
      return presentHeal(kernel, resolution.world, action, info, resolution.targets[0])
        .map((healed) => ({ world: healed, targets: [], spread: false, facts: resolution.facts, failed: true as const }));
    });
  });
}

/**
 * A damaging move's Try after moveFailure (doubles-turn.ts damagingMove, per resolution): Shell Trap's TryMove without a
 * physical hit from a foe (`cant`), Round's onTry pulling the next queued Round to move next with source Round (120 power),
 * Trump Card with no PP left. A failure text, or null.
 */
export function tryMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, target: DoublesSlotId, priority: number, info: TurnMoveInfo): string | null {
  void target; void priority;
  if (info.transformed) return null;
  const name = kernel.names[action.slot];
  // status2 integration 1b (FC's ask): Echoed Voice's onTryMove adds the echoedvoice pseudo-weather (PS/data/moves.ts
  // echoedvoice; sim/field.ts addPseudoWeather runs PseudoWeatherChange for a new one only, none on a restart): new with none
  // from last turn (echoedVoice 0) and none earlier this turn (World.fieldSet, kept only while a Room Service holder is in the
  // turn: the readers rule), when, with Trick Room up, each held Room Service is used (doubles-fieldchange.ts).
  if (move.id === "echoedvoice" && kernel.input.echoedVoice === 0 && !w.fieldSet?.echoedVoice
    && DOUBLES_SLOTS.some((slot) => kernel.input.pokemon[slot]?.build.itemId === "roomservice")) {
    w.fieldSet = { ...w.fieldSet, echoedVoice: true };
    fieldChangeHooks.pseudoWeatherChanged(kernel, w, "echoedvoice", action);
  }
  if (move.id === "shelltrap" && !w.mons[action.slot]!.vol.shellTrap?.hit) return `${move.name} fails: ${name} took no physical hit.`;
  if (move.id === "trumpcard" && kernel.input.pokemon[action.slot]?.carried?.ppLeft?.trumpcard === 0) return `${move.name} fails: ${name} has no PP left for it.`;
  if (move.id === "round") {
    const rounds = w.remaining.filter((each) => each.moveId === "round" && !zOrMax(kernel, w, each));
    if (!rounds.length) return null;
    const marked = marksOf(w, action.slot)?.pull;
    const pulled = marked !== undefined ? rounds.find((each) => each.slot === marked)! : firstQueued(kernel, w, rounds)[0];
    if (kernel.prioritize(w, pulled.slot, "next")) {
      w.remaining = w.remaining.map((each) => (each.slot === pulled.slot && each.index === pulled.index ? { ...each, source: "round" } : each));
      kernel.stepFact(action, `${move.name}: ${kernel.names[pulled.slot]} moves next.`, w.mass);
    }
  }
  return null;
}

/** The combined Pledges' type and the side condition each pair starts (PS/data/moves.ts firepledge, grasspledge, waterpledge onModifyMove). */
function pledgePair(a: string, b: string): { type: string; kind: "fire" | "grass" | "water"; foe: boolean } | null {
  const pair = new Set([a, b]);
  if (pair.size !== 2) return null;
  if (pair.has("firepledge") && pair.has("grasspledge")) return { type: "Fire", kind: "fire", foe: true };
  if (pair.has("grasspledge") && pair.has("waterpledge")) return { type: "Grass", kind: "grass", foe: true };
  return { type: "Water", kind: "water", foe: false };
}

/**
 * A damaging move's own PrepareHit before Protean (doubles-turn.ts damagingMove): a Pledge whose living ally has a different
 * Pledge queued (not a Z-Move or Max Move) waits: the ally's action moves next with this move as its source and this one stops
 * silently (PS/data/moves.ts:5397-5410); the combined Pledge's fact. The worlds that stop here, or null.
 */
export function prepareHit(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo): World[] | null {
  if (info.transformed) return null;
  const id = action.moveId!;
  if (PLEDGE_MOVES.has(id)) {
    if (action.source && PLEDGE_MOVES.has(action.source) && action.source !== id) {
      const pair = pledgePair(id, action.source)!;
      kernel.stepFact(action, `${kernel.moveName(action.source)} and ${kernel.moveName(id)} combine: ${pair.type}, 150 power.`, w.mass);
      return null;
    }
    const ally = allyOf(action.slot);
    const queued = queuedOf(w, ally);
    if (queued?.moveId && PLEDGE_MOVES.has(queued.moveId) && queued.moveId !== id && kernel.alive(w, ally) && !zOrMax(kernel, w, queued)) {
      kernel.prioritize(w, ally, "next");
      w.remaining = w.remaining.map((each) => (each.slot === ally && each.index === queued.index ? { ...each, source: id } : each));
      kernel.stepFact(action, `${kernel.moveName(id)} waits for ${kernel.names[ally]}'s ${kernel.moveName(queued.moveId)}.`, w.mass);
      return [w];
    }
    return null;
  }
  return null;
}

/**
 * Present's heal (PS/data/moves.ts present onModifyMove: heal [1, 4], infiltrates; sim/battle-actions.ts runMoveEffects):
 * after the hit steps (the invulnerability step, Wide and Quick Guard, protection, Telepathy: hitChecks; Wonder Guard, which
 * Normal never passes; the type immunity, which Scrappy, Mind's Eye, Foresight and Ring Target lift), the target regains
 * round(base maximum HP / 4) through a Substitute, and nothing at full HP (`-fail`). No damage, no contact, no DamagingHit.
 */
function presentHeal(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, target: DoublesSlotId): World[] {
  const attacker = action.slot;
  const priority = action.frozen ? action.frozen.priority - action.fractional : kernel.priorityOf(w, action);
  // PrepareHit's Protean and Libero (a Normal move).
  typingHooks.proteanGuard(kernel, w, attacker, "present", () => "Normal");
  const stats = kernel.hitStats(action, target);
  if (stats) stats.reached += w.mass;
  const [check] = kernel.hitChecks(w, action, info, [target], false, priority);
  if (check.block) return kernel.blockedHit(w, action, info, check);
  const mon = w.mons[target]!;
  const name = kernel.names[target];
  const user = w.mons[attacker]!.build;
  const immune = (text: string) => { if (stats) stats.noDamage += w.mass; kernel.hitFact(action, target, text, w.mass); return [w]; };
  const broken = kernel.breaks(w, attacker, target, info);
  if (mon.build.abilityId === "wonderguard" && target !== attacker && !broken) return immune(`${kernel.abilityName("wonderguard")}: ${name} is immune.`);
  const ringTarget = mon.build.itemId === "ringtarget" && kernel.itemWorks(w, mon.build);
  const revealed = mon.vol.revealed === "foresight" || user.abilityId === "scrappy" || user.abilityId === "mindseye";
  if (kernel.typesIn(w, target).includes("Ghost") && !ringTarget && !revealed) return immune(`${name} is immune.`);
  const { maxHP, baseMaxHP } = kernel.hp[target];
  const amount = Math.round(baseMaxHP / 4);
  if (stats) stats.effect += w.mass;
  const healed = mapHP(w, target, (hp) => (hp >= maxHP ? { hp, tag: "full" } : { hp: Math.min(maxHP, hp + amount), tag: "healed" }));
  return healed.map(({ world, tag }) => {
    if (tag === "full") kernel.hitFact(action, target, `${kernel.moveName("present")} fails: ${name} is at full HP.`, world.mass);
    else {
      kernel.hitFact(action, target, `${kernel.moveName("present")}: ${name} regains HP.`, world.mass);
      world.mons[target]!.hurt = mon.hurt;
    }
    return world;
  });
}

// ---------------- the Counter family (T2P §3.7; PS/data/moves.ts counter, mirrorcoat, metalburst, comeuppance) ----------------

/**
 * What each records (MonState.taken): Counter the last physical hit from a foe (its volatile's onDamagingHit: slot and damage,
 * per hit, so a multi-hit move's last), Mirror Coat the last special one, Metal Burst and Comeuppance the last damaging move
 * from a foe (pokemon.attackedBy, after the hit loop: its last hit's damage; getLastDamagedBy(true)). Hits into a Substitute
 * and a face's 0-damage hit record nothing they read.
 */
const COUNTERS: Readonly<Record<string, "physical" | "special" | "any">> = { counter: "physical", mirrorcoat: "special", metalburst: "any", comeuppance: "any" };
const LAST_HIT = Object.freeze({ lastHit: true as const });

/** The Counter-family move `slot` has queued as itself (not as a Z-Move or Max Move), or undefined: its hits from foes are recorded (the readers rule). */
function counterQueued(kernel: TurnKernel, w: World, slot: DoublesSlotId): "physical" | "special" | "any" | undefined {
  const queued = queuedOf(w, slot);
  if (!queued?.moveId || !COUNTERS[queued.moveId] || zOrMax(kernel, w, queued) || !kernel.alive(w, slot)) return undefined;
  return COUNTERS[queued.moveId];
}

/** Whether the turn records MonState.taken: a Counter-family move is queued as itself. */
export function tracksHits(kernel: TurnKernel): boolean {
  return DOUBLES_SLOTS.some((slot) => {
    const moveId = kernel.input.pokemon[slot]?.action.moveId;
    return !!moveId && !!COUNTERS[moveId];
  });
}

/**
 * The step report PR asks of one pair's step (doubles-turn.ts searchFor, with the integrator's line): the last hit (damage and
 * the category it was used with: uses-to-ko.ts report.lastHit) for a foe's hit into a Pokémon with a Counter-family move
 * queued; else null (today's step).
 */
export function stepReport(kernel: TurnKernel, w: World, attacker: DoublesSlotId | null, target: DoublesSlotId, moveId: string): { lastHit?: true; dealt?: true } | null {
  void moveId;
  if (attacker === null || attacker === target) return null;
  // A releasing Bide stores every move's damage, an ally's too (its onDamage: a Move effect with a source).
  if (bideReleases(kernel, w, target)) return DEALT;
  if (!kernel.isFoe(attacker, target)) return null;
  return counterQueued(kernel, w, target) ? LAST_HIT : null;
}
// The last hit too, so that the kernel keeps each dealt amount's child apart (its split reads a reported last hit).
const DEALT = Object.freeze({ lastHit: true as const, dealt: true as const });

/** Whether `slot` releases a carried Bide this turn (its Bide queued): the moves' damage before it adds to the store. */
function bideReleases(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean {
  if (!kernel.input.pokemon[slot]?.carried?.bide?.release) return false;
  const queued = queuedOf(w, slot);
  return queued?.moveId === "bide" && kernel.alive(w, slot);
}

/**
 * A landed hit's record (afterHit; the child world's own last hit, which the kernel's split by lastHit keeps apart): a foe's
 * on a Counter-family user; any Pokémon's on a releasing Bide holder, added up, with its user (bide onDamage: totalDamage,
 * lastDamageSource: the Pokémon, wherever it stands).
 */
function recordHit(kernel: TurnKernel, w: World, attacker: DoublesSlotId, target: DoublesSlotId, outcome: TurnStepOutcome) {
  const holder = w.mons[target]!;
  if (outcome.dealt !== undefined && attacker !== target && bideReleases(kernel, w, target)) {
    holder.taken = { any: { from: attacker, damage: (holder.taken?.any?.damage ?? 0) + outcome.dealt } };
    return;
  }
  if (!outcome.lastHit || !kernel.isFoe(attacker, target)) return;
  const kind = counterQueued(kernel, w, target);
  if (!kind) return;
  if (kind !== "any" && (kind === "physical") !== (outcome.lastHit.category === "Physical")) return;
  holder.taken = { ...holder.taken, [kind]: { from: kernel.positionOf(w, attacker), damage: outcome.lastHit.damage } };
}

/** An action that ends with no move used (its step: not a move, a skip fact), as a storing Bide and a release in BeforeMove are. */
function unused(kernel: TurnKernel, w: World, action: PendingAction, text: string) {
  const step = kernel.step(action);
  if (step) step.moves -= w.mass;
  kernel.skipFact(action, text, w.mass);
}

/**
 * A carried Bide's release (its onBeforeMove at duration 1, after the BeforeMove checks above priority 0): twice the damage
 * stored (the input's, then this turn's moves' before it) at the last Pokémon that damaged it (this turn's, else the input's;
 * one not in battle: a random adjacent foe, getRandomTarget), through tryMoveHit: no protection, no hit steps but the type
 * immunity (getDamage runImmunity: a Ghost is immune), a Substitute, the Damage and DamagingHit events (Sturdy, Endure, Focus
 * Sash and Band, Disguise, contact retaliation). Nothing stored or no source: `-fail`. The release has no move line but its
 * unsilenced `-end` (the oracle's use: the step's `moves`), and its target is reached where its damage is computed.
 */
function bideRelease(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, move: ChampionsMove, carried: { stored: number; source: DoublesSlotId | null }): Resolution[] {
  const slot = action.slot;
  const user = w.mons[slot]!;
  const record = user.taken?.any;
  const total = carried.stored + (record?.damage ?? 0);
  const source = record ? record.from : carried.source;
  const done = (worlds: World[], facts: string[] = []) => worlds.map((world): Resolution => {
    if (world.mons[slot]!.vol.bide) setVol(world, slot, { bide: undefined });
    delete world.mons[slot]!.taken;
    return { world, targets: [], spread: false, facts, failed: true };
  });
  // `-fail` with nothing stored or no Pokémon that damaged it (its -end line first: the oracle counts the release as its use).
  if (!total) return done([w], [`${move.name} fails: ${kernel.names[slot]} stored no damage.`]);
  if (source === null) return done([w], [`${move.name} fails: no Pokémon damaged ${kernel.names[slot]}.`]);
  if (user.build.abilityId === "protean" || user.build.abilityId === "libero") kernel.notEstimated(REASONS.combo(move.name, kernel.abilityName(user.build.abilityId)));
  // A source that fainted: getRandomTarget's random adjacent foe (in 2v2 one is left while the battle goes on).
  const foes = DOUBLES_SLOTS.filter((each) => kernel.isFoe(each, slot) && kernel.alive(w, each));
  if (!kernel.alive(w, source) && !foes.length) return done([w], [`${move.name} misses.`]);
  const targets: { world: World; target: DoublesSlotId; facts: string[] }[] = kernel.alive(w, source) ? [{ world: w, target: source, facts: [] }]
    : evenly(w, foes).map(({ world, choice }) => ({ world, target: choice, facts: [`${kernel.names[source]} fainted: ${move.name} hits ${kernel.names[choice]}.`] }));
  const out: World[] = [];
  for (const { world, target, facts } of targets) {
    kernel.stepFact(action, `${kernel.names[slot]} unleashes the energy (${move.name}): twice the ${total} HP stored.`, world.mass);
    for (const fact of facts) kernel.stepFact(action, fact, world.mass);
    if (world.mons[target]!.vol.substitute) kernel.notEstimated(REASONS.combo(move.name, `${kernel.names[target]}'s Substitute`));
    // tryMoveHit skips the protection step (CQ10c): the calculation reads no Protect.
    const base = kernel.conditionsFor(world, slot, target, false, move.id);
    const conditions = base.defenderSide.protect ? { ...base, defenderSide: { ...base.defenderSide, protect: false } } : base;
    const context: MoveContext & { fixedDamage?: number } = { fixedDamage: 2 * total };
    const entry = kernel.searchFor(world, slot, target, move.id, conditions, context);
    // tryMoveHit has no hit steps: a target its damage is computed for is reached (getDamage: not a type immunity).
    const reached = () => { const stats = kernel.hitStats(action, target); if (stats) stats.reached += world.mass; };
    if (entry.row.kind !== "calculated") {
      const face = kernel.faceTaken(world, slot, target, entry.row, move);
      if (face) { reached(); out.push(...kernel.faceHit(world, action, info, target, face, false)); continue; }
      kernel.notEstimated(kernel.rowReason(world, target, entry.row, move));
    }
    kernel.focusBandGuard(world, target, entry.row);
    if (!entry.search) { kernel.hitFact(action, target, kernel.noDamageFact(entry.row, move, target), world.mass); out.push(world); continue; }
    reached();
    kernel.unnerveGuard(world, slot, target);
    for (const child of kernel.applyStep(world, action, target, entry, info, false)) {
      if (child.knocked) kernel.koBoost(child.world, slot, 1);
      out.push(child.world);
    }
  }
  return done(out);
}

/**
 * A Counter-family move's target and its fixed damage (counter onTry, onRedirectTarget at priority −1; metalburst onTry,
 * onModifyTarget): nothing recorded fails at Try; the centres of attention (Spotlight, Follow Me, Rage Powder) take it first;
 * else the Pokémon now standing where the recorded attacker stood (Ally Switch: TP2·C12): fainted, Counter and Mirror Coat
 * have no target (TP5·E1), Metal Burst and Comeuppance go to a random living foe (getMoveTargets retargets a fainted foe).
 * Parental Bond's two full hits are not followed.
 */
function counterAim(kernel: TurnKernel, w: World, action: PendingAction, info: TurnMoveInfo, move: ChampionsMove, kind: "physical" | "special" | "any"): Resolution[] {
  const slot = action.slot;
  const name = kernel.names[slot];
  const record = w.mons[slot]!.taken?.[kind];
  if (!record) {
    const what = kind === "physical" ? "took no physical hit" : kind === "special" ? "took no special hit" : "took no damage from a foe this turn";
    return [{ world: w, targets: [], spread: false, facts: [`${move.name} fails: ${name} ${what}.`], failed: true }];
  }
  if (w.mons[slot]!.build.abilityId === "parentalbond") kernel.notEstimated(REASONS.combo(move.name, kernel.abilityName("parentalbond")));
  const foes = DOUBLES_SLOTS.filter((each) => kernel.isFoe(each, slot) && kernel.alive(w, each));
  const recorded = kernel.occupant(w, record.from);
  const out: Resolution[] = [];
  const at = (world: World, target: DoublesSlotId, facts: string[]) => {
    const taken = kernel.redirect(world, slot, target, info, move.id, undefined, move.type);
    const routed = taken?.slot ?? target;
    out.push({ world, targets: [routed], spread: false, facts: taken && routed !== target ? [...facts, `${taken.by}: ${kernel.names[routed]} takes ${move.name}.`] : facts });
  };
  if (kernel.alive(w, recorded)) at(w, recorded, []);
  else if (kind !== "any") {
    // A centre still takes it (its redirect runs first); with none the move has no target.
    const taken = foes.length ? kernel.redirect(w, slot, foes[0], info, move.id, undefined, move.type) : null;
    if (taken) out.push({ world: w, targets: [taken.slot], spread: false, facts: [`${taken.by}: ${kernel.names[taken.slot]} takes ${move.name}.`] });
    else out.push({ world: w, targets: [], spread: false, facts: [] });
  } else if (!foes.length) out.push({ world: w, targets: [], spread: false, facts: [] });
  else for (const { world, choice } of evenly(w, foes)) at(world, choice, [`${kernel.names[recorded]} fainted: ${move.name} hits ${kernel.names[choice]}.`]);
  for (const resolution of out) {
    if (resolution.targets.length) kernel.stepFact(action, `${move.name}: ${kind === "any" ? "1.5 times" : "twice"} the ${record.damage} HP ${name} took.`, resolution.world.mass);
  }
  return out;
}
/** The fixed damage (damageCallback): Counter and Mirror Coat 2 × damage, Metal Burst and Comeuppance floor(1.5 × damage); at least 1. */
const counterDamage = (kind: "physical" | "special" | "any", damage: number) => (kind === "any" ? Math.floor(damage * 1.5) : damage * 2) || 1;

// ---------------- the hits ----------------

/**
 * After a damaging hit (doubles-turn.ts afterHit, last): moveDidSomething's mark (a hit landed or met a Substitute) and a
 * dance's target; Beak Blast's heat burning a contact attacker (its onHit: trySetStatus from the holder; a multi-hit contact
 * move whose burn lands between its hits is intoBeakBlast); Shell Trap's trigger (a physical hit from a non-ally: gotHit, its
 * queued action next); Flame Burst's splash on the target's adjacent allies (onHit and onAfterSubDamage: baseMaxHP / 16, not
 * past Magic Guard); a combined Pledge's side condition (on a hit to the Pokémon); Order Up's rise for a commanded Dondozo.
 */
export function afterHit(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, outcome: TurnStepOutcome, info: TurnMoveInfo) {
  const attacker = action.slot;
  const id = action.moveId!;
  const hitAny = outcome.landed + outcome.subHits > 0;
  if (!hitAny) return;
  // moveDidSomething's mark, read at the action's end only by a dance a Dancer copies and by Fusion's memory.
  // A dance's target is activeTarget, set at hitStepAccuracy (PS/sim/battle-actions.ts:693) whether the hit then lands or a
  // Substitute takes it (:334-340: an ally Dancer copies at it).
  if (w.mons[attacker] && (DANCE_MOVES.has(id) || FUSION[id]) && !marksOf(w, attacker)?.did) mark(w, attacker, { did: true, ...(DANCE_MOVES.has(id) ? { target } : {}) });
  else if (w.mons[attacker] && DANCE_MOVES.has(id)) mark(w, attacker, { target });
  if (outcome.landed > 0) recordHit(kernel, w, attacker, target, outcome);
  const holder = w.mons[target]!;
  // Beak Blast: a contact hit into its heating holder burns the attacker.
  if (outcome.landed > 0 && holder.vol.beakBlast && info.contact && attacker !== target && kernel.alive(w, attacker)) {
    const was = w.mons[attacker]!.build;
    const probe = cloneWorld(w);
    kernel.giveStatus(probe, attacker, "brn", target);
    const after = probe.mons[attacker]!.build;
    // The burn landed (a curing Berry may have eaten it at once); one that stands burns the move's later hits.
    const lands = after.status !== was.status || after.itemId !== was.itemId;
    if (after.status === "brn" && was.status !== "brn" && outcome.landed > 1) kernel.notEstimated(REASONS.intoBeakBlast(info.effective.name, kernel.names[target]));
    if (lands) {
      kernel.giveStatus(w, attacker, "brn", target);
      kernel.hitFact(action, target, `${kernel.moveName("beakblast")}: ${kernel.names[attacker]} is burned.`, w.mass);
    }
  }
  // Shell Trap: a physical hit from a foe sets it off; its queued action moves next.
  if (outcome.landed > 0 && holder.vol.shellTrap && !holder.vol.shellTrap.hit && kernel.isFoe(attacker, target)) {
    const used = info.effective;
    if (!info.transformed && (used.id === "shellsidearm" || used.id === "photongeyser")) kernel.notEstimated(REASONS.combo(kernel.moveName("shelltrap"), used.name));
    if (used.category === "Physical") {
      setVol(w, target, { shellTrap: { hit: true } });
      const queued = queuedOf(w, target);
      if (queued && kernel.prioritize(w, target, "next")) kernel.stepFact(action, `${kernel.moveName("shelltrap")}: ${kernel.names[target]} moves next.`, w.mass);
    }
  }
  if (info.transformed) return;
  // Flame Burst's splash.
  if (id === "flameburst") {
    const ally = allyOf(target);
    if (kernel.alive(w, ally) && w.mons[ally]!.build.abilityId !== "magicguard") {
      const loss = Math.max(1, Math.floor(kernel.hp[ally].baseMaxHP / 16));
      kernel.lossFact(ally, `${kernel.names[ally]} loses ${loss} HP (${kernel.moveName("flameburst")}).`, w.mass);
      replaceWith(kernel, w, kernel.afterLoss(w, ally, loss), REASONS.combo(kernel.moveName("flameburst"), `${kernel.names[ally]}'s HP`));
    }
  }
  // A combined Pledge's side condition: the sea of fire and the swamp on the target's side, the rainbow on the user's.
  if (PLEDGE_MOVES.has(id) && action.source && PLEDGE_MOVES.has(action.source) && action.source !== id && outcome.landed > 0) {
    const pair = pledgePair(id, action.source)!;
    const side = pair.foe ? slotSide(target) : slotSide(attacker);
    const state = w.sides[side];
    if (!state.pledge?.[pair.kind]) {
      w.sides[side] = { ...state, pledge: { ...state.pledge, [pair.kind]: 4 } };
      const what = pair.kind === "fire" ? "The sea of fire" : pair.kind === "grass" ? "A swamp" : "A rainbow";
      kernel.stepFact(action, `${what} starts on ${sideName(side)}.`, w.mass);
    }
  }
  // Order Up (onAfterMoveSecondarySelf): a commanded Dondozo +1 Attack (Tatsugiri), Defense (Droopy) or Speed (Stretchy).
  if (id === "orderup" && w.mons[attacker]?.commanded !== undefined && kernel.alive(w, attacker) && w.mons[attacker]!.build.abilityId !== "sheerforce") {
    const tatsugiri = w.mons[w.mons[attacker]!.commanded!]!.build.speciesId;
    const stat = tatsugiri.startsWith("tatsugiridroopy") ? "def" : tatsugiri.startsWith("tatsugiristretchy") ? "spe" : "atk";
    const changed = kernel.applyBoosts(w, attacker, { [stat]: 1 }, attacker, { effect: "move" });
    const by = changed[stat] ?? 0;
    const names = { atk: "Attack", def: "Defense", spe: "Speed" } as const;
    if (by) kernel.stepFact(action, `${kernel.moveName("orderup")}: ${kernel.names[attacker]} +${by} ${names[stat]}.`, w.mass);
  }
}

/** `w` replaced in place by the one world `worlds` holds (an afterLoss in a hook that returns no worlds), or not estimated with `reason` when it split. */
function replaceWith(kernel: TurnKernel, w: World, worlds: World[], reason: string) {
  if (worlds.length !== 1) kernel.notEstimated(reason);
  const only = worlds[0];
  if (only === w) return;
  for (const key of Object.keys(w) as (keyof World)[]) delete w[key];
  Object.assign(w, only);
}

// ---------------- after the action ----------------

/**
 * After an action (doubles-turn.ts runMove's end, after the AfterMove copies, eventGuards and the history): Fusion's memory
 * (lastSuccessfulMoveThisTurn: the move as used when it did something, else null; read only for Fusion Bolt and Fusion Flare,
 * so any other move is null), Beak Blast's own AfterMove ending its heat, then the Dancers' copies. PR's marks go.
 */
export function afterAction(kernel: TurnKernel, w: World, action: PendingAction): World[] | null {
  const slot = action.slot;
  const marks = marksOf(w, slot);
  const id = action.moveId;
  const info = id && FUSION[id] ? kernel.moveInfo(w, slot, id, kernel.input.pokemon[slot]?.contexts[id]) : null;
  const did = !!marks?.did;
  if (w.didSomething !== undefined || w.lastSuccessful !== undefined) {
    const fusion = !!id && !!FUSION[id] && info?.kind === "move" && !info.transformed;
    w.lastSuccessful = did && fusion ? id : null;
    delete w.didSomething;
  }
  if (id === "beakblast" && w.mons[slot]?.vol.beakBlast) setVol(w, slot, { beakBlast: undefined });
  unmark(w, slot);
  // A Fusion move remembered: the No-move Pokémon still to act (context's guard: a No move between the two resets it).
  if (id && FUSION[id] && w.lastSuccessful === id) {
    const idle = w.remaining.filter((each) => each.moveId === null && each.slot !== slot).map((each) => each.slot);
    if (idle.length) mark(w, slot, { idle });
  }
  // A Counter-family record is read only while its user's move is queued (the readers rule): one no queued move reads goes.
  for (const each of DOUBLES_SLOTS) if (w.mons[each]?.taken && !counterQueued(kernel, w, each) && !bideReleases(kernel, w, each)) delete w.mons[each]!.taken;
  return dancerCopies(kernel, w, action, did, marks?.target);
}

/** A Dancer's copy that passed its BeforeMove (its step's `moves`: kernel.externalUse runs BeforeMove, then the move's own handling first calls statusMove or aim). */
function copyMoves(kernel: TurnKernel, w: World, action: PendingAction) {
  const step = action.external ? kernel.step(action) : null;
  if (step) step.moves += w.mass;
}

// ---------------- the contexts ----------------

/** The other Fusion move (PS/data/moves.ts fusionbolt, fusionflare onBasePower: 2x after it). */
const FUSION: Readonly<Record<string, string>> = { fusionbolt: "fusionflare", fusionflare: "fusionbolt" };
/** Trump Card's power by the PP left after this use (PS/data/moves.ts:20077-20110). */
const TRUMP: readonly number[] = [200, 80, 60, 50];

/**
 * The 2v2 context of a presence or history move (doubles-turn.ts contextFor; calculate.ts reads basePower, powerMods,
 * retypeTo, forceStab, switching): Round pulled by a Round (120); Fusion Bolt after Fusion Flare and the reverse (×2); a
 * combined Pledge (150, the pair's type, forced STAB); Present's and Magnitude's rolled power; Retaliate after a faint on its
 * side last turn (×2; the input's faintedLastTurn, else the row's reason); Fury Cutter 40 × min(4, 2^uses), at most 160;
 * Rollout and Ice Ball 30 × 2^hits, ×2 after Defense Curl; Echoed Voice 40 × min(5, m + 1) (40 with no Echoed Voice last
 * turn: the pseudo-weather's multiplier; every use this turn the same, C25); Trump Card by the PP left after this use and a
 * foe target's Pressure; Pursuit with no switching target (40); Beat Up's party at the use. None for a Z-Move or Max Move.
 */
export function context(kernel: TurnKernel, w: World, action: PendingAction, target: DoublesSlotId, info: TurnMoveInfo): MoveContext | undefined {
  if (info.transformed) return undefined;
  const id = action.moveId!;
  const slot = action.slot;
  const entry = kernel.input.pokemon[slot]!;
  const carried = entry.carried;
  switch (id) {
    case "round": return action.source === "round" ? { basePower: 120 } : undefined;
    case "fusionbolt": case "fusionflare": {
      // A No move that acted since the other Fusion move: past its BeforeMove (Splash: moveDidSomething) it resets the memory,
      // stopped there it does not. The kernel's No move does not reset it yet (W1B-PR.md: executeUsed's line), and its
      // BeforeMove rolls no paralysis or infatuation (doubles-status.ts beforeMove), so either way the memory is not followed.
      const idle = DOUBLES_SLOTS.flatMap((each) => marksOf(w, each)?.idle ?? []);
      const moved = idle.filter((each) => !w.remaining.some((queued) => queued.slot === each && queued.moveId === null));
      const unrolled = moved.some((each) => w.mons[each]!.build.status === "par" || !!w.mons[each]!.vol.attract);
      if (moved.length && (w.lastSuccessful === FUSION[id] || (w.lastSuccessful === null && unrolled))) {
        kernel.notEstimated(REASONS.combo(kernel.runtime.movesById.get(id)!.name, "No move"));
      }
      return w.lastSuccessful === FUSION[id] ? { powerMods: [8192] } : undefined;
    }
    case "firepledge": case "grasspledge": case "waterpledge": {
      if (!action.source || !PLEDGE_MOVES.has(action.source) || action.source === id) return undefined;
      return { basePower: 150, retypeTo: pledgePair(id, action.source)!.type, forceStab: true };
    }
    case "present": case "magnitude": {
      const power = marksOf(w, slot)?.power;
      return power ? { basePower: power } : undefined;
    }
    case "retaliate": {
      const fainted = kernel.input.faintedLastTurn?.[slotSide(slot)];
      return fainted === undefined ? undefined : { powerMods: fainted ? [8192] : [] };
    }
    case "furycutter": {
      const uses = carried?.furyCutter;
      return uses === undefined ? undefined : { basePower: Math.min(160, 40 * Math.min(4, 2 ** uses)) };
    }
    case "rollout": case "iceball": {
      const hits = carried?.rollout;
      return hits === undefined ? undefined : { basePower: 30 * 2 ** hits * (carried?.defenseCurl ? 2 : 1) };
    }
    case "echoedvoice": {
      const multiplier = kernel.input.echoedVoice;
      return multiplier === undefined ? undefined : { basePower: 40 * (multiplier === 0 ? 1 : Math.min(5, multiplier + 1)) };
    }
    case "trumpcard": {
      const left = carried?.ppLeft?.trumpcard;
      if (left === undefined) return undefined;
      // runMove deducts 1 (sim/battle-actions.ts:281), then useMoveInner Pressure's extra 1 for a foe target (:472-483). Where an
      // Instruct can come, the PP spent this turn is kept (doubles-calling.ts spendPP: this use's 1 at BeforeMove and its
      // Pressure after the targets, an instructed use's before it), which basePowerCallback reads at the hit (moveSlot.pp).
      const spent = w.mons[slot]?.vol.ppSpent?.trumpcard;
      const pressure = kernel.isFoe(slot, target) && w.mons[target]?.build.abilityId === "pressure" ? 1 : 0;
      const after = Math.max(0, spent !== undefined ? left - spent : left - 1 - pressure);
      return { basePower: TRUMP[after] ?? 40 };
    }
    // status2 R-E: at a switch-out's BeforeSwitchOut (doubles-switch.ts beforeSwitchOut: World.switching names the leaver), the
    // base power doubled (PS/data/moves.ts pursuit basePowerCallback: target.switchFlag, move.basePower * 2): 80 before the
    // onBasePower handlers, so Technician (60 or less) does not boost it; its accuracy true there (onModifyMove) changes nothing
    // the turn reads (every move hits).
    case "pursuit": {
      if (!w.switching?.some((p) => p.slot === target)) return { switching: false };
      return { switching: false, basePower: 80 };
    }
    case "counter": case "mirrorcoat": case "metalburst": case "comeuppance": {
      const record = w.mons[slot]!.taken?.[COUNTERS[id]];
      // A fixed hit (calculate.ts, with the integrator's MoveContext.fixedDamage): its damage, every modifier skipped.
      const fixed: MoveContext & { fixedDamage?: number } = record ? { fixedDamage: counterDamage(COUNTERS[id], record.damage) } : {};
      return record ? fixed : undefined;
    }
    case "beatup": return beatUpContext(kernel, w, action);
  }
  return undefined;
}

/**
 * Beat Up's party at the use (PS/data/moves.ts beatup onModifyMove: side.pokemon that is the user or not fainted with no
 * status; each hit 5 + floor(base Attack / 10) of its set species): the user, then its partner where it can hit, then the
 * input party's other members (the party context as given, else the side's bench: benchParty). side.pokemon puts Showdown's
 * position 0 first: a user at position 1 behind a partner that hits with a different power is not followed (count-moves.ts
 * puts the user's hit first). Without an input party, the row's reason stands.
 */
function beatUpContext(kernel: TurnKernel, w: World, action: PendingAction): MoveContext | undefined {
  const slot = action.slot;
  // status2 R-E: with the side's bench given (and no party context), the party is the bench now in team order (World.bench:
  // the input's bench Pokémon and those that left this turn), each without a status (side.pokemon: alive with no status).
  const given = kernel.input.pokemon[slot]!.contexts.beatup?.party ?? benchParty(kernel, w, slot);
  if (!given) return undefined;
  const ally = allyOf(slot);
  const partner = w.mons[ally];
  const team = (speciesId: string) => {
    const species = kernel.runtime.speciesById.get(speciesId);
    return species?.battleForm && species.baseSpecies ? species.baseSpecies : speciesId;
  };
  const rest = [...given];
  if (partner) {
    const at = rest.findIndex((id) => team(id) === team(partner.build.speciesId));
    if (at >= 0) rest.splice(at, 1);
  }
  const hits = !!partner && !partner.fainted && !partner.build.status;
  if (hits && SHOWDOWN_POSITION[kernel.positionOf(w, slot)].position === 1) {
    const power = (speciesId: string) => 5 + Math.floor((kernel.runtime.speciesById.get(team(speciesId))?.baseStats.atk ?? 0) / 10);
    if (power(partner.build.speciesId) !== power(w.mons[slot]!.build.speciesId)) kernel.notEstimated(REASONS.combo(kernel.moveName("beatup"), `${kernel.names[ally]}'s hit first`));
  }
  return { party: hits ? [partner.build.speciesId, ...rest] : rest };
}

/**
 * status2 R-E: Beat Up's party from the side's bench (PS/data/moves.ts beatup onModifyMove: side.pokemon past the two active
 * Pokémon, alive, with no status), its species in team order (World.bench, else the input's order); null without a bench.
 */
function benchParty(kernel: TurnKernel, w: World, slot: DoublesSlotId): string[] | null {
  const side = slotSide(slot);
  const bench = kernel.baseInput.bench?.[side];
  if (!bench) return null;
  const order = w.bench?.[side] ?? bench.map((each) => each.id);
  return order.flatMap((id) => {
    const left = w.benched?.[side]?.find((each) => each.id === id && !each.back);
    const build = left ? left.mon.build : id.startsWith("slot:") ? kernel.baseInput.pokemon[id.slice(5) as DoublesSlotId]?.build : bench.find((each) => each.id === id)?.build;
    return build && !build.status ? [build.speciesId] : [];
  });
}

// ---------------- Bide (USUM; T2P §6.1, C41) ----------------

/** A carried Bide (C41) at its BeforeMove: kept (no kernel call yet); the move's own use is aim's. */
export function bide(kernel: TurnKernel, w: World, action: PendingAction): World[] | null {
  void kernel; void w; void action;
  return null;
}

/** Whether `mon` is a commanding Tatsugiri (for other hook modules' reads). */
export const isCommanding = (mon: MonState | undefined) => mon?.commanding !== undefined;
