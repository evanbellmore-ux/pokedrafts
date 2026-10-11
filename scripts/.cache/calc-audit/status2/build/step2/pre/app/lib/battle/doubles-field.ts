import { ABSORBING, REASONS, SIDE_MOVES, STRONG_WEATHERS, TERRAIN_MOVES, WEATHER_MOVES } from "./doubles-actions";
import { DOUBLES_SLOTS, SHOWDOWN_POSITION, slotSide, type DoublesSideId, type DoublesSlotId, type SideClockFlag } from "./doubles-types";
import { cloneWorld, type PendingAction, type SideState, type World } from "./doubles-world";
import type { TurnKernel } from "./doubles-turn";
import * as fieldChangeNs from "./doubles-fieldchange";
import * as hiddenNs from "./doubles-hidden";
import * as itemNs from "./doubles-items";
import * as presenceNs from "./doubles-presence";
import * as typingNs from "./doubles-typing";
import { breaks, generation, hitFact, setEot, setVol, tableEntry, type StatusHandler, type Use } from "./doubles-use";
import type { ChampionsMove } from "./types";

// The hook namespaces are copied once into plain objects: under tsx (the bench and the verify harness) a namespace
// import's member is a getter over the module's own export getter, while a plain object keeps each hook call one property
// load. No runtime import of these modules is in a cycle (tests/source/status2-hooks.test.ts), so each namespace is
// complete when this module runs, and every export is a function or a const.
const fieldChangeHooks = { ...fieldChangeNs };
const hiddenHooks = { ...hiddenNs };
const itemHooks = { ...itemNs };
const presenceHooks = { ...presenceNs };

// Field, side, reflection and items (status2 SPEC2 §2.2's A3 rows, §3.5, §4.4; ADDENDUM2 §3.5, §4.2; F3 field-side-items.md
// §4-§5): Track A3's file. fieldMove (moved verbatim from doubles-status.ts in Step 0, now with the side clocks and
// World.fieldSet), Snatch's dispatch (snatch), the side's and Magic Coat's TryHit (tryHitSide), Mist's TryBoost (mistBlocks),
// and HANDLERS, the status-table handlers doubles-status.ts dispatches by key (moveTry, tryHit, volatile, onHit,
// sideOrField). Item moves are doubles-items.ts's (also A3's). Every rule cites pinned Showdown c23d2e94 (PS/data/moves.ts,
// PS/sim/...), probe ids are F3's (field-side-items-probes.out).

const STATUS_NOUNS: Readonly<Record<string, string>> = { slp: "sleep", par: "paralysis", brn: "burn", psn: "poison", tox: "bad poison", frz: "freeze" };
/** The curing Berries' statuses (data/items.ts lumberry, cheriberry, chestoberry, pechaberry, rawstberry, aspearberry onUpdate). */
const BERRY_CURES: Readonly<Record<string, readonly string[]>> = {
  lumberry: ["par", "brn", "psn", "tox", "slp", "frz"], cheriberry: ["par"], chestoberry: ["slp"], pechaberry: ["psn", "tox"], rawstberry: ["brn"], aspearberry: ["frz"],
};

// ------------------------------------------------------------------------------------------------------------------
// A stolen or reflected use (Snatch, Magic Coat): the Snatch user's or the holder's own use through kernel.useCalled
// ------------------------------------------------------------------------------------------------------------------

/**
 * The stolen or reflected use that runs now (PS/data/moves.ts snatch onAnyPrepareHit: useMove(move.id, snatchUser), its
 * sourceEffect 'snatch'; magiccoat onTryHit: useMove(newMove, target, { target: source }) with hasBounced): while it runs,
 * its own PrepareHit is not snatched again and its own TryHit not reflected again. kernel.useCalled carries `snatched` and
 * `bounced` into the use once the integrator's pass-through lands (needsFromIntegrator); until then the nested hooks below
 * mark the use themselves at its first PrepareHit or TryHit.
 */
let running: "snatch" | "bounce" | null = null;
function through(kind: "snatch" | "bounce", run: () => World[]): World[] {
  const was = running;
  running = kind;
  try {
    return run();
  } finally {
    running = was;
  }
}
/** kernel.useCalled's options with the integrator's pass-through fields (ignored by the kernel until it reads them). */
type CalledOpts = { priority?: number; prankster?: boolean; snatched?: true; bounced?: true };
const called = (opts: CalledOpts) => opts as { priority?: number; prankster?: boolean };

// ------------------------------------------------------------------------------------------------------------------
// Side and field state
// ------------------------------------------------------------------------------------------------------------------

const otherSide = (side: DoublesSideId): DoublesSideId => (side === "own" ? "opponent" : "own");
/** Replace a side's state (SideState objects are never mutated). */
const setSide = (w: World, side: DoublesSideId, change: Partial<SideState>) => {
  const next = { ...w.sides[side], ...change } as SideState & Record<string, unknown>;
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete next[key];
  w.sides[side] = next;
};
/** A side condition set this turn runs on a fresh clock (DoublesOutcome.sides.clock "set"; F3 §4.3). */
const setClock = (w: World, side: DoublesSideId, flag: SideClockFlag) => setSide(w, side, { clock: { ...w.sides[side].clock, [flag]: "set" } });
/** A side condition gone: its clock entry goes with it. */
function dropClock(w: World, side: DoublesSideId, flags: readonly SideClockFlag[]) {
  const clock = w.sides[side].clock;
  if (!clock || !flags.some((flag) => flag in clock)) return;
  const kept = Object.fromEntries(Object.entries(clock).filter(([flag]) => !flags.includes(flag as SideClockFlag)));
  setSide(w, side, { clock: Object.keys(kept).length ? kept : undefined });
}
/** A room or Sport set (fresh) or removed this turn (World.fieldSet; F3 §4.3). */
function noteFieldSet(w: World, flag: "magicRoom" | "wonderRoom" | "trickRoom" | "gravity" | "mudSport" | "waterSport", up: boolean) {
  if (up) { w.fieldSet = { ...w.fieldSet, [flag]: true }; return; }
  if (!w.fieldSet?.[flag]) return;
  const { [flag]: _gone, ...rest } = w.fieldSet;
  void _gone;
  if (Object.keys(rest).length) w.fieldSet = rest; else delete w.fieldSet;
}

