// SPEC 10.5 cell evaluation: one pairing of the AI's joint option with the player's, valued on belief battles through
// TurnServices only. Engine path: the bridge's worlds of belief world 0 (live, or after a prelude that ran the turn's
// switches and Mega Evolution exactly as Showdown does: the new form's types, ability and Speed before any move, A1.5),
// E2 per world, the residual pass and the field clock added, plus a first-order accuracy correction. Rollout path:
// simulator samples on the belief worlds with common random numbers. Engine paths assume no crits and no chance effects
// below 100% (doubles-turn.ts turnFacts; one Serene Grace doubles to 100% happens); rollouts sample them. Documented, not corrected.
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import {
  DOUBLES_SLOTS, foesOf, slotSide, type DoublesOutcome, type DoublesOutcomesResult, type DoublesSideId, type DoublesSlotId,
  type DoublesStart, type DoublesTurnInput,
} from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { AiView, CellActions, EngineWorld, EngineWorlds, FieldClock, MonKey, PostMon, PostState, ReplacePolicy, TurnServices } from "../model/ai-view";
import type { CellMethod, WorkBudget } from "../model/decision";
import { jointActionKey, megaSlots } from "../model/view-types";
import { effectiveAccuracy } from "./accuracy";
import type { MegaOutlook } from "./mega";
import type { RowTable } from "./rows";
import { stateTerms, type ValueContext } from "./value";
import type { Weights } from "./value-weights";

export type CellValue = {
  /** E[V(post)] (ai/value.ts), accuracy-corrected on the engine path. */
  value: number;
  method: CellMethod;
  /** Rollout samples behind the value (0 on the engine path). */
  samples: number;
  /** The worlds' notes ("Protect fails (2/3).") and why a cell left the engine. */
  notes: string[];
  /** A1.5: the expected Mega lasting and keep terms inside `value` (ai/value.ts megaLasting, megaKeep). */
  mega: { lasting: number; keep: number };
};
export type EvaluatorDeps = {
  services: TurnServices; runtime: BattleRuntime; weights: Weights; worth: Record<MonKey, number>; rows: RowTable;
  replace: ReplacePolicy; budget: WorkBudget;
  /** A1.5: the decision's Mega outlook for the value's lasting and option terms. */
  mega?: MegaOutlook;
  /** A clock for the timing counters (evaluation scripts); without it they stay 0. */
  now?: () => number;
};
export type CellEvaluator = {
  /**
   * Stage A: the first evaluation; stage B: rollout cells topped up to budget.stageBSamples. null: skipped or budget spent.
   * reserve: engine calls kept for the cells still to come; the accuracy correction only spends calls beyond it.
   * rolloutsAhead: rollout samples kept for the rollout cells expected to come; a new rollout cell takes stageASamples
   * only when they stay free, else one sample (so a heavy matrix keeps every cell instead of dropping its last rows).
   */
  evaluate(cell: CellActions, stage: "A" | "B", reserve?: number, rolloutsAhead?: number): CellValue | null;
  /** The memoised bridge result of a cell (the read's Mega facts read a prelude's world from it). */
  worldsOf(cell: CellActions): EngineWorlds;
  /** Whether another cell can still be evaluated in stage A. */
  canEvaluate(): boolean;
  /** Why a cell has no value (a skip's reasons, the engine's not-estimated reason before a rollout that had no budget). */
  notesOf(cell: CellActions): readonly string[];
  /** Belief world 0 rejected the cell's choice strings (TurnServices "skip"): not a budget drop. */
  skipped(cell: CellActions): boolean;
  readonly used: { engineCalls: number; rolloutSamples: number };
  /** E2 results with issues (an engine bug: counted, then rolled out). */
  readonly issues: number;
  /** Milliseconds in E2, in the value function, and in the services' bridge/prelude and rollouts (with deps.now). */
  readonly timing: { e2: number; value: number; bridge: number; rollout: number };
  /** E2 calls spent on accuracy corrections. */
  readonly corrections: number;
  /** The decision's work so far in E2-call units (ROLLOUT_WORK, PRELUDE_WORK). */
  work(): number;
};

type Terms = { total: number; lasting: number; keep: number };
type Entry = { method: CellMethod; samples: number; sum: Terms; value: CellValue | null; notes: string[]; skip?: boolean };

/** At most this many inaccurate actions are corrected per cell (SPEC 10.5: the two lowest accuracies). */
const ACCURACY_CORRECTIONS = 2;
/**
 * The decision's work in E2-call units: E2 calls + ROLLOUT_WORK × rollout samples + PRELUDE_WORK × preludes (pinned simulator
 * costs against E2's, scripts/.cache/training/build/ai2/profile-match.out: rollout 3.8 ms, prelude 1.2–2 ms, E2 1.6 ms).
 */
export const ROLLOUT_WORK = 2.5, PRELUDE_WORK = 1;
/** Accuracy corrections are a refinement: none once the decision's work reaches this (SPEC 15's time budget). */
export const CORRECTION_WORK = 260;
/** Turns a field effect set this turn has left after this turn's countdown (pinned data/moves.ts durations − 1). */
const SET_THIS_TURN = { weather: 4, terrain: 4, room: 4, tailwind: 3, screen: 4 } as const;
/** Hazard moves the engine leaves without effect (doubles-actions.ts NO_EFFECT_MOVES), set on the foe side when used. */
const HAZARD_MOVES: ReadonlySet<string> = new Set(["stealthrock", "spikes", "toxicspikes", "stickyweb"]);

const cellKey = (cell: CellActions) => `${jointActionKey(cell.opponent)}|${jointActionKey(cell.own)}`;
const addTerms = (a: Terms, b: Terms, scale = 1): Terms => ({ total: a.total + scale * b.total, lasting: a.lasting + scale * b.lasting, keep: a.keep + scale * b.keep });
const ZERO: Terms = { total: 0, lasting: 0, keep: 0 };
const inputKey = (input: DoublesTurnInput) => JSON.stringify([input.field, input.pokemon]);
const otherSide = (side: DoublesSideId): DoublesSideId => side === "own" ? "opponent" : "own";

/**
 * The field clock after this turn's countdown (SPEC 10.5): an effect up before the turn loses one turn; one set this turn
 * (absent from the decision's clock, present after the moves) has its base duration less one: Tailwind 3, Trick Room and
 * the other rooms 4, weather and terrain 4, screens 4. An effect gone after the moves is 0. Hazards the cell set this turn
 * are added (the engine gives them no effect).
 */
export function nextClock(clock: FieldClock, outcome: DoublesOutcome, hazards: Partial<Record<DoublesSideId, string[]>> = {}): FieldClock {
  const count = (before: number, on: boolean, set: number) => !on ? 0 : before > 0 ? Math.max(0, before - 1) : set;
  const weatherNow = outcome.field.weather;
  const weather = !weatherNow ? null
    : clock.weather && clock.weather.id === weatherNow ? (clock.weather.turns === null ? { id: weatherNow, turns: null } : clock.weather.turns > 1 ? { id: weatherNow, turns: clock.weather.turns - 1 } : null)
    : { id: weatherNow, turns: weatherNow === "Harsh Sunshine" || weatherNow === "Heavy Rain" || weatherNow === "Strong Winds" ? null : SET_THIS_TURN.weather };
  const terrainNow = outcome.field.terrain;
  const terrain = !terrainNow ? null
    : clock.terrain && clock.terrain.id === terrainNow ? (clock.terrain.turns > 1 ? { id: terrainNow, turns: clock.terrain.turns - 1 } : null)
    : { id: terrainNow, turns: SET_THIS_TURN.terrain };
  const rooms = {
    trickRoom: count(clock.rooms.trickRoom, outcome.field.trickRoom, SET_THIS_TURN.room),
    gravity: count(clock.rooms.gravity, outcome.field.gravity, SET_THIS_TURN.room),
    magicRoom: count(clock.rooms.magicRoom, outcome.field.magicRoom, SET_THIS_TURN.room),
    wonderRoom: count(clock.rooms.wonderRoom, outcome.field.wonderRoom, SET_THIS_TURN.room),
  };
  const side = (id: DoublesSideId) => {
    const before = clock.sides[id];
    const after = outcome.sides[id];
    const next = {
      ...before,
      tailwind: count(before.tailwind, after.tailwind, SET_THIS_TURN.tailwind),
      reflect: count(before.reflect, after.reflect, SET_THIS_TURN.screen),
      lightScreen: count(before.lightScreen, after.lightScreen, SET_THIS_TURN.screen),
      auroraVeil: count(before.auroraVeil, after.auroraVeil, SET_THIS_TURN.screen),
      safeguard: Math.max(0, before.safeguard - 1),
    };
    for (const moveId of hazards[id] ?? []) {
      if (moveId === "stealthrock") next.stealthRock = true;
      else if (moveId === "spikes") next.spikes = Math.min(3, next.spikes + 1) as 0 | 1 | 2 | 3;
      else if (moveId === "toxicspikes") next.toxicSpikes = Math.min(2, next.toxicSpikes + 1) as 0 | 1 | 2;
      else if (moveId === "stickyweb") next.stickyWeb = true;
    }
    return next;
  };
  return { weather, terrain, rooms, sides: { own: side("own"), opponent: side("opponent") } };
}