/** Statistics and facts of one target of a status use (doubles-status.ts's helpers, for this module's handlers). */
const statsOf = (kernel: TurnKernel, use: Use, slot: DoublesSlotId) => kernel.hitStats(use.action, slot);
const blocked = (kernel: TurnKernel, use: Use, slot: DoublesSlotId, w: World, text: string) => { const stats = statsOf(kernel, use, slot); if (stats) stats.blocked += w.mass; hitFact(kernel, use, slot, text, w); };
const effect = (kernel: TurnKernel, use: Use, slot: DoublesSlotId, w: World) => { const stats = statsOf(kernel, use, slot); if (stats) stats.effect += w.mass; };
const immune = (kernel: TurnKernel, use: Use, slot: DoublesSlotId, w: World, text: string) => { const stats = statsOf(kernel, use, slot); if (stats) stats.noDamage += w.mass; hitFact(kernel, use, slot, text, w); };
const reach = (kernel: TurnKernel, use: Use, slot: DoublesSlotId, w: World) => { use.reached.add(slot); const stats = statsOf(kernel, use, slot); if (stats) stats.reached += w.mass; };
const fails = (kernel: TurnKernel, use: Use, w: World, reason: string) => { kernel.stepFact(use.action, `${use.move.name} fails: ${reason}.`, w.mass); return [w]; };

/** The status cure (doubles-status.ts cureStatus): the status, its sleep, freeze and bad-poison counters, with "Its burn is cured." */
function cure(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): boolean {
  const mon = w.mons[slot]!;
  const status = mon.build.status;
  if (!status || mon.fainted) return false;
  mon.build = { ...mon.build, status: "" };
  if (status === "slp") setVol(w, slot, { sleep: undefined });
  if (status === "frz") setVol(w, slot, { freeze: undefined });
  if (status === "tox") setEot(w, slot, { toxic: undefined });
  hitFact(kernel, use, slot, `Its ${STATUS_NOUNS[status]} is cured.`, w);
  return true;
}

/** The living Pokémon in pinned getAllActive order (own-left, own-right, opponent-right, opponent-left; positions after Ally Switch). */
function allActive(kernel: TurnKernel, w: World): DoublesSlotId[] {
  const key = (slot: DoublesSlotId) => { const at = SHOWDOWN_POSITION[kernel.positionOf(w, slot)]; return at.side * 2 + at.position; };
  return DOUBLES_SLOTS.filter((slot) => kernel.alive(w, slot) && slot !== w.ghost).sort((a, b) => key(a) - key(b));
}

// ------------------------------------------------------------------------------------------------------------------
// The field moves of today's code (moved from doubles-status.ts in Step 0)
// ------------------------------------------------------------------------------------------------------------------

/**
 * Tailwind, the screens, Trick Room, Gravity and the weather and terrain moves (SPEC §4.4 step 9): each sets its side
 * or field state, which every later calculation and, from generation 8, the next sort read; or it fails where
 * Showdown's own check does. Whether `move` is one of them. status2 (F3 §4.3): a screen or Tailwind set runs on a fresh
 * clock (SideState.clock), and Trick Room or Gravity set this turn is World.fieldSet's.
 */
export function fieldMove(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove): boolean {
  const slot = action.slot;
  const side = slotSide(slot);
  const fail = (reason: string) => { kernel.stepFact(action, `${move.name} fails: ${reason}.`, w.mass); return true; };
  const done = (text: string) => { kernel.stepFact(action, text, w.mass); return true; };
  // What the field and the user's side were before the move set them (FC's afterFieldMove reads it).
  const before = { field: w.field, side: w.sides[side] };
  const flag = SIDE_MOVES[move.id];
  if (flag) {
    // sim/side.ts addSideCondition fails while the condition is up (none of the four has onSideRestart).
    if (w.sides[side][flag]) return fail(`it is already up on ${kernel.names[slot]}'s side`);
    // Aurora Veil's onTry: this.field.isWeather(['hail', 'snowscape']), through effectiveWeather.
    if (move.id === "auroraveil" && kernel.effectiveWeather(w) !== "Hail" && kernel.effectiveWeather(w) !== "Snow") return fail("there is no hail or snow");
    fieldChangeHooks.beforeFieldMove(kernel, w, slot, move);
    w.sides[side] = { ...w.sides[side], [flag]: true };
    setClock(w, side, flag);
    return done(`${move.name} starts on ${kernel.names[slot]}'s side.`) && fieldChangeHooks.afterFieldMove(kernel, w, slot, move, before, action);
  }
  if (move.id === "trickroom") {
    fieldChangeHooks.beforeFieldMove(kernel, w, slot, move);
    // A Trick Room used while it is up ends it (data/moves.ts trickroom condition onFieldRestart).
    w.field = { ...w.field, trickRoom: !w.field.trickRoom };
    noteFieldSet(w, "trickRoom", w.field.trickRoom);
    return done(w.field.trickRoom ? "Trick Room starts." : "Trick Room ends.") && fieldChangeHooks.afterFieldMove(kernel, w, slot, move, before, action);
  }
  if (move.id === "gravity") {
    // sim/field.ts addPseudoWeather fails while it is up (Gravity has no onFieldRestart).
    if (w.field.gravity) return fail("Gravity is already up");
    w.field = { ...w.field, gravity: true };
    noteFieldSet(w, "gravity", true);
    // Gravity's onFieldStart: every hidden Pokémon lands (H; ADDENDUM2 §3.5).
    for (const each of DOUBLES_SLOTS) if (w.mons[each]?.eot.hidden && kernel.alive(w, each)) hiddenHooks.land(kernel, w, each);
    // Gravity's onFieldStart also ends Magnet Rise and Telekinesis (A2's doubles-typing.ts gravityGrounds; integration 1a).
    for (const each of DOUBLES_SLOTS) if (kernel.alive(w, each)) typingNs.gravityGrounds(kernel, w, each);
    return done("Gravity starts.") && fieldChangeHooks.afterFieldMove(kernel, w, slot, move, before, action);
  }
  const weather = WEATHER_MOVES[move.id];
  if (weather) {
    // sim/field.ts setWeather: the weather already up fails (generation 3 on); a living strong-weather holder stops
    // any other weather while its own is up (data/abilities.ts desolateland onAnySetWeather and its kin).
    if (w.field.weather === weather) return fail(`the weather is already ${weather}`);
    const keeper = STRONG_WEATHERS[w.field.weather];
    if (keeper && DOUBLES_SLOTS.some((other) => kernel.alive(w, other) && w.mons[other]!.build.abilityId === keeper)) return fail(`${w.field.weather} cannot be replaced`);
    fieldChangeHooks.beforeFieldMove(kernel, w, slot, move);
    w.field = { ...w.field, weather };
    return done(`The weather becomes ${weather}.`) && fieldChangeHooks.afterFieldMove(kernel, w, slot, move, before, action);
  }
  const terrain = TERRAIN_MOVES[move.id];
  if (terrain) {
    // sim/field.ts setTerrain: the terrain already up fails.
    if (w.field.terrain === terrain) return fail(`the terrain is already ${terrain} Terrain`);
    fieldChangeHooks.beforeFieldMove(kernel, w, slot, move);
    w.field = { ...w.field, terrain };
    return done(`The terrain becomes ${terrain} Terrain.`) && fieldChangeHooks.afterFieldMove(kernel, w, slot, move, before, action);
  }
  return false;
}

// ------------------------------------------------------------------------------------------------------------------
// Snatch's dispatch (PrepareHit, priority −1) and Magic Coat's side bounce
// ------------------------------------------------------------------------------------------------------------------

/**
 * Snatch (PS/data/moves.ts:17116-17133 snatch condition onAnyPrepareHit, priority −1; F3 §5.1.2): the next move with the
 * snatch flag of another Pokémon (an ally's too: F10), not a snatched one, is taken by the fastest living Snatch user that
 * is not Sky Dropped (two at one Speed: speedSort's shuffle, one world each), which removes its volatile and uses the
 * move itself with no target and no BeforeMove (F15; its own Try runs: PS/sim/battle-actions.ts useMoveInner); the
 * original stops. Called at the four PrepareHit points after the move's own Try (doubles-status.ts prepareHit and
 * sideOrField with the use, earlyBranch for Wide Guard, Quick Guard, the screens and Tailwind); the worlds after the
 * stolen use, or null when nothing takes it.
 *
 * At sideOrField a hazard aimed at the foe side (target foeSide, no snatch flag) meets Magic Coat there instead (its
 * onAllyTryHitSide, the TryHitSide right after this PrepareHit): see sideBounce.
 */
export function snatch(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, use?: Use): World[] | null {
  // The stolen use itself (move.sourceEffect 'snatch'): never snatched again.
  if (running === "snatch") { if (use && !use.snatched) use.snatched = true; return null; }
  if (use?.bounced || use?.snatched) return null;
  if (use && use.targetType === "foeSide") return sideBounce(kernel, w, use);
  const entry = use?.entry ?? tableEntry(kernel, move.id);
  if (!entry?.flags.snatch) return null;
  const user = use?.user ?? action.slot;
  const takers = snatchers(kernel, w, user);
  if (!takers.length) return null;
  // The move's own Try, which comes before PrepareHit (sim/battle-actions.ts useMoveInner): a failing one is not taken.
  if (!use && (move.id === "wideguard" || move.id === "quickguard") && !w.remaining.length) return null;
  if (!use && move.id === "auroraveil" && kernel.effectiveWeather(w) !== "Hail" && kernel.effectiveWeather(w) !== "Snow") return null;
  if (use && move.id === "matblock" && (kernel.input.pokemon[user]?.firstTurn === false || !w.remaining.length)) return null;
  const worlds = takers.length === 1 ? [w] : takers.map((_, index) => (index === 0 ? w : cloneWorld(w, w.mass / takers.length)));
  if (takers.length > 1) w.mass /= takers.length;
  return worlds.flatMap((world, index) => steal(kernel, world, action, move, use, takers[index]));
}

/** The Snatch users that take a use of `user`'s: the fastest living holders of the volatile (one, or the tied ones), not Sky Dropped. */
function snatchers(kernel: TurnKernel, w: World, user: DoublesSlotId): DoublesSlotId[] {
  const holders = DOUBLES_SLOTS.filter((slot) => {
    const mon = w.mons[slot];
    return slot !== user && !!mon && kernel.alive(w, slot) && !!mon.vol.snatch && mon.eot.hidden !== "skydrop" && mon.eot.lifted === undefined;
  });
  if (holders.length < 2) return holders;
  const fastest = Math.max(...holders.map((slot) => kernel.speedOf(w, slot)));
  return holders.filter((slot) => kernel.speedOf(w, slot) === fastest);
}

/** The Snatch user `by` takes the move (its volatile removed: `-activate … move: Snatch`) and uses it itself. */
function steal(kernel: TurnKernel, w: World, action: PendingAction, move: ChampionsMove, use: Use | undefined, by: DoublesSlotId): World[] {
  setVol(w, by, { snatch: undefined });
  kernel.stepFact(action, `${kernel.moveName("snatch")}: ${kernel.names[by]} takes ${move.name}.`, w.mass);
  const stolen: PendingAction = { ...action, slot: by, target: null };
  if (!use) {
    // Today's early moves (doubles-status.ts earlyBranch): Wide Guard and Quick Guard on the Snatch user's side; the screens
    // and Tailwind through fieldMove, whose "already up" check reads the Snatch user's side.
    if (move.id === "wideguard" || move.id === "quickguard") {
      const side = slotSide(by);
      w.sides[side] = { ...w.sides[side], [move.id === "wideguard" ? "wideGuard" : "quickGuard"]: true };
      return [w];
    }
    fieldMove(kernel, w, stolen, move);
    return [w];
  }
  // A snatched Swallow skips its own Try (PS/data/moves.ts:18584: move.sourceEffect 'snatch'), which reads use.snatched:
  // until kernel.useCalled carries it into the use (needsFromIntegrator), a Snatch user without a Stockpile of its own is
  // not followed. (The integrator deletes this line with the pass-through.)
  return through("snatch", () => kernel.useCalled(w, stolen, move.id, null, called({ priority: use.priority, snatched: true })));
}

/**
 * Magic Coat's onAllyTryHitSide (PS/data/moves.ts:10722-10732; F04): a reflectable move aimed at the foe side (the hazards)
 * from a Pokémon of the other side comes back to its user's side when a living, not semi-invulnerable holder of that side
 * is first among the side's reflectors (Speed descending; at one Speed the volatile before Magic Bounce's ability: F3
 * §5.1.1). Magic Bounce first, or no holder: null (doubles-status.ts sideOrField's bouncer).
 */
function sideBounce(kernel: TurnKernel, w: World, use: Use): World[] | null {
  if (!use.entry.flags.reflectable) return null;
  const foe = otherSide(slotSide(use.user));
  const living = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === foe && kernel.alive(w, slot) && slot !== w.ghost);
  const coats = living.filter((slot) => w.mons[slot]!.vol.magicCoat && !w.mons[slot]!.eot.hidden && w.mons[slot]!.eot.lifted === undefined);
  if (!coats.length) return null;
  const bounce = living.filter((slot) => w.mons[slot]!.build.abilityId === "magicbounce" && !breaks(kernel, w, use, slot));
  const speed = (slot: DoublesSlotId) => kernel.speedOf(w, slot);
  const coat = coats.reduce((a, b) => (speed(b) > speed(a) ? b : a));
  if (bounce.some((slot) => speed(slot) > speed(coat))) return null;
  const userSide = slotSide(use.user);
  kernel.stepFact(use.action, `${kernel.moveName("magiccoat")}: ${use.move.name} goes back to ${kernel.names[use.user]}'s side.`, w.mass);
  w.sides[userSide] = { ...w.sides[userSide], hazards: [...w.sides[userSide].hazards, use.move.id] };
  return [w];
}

// ------------------------------------------------------------------------------------------------------------------
// TryHit on a Pokémon's side: Crafty Shield (side, 3), Magic Coat (volatile, 2)
// ------------------------------------------------------------------------------------------------------------------