/**
 * A Pokémon whose ability is not one of its species' own (Trace's copy, Skill Swap, Entrainment, Receiver: PS/data/abilities.ts
 * trace onUpdate setAbility): the calculator's builds take only the species' catalog abilities (model.ts validateBuild), so
 * such a cell is rolled out rather than sent to E2 as an issue.
 */
function foreignAbility(input: DoublesTurnInput, runtime: BattleRuntime): string | null {
  for (const slot of DOUBLES_SLOTS) {
    const build = input.pokemon[slot]?.build;
    const species = build ? runtime.speciesById.get(build.speciesId) : null;
    if (build && species && !species.abilities.includes(build.abilityId)) {
      return `${species.name}'s ability (${runtime.abilitiesById.get(build.abilityId)?.name ?? build.abilityId}) is not its own.`;
    }
  }
  return null;
}
/** The first issue of an E2 "issues" result as text ("own-left: Ability is not legal."). */
function issueText(issues: Extract<DoublesOutcomesResult, { status: "issues" }>["issues"]): string {
  for (const [slot, list] of Object.entries(issues.pokemon)) if (list?.length) return `${slot}: ${list[0].message}`;
  if (issues.field.length) return `field: ${issues.field[0].message}`;
  if (issues.actions.length) return `${issues.actions[0].slot}: ${issues.actions[0].message}`;
  return "unknown";
}
/** The input with one slot's action made "No move" (a fair miss: no damage, no secondary, no recoil; doubles-types.ts DoublesAction). */
function withoutAction(input: DoublesTurnInput, slot: DoublesSlotId): DoublesTurnInput {
  const entry = input.pokemon[slot];
  if (!entry) return input;
  return { ...input, pokemon: { ...input.pokemon, [slot]: { ...entry, action: { moveId: null, target: null } } } };
}

/**
 * One E2 outcome as a PostState (SPEC 10.5): slots to keys by the world; bench and unseen members as in `base` (a Pokémon
 * the prelude switched out keeps its HP on the bench); the residual pass added to each surviving Pokémon (clamped); the
 * field clock counted down one turn; the side's wipe chance when it has no living bench and no unseen members.
 */
export function postFromOutcome(args: {
  view: AiView; base: PostState; residual: Readonly<Record<MonKey, number>>; outcome: DoublesOutcome; start: DoublesStart; world: EngineWorld; cell: CellActions;
}): PostState {
  const { view, base, residual, outcome, start, world, cell } = args;
  const placed = new Set<MonKey>();
  const mons: PostMon[] = [];
  for (const slot of DOUBLES_SLOTS) {
    const key = world.keys[slot];
    const mon = outcome.mons[slot];
    if (!key || !mon) continue;
    placed.add(key);
    const before = base.mons.find((each) => each.key === key);
    const maxHp = start[slot]?.maximum ?? before?.maxHp ?? 1;
    const change = residual[key] ?? 0;
    mons.push({
      key, side: slotSide(slot), slot, known: before?.known ?? view.mons.some((each) => each.key === key), build: mon.build,
      hp: mon.hp.map((entry) => ({ hp: entry.hp > 0 ? Math.max(0, Math.min(maxHp, entry.hp + change)) : 0, chance: entry.chance })),
      maxHp, volatiles: [], protected: mon.protected,
    });
  }
  for (const mon of base.mons) if (!placed.has(mon.key)) mons.push({ ...mon, slot: mon.slot !== null && mon.hp.some((entry) => entry.hp > 0) ? null : mon.slot, protected: false });
  const megaUsed = { own: view.megaUsed.own || megaSlots(cell.own).length > 0, opponent: view.megaUsed.opponent || megaSlots(cell.opponent).length > 0 };
  const hazards: Partial<Record<DoublesSideId, string[]>> = {};
  for (const slot of DOUBLES_SLOTS) {
    const action = world.input.pokemon[slot]?.action;
    if (action?.moveId && HAZARD_MOVES.has(action.moveId) && outcome.mons[slot]?.moved) (hazards[otherSide(slotSide(slot))] ??= []).push(action.moveId);
  }
  const wiped = { own: 0, opponent: 0 };
  for (const side of ["own", "opponent"] as const) {
    const bench = mons.some((mon) => mon.side === side && mon.slot === null && mon.hp.some((entry) => entry.hp > 0));
    const unseen = side === "own" && view.hidden.unrevealed > 0;
    if (!bench && !unseen) wiped[side] = outcome.allFainted[side];
  }
  return { chance: outcome.chance, mons, clock: nextClock(view.clock, outcome, hazards), megaUsed, wiped, endOfTurn: "estimated" };
}

export function createCellEvaluator(deps: EvaluatorDeps): CellEvaluator {
  const { services, runtime, weights, worth, rows, replace, budget } = deps;
  const view: AiView = services.view;
  const ctx: ValueContext = { weights, worth, runtime, field: view.field, rows, particles: view.particles, view, mega: deps.mega };
  const used = { engineCalls: 0, rolloutSamples: 0 };
  const timing = { e2: 0, value: 0, bridge: 0, rollout: 0 };
  const now = deps.now ?? (() => 0);
  const timed = <T,>(part: keyof typeof timing, run: () => T): T => { const start = now(); try { return run(); } finally { timing[part] += now() - start; } };
  let issues = 0;
  const entries = new Map<string, Entry>();
  const bridged = new Map<string, EngineWorlds>();
  const e2 = new Map<string, DoublesOutcomesResult>();
  let residual: Readonly<Record<MonKey, number>> | null = null;
  let start: PostState | null = null;
  const residualOf = () => residual ??= services.residual();
  const current = () => start ??= services.current();
  const byKey = new Map(view.mons.map((mon) => [mon.key, mon]));

  const worldsOf = (cell: CellActions): EngineWorlds => {
    const key = cellKey(cell);
    let worlds = bridged.get(key);
    if (!worlds) bridged.set(key, worlds = timed("bridge", () => services.engineWorlds(cell)));
    return worlds;
  };
  const engineLeft = () => budget.engineCalls - used.engineCalls;
  const work = () => used.engineCalls + ROLLOUT_WORK * used.rolloutSamples + PRELUDE_WORK * services.spent.preludes;
  const rolloutLeft = () => budget.rolloutSamples - used.rolloutSamples;
  /** Inputs of `inputs` not yet calculated. */
  const missing = (inputs: readonly DoublesTurnInput[]) => new Set(inputs.map(inputKey).filter((key) => !e2.has(key))).size;
  const outcomesOf = (input: DoublesTurnInput): DoublesOutcomesResult => {
    const key = inputKey(input);
    let result = e2.get(key);
    if (!result) {
      used.engineCalls++;
      result = timed("e2", () => calculateDoublesOutcomes(input));
      if (result.status === "issues") issues++;
      e2.set(key, result);
    }
    return result;
  };

  const postOf = (outcome: DoublesOutcome, startHP: DoublesStart, world: EngineWorld, cell: CellActions) =>
    postFromOutcome({ view, base: current(), residual: residualOf(), outcome, start: startHP, world, cell });
  const termsOf = (post: PostState, cell: CellActions): Terms => {
    const terms = timed("value", () => stateTerms(post, { ...ctx, cell }));
    return { total: terms.total, lasting: terms.megaLasting, keep: terms.megaKeep };
  };

  /** E[terms] over the worlds' outcomes; null when a world is not estimated (the reason) or has issues. */
  function engineTerms(worlds: readonly EngineWorld[], cell: CellActions, notes: string[]): Terms | null {
    let total = ZERO;
    for (const world of worlds) {
      const foreign = foreignAbility(world.input, runtime);
      if (foreign) { notes.push(foreign); return null; }
      const result = outcomesOf(world.input);
      if (result.status === "issues") { notes.push(`The turn engine reported issues: ${issueText(result.issues)}`); return null; }
      if (result.status === "not-estimated") { notes.push(result.reason); return null; }
      for (const outcome of result.outcomes) total = addTerms(total, termsOf(postOf(outcome, result.start, world, cell), cell), world.weight * outcome.chance);
    }
    return total;
  }

  /** The cell's inaccurate actions in world 0 (p < 1), lowest first, at most ACCURACY_CORRECTIONS. */
  function inaccurate(world: EngineWorld): { slot: DoublesSlotId; p: number }[] {
    const out: { slot: DoublesSlotId; p: number }[] = [];
    for (const slot of DOUBLES_SLOTS) {
      const entry = world.input.pokemon[slot];
      const actor = world.keys[slot];
      const moveId = entry?.action.moveId;
      if (!entry || !actor || !moveId || !byKey.has(actor)) continue;
      const move = runtime.movesById.get(moveId);
      if (!move || move.accuracy === null) continue;
      const aimed = entry.action.target ? world.keys[entry.action.target] : null;
      const targets = aimed && byKey.has(aimed) ? [aimed]
        : foesOf(slot).map((each) => world.keys[each]).filter((key): key is MonKey => !!key && byKey.has(key));
      const p = targets.length
        ? targets.reduce((sum, key) => sum + effectiveAccuracy(view, actor, moveId, key, runtime), 0) / targets.length
        : effectiveAccuracy(view, actor, moveId, null, runtime);
      if (p < 1 - 1e-9) out.push({ slot, p });
    }
    return out.sort((a, b) => a.p - b.p || DOUBLES_SLOTS.indexOf(a.slot) - DOUBLES_SLOTS.indexOf(b.slot)).slice(0, ACCURACY_CORRECTIONS);
  }

  let corrections = 0;
  function engineValue(result: Extract<EngineWorlds, { kind: "engine" }>, cell: CellActions, notes: string[], reserve: number): CellValue | null {
    if (missing(result.worlds.map((world) => world.input)) > engineLeft()) { notes.push("Engine budget spent."); return null; }
    const all = engineTerms(result.worlds, cell, notes);
    if (!all) return null;
    let value = all;
    // V = V_all + Σ (1 − p_i)(V_−i − V_all), each miss re-run as "No move" in every world (SPEC 10.5).
    for (const { slot, p } of inaccurate(result.worlds[0])) {
      const missed = result.worlds.map((world) => ({ ...world, input: withoutAction(world.input, slot) }));
      const calls = missing(missed.map((world) => world.input));
      if (calls > engineLeft() - reserve || work() + calls > CORRECTION_WORK) break;
      corrections += calls;
      const without = engineTerms(missed, cell, []);
      if (!without) continue;
      value = addTerms(value, addTerms(without, all, -1), 1 - p);
    }
    for (const world of result.worlds) for (const note of world.notes) if (!notes.includes(note)) notes.push(note);
    return { value: value.total, method: result.source === "prelude" ? "prelude" : "engine", samples: 0, notes, mega: { lasting: value.lasting, keep: value.keep } };
  }

  function rolloutTo(entry: Entry, cell: CellActions, target: number): CellValue | null {
    while (entry.samples < target && rolloutLeft() > 0) {
      const post = timed("rollout", () => services.rollout(cell, entry.samples, replace));
      used.rolloutSamples++;
      entry.sum = addTerms(entry.sum, termsOf(post, cell));
      entry.samples++;
    }
    if (!entry.samples) return null;
    const mean = (value: number) => value / entry.samples;
    return entry.value = {
      value: mean(entry.sum.total), method: "rollout", samples: entry.samples, notes: entry.notes,
      mega: { lasting: mean(entry.sum.lasting), keep: mean(entry.sum.keep) },
    };
  }

  function evaluate(cell: CellActions, stage: "A" | "B", reserve = 0, rolloutsAhead = 0): CellValue | null {
    const key = cellKey(cell);
    const known = entries.get(key);
    if (known) {
      if (stage === "B" && known.method === "rollout") return rolloutTo(known, cell, Math.max(budget.stageBSamples, known.samples));
      return known.value;
    }
    const worlds = worldsOf(cell);
    const notes: string[] = [];
    if (worlds.kind === "skip") {
      entries.set(key, { method: "dropped", samples: 0, sum: ZERO, value: null, notes: [...worlds.reasons], skip: true });
      return null;
    }
    if (worlds.kind === "engine") {
      const value = engineValue(worlds, cell, notes, reserve);
      if (value) {
        entries.set(key, { method: value.method, samples: 0, sum: ZERO, value, notes });
        return value;
      }
    } else notes.push(...worlds.reasons);
    const entry: Entry = { method: "rollout", samples: 0, sum: ZERO, value: null, notes };
    entries.set(key, entry);
    const samples = rolloutLeft() - budget.stageASamples >= rolloutsAhead ? budget.stageASamples : 1;
    const value = rolloutTo(entry, cell, samples);
    if (!value) entry.method = "dropped";
    return value;
  }

  return {
    evaluate,
    worldsOf,
    canEvaluate: () => engineLeft() > 0 || rolloutLeft() > 0,
    notesOf: (cell) => entries.get(cellKey(cell))?.notes ?? [],
    skipped: (cell) => !!entries.get(cellKey(cell))?.skip,
    used,
    timing,
    get issues() { return issues; },
    get corrections() { return corrections; },
    work,
  };
}