/**
 * The side's and Magic Coat's TryHit for a status move on `slot` (status2 SPEC2 §4.1 step 4, F3 §4.4: after the Protect
 * family, Crafty Shield (side, 3) then Magic Coat (volatile, 2)): a result to return from doubles-status.ts tryHit, or null
 * to go on.
 * - Crafty Shield (PS/data/moves.ts:3162-3166): every Status move whose target is not self or all into its side, from any
 *   Pokémon (F21, F24), is blocked.
 * - Magic Coat (PS/data/moves.ts:10711-10721): a reflectable move from another Pokémon (an ally's too: F05) that has not
 *   bounced, into a holder that is not semi-invulnerable, goes back: the holder uses it at the user (its Prankster flag
 *   from the Magic Coat use: F02); Mold Breaker does not pass it (F03). The holder's use runs through kernel.useCalled.
 */
export function tryHitSide(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): { pass: boolean; worlds: World[] } | null {
  // The reflected use itself (move.hasBounced): never reflected again, by Magic Coat or Magic Bounce.
  if (running === "bounce" && !use.bounced) use.bounced = true;
  const mon = w.mons[slot]!;
  if (w.sides[slotSide(slot)].craftyShield && use.move.category === "Status" && use.targetType !== "self" && use.targetType !== "all") {
    blocked(kernel, use, slot, w, `${kernel.moveName("craftyshield")} blocks ${use.move.name}.`);
    return { pass: false, worlds: [w] };
  }
  const coat = mon.vol.magicCoat;
  if (coat && slot !== use.user && !use.bounced && use.entry.flags.reflectable && !mon.eot.hidden && mon.eot.lifted === undefined) {
    blocked(kernel, use, slot, w, `${kernel.moveName("magiccoat")}: ${use.move.name} goes back to ${kernel.names[use.user]}.`);
    const at = kernel.positionOf(w, use.user);
    const holder: PendingAction = { ...use.action, slot, target: at };
    return { pass: false, worlds: through("bounce", () => kernel.useCalled(w, holder, use.move.id, at, called({ priority: use.priority, prankster: coat.prankster, bounced: true }))) };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------------------------
// Mist's TryBoost
// ------------------------------------------------------------------------------------------------------------------

/**
 * Mist's TryBoost on `slot`'s side (PS/data/moves.ts:12084-12099; F3 §4.5, F40, CR06): every drop from another Pokémon is
 * stopped (an ally's too: F41; an ability's, an item's: CR06), after the Pokémon's own TryBoost and Mirror Armor (a side
 * condition sorts last, F40). The exception is a move's effect from a foe that infiltrates (F42): a status use's Infiltrator,
 * or, for a damaging path's drop with no use (doubles-stages.ts foeDrop: a Max Move's, Mud-Slap's), its source's own move
 * with Infiltrator, but not a protecting move's contact effect (getActiveMove: no ModifyMove) nor anything at the end of turn
 * (Octolock: getActiveMove). Whether it stops the drops.
 */
export function mistBlocks(kernel: TurnKernel, w: World, slot: DoublesSlotId, source: DoublesSlotId, opts: { use?: Use; effect?: "move" | "ability" | "item" | null }): boolean {
  if (!w.sides[slotSide(slot)].mist || !source || source === slot) return false;
  if (opts.effect === "move" && kernel.isFoe(source, slot)) {
    const by = w.mons[source];
    const infiltrates = opts.use ? opts.use.infiltrates : !kernel.inEndOfTurn && !!by && !by.protect && by.build.abilityId === "infiltrator";
    if (infiltrates) return false;
  }
  return true;
}

// ------------------------------------------------------------------------------------------------------------------
// The status moves (status-table handler keys)
// ------------------------------------------------------------------------------------------------------------------

/** A side condition on the user's side (Safeguard, Mist, Lucky Chant): fails while up (no onSideRestart), else set on a fresh clock. */
function sideCondition(kernel: TurnKernel, w: World, use: Use, flag: "safeguard" | "mist" | "luckyChant"): World[] {
  const side = slotSide(use.user);
  const name = kernel.names[use.user];
  if (w.sides[side][flag]) return fails(kernel, use, w, `it is already up on ${name}'s side`);
  setSide(w, side, { [flag]: true });
  setClock(w, side, flag);
  kernel.stepFact(use.action, `${use.move.name} starts on ${name}'s side.`, w.mass);
  return [w];
}

/**
 * Mat Block (PS/data/moves.ts:10984-11027; F30-F32): onTry fails after its user's first turn out (activeMoveActions > 1:
 * DoublesPokemonInput.firstTurn false; absent, the existing turn fact) and with no action after it; then the side condition
 * (one turn), which stops damaging moves with the protect flag into the side, an ally's included (F31: the kernel's
 * hitChecks), a Z-Move or Max Move at a quarter (conditionsFor).
 */
function matBlock(kernel: TurnKernel, w: World, use: Use): World[] {
  const side = slotSide(use.user);
  const name = kernel.names[use.user];
  const first = kernel.input.pokemon[use.user]?.firstTurn;
  if (first === false) return fails(kernel, use, w, `it is not ${name}'s first turn`);
  if (first === undefined) kernel.turnFact("Assumes the attacker's first turn in battle.");
  if (!w.remaining.length) return fails(kernel, use, w, "no Pokémon moves after it");
  if (w.sides[side].matBlock) return fails(kernel, use, w, `it is already up on ${name}'s side`);
  setSide(w, side, { matBlock: true });
  kernel.stepFact(use.action, `${use.move.name}: damaging moves aimed at ${name}'s side are blocked this turn.`, w.mass);
  return [w];
}

/** Crafty Shield (PS/data/moves.ts:3143-3173; F20-F26): onTry `!!queue.willAct()`, then the side condition for this turn (tryHitSide). */
function craftyShield(kernel: TurnKernel, w: World, use: Use): World[] {
  const side = slotSide(use.user);
  const name = kernel.names[use.user];
  if (!w.remaining.length) return fails(kernel, use, w, "no Pokémon moves after it");
  if (w.sides[side].craftyShield) return fails(kernel, use, w, `it is already up on ${name}'s side`);
  setSide(w, side, { craftyShield: true });
  kernel.stepFact(use.action, `${use.move.name}: status moves aimed at ${name}'s side are blocked this turn.`, w.mass);
  return [w];
}

/** Mud Sport and Water Sport (PS/data/moves.ts:12456-12489, 20628-20661): a pseudo-weather for 5 turns (no onFieldRestart: fails while up). */
function sport(kernel: TurnKernel, w: World, use: Use): World[] {
  const flag = use.move.id === "mudsport" ? "mudSport" : "waterSport";
  if (w.field[flag]) return fails(kernel, use, w, "it is already up");
  w.field = { ...w.field, [flag]: true };
  noteFieldSet(w, flag, true);
  fieldChangeHooks.pseudoWeatherChanged(kernel, w, use.move.id, use);
  kernel.stepFact(use.action, `${use.move.name} starts.`, w.mass);
  return [w];
}

/**
 * Magic Room and Wonder Room (PS/data/moves.ts:10755-10798, 20970-21018): a use while up ends it (onFieldRestart), else it
 * starts for 5 turns (World.fieldSet). Magic Room's start ends nothing (its item End calls are suppressed: F67, F67b); its
 * end lets the items act again (roomEnd).
 */
function room(kernel: TurnKernel, w: World, use: Use): World[] {
  const flag = use.move.id === "magicroom" ? "magicRoom" : "wonderRoom";
  const up = !w.field[flag];
  w.field = { ...w.field, [flag]: up };
  noteFieldSet(w, flag, up);
  kernel.stepFact(use.action, `${use.move.name} ${up ? "starts" : "ends"}.`, w.mass);
  // addPseudoWeather runs PseudoWeatherChange (Room Service: FC's hook); removePseudoWeather runs none (sim/field.ts).
  if (up) fieldChangeHooks.pseudoWeatherChanged(kernel, w, use.move.id, use);
  return up || flag !== "magicRoom" ? [w] : roomEnd(kernel, w, use);
}

/**
 * Magic Room ended mid-turn (F65, F143; F3 §5.3.1): the items act again. White Herb at the move's AfterMove (data/items.ts
 * whiteherb onAnyAfterMove), then at the action's Update the onUpdate items each Pokémon holds: a curing Berry against its
 * status (Lum and Persim against a confusion too), Mental Herb against Attract, Taunt, Encore, Disable or Heal Block (Unnerve
 * does not stop it), an HP or pinch Berry at its line (a foe's Unnerve or As One stops the Berries), and Booster Energy for a
 * Protosynthesis or Quark Drive holder whose field is down (FC's itemsAfterField: SPEC2's boosterAfterRoom until 1b).
 * Utility Umbrella's End never ran (F67), so nothing changes for it.
 */
function roomEnd(kernel: TurnKernel, w: World, use: Use): World[] {
  for (const slot of DOUBLES_SLOTS) if (kernel.alive(w, slot) && slot !== w.ghost) itemHooks.whiteHerb(kernel, w, use.action, slot);
  let worlds = [w];
  for (const slot of DOUBLES_SLOTS) {
    worlds = worlds.flatMap((world) => {
      if (!kernel.alive(world, slot) || slot === world.ghost) return [world];
      const mon = world.mons[slot]!;
      const build = mon.build;
      const item = build.itemId;
      if (!item || !kernel.itemWorks(world, build)) return [world];
      if (item === "boosterenergy" && boosterDown(kernel, world, slot)) return fieldChangeHooks.itemsAfterField(kernel, world, slot, use);
      if (item === "mentalherb") {
        // data/items.ts mentalherb onUpdate: attract, taunt, encore, torment, disable, healblock (useItem: Unnerve does not stop it).
        const vol = mon.vol;
        const ended = [vol.attract && "infatuation", vol.taunt && kernel.moveName("taunt"), vol.encore && kernel.moveName("encore"), vol.disabled && kernel.moveName("disable"),
          mon.eot.healBlock && kernel.moveName("healblock")].filter((part): part is string => !!part);
        if (!ended.length) return [world];
        mon.build = { ...build, itemId: "", ...(build.abilityId === "unburden" ? { abilityActive: true } : {}) };
        kernel.noteItemUse(world, slot, item);
        setVol(world, slot, { attract: undefined, taunt: undefined, encore: undefined, disabled: undefined });
        setEot(world, slot, { healBlock: undefined });
        kernel.stepFact(use.action, `${kernel.itemName(item)}: ${kernel.names[slot]}'s ${ended.join(", ")} ends.`, world.mass);
        return [world];
      }
      if (!item.endsWith("berry") || kernel.berryStopped(world, slot)) return [world];
      // A curing Berry against its status from before, Lum and Persim against a confusion (data/items.ts lumberry and its kin onUpdate).
      const status = build.status;
      const curesStatus = !!status && !!BERRY_CURES[item]?.includes(status);
      const curesConfusion = !!mon.vol.confusion && (item === "lumberry" || item === "persimberry");
      if (curesStatus || curesConfusion) {
        mon.build = { ...build, itemId: "", ...(curesStatus ? { status: "" as const } : {}), ...(build.abilityId === "unburden" ? { abilityActive: true } : {}) };
        if (curesStatus && status === "slp") setVol(world, slot, { sleep: undefined });
        if (curesStatus && status === "frz") setVol(world, slot, { freeze: undefined });
        if (curesStatus && status === "tox") setEot(world, slot, { toxic: undefined });
        if (item === "lumberry" || item === "persimberry") setVol(world, slot, { confusion: undefined });
        kernel.noteItemUse(world, slot, item);
        kernel.pouchHeal(world, slot);
        return [world];
      }
      // An HP or pinch Berry at its line (kernel.berryDue: the Berserk lock, ateBerry's item history, Unburden and rises).
      return kernel.berryDue(world, slot);
    });
  }
  return worlds;
}

/** Booster Energy's onUpdate would act (data/items.ts boosterenergy): a Protosynthesis holder without sun, a Quark Drive holder without Electric Terrain. */
function boosterDown(kernel: TurnKernel, w: World, slot: DoublesSlotId): boolean {
  const ability = w.mons[slot]!.build.abilityId;
  if (ability === "protosynthesis") return kernel.effectiveWeather(w) !== "Sun";
  if (ability === "quarkdrive") return w.field.terrain !== "Electric";
  return false;
}

/**
 * Court Change (PS/data/moves.ts:3032-3098; F50-F53, F142): the two sides' conditions swap with their state: Mist, the
 * screens, Safeguard, Tailwind, Lucky Chant, the hazards, the Pledges' fields and the G-Max side conditions (durations
 * and layers move: SideState.clock and hazardsFrom carry the side each came from, F3 §4.3); Wide Guard, Quick Guard,
 * Crafty Shield and Mat Block stay. No SideConditionStart runs (Wind Rider: F142). With nothing to swap it fails, which
 * no number reads (the pre-turn hazards are not an input in wave 1): the fact is given when a known condition moved.
 */
function courtChange(kernel: TurnKernel, w: World, use: Use): World[] {
  const FLAGS: SideClockFlag[] = ["reflect", "lightScreen", "auroraVeil", "tailwind", "safeguard", "mist", "luckyChant"];
  const own = w.sides.own, opponent = w.sides.opponent;
  const known = (state: SideState) => FLAGS.some((flag) => state[flag]) || state.hazards.length > 0 || !!state.pledge || !!state.gmax?.length;
  const moved = known(own) || known(opponent);
  const swapped = (to: DoublesSideId, from: SideState, fromId: DoublesSideId, stay: SideState): SideState => {
    const clock: Partial<Record<SideClockFlag, DoublesSideId | "set">> = {};
    for (const flag of FLAGS) {
      if (!from[flag]) continue;
      const origin = from.clock?.[flag] ?? fromId;
      if (origin !== to) clock[flag] = origin;
    }
    const origin = from.hazardsFrom === undefined ? fromId : from.hazardsFrom;
    const out: SideState = {
      reflect: from.reflect, lightScreen: from.lightScreen, auroraVeil: from.auroraVeil, tailwind: from.tailwind, safeguard: from.safeguard,
      wideGuard: stay.wideGuard, quickGuard: stay.quickGuard, faintedThisTurn: stay.faintedThisTurn, hazards: [...from.hazards],
    };
    if (from.mist) out.mist = true;
    if (from.luckyChant) out.luckyChant = true;
    if (Object.keys(clock).length) out.clock = clock;
    if (origin !== to) out.hazardsFrom = origin;
    if (from.pledge) out.pledge = { ...from.pledge };
    if (from.gmax?.length) out.gmax = [...from.gmax];
    if (stay.craftyShield) out.craftyShield = true;
    if (stay.matBlock) out.matBlock = true;
    if (stay.benchCured) out.benchCured = true;
    return out;
  };
  w.sides = { own: swapped("own", opponent, "opponent", own), opponent: swapped("opponent", own, "own", opponent) };
  if (moved) kernel.stepFact(use.action, `${use.move.name}: the two sides' conditions are swapped.`, w.mass);
  return [w];
}

/**
 * Defog's onHit (PS/data/moves.ts:3448-3482; gen 7 PS/data/mods/gen7/moves.ts:125-147; F55-F61): the target's evasion −1
 * from the user unless it is behind a Substitute the move does not infiltrate (F56), through boost() (Mist, Clear Body,
 * Mirror Armor, Defiant: F55, F59); the target's side loses Reflect, Light Screen, Aurora Veil, Safeguard and Mist; the
 * hazards go from both sides (hazardsFrom null); from generation 8 the terrain ends whatever else happened (F58), which a
 * terrain-settled holder reads (FC's changed: today's fieldChange reason until 1b).
 */
function defog(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const target = w.mons[slot]!;
  if (!target.vol.substitute || use.infiltrates) kernel.applyBoosts(w, slot, { evasion: -1 }, use.user, { use, effect: "move", report: true });
  const side = slotSide(slot);
  const name = kernel.names[slot];
  const ends: [SideClockFlag, string][] = [["reflect", "reflect"], ["lightScreen", "lightscreen"], ["auroraVeil", "auroraveil"], ["safeguard", "safeguard"], ["mist", "mist"]];
  const gone = ends.filter(([flag]) => w.sides[side][flag]);
  if (gone.length) {
    setSide(w, side, { reflect: false, lightScreen: false, auroraVeil: false, safeguard: false, mist: undefined });
    dropClock(w, side, gone.map(([flag]) => flag));
    for (const [, id] of gone) kernel.stepFact(use.action, `${use.move.name}: ${kernel.moveName(id)} ends on ${name}'s side.`, w.mass);
  }
  const landed = w.sides.own.hazards.length > 0 || w.sides.opponent.hazards.length > 0;
  for (const each of ["own", "opponent"] as const) setSide(w, each, { hazards: [], hazardsFrom: null });
  if (landed) kernel.stepFact(use.action, `${use.move.name}: the hazards on both sides are cleared.`, w.mass);
  if (generation(kernel) >= 8 && w.field.terrain) {
    const terrain = w.field.terrain;
    w.field = { ...w.field, terrain: "" };
    kernel.stepFact(use.action, `${use.move.name}: the ${terrain} Terrain ends.`, w.mass);
    fieldChangeHooks.changed(kernel, w, { weather: w.field.weather, terrain }, use);
  }
  return [w];
}

/**
 * Corrosive Gas's onHit on each target (PS/data/moves.ts:2914-2934; F80-F85): takeItem from the user. No item: `-fail`;
 * Sticky Hold (breakable: Mold Breaker takes it, F80; a Sticky Barb goes anyway) and the items that refuse their TakeItem
 * (Mega Stones, Z-Crystals, owned items, a Paradox Pokémon's Booster Energy: F81) keep it; otherwise it is gone with no item
 * history, Unburden, and no Symbiosis (World.itemsTaken: F84). The Substitute (F81), Protect, Wide Guard and the bounce
 * are the pipeline's.
 */
function corrosiveGas(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const holder = w.mons[slot]!;
  const item = holder.build.itemId;
  const name = kernel.names[slot];
  if (!item) { hitFact(kernel, use, slot, `${use.move.name} fails: ${name} holds no item.`, w); return [w]; }
  if (holder.build.abilityId === "stickyhold" && item !== "stickybarb" && !breaks(kernel, w, use, slot)) {
    hitFact(kernel, use, slot, `${kernel.abilityName("stickyhold")}: ${name} keeps its item.`, w);
    return [w];
  }
  if (!itemHooks.movable(kernel, item, holder.build, w.mons[use.user]!.build, false)) {
    hitFact(kernel, use, slot, `${use.move.name} fails: ${name}'s ${kernel.itemName(item)} cannot be removed.`, w);
    return [w];
  }
  itemHooks.takeAway(w, slot);
  hitFact(kernel, use, slot, `Loses its ${kernel.itemName(item)}.`, w);
  return [w];
}

/**
 * Bestow's onHit (PS/data/moves.ts:1237-1263; F88): fails when the target holds an item or the user holds none, or the
 * user's item refuses the move (its TakeItem toward its holder and receiver: Trick's itemTakeable; the user's own Sticky
 * Hold lets go); otherwise doubles-items.ts give. It has no protect flag (F88b) and bypasses a Substitute.
 */
function bestow(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const user = use.user;
  const giver = w.mons[user]!, holder = w.mons[slot]!;
  const item = giver.build.itemId;
  const fail = (text: string) => { hitFact(kernel, use, slot, `${use.move.name} fails: ${text}.`, w); return [w]; };
  if (holder.build.itemId) return fail(`${kernel.names[slot]} already holds an item`);
  if (!item) return fail(`${kernel.names[user]} holds no item`);
  if (!itemHooks.movable(kernel, item, giver.build, holder.build, true)) return fail(`${kernel.names[user]}'s ${kernel.itemName(item)} cannot be moved`);
  kernel.stepFact(use.action, `${use.move.name}: ${kernel.names[slot]} gets ${kernel.itemName(item)}; ${kernel.names[user]} holds no item.`, w.mass);
  itemHooks.give(kernel, w, use.action, user, slot);
  return [w];
}

/**
 * The item Recycle restores (PS/data/moves.ts:14822-14842 onHit: `pokemon.item || !pokemon.lastItem` fails; F90-F96):
 * MonState.lastItem (item history, kept while kernel.tracksItems: D's tracksItems with a Recycle user; "" after a Recycle),
 * else the input's lastItem (null: none). Not followed: the input's lastItem absent (REASONS.needsLastItem), or, while the
 * turn keeps no item history, an item it held as the turn started and no longer holds (used or taken this turn).
 */
function recycledItem(kernel: TurnKernel, w: World, slot: DoublesSlotId): string | null {
  const mon = w.mons[slot]!;
  if (mon.lastItem !== undefined) return mon.lastItem || null;
  const input = kernel.input.pokemon[slot];
  if (!kernel.tracksItems && input?.build.itemId && !mon.build.itemId) kernel.notEstimated(REASONS.notIn2v2(kernel.moveName("recycle")));
  const last = input?.lastItem;
  if (last === undefined) kernel.notEstimated(REASONS.needsLastItem(kernel.moveName("recycle"), kernel.names[slot]));
  return last;
}

/** Recycle's onHit (its own failures at the hit, after PrepareHit: Snatch takes a Recycle that would fail; F3 §5.4.3), then doubles-items.ts restore. */
function recycle(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  const name = kernel.names[slot];
  const fail = (text: string) => { hitFact(kernel, use, slot, `${use.move.name} fails: ${text}.`, w); return [w]; };
  if (w.mons[slot]!.build.itemId) return fail(`${name} holds an item`);
  const item = recycledItem(kernel, w, slot);
  if (!item) return fail(`${name} has used no item`);
  kernel.stepFact(use.action, `${use.move.name}: ${name} gets ${kernel.itemName(item)} back.`, w.mass);
  itemHooks.restore(kernel, w, use.action, slot, item);
  return [w];
}

/**
 * Teatime's onHitField (PS/data/moves.ts:19036-19066; F100-F103, K30): each active Pokémon in getAllActive order is missed
 * when invulnerable (a commanding Tatsugiri: PR; a hidden Pokémon: H's missesField), else meets TryHit (Good as Gold, an
 * absorbing ability by the move's type as used, Psychic Terrain against a priority use from a foe; no protect flag, so the
 * protections and Crafty Shield let it through); those holding a Berry then eat it with eatItem(true) (doubles-items.ts
 * forceEat), the eat's source Teatime's user. With no eater it fails.
 */
function teatime(kernel: TurnKernel, w: World, use: Use): World[] {
  const { user, move } = use;
  const eaters: DoublesSlotId[] = [];
  let worlds = [w];
  for (const slot of allActive(kernel, w)) {
    const at = worlds[0];
    const mon = at.mons[slot]!;
    const name = kernel.names[slot];
    // A hit entry for each Pokémon the move did something to (missed, stopped, absorbed, or made eat), as Perish Song's.
    const stop = (text: string) => { for (const world of worlds) { reach(kernel, use, slot, world); blocked(kernel, use, slot, world, text); } };
    const label = presenceHooks.invulnerable(kernel, at, user, slot);
    if (label || hiddenHooks.missesField(kernel, at, slot, move, user)) { stop(`${move.name} misses ${name}${label ? ` (${label})` : ""}.`); continue; }
    const ability = mon.build.abilityId;
    const broken = breaks(kernel, at, use, slot);
    if (slot !== user && ability === "goodasgold" && !broken) { stop(`${kernel.abilityName(ability)}: ${name} is not affected.`); continue; }
    const absorb = ABSORBING[ability];
    if (absorb && slot !== user && !broken && !absorb.wind && absorb.type === use.type) {
      worlds = worlds.flatMap((world) => { reach(kernel, use, slot, world); return absorbStatus(kernel, world, use, slot, ability); });
      continue;
    }
    if (w.field.terrain === "Psychic" && use.priority > 0.1 && kernel.isFoe(user, slot) && kernel.grounded(at, slot) && !mon.eot.hidden) { stop(`Psychic Terrain: ${name} is not affected.`); continue; }
    if (mon.protect === "maxguard") { stop(`${kernel.moveName("maxguard")} blocks ${move.name}.`); continue; }
    if (mon.build.itemId.endsWith("berry")) eaters.push(slot);
  }
  if (!eaters.length) { for (const world of worlds) kernel.stepFact(use.action, `${move.name} fails: no Pokémon holds a Berry.`, world.mass); return worlds; }
  for (const slot of eaters) {
    worlds = worlds.flatMap((world) => {
      const item = world.mons[slot]!.build.itemId;
      if (!item || !kernel.alive(world, slot)) return [world];
      reach(kernel, use, slot, world);
      effect(kernel, use, slot, world);
      return itemHooks.forceEat(kernel, world, use.action, slot, item, user, { fact: (each, text) => hitFact(kernel, use, slot, text, each), breaks: breaks(kernel, world, use, slot) });
    });
  }
  return worlds;
}

/** An absorbing ability taking a status move (doubles-status.ts absorbStatus): a quarter of the base maximum HP, a stat rise or Flash Fire. */
function absorbStatus(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId, ability: string): World[] {
  const absorb = ABSORBING[ability];
  const stats = statsOf(kernel, use, slot);
  if (stats) stats.blocked += w.mass;
  const name = kernel.abilityName(ability);
  if (absorb.heal) {
    hitFact(kernel, use, slot, `${name}: ${use.move.name} has no effect, and it regains HP.`, w);
    return itemHooks.heal(kernel, w, slot, Math.max(1, Math.floor(kernel.hp[slot].baseMaxHP / 4)), use.action, name).map(({ world }) => world);
  }
  if (absorb.stages) {
    const result = kernel.applyBoosts(w, slot, absorb.stages, slot, { use, effect: "ability", report: true, by: name });
    if (!Object.keys(result).length) hitFact(kernel, use, slot, `${name}: ${use.move.name} has no effect.`, w);
    return [w];
  }
  w.mons[slot]!.build = { ...w.mons[slot]!.build, abilityActive: true };
  hitFact(kernel, use, slot, `${name}: its Fire moves have 1.5x power.`, w);
  return [w];
}

/**
 * Aromatherapy and Heal Bell (PS/data/moves.ts:556-590, 8241-8273; gen 7 Heal Bell PS/data/mods/gen7/moves.ts:303-318;
 * F120-F126, K42): every Pokémon of the user's side, the bench included (its abilities ignored off the field:
 * PS/sim/pokemon.ts ignoringAbility), is cured but where an ability of an active one stops it: from generation 8 another
 * Pokémon's Soundproof or Good as Gold (Heal Bell), Sap Sipper or Good as Gold (Aromatherapy), unless the move's Mold
 * Breaker suppresses it; an Aromatherapy ally behind a Substitute the move does not infiltrate is skipped; generation 7's
 * Heal Bell checks Soundproof on every active one, its user included (F122). cureStatus needs HP. The bench: SideState
 * .benchCured (E2), with the fact unless the input says the side has no Pokémon left to switch in.
 */
function teamCure(kernel: TurnKernel, w: World, use: Use): World[] {
  const { user, move } = use;
  const side = slotSide(user);
  const healBell = move.id === "healbell";
  const gen7 = generation(kernel) <= 7;
  // TryHitSide (sim/battle-actions.ts tryMoveHit, before onHit): an ally's Sap Sipper takes a Grass move on its own side
  // (data/abilities.ts sapsipper onAllyTryHitSide: +1 Attack from the user; breakable), Aromatherapy as used.
  if (use.type === "Grass") {
    for (const slot of allActive(kernel, w)) {
      if (slotSide(slot) !== side || slot === user || w.mons[slot]!.build.abilityId !== "sapsipper" || breaks(kernel, w, use, slot)) continue;
      kernel.applyBoosts(w, slot, { atk: 1 }, user, { use, effect: "ability", report: true, by: kernel.abilityName("sapsipper") });
    }
  }
  for (const slot of allActive(kernel, w)) {
    if (slotSide(slot) !== side) continue;
    const mon = w.mons[slot]!;
    const name = kernel.names[slot];
    const ability = mon.build.abilityId;
    const suppressed = breaks(kernel, w, use, slot);
    // A hit entry for each one it stopped at or cured (a Pokémon with no status: nothing to show).
    const stop = (text: string) => { reach(kernel, use, slot, w); immune(kernel, use, slot, w, text); };
    if (healBell && gen7) {
      if (ability === "soundproof" && !suppressed) { stop(`${kernel.abilityName(ability)}: ${name} is not affected.`); continue; }
    } else if (slot !== user && !suppressed) {
      if ((healBell ? ability === "soundproof" : ability === "sapsipper") || ability === "goodasgold") { stop(`${kernel.abilityName(ability)}: ${name} is not affected.`); continue; }
      if (!healBell && mon.vol.substitute && !use.infiltrates) { stop(`${name} is behind a Substitute.`); continue; }
    }
    if (!mon.build.status) continue;
    reach(kernel, use, slot, w);
    if (cure(kernel, w, use, slot)) effect(kernel, use, slot, w);
  }
  setSide(w, side, { benchCured: true });
  if (kernel.input.canSwitch?.[side] !== false && DOUBLES_SLOTS.every((slot) => slotSide(slot) !== side || kernel.input.pokemon[slot])) {
    kernel.stepFact(use.action, `${move.name} also cures the statuses of ${side === "own" ? "your side" : "the opponent's side"}'s Pokémon not in battle.`, w.mass);
  }
  return [w];
}

/** Purify's onHit (PS/data/moves.ts:14347-14369; gen 7 :739-745; F115, F116, K44): the target's status cured, else it fails (Comatose has none); then the user heals ceil(maxhp / 2). */
function purify(kernel: TurnKernel, w: World, use: Use, slot: DoublesSlotId): World[] {
  if (!w.mons[slot]!.build.status) { hitFact(kernel, use, slot, `${use.move.name} fails: ${kernel.names[slot]} has no status.`, w); return [w]; }
  cure(kernel, w, use, slot);
  const user = use.user;
  if (!kernel.alive(w, user)) return [w];
  return itemHooks.heal(kernel, w, user, Math.ceil(kernel.hp[user].maxHP / 2), use.action, use.move.name).map(({ world }) => world);
}

/** The family's handlers by status-table key (SPEC2 §2.2's A3 rows; F3 §3.4), and Safeguard's side condition with its clock (F3 §4.3). */
export const HANDLERS: Readonly<Record<string, StatusHandler>> = {
  // Magic Coat and Snatch: this turn's volatiles (onStart; Magic Coat keeps the use's pranksterBoosted: F02).
  magicCoat: {
    volatile: (kernel, w, use, slot) => {
      setVol(w, slot, { magicCoat: { prankster: use.prankster } });
      kernel.stepFact(use.action, `${use.move.name}: reflectable moves aimed at ${kernel.names[slot]} go back to their users this turn.`, w.mass);
      return true;
    },
  },
  snatch: {
    volatile: (kernel, w, use, slot) => {
      setVol(w, slot, { snatch: true });
      kernel.stepFact(use.action, `${use.move.name}: ${kernel.names[slot]} takes the next move that can be snatched this turn.`, w.mass);
      return true;
    },
  },
  craftyShield: { sideOrField: craftyShield },
  matBlock: { sideOrField: matBlock },
  safeguard: { sideOrField: (kernel, w, use) => sideCondition(kernel, w, use, "safeguard") },
  mist: { sideOrField: (kernel, w, use) => sideCondition(kernel, w, use, "mist") },
  luckyChant: { sideOrField: (kernel, w, use) => sideCondition(kernel, w, use, "luckyChant") },
  sport: { sideOrField: sport },
  room: { sideOrField: room },
  courtChange: { sideOrField: courtChange },
  defog: { onHit: defog },
  corrosiveGas: { onHit: corrosiveGas },
  bestow: { onHit: bestow },
  recycle: { onHit: recycle },
  teatime: { sideOrField: teatime },
  stuffCheeks: {
    // onTry: getItem().isBerry, which an item it ignores passes (F107).
    moveTry: (kernel, w, use) => {
      if (w.mons[use.user]!.build.itemId.endsWith("berry")) return [{ world: w, ok: true }];
      kernel.stepFact(use.action, `${use.move.name} fails: ${kernel.names[use.user]} holds no Berry.`, w.mass);
      return [{ world: w, ok: false }];
    },
    // onHit: `if (!this.boost({ def: 2 })) return null;` (+6: nothing eaten, F105; Contrary's −2 eats, F106), then eatItem(true).
    onHit: (kernel, w, use, slot) => {
      const changed = kernel.applyBoosts(w, slot, { def: 2 }, use.user, { use, effect: "move", report: true });
      const item = w.mons[slot]!.build.itemId;
      if (!Object.values(changed).some((by) => by) || !item) return [w];
      return itemHooks.forceEat(kernel, w, use.action, slot, item, slot, { fact: (each, text) => hitFact(kernel, use, slot, text, each), breaks: false });
    },
  },
  teamCure: { sideOrField: teamCure },
  purify: { onHit: purify },
  psychoShift: {
    // onTryHit: `if (!source.status) return false; move.status = source.status;` The status step then runs the pipeline's
    // trySetStatus (its immunities, Safeguard: F111; a Fire type against a burn: K57), and only a status that lands runs
    // self.onHit, the user's cure (onHit below), so Synchronize sees the user still statused (F110).
    tryHit: (kernel, w, use) => {
      const status = w.mons[use.user]!.build.status;
      if (!status) return `${kernel.names[use.user]} has no status`;
      use.entry = { ...use.entry, status: status as NonNullable<Use["entry"]["status"]> };
      return null;
    },
    onHit: (kernel, w, use) => {
      cure(kernel, w, use, use.user);
      return [w];
    },
  },
};
