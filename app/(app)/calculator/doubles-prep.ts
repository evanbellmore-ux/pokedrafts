import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { defaultDoublesTarget, doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import {
  allyOf, DOUBLES_SLOTS, doublesNames, foesOf, SHOWDOWN_POSITION, slotSide,
  type DoublesAction, type DoublesCarried, type DoublesPokemonInput, type DoublesSideId, type DoublesSlotId, type DoublesTargetRule, type DoublesTurnInput,
} from "@/app/lib/battle/doubles-types";
import { NO_TRACE_ABILITIES } from "@/app/lib/battle/imposter";
import { applyIntimidateToFoes, entryBoosts, intimidatedKey, type EntryBoost, type IntimidateBattle } from "@/app/lib/battle/intimidate";
import { createBuild, createConditions, validateBuild, withUsualAbility } from "@/app/lib/battle/model";
import { createMoveSlots, usualAbility, withHiddenPowerIVs } from "@/app/lib/battle/move-defaults";
import type { BattleBuild, BattleConditions, BattleMechanic, BuildIssue, CombatStat, MoveContext } from "@/app/lib/battle/types";
import {
  addBenchEntry, afterDoublesAction, aimedAt, applyDoublesEarlier, benchOf, carriedAbilityOn, clearSlotEarlier, isFaintedBuild, NO_BENCH, NO_CARRIED, NO_HISTORY, NO_TURN_EARLIER,
  mapBenchEntries, reconcileCarried, reconcileEarlier, removeBenchEntry, withBench, withSlotHistory, withTurnEarlier,
  type DoublesBench, type DoublesBenchEntry, type DoublesSlotHistory, type DoublesTurnEarlier,
} from "./doubles-inputs";
import type { CalculatorRosterState } from "./roster-data";
import {
  activateMoveSlot, dismissMoveReplacement, equipRequiredMove, getMoveOwner, orientField, reconcileRosterSlot, replaceMatchupMove,
  rosterSourceCheck, sameMoveOwner, selectMatchupMove, selectRosterPokemon, toggleMatchupMechanic, toggleMatchupMega, updateMatchupBuild,
  updateMatchupHP, updateMatchupMoveContext, withPreparedMoves,
  type Combatant, type MoveOwner, type MoveReplacement, type PreparedMatchup, type RosterChoice, type RosterSourceCheck,
} from "./roster-prep";

// The state-from-earlier-turns logic lives in doubles-inputs.ts (status2 Step 0c); its exports stay importable from here.
export {
  benchNamesOf, carriedAbilityOn, carriedIssueTexts, carriedOptions, earlierTurnToggles, isFaintedBuild, NO_BENCH, NO_CARRIED_OPTIONS, reconcileCarried, setDoublesSwitchedIn,
  sleepTurnsMax, switchedInOptions, type CarriedOptions, type DoublesBench, type DoublesBenchEntry,
} from "./doubles-inputs";

export type DoublesMatchup = {
  runtime: BattleRuntime;
  /** Bumps on 2v2 Reset, game change and account change. Combatant keys are revision * 4 + DOUBLES_SLOTS index. */
  revision: number;
  notice: string;
  slots: Record<DoublesSlotId, Combatant>;
  actions: Record<DoublesSlotId, DoublesAction>;
  /** It used Charge on an earlier turn; cleared when the slot gets another Pokémon. */
  charged: Record<DoublesSlotId, boolean>;
  /**
   * Its state from earlier turns the calculator sets (status-eot SPEC §5, ADDENDUM §5): turns lost to sleep and Rest
   * sleep, turns lost to freeze (Champions), confusion and its turns, bad poison turns, and a Substitute's HP. {} when
   * none. Cleared when the slot gets another Pokémon; a build change drops or bounds what no longer applies
   * (reconcileCarried).
   */
  carried: Record<DoublesSlotId, DoublesCarried>;
  /**
   * Its answers about earlier turns that are not carried state (status2 IN §5.4; doubles-inputs DoublesSlotHistory): its
   * last move and that move's target, the item it used earlier, its types. NO_HISTORY until a control sets one (Step 0c).
   */
  history: Record<DoublesSlotId, DoublesSlotHistory>;
  /** The field's and the sides' answers about earlier turns (status2 IN §5.4; doubles-inputs DoublesTurnEarlier). NO_TURN_EARLIER until a control sets one. */
  turnEarlier: DoublesTurnEarlier;
  /**
   * status2 R-U (IN §5.7): each side's Bench from its roster (in roster order, at most four), the Replacement picked for each
   * Pokémon that can switch out by its player's choice, and each side's Hazards (doubles-inputs DoublesBench). NO_BENCH until a
   * control sets one. A game, account or 2v2 Reset gives none; a roster change removes the bench Pokémon it no longer offers
   * (reconcileDoublesRosters); one put into play leaves the bench (selectDoublesRoster).
   */
  bench: DoublesBench;
  /** attackerSide: your side; defenderSide: the opponent's. gameType "Doubles". */
  field: BattleConditions;
  /** The Moves pane: whose moves it lists and which Pokémon its rows are into (never the same slot). */
  moves: { slot: DoublesSlotId; into: DoublesSlotId };
  replacement: MoveReplacement | null;
  replacementSession: number;
  /**
   * The last apply action's result (applyDoublesIntimidate: an Intimidate, or the Intimidate a Trace holder copied;
   * applyDoublesCommander): its Pokémon, its lines, how many times in a row, and the four builds it left.
   */
  intimidate: { slot: DoublesSlotId; lines: string[]; count: number; builds: Record<DoublesSlotId, BattleBuild> } | null;
};
/** CalculatorClient's one useState: an update changes both views consistently. */
export type CalculatorState = { matchup: PreparedMatchup; doubles: DoublesMatchup };

const DEFAULT_SPECIES: Record<DoublesSlotId, string> = {
  "own-left": "charizard", "own-right": "venusaur", "opponent-left": "blastoise", "opponent-right": "pikachu",
};
const NO_ACTION: DoublesAction = { moveId: null, target: null };

function perSlot<T>(value: (slot: DoublesSlotId, index: number) => T): Record<DoublesSlotId, T> {
  return Object.fromEntries(DOUBLES_SLOTS.map((slot, index) => [slot, value(slot, index)])) as Record<DoublesSlotId, T>;
}

/** The four slots' names (doublesNames): "Charizard", "Garchomp (yours)", "Garchomp (1)". */
function namesOf(doubles: Pick<DoublesMatchup, "slots" | "runtime">): Record<DoublesSlotId, string> {
  return doublesNames(doubles.slots, doubles.runtime);
}

/** The 1v1 side whose side conditions are the slot's (attackerSide is your side). */
function pairSide(slot: DoublesSlotId) {
  return slotSide(slot) === "own" ? "attacker" as const : "defender" as const;
}

export function createDoubles(revision = 0, runtime: BattleRuntime = championsRuntime): DoublesMatchup {
  const field: BattleConditions = { ...createConditions(), gameType: "Doubles" };
  const fallback = runtime.catalog.species.find((entry) => !entry.battleForm && !entry.unsupported.length)?.id ?? "";
  const slots = perSlot((slot, index): Combatant => {
    const id = runtime.speciesById.has(DEFAULT_SPECIES[slot]) ? DEFAULT_SPECIES[slot] : fallback;
    const moves = createMoveSlots(id, field.gameType, runtime);
    const build = withHiddenPowerIVs(withUsualAbility(createBuild(id, runtime), usualAbility(id, field.gameType, runtime)), moves, runtime);
    return { key: revision * 4 + index, editorRevision: 0, role: slotSide(slot), build: withPreparedMoves(build, moves),
      hpInput: "", source: null, moves, megaBase: null, contexts: {}, moveEpoch: 0 };
  });
  return {
    runtime, revision, notice: "", slots,
    actions: perSlot(() => NO_ACTION), charged: perSlot(() => false), carried: perSlot(() => NO_CARRIED),
    history: perSlot(() => NO_HISTORY), turnEarlier: NO_TURN_EARLIER, bench: NO_BENCH, field,
    moves: { slot: "own-left", into: "opponent-left" },
    replacement: null, replacementSession: 0, intimidate: null,
  };
}

/** A fresh 2v2 for the next revision; move epochs and the replacement session keep counting, as freshMatchup's do. */
function freshDoubles(doubles: DoublesMatchup, runtime = doubles.runtime): DoublesMatchup {
  const next = createDoubles(doubles.revision + 1, runtime);
  return {
    ...next,
    slots: perSlot((slot) => ({ ...next.slots[slot], moveEpoch: doubles.slots[slot].moveEpoch + 1 })),
    replacementSession: doubles.replacementSession,
  };
}

/** The slots whose Pokémon has fainted before the turn (doubles-inputs isFaintedBuild: current HP 0). */
export function doublesFainted(slots: Record<DoublesSlotId, { build: BattleBuild }>): Record<DoublesSlotId, boolean> {
  return perSlot((slot) => isFaintedBuild(slots[slot].build));
}

/** The 2v2 build issues: validateBuild, where current HP 0 (fainted) is allowed. */
export function doublesBuildIssues(build: BattleBuild, runtime: BattleRuntime): BuildIssue[] {
  return validateBuild(isFaintedBuild(build) ? { ...build, currentHP: null } : build, runtime);
}

/**
 * The target a "choose" rule gives `slot`: `chosen` while the rule offers it, else `preferred`, else the first foe it
 * offers, else its first option. A move that can aim at a foe (`full`, the rule with every slot filled) is never
 * turned on its ally or itself when no foe is left: it has no target unless that was chosen. Null for "auto" and
 * "none". With all four slots filled this is defaultDoublesTarget.
 */
function pickTarget(rule: DoublesTargetRule, full: DoublesTargetRule, slot: DoublesSlotId, chosen: DoublesSlotId | null, preferred: DoublesSlotId | null): DoublesSlotId | null {
  if (rule.kind !== "choose") return null;
  if (chosen && rule.options.includes(chosen)) return chosen;
  const foe = (options: DoublesSlotId[]) => options.find((option) => slotSide(option) !== slotSide(slot));
  const living = foe(rule.options);
  if (!living && full.kind === "choose" && foe(full.options)) return null;
  if (preferred && rule.options.includes(preferred)) return preferred;
  return living ?? rule.options[0] ?? null;
}

/**
 * The turn's input from the four slots: a fainted slot is null (doubles-types: no Pokémon there), so it does not act,
 * is not a target and gives its partner nothing. Each other slot keeps its action; a target that has fainted is
 * replaced as the game does (pickTarget: the other foe), and the chosen one comes back when that Pokémon's HP does.
 * The turn's text names the four Pokémon as their cards do (`names`: doublesNames over all four, a fainted one's too),
 * so a fainted twin or mirror partner does not change the others' names.
 */
export function doublesTurnInput(runtime: BattleRuntime, field: BattleConditions, pokemon: Record<DoublesSlotId, DoublesPokemonInput>): DoublesTurnInput {
  if (!DOUBLES_SLOTS.some((slot) => isFaintedBuild(pokemon[slot].build))) return { runtime, field, pokemon };
  const full: DoublesTurnInput = { runtime, field, pokemon };
  const living: DoublesTurnInput = { runtime, field, pokemon: perSlot((slot) => isFaintedBuild(pokemon[slot].build) ? null : pokemon[slot]) };
  return {
    runtime, field, names: doublesNames(pokemon, runtime),
    pokemon: perSlot((slot) => {
      const entry = living.pokemon[slot];
      const { moveId, target } = entry?.action ?? NO_ACTION;
      if (!entry || moveId === null) return entry;
      const next = pickTarget(doublesTargetRule(living, slot, moveId), doublesTargetRule(full, slot, moveId), slot, target, null);
      return next === target ? entry : { ...entry, action: { moveId, target: next } };
    }),
  };
}

/**
 * The actions that read their user's own moves (DoublesPokemonInput.moves): Imprison (the moves it stops a foe using,
 * status-eot SPEC §4.2), Conversion (its first move's type: the first quick move, status2 Q11) and Sleep Talk (the moves
 * it can call, status2 ADDENDUM2 §2.3 #49).
 */
const MOVES_READERS = new Set(["imprison", "conversion", "sleeptalk"]);

/**
 * One slot's turn input: its build, move contexts, Charge and action, its state from earlier turns when it has any, and
 * its moves when its action reads them (MOVES_READERS: its quick moves in slot order, then its chosen move when that is
 * not one of them), so every other turn's input is what it was before. Its history answers (`history`: its last move, the
 * item it used earlier, its types) through doubles-inputs withSlotHistory.
 */
export function doublesSlotInput(combatant: Pick<Combatant, "build" | "contexts" | "moves">, charged: boolean, action: DoublesAction, carried: DoublesCarried, history: DoublesSlotHistory = NO_HISTORY,
  read = false): DoublesPokemonInput {
  const { build, contexts } = combatant;
  const moves = (action.moveId !== null && MOVES_READERS.has(action.moveId)) || read
    ? [...new Set([...combatant.moves.flatMap((prepared) => prepared.moveId ? [prepared.moveId] : []), ...(action.moveId !== null ? [action.moveId] : [])])] : null;
  return withSlotHistory({ build, contexts, charged, action, ...(Object.keys(carried).length ? { carried } : {}), ...(moves ? { moves } : {}) }, history);
}

/**
 * Review 2 (R6-2; round 2, R6-r2-1, -4): the slots whose moves another Pokémon's action reads (doublesSlotInput's `read`; their
 * own MOVES_READERS action aside): Assist's partner (PS/data/moves.ts assist: each other party member's moveSlots); a Snatch or
 * Copycat user where Conversion or Imprison may be used this turn (an action, a last move, the battle's last move), and every
 * Assist user (a called one is its user's: conversion onHit reads moveSlots[0], imprison's condition its source's moveSlots;
 * Imprison has the snatch flag and neither failcopycat nor noassist); an Instruct target whose last move is one of
 * MOVES_READERS (instruct re-runs lastMove), the Instruct aimed at it as the turn's input aims it (aimedAt: a fainted target's
 * retarget; `fainted`, the slots fainted before the turn).
 */
export function movesRead(actions: Record<DoublesSlotId, DoublesAction>, history: Partial<Record<DoublesSlotId, DoublesSlotHistory>>, battleLastMove?: string | null,
  fainted: Record<DoublesSlotId, boolean> = perSlot(() => false)): Record<DoublesSlotId, boolean> {
  const used = (slot: DoublesSlotId) => actions[slot].moveId;
  const reads = (id: unknown) => typeof id === "string" && SELF_READERS.has(id);
  const called = reads(battleLastMove) || DOUBLES_SLOTS.some((slot) => reads(used(slot)) || reads(history[slot]?.lastMove));
  return perSlot((slot) => {
    if (used(allyOf(slot)) === "assist" || used(slot) === "assist") return true;
    if ((used(slot) === "snatch" || used(slot) === "copycat") && called) return true;
    const last = history[slot]?.lastMove;
    return typeof last === "string" && MOVES_READERS.has(last)
      && DOUBLES_SLOTS.some((other) => other !== slot && used(other) === "instruct" && (aimedAt(actions, fainted, other) === slot || actions[other].target === null));
  });
}
/** The moves that read their user's own moves when another move calls them (conversion: moveSlots[0]; imprison: its source's moveSlots). */
const SELF_READERS: ReadonlySet<string> = new Set(["conversion", "imprison"]);

function slotInputs(doubles: DoublesMatchup): Record<DoublesSlotId, DoublesPokemonInput> {
  const read = movesRead(doubles.actions, doubles.history, doubles.turnEarlier?.battleLastMove, doublesFainted(doubles.slots));
  return perSlot((slot) => doublesSlotInput(doubles.slots[slot], doubles.charged[slot], doubles.actions[slot], doubles.carried[slot], doubles.history[slot], read[slot]));
}

/**
 * The 2v2 turn's input (doublesTurnInput over the four slots), with the field's and the sides' answers about earlier turns
 * (doubles-inputs withTurnEarlier) and the Bench, Replacement picks and Hazards (status2 R-U: doubles-inputs withBench).
 */
export function getDoublesTurnInput(doubles: DoublesMatchup): DoublesTurnInput {
  return withBench(withTurnEarlier(doublesTurnInput(doubles.runtime, doubles.field, slotInputs(doubles)), doubles.turnEarlier), doubles.bench);
}

/** The slot's action in the turn (doublesTurnInput); No move for a fainted slot. */
export function doublesTurnAction(input: DoublesTurnInput, slot: DoublesSlotId): DoublesAction {
  return input.pokemon[slot]?.action ?? NO_ACTION;
}

function slotByKey(doubles: DoublesMatchup, key: number): DoublesSlotId | null {
  return DOUBLES_SLOTS.find((slot) => doubles.slots[slot].key === key) ?? null;
}

function slotByOwner(doubles: DoublesMatchup, owner: MoveOwner): DoublesSlotId | null {
  return DOUBLES_SLOTS.find((slot) => sameMoveOwner(getMoveOwner(doubles.slots[slot]), owner)) ?? null;
}

/** The target a move change defaults to: the Moves pane's `into` while the pane shows this slot, else the first foe in slot order. */
function preferredTarget(doubles: DoublesMatchup, slot: DoublesSlotId): DoublesSlotId {
  return doubles.moves.slot === slot ? doubles.moves.into : foesOf(slot)[0];
}

/**
 * The slot's target for its move's rule: the current one while it is an option (doubles-targets defaultDoublesTarget).
 * A fainted slot keeps its action, and a target that has fainted is kept while the move could aim at it, so both come
 * back with that Pokémon's HP; the turn aims elsewhere meanwhile (doublesTurnInput).
 */
function retarget(doubles: DoublesMatchup, slot: DoublesSlotId): DoublesMatchup {
  const action = doubles.actions[slot];
  const fainted = doublesFainted(doubles.slots);
  if (fainted[slot]) return doubles;
  let target: DoublesSlotId | null = null;
  if (action.moveId !== null) {
    const full: DoublesTurnInput = { runtime: doubles.runtime, field: doubles.field, pokemon: slotInputs(doubles) };
    const fullRule = doublesTargetRule(full, slot, action.moveId);
    const kept = action.target !== null && fainted[action.target] && fullRule.kind === "choose" && fullRule.options.includes(action.target);
    target = !DOUBLES_SLOTS.some((entry) => fainted[entry]) ? defaultDoublesTarget(fullRule, action.target, preferredTarget(doubles, slot))
      : kept ? action.target
      : pickTarget(doublesTargetRule(getDoublesTurnInput(doubles), slot, action.moveId), fullRule, slot, action.target, preferredTarget(doubles, slot));
  }
  return target === action.target ? doubles : { ...doubles, actions: { ...doubles.actions, [slot]: { ...action, target } } };
}

/** `into` while it is another slot whose Pokémon has not fainted, else the first such slot of its foes (in slot order) and its ally; else `into`. */
function livingInto(fainted: Record<DoublesSlotId, boolean>, slot: DoublesSlotId, into: DoublesSlotId): DoublesSlotId {
  if (into !== slot && !fainted[into]) return into;
  return [...foesOf(slot), allyOf(slot)].find((entry) => !fainted[entry]) ?? into;
}

/**
 * The Moves pane leaves fainted Pokémon: a fainted pane slot gives way to the first living one (its own side first,
 * pointed at its target as focusPane does), a fainted receiver to a living one (livingInto).
 */
function livingPane(doubles: DoublesMatchup): DoublesMatchup {
  const fainted = doublesFainted(doubles.slots);
  const { moves } = doubles;
  if (!fainted[moves.slot] && !fainted[moves.into]) return doubles;
  if (!fainted[moves.slot]) {
    const into = livingInto(fainted, moves.slot, moves.into);
    return into === moves.into ? doubles : { ...doubles, moves: { slot: moves.slot, into } };
  }
  const side = slotSide(moves.slot);
  const next = [...DOUBLES_SLOTS.filter((entry) => slotSide(entry) === side), ...DOUBLES_SLOTS.filter((entry) => slotSide(entry) !== side)].find((entry) => !fainted[entry]);
  return next ? focusPane(doubles, next) : doubles;
}

function withDoubles(state: CalculatorState, doubles: DoublesMatchup): CalculatorState {
  return doubles === state.doubles ? state : { ...state, doubles };
}

/**
 * Runs a 1v1 one-Pokémon transition on a 2v2 slot: the slot stands as "attacker", its first foe in slot order as
 * "defender", the field oriented to the slot's side. Reads back only the slot, the shared cache, the replacement/session
 * and the action's move; notices name the Pokémon the change replaces through the transitions' `place`. Discards every
 * other change (clearMoveInteractions, the other Pokémon, field). A replacement another slot owns is kept.
 */
function onSlot(state: CalculatorState, slot: DoublesSlotId, run: (pair: PreparedMatchup) => PreparedMatchup): CalculatorState {
  const { matchup, doubles } = state;
  const combatant = doubles.slots[slot];
  const pair: PreparedMatchup = {
    ...matchup,
    notice: doubles.notice,
    intimidate: null,
    attacker: combatant,
    defender: doubles.slots[foesOf(slot)[0]],
    field: orientField(doubles.field, pairSide(slot)),
    attack: { owner: getMoveOwner(combatant), moveId: doubles.actions[slot].moveId },
    replacement: doubles.replacement,
    replacementSession: doubles.replacementSession,
  };
  const next = run(pair);
  if (next === pair) return state;
  const nextSlot = next.attacker;
  const moveId = sameMoveOwner(next.attack.owner, getMoveOwner(nextSlot)) ? next.attack.moveId : null;
  const owned = (replacement: MoveReplacement | null) => replacement !== null && replacement.owner.key === combatant.key;
  // A new species or roster entry bumps editorRevision (roster-prep storeBuild, selectRosterPokemon).
  const anotherPokemon = nextSlot.editorRevision !== combatant.editorRevision;
  const action = doubles.actions[slot];
  const updated: DoublesMatchup = {
    ...doubles,
    notice: next.notice,
    slots: { ...doubles.slots, [slot]: nextSlot },
    actions: moveId === action.moveId ? doubles.actions : { ...doubles.actions, [slot]: moveId === null ? NO_ACTION : { moveId, target: action.target } },
    charged: anotherPokemon && doubles.charged[slot] ? { ...doubles.charged, [slot]: false } : doubles.charged,
    carried: anotherPokemon ? withCarried(doubles, slot, NO_CARRIED) : doubles.carried,
    // Its answers about earlier turns are the old Pokémon's (status2 IN §5.4): its history clears and it leaves the entry order.
    history: anotherPokemon ? withHistory(doubles, slot, NO_HISTORY) : doubles.history,
    turnEarlier: anotherPokemon ? withoutEntered(doubles.turnEarlier, slot) : doubles.turnEarlier,
    replacement: owned(doubles.replacement) || owned(next.replacement) ? next.replacement : doubles.replacement,
    replacementSession: next.replacementSession,
  };
  // status2 (integration 1a, NU's rules: IN §5.4): another Pokémon also ends the states that name this one as their source
  // (clearSlotEarlier); a changed action drops its action-bound states and ends Switched in (afterDoublesAction); every
  // build change reconciles the history answers (reconcileEarlier: types of another species, a trap's source item).
  const cleared = anotherPokemon ? clearSlotEarlier(updated, slot) : updated;
  const acted = cleared.actions[slot].moveId !== action.moveId ? afterDoublesAction(cleared, slot) : cleared;
  return {
    matchup: next.cache === matchup.cache ? matchup : { ...matchup, cache: next.cache },
    // Every slot: this one's build, or a Neutralizing Gas it gains, loses or faints with, changes what the others carry.
    doubles: livingPane(retarget(reconcileAllCarried(reconcileEarlier(acted)), slot)),
  };
}

export function resetDoubles(state: CalculatorState): CalculatorState {
  const { doubles } = state;
  const champions = doubles.runtime.profile.id === "champions";
  return {
    matchup: { ...state.matchup, cache: new Map() },
    doubles: {
      ...freshDoubles(doubles),
      notice: champions
        ? "Reset 2v2 to Charizard and Venusaur versus Blastoise and Pikachu, full HP, zero Stat Points and stages, no moves and the default Doubles field. Session build edits cleared. League and opponent choices kept; imported teams kept with their original sets."
        : `Reset 2v2 ${doubles.runtime.profile.label} preparation, full HP, zero EVs and stages, no moves and the default Doubles field. Team documents and choices kept.`,
    },
  };
}

/** Why `choice` cannot go into `slot`: the ally slot already shows that roster entry ("Active as Venusaur's ally."). */
export function doublesRosterDisabled(doubles: DoublesMatchup, slot: DoublesSlotId, choice: RosterChoice): string | null {
  const ally = allyOf(slot);
  return choice.source && doubles.slots[ally].source?.key === choice.source.key ? `Active as ${namesOf(doubles)[slot]}'s ally.` : null;
}

export function selectDoublesRoster(state: CalculatorState, key: number, choice: RosterChoice): CalculatorState {
  const slot = slotByKey(state.doubles, key);
  if (!slot || doublesRosterDisabled(state.doubles, slot, choice)) return state;
  const next = onSlot(state, slot, (pair) => selectRosterPokemon(pair, "attacker", choice, namesOf(state.doubles)[slot]));
  // status2 R-U (IN §5.7): a bench Pokémon put into play leaves its side's bench.
  const side = slotSide(slot);
  const source = next.doubles.slots[slot].source;
  if (!source || !benchOf(next.doubles)[side].some((entry) => entry.key === source.key)) return next;
  const left = applyDoublesEarlier(next, removeBenchEntry(side, source.key));
  return withDoubles(left, { ...left.doubles, notice: `${left.doubles.notice} ${choice.name} is no longer on the bench.`.trim() });
}

/**
 * status2 R-U (IN §5.7): adds a roster entry of `side` to its Bench, prepared as a roster pick is (roster-prep
 * selectRosterPokemon: the shared cache's session build, else the imported set or the default build), without storing it in the
 * cache: at its place in `roster`'s order (the side's roster panel's choices), unless the bench holds four, the entry is on the
 * bench already or in play on its side.
 */
export function addDoublesBench(state: CalculatorState, side: DoublesSideId, choice: RosterChoice, roster: readonly RosterChoice[]): CalculatorState {
  const { doubles, matchup } = state;
  const source = choice.source;
  if (!source) return state;
  const [first] = DOUBLES_SLOTS.filter((slot) => slotSide(slot) === side);
  // A stand-in of the side's role with no source: selectRosterPokemon prepares the entry as it would for a slot.
  const stand: Combatant = { ...doubles.slots[first], source: null };
  const pair: PreparedMatchup = { ...matchup, attacker: stand, field: doubles.field };
  const prepared = selectRosterPokemon(pair, "attacker", choice);
  if (prepared === pair || prepared.attacker.source?.key !== source.key) return state;
  const entry: DoublesBenchEntry = {
    key: source.key, source, base: prepared.attacker.build,
    moves: prepared.attacker.moves.flatMap((move) => move.moveId ? [move.moveId] : []),
  };
  return applyDoublesEarlier(state, addBenchEntry(side, entry, roster.flatMap((each) => each.source ? [each.source.key] : [])));
}

export function updateDoublesBuild(state: CalculatorState, key: number, build: BattleBuild): CalculatorState {
  const slot = slotByKey(state.doubles, key);
  return slot ? onSlot(state, slot, (pair) => updateMatchupBuild(pair, "attacker", build, namesOf(state.doubles)[slot])) : state;
}

export function updateDoublesHP(state: CalculatorState, key: number, text: string): CalculatorState {
  const slot = slotByKey(state.doubles, key);
  return slot ? onSlot(state, slot, (pair) => updateMatchupHP(pair, "attacker", text, namesOf(state.doubles)[slot])) : state;
}

/** Trace copies a random foe's ability in doubles, so the entry form's copied Intimidate is not stored here. */
export function toggleDoublesMega(state: CalculatorState, owner: MoveOwner, formId: string): CalculatorState {
  const slot = slotByOwner(state.doubles, owner);
  return slot ? onSlot(state, slot, (pair) => toggleMatchupMega(pair, owner, formId, { storeCopiedIntimidate: false })) : state;
}

export function toggleDoublesMechanic(state: CalculatorState, owner: MoveOwner, mechanic: BattleMechanic): CalculatorState {
  const slot = slotByOwner(state.doubles, owner);
  return slot ? onSlot(state, slot, (pair) => toggleMatchupMechanic(pair, owner, mechanic)) : state;
}

export function equipDoublesRequiredMove(state: CalculatorState, key: number, slotIndex: number): CalculatorState {
  const slot = slotByKey(state.doubles, key);
  return slot ? onSlot(state, slot, (pair) => equipRequiredMove(pair, key, slotIndex)) : state;
}

/**
 * Points the Moves pane at `slot`: into its target, else the current receiver when it is another slot, else its first
 * foe in slot order; a living one (livingInto). Not at a fainted slot.
 */
function focusPane(doubles: DoublesMatchup, slot: DoublesSlotId): DoublesMatchup {
  const fainted = doublesFainted(doubles.slots);
  if (fainted[slot]) return doubles;
  const target = doublesTurnAction(getDoublesTurnInput(doubles), slot).target;
  const into = livingInto(fainted, slot, target !== null && target !== slot ? target : doubles.moves.into !== slot ? doubles.moves.into : foesOf(slot)[0]);
  // Replacement mode edits the pane's Pokémon, so another slot's ends.
  const replacement = doubles.replacement && doubles.replacement.owner.key !== doubles.slots[slot].key ? null : doubles.replacement;
  if (doubles.moves.slot === slot && doubles.moves.into === into && replacement === doubles.replacement) return doubles;
  return { ...doubles, moves: { slot, into }, replacement };
}

export function activateDoublesMoveSlot(state: CalculatorState, owner: MoveOwner, slotIndex: number): CalculatorState {
  const slot = slotByOwner(state.doubles, owner);
  if (!slot) return state;
  const next = onSlot(state, slot, (pair) => activateMoveSlot(pair, owner, slotIndex));
  return next === state ? state : withDoubles(next, focusPane(next.doubles, slot));
}

export function replaceDoublesMove(state: CalculatorState, replacement: MoveReplacement, moveId: string): CalculatorState {
  const slot = slotByOwner(state.doubles, replacement.owner);
  return slot ? onSlot(state, slot, (pair) => replaceMatchupMove(pair, replacement, moveId)) : state;
}

export function dismissDoublesReplacement(state: CalculatorState, replacement: MoveReplacement): CalculatorState {
  const slot = slotByOwner(state.doubles, replacement.owner);
  return slot ? onSlot(state, slot, (pair) => dismissMoveReplacement(pair, replacement)) : state;
}

/** A Moves-pane row or No move (null). The move must be one the Pokémon learns (roster-prep selectMatchupMove). */
export function chooseDoublesMove(state: CalculatorState, owner: MoveOwner, moveId: string | null): CalculatorState {
  const slot = slotByOwner(state.doubles, owner);
  if (!slot) return state;
  const next = onSlot(state, slot, (pair) => selectMatchupMove(pair, moveId, owner));
  // Choosing a move, No move included, ends Switched in (status2 NU: doubles-inputs afterDoublesAction).
  return withDoubles(next, afterDoublesAction(next.doubles, slot));
}

/** Only an option of the move's "choose" rule; the Moves pane follows while it shows this slot. */
export function setDoublesTarget(state: CalculatorState, owner: MoveOwner, target: DoublesSlotId): CalculatorState {
  const { doubles } = state;
  const slot = slotByOwner(doubles, owner);
  const action = slot ? doubles.actions[slot] : null;
  if (!slot || !action?.moveId) return state;
  const rule = doublesTargetRule(getDoublesTurnInput(doubles), slot, action.moveId);
  if (rule.kind !== "choose" || !rule.options.includes(target)) return state;
  const follows = doubles.moves.slot === slot && target !== slot && doubles.moves.into !== target;
  if (action.target === target && !follows) return state;
  return withDoubles(state, {
    ...doubles,
    actions: action.target === target ? doubles.actions : { ...doubles.actions, [slot]: { ...action, target } },
    moves: follows ? { slot, into: target } : doubles.moves,
  });
}

export function updateDoublesMoveContext(state: CalculatorState, owner: MoveOwner, moveId: string, context: MoveContext): CalculatorState {
  const slot = slotByOwner(state.doubles, owner);
  return slot ? onSlot(state, slot, (pair) => updateMatchupMoveContext(pair, owner, moveId, context)) : state;
}

export function focusDoublesMoves(state: CalculatorState, slot: DoublesSlotId): CalculatorState {
  return withDoubles(state, focusPane(state.doubles, slot));
}

/** The pane's receiver (never its own slot nor a fainted Pokémon); the slot's target follows when its rule offers it. */
export function setDoublesMovesInto(state: CalculatorState, into: DoublesSlotId): CalculatorState {
  const { doubles } = state;
  const slot = doubles.moves.slot;
  if (into === slot || into === doubles.moves.into || isFaintedBuild(doubles.slots[into].build)) return state;
  const action = doubles.actions[slot];
  const rule = action.moveId ? doublesTargetRule(getDoublesTurnInput(doubles), slot, action.moveId) : null;
  const follows = rule?.kind === "choose" && rule.options.includes(into) && action.target !== into;
  return withDoubles(state, {
    ...doubles,
    moves: { slot, into },
    actions: follows ? { ...doubles.actions, [slot]: { ...action, target: into } } : doubles.actions,
  });
}

export function setDoublesField(state: CalculatorState, revision: number, field: BattleConditions): CalculatorState {
  if (state.doubles.revision !== revision) return state;
  // Magic Room switches Ability Shield off, which lets a Neutralizing Gas reach a curing ability (carriedAbilityOn).
  const next: BattleConditions = { ...field, gameType: "Doubles" };
  let doubles: DoublesMatchup = reconcileAllCarried({ ...state.doubles, field: next, turnEarlier: earlierForField(state.doubles.turnEarlier, next) });
  for (const slot of DOUBLES_SLOTS) doubles = retarget(doubles, slot);
  return withDoubles(state, doubles);
}

/** The weathers no countdown ends (pinned Showdown: Desolate Land, Primordial Sea and Delta Stream last while their holder does). */
const STRONG_WEATHERS = new Set<BattleConditions["weather"]>(["Harsh Sunshine", "Heavy Rain", "Strong Winds"]);

/**
 * The field's answers about earlier turns for a new field (status2 IN §5.4): each "ends this turn" answer goes once its
 * effect is off (the weather also once it is a strong one, which never runs out). The same object when nothing goes.
 */
function earlierForField(earlier: DoublesTurnEarlier, field: BattleConditions): DoublesTurnEarlier {
  const off = {
    weatherEnds: !field.weather || STRONG_WEATHERS.has(field.weather), terrainEnds: !field.terrain, gravityEnds: !field.gravity, magicRoomEnds: !field.magicRoom,
  } as const;
  const gone = (Object.keys(off) as (keyof typeof off)[]).filter((key) => earlier[key] && off[key]);
  if (!gone.length) return earlier;
  const next = { ...earlier };
  for (const key of gone) delete next[key];
  return Object.keys(next).length ? next : NO_TURN_EARLIER;
}

/** `doubles.history` with the slot's set to `history`: the same record when it is unchanged. */
function withHistory(doubles: DoublesMatchup, slot: DoublesSlotId, history: DoublesSlotHistory): Record<DoublesSlotId, DoublesSlotHistory> {
  return doubles.history[slot] === history ? doubles.history : { ...doubles.history, [slot]: history };
}

/** The field's answers without the slot in the entry order (another Pokémon came into it): the same object when it was not there. */
function withoutEntered(earlier: DoublesTurnEarlier, slot: DoublesSlotId): DoublesTurnEarlier {
  if (earlier.entered?.[slot] === undefined) return earlier;
  const entered = { ...earlier.entered };
  delete entered[slot];
  const next: DoublesTurnEarlier = { ...earlier, entered };
  if (!Object.keys(entered).length) delete next.entered;
  return Object.keys(next).length ? next : NO_TURN_EARLIER;
}

/**
 * The slot's answers about earlier turns that are not carried state (doubles-inputs DoublesSlotHistory: its last move and
 * that move's target, the item it used earlier, its types), as EarlierTurnFields' controls set them. The same state when
 * they are unchanged; an empty answer is NO_HISTORY.
 */
export function setDoublesHistory(state: CalculatorState, key: number, history: DoublesSlotHistory): CalculatorState {
  const { doubles } = state;
  const slot = slotByKey(doubles, key);
  if (!slot) return state;
  const next = Object.keys(history).length ? history : NO_HISTORY;
  const current = doubles.history[slot];
  if (next === current || JSON.stringify(next) === JSON.stringify(current)) return state;
  return withDoubles(state, { ...doubles, history: withHistory(doubles, slot, next) });
}

/**
 * The field's and the sides' answers about earlier turns (doubles-inputs DoublesTurnEarlier), as EarlierTurnFields' controls
 * set them, for the 2v2 `revision` they were made in; an "ends this turn" answer whose effect is off is dropped
 * (earlierForField). The same state when they are unchanged.
 */
export function setDoublesTurnEarlier(state: CalculatorState, revision: number, earlier: DoublesTurnEarlier): CalculatorState {
  const { doubles } = state;
  if (doubles.revision !== revision) return state;
  const bounded = earlierForField(earlier, doubles.field);
  const next = Object.keys(bounded).length ? bounded : NO_TURN_EARLIER;
  if (next === doubles.turnEarlier || JSON.stringify(next) === JSON.stringify(doubles.turnEarlier)) return state;
  return withDoubles(state, { ...doubles, turnEarlier: next });
}

export function setDoublesCharged(state: CalculatorState, key: number, charged: boolean): CalculatorState {
  const slot = slotByKey(state.doubles, key);
  if (!slot || state.doubles.charged[slot] === charged) return state;
  return withDoubles(state, { ...state.doubles, charged: { ...state.doubles.charged, [slot]: charged } });
}

/** `doubles.carried` with the slot's set to `carried`: the same record when it is unchanged. */
function withCarried(doubles: DoublesMatchup, slot: DoublesSlotId, carried: DoublesCarried): Record<DoublesSlotId, DoublesCarried> {
  return doubles.carried[slot] === carried ? doubles.carried : { ...doubles.carried, [slot]: carried };
}

/** Each slot's carried state for its build and whether its ability is in effect (reconcileCarried, carriedAbilityOn); the same matchup when none changes. */
function reconcileAllCarried(doubles: DoublesMatchup): DoublesMatchup {
  let carried = doubles.carried;
  for (const slot of DOUBLES_SLOTS) {
    if (!Object.keys(carried[slot]).length) continue;
    const next = reconcileCarried(carried[slot], doubles.slots[slot].build, doubles.runtime, carriedAbilityOn(doubles, slot));
    if (next !== carried[slot]) carried = { ...carried, [slot]: next };
  }
  return carried === doubles.carried ? doubles : { ...doubles, carried };
}

/** The slot's state from earlier turns (BattleConditions' 2v2 controls), bounded to what its build allows (reconcileCarried). */
export function setDoublesCarried(state: CalculatorState, key: number, carried: DoublesCarried): CalculatorState {
  const { doubles } = state;
  const slot = slotByKey(doubles, key);
  if (!slot) return state;
  const next = reconcileCarried(carried, doubles.slots[slot].build, doubles.runtime, carriedAbilityOn(doubles, slot));
  const current = doubles.carried[slot];
  if (next === current || JSON.stringify(next) === JSON.stringify(current)) return state;
  return withDoubles(state, { ...doubles, carried: withCarried(doubles, slot, next) });
}

function builds(doubles: DoublesMatchup): Record<DoublesSlotId, BattleBuild> {
  return perSlot((slot) => doubles.slots[slot].build);
}

function isIntimidateCurrent(doubles: DoublesMatchup, intimidate: NonNullable<DoublesMatchup["intimidate"]>): boolean {
  return DOUBLES_SLOTS.every((slot) => intimidate.builds[slot] === doubles.slots[slot].build);
}

/**
 * The foes the slot's Intimidate reaches, in Showdown's adjacentFoes() order (foe position 0, then 1): the living ones,
 * and none from a fainted Pokémon (sim/pokemon.ts adjacentFoes skips fainted Pokémon).
 */
export function intimidateFoes(doubles: DoublesMatchup, slot: DoublesSlotId): DoublesSlotId[] {
  if (isFaintedBuild(doubles.slots[slot].build)) return [];
  return [...foesOf(slot)].filter((foe) => !isFaintedBuild(doubles.slots[foe].build)).sort((a, b) => SHOWDOWN_POSITION[a].position - SHOWDOWN_POSITION[b].position);
}

/**
 * The slot's Pokémon uses Intimidate (on entry, or on Mega Evolution into an Intimidate form) against both foes, in
 * Showdown's adjacentFoes() order: foe position 0, then 1 (sim/pokemon.ts:732-735, sim/side.ts:397-403), so
 * opponent-right (p2a) first for your Pokémon and own-left (p1a) first for theirs. Each Pokémon is named in the lines
 * by its doublesNames name. Every build it reads keeps the result. A fainted foe is skipped, and a fainted Pokémon
 * intimidates no one (intimidateFoes). A Trace holder whose Trace copies Intimidate as it comes in (traceCopiesIntimidate)
 * uses it the same way, keeps Trace, and stores the foes that took it (copiedIntimidateStored: their intimidatedKey, in
 * that order, joined by ",").
 */
export function applyDoublesIntimidate(state: CalculatorState, key: number): CalculatorState {
  const { doubles } = state;
  const slot = slotByKey(doubles, key);
  if (!slot) return state;
  const holder = doubles.slots[slot].build;
  const traced = holder.abilityId !== "intimidate" && traceCopiesIntimidate(doubles, slot);
  if (holder.abilityId !== "intimidate" && !traced) return state;
  const foes = intimidateFoes(doubles, slot);
  if (!foes.length) return state;
  const { field } = doubles;
  const names = namesOf(doubles);
  const result = applyIntimidateToFoes(traced ? { ...holder, abilityId: "intimidate" } : holder, foes.map((foe) => ({
    build: doubles.slots[foe].build, tailwind: sideTailwind(field, foe), name: names[foe],
  })), {
    magicRoom: field.magicRoom, wonderRoom: field.wonderRoom, terrain: field.terrain, gameType: "Doubles",
    sourceTailwind: sideTailwind(field, slot), sourceName: names[slot],
  }, doubles.runtime);
  // A Trace holder keeps Trace; the drops it stored are marked with the foes that took them (copiedIntimidateStored),
  // so a calculation that applies a copied Intimidate itself leaves them out.
  const source = traced
    ? { ...result.source, abilityId: holder.abilityId, copiedIntimidateStored: foes.map((foe) => intimidatedKey(doubles.slots[foe].build, doubles.runtime)).join(",") }
    : result.source;
  const lines = traced ? [`${names[slot]}'s Intimidate (copied by Trace):`, ...result.lines.slice(1)] : result.lines;
  let next = storeBuild(state, slot, source);
  foes.forEach((foe, index) => { next = storeBuild(next, foe, result.foes[index]); });
  // Review 2 (R6-6): the source's partner, a foe of each target, copies the targets' rises (Defiant, Competitive, Rattled,
  // Guard Dog, an Adrenaline Orb, a Contrary drop) at the switch-in (−3): its Opportunist and its Mirror Herb, as Commander's.
  const partner = allyOf(slot);
  if (Object.keys(result.rises).length && !isFaintedBuild(doubles.slots[partner].build)) {
    const copied = copyRises(doubles, partner, foes[0], result.rises, lines);
    if (copied) next = storeBuild(next, partner, copied);
  }
  return withApplied(next, doubles, slot, lines);
}

/**
 * `copier`'s copies of its foes' rises at a switch-in (priority −3): its Opportunist (data/abilities.ts opportunist
 * onFoeAfterBoost, onAnySwitchIn; in effect: carriedAbilityOn) and its Mirror Herb (data/items.ts mirrorherb; not under Magic
 * Room or Klutz; used up, which starts an Unburden), each through its own boost() (selfSideBoost). Its build after them, or
 * null with neither. `foe`: a foe of the copier for its entry boosts (staging).
 */
function copyRises(doubles: DoublesMatchup, copier: DoublesSlotId, foe: DoublesSlotId, rises: Partial<Record<CombatStat, number>>, lines: string[]): BattleBuild | null {
  const { field, runtime } = doubles;
  const names = namesOf(doubles);
  const build = doubles.slots[copier].build;
  const opportunist = build.abilityId === "opportunist" && carriedAbilityOn(doubles, copier);
  const herb = build.itemId === "mirrorherb" && !field.magicRoom && build.abilityId !== "klutz";
  if (!opportunist && !herb) return null;
  const battle: IntimidateBattle = { magicRoom: field.magicRoom, wonderRoom: field.wonderRoom, terrain: field.terrain, gameType: "Doubles" };
  const m = staging(build, names[copier], doubles.slots[foe].build, sideTailwind(field, copier), sideTailwind(field, foe), battle, runtime);
  if (opportunist) {
    lines.push(`${names[copier]}'s Opportunist copies the rises.`);
    selfSideBoost(m, rises, lines);
  }
  if (herb) {
    lines.push(`${names[copier]}'s Mirror Herb copies the rises (used up).`);
    selfSideBoost(m, rises, lines);
    if (build.abilityId === "unburden") lines.push(`${names[copier]}'s Unburden activates.`);
  }
  return stagedBuild(m, herb ? "" : build.itemId);
}

const storeBuild = (current: CalculatorState, slot: DoublesSlotId, build: BattleBuild) => onSlot(current, slot, (pair) => updateMatchupBuild(pair, "attacker", build));

/** Tailwind on the slot's side (Wind Rider's entry boost). */
function sideTailwind(field: BattleConditions, slot: DoublesSlotId): boolean {
  return (slotSide(slot) === "own" ? field.attackerSide : field.defenderSide).tailwind;
}

/** The apply action's result stored for the slot's button (DoublesMatchup.intimidate), counting a press in a row. */
function withApplied(next: CalculatorState, before: DoublesMatchup, slot: DoublesSlotId, lines: string[]): CalculatorState {
  const again = before.intimidate?.slot === slot && isIntimidateCurrent(before, before.intimidate);
  return withDoubles(next, {
    ...next.doubles, notice: "",
    intimidate: { slot, lines, count: again ? before.intimidate!.count + 1 : 1, builds: builds(next.doubles) },
  });
}

/**
 * The slot's Trace copies Intimidate as it comes in (pinned Showdown data/abilities.ts trace onStart and onUpdate; the 2v2
 * settle's rule, doubles-start.ts settleDoublesStart): it has Trace, not under its own Ability Shield (outside Magic Room,
 * which stops Trace) nor another Pokémon's Neutralizing Gas (carriedAbilityOn), and the ability it copies is Intimidate:
 * the one chosen in Build settings (`tracedAbility`), else the one ability all of its living foes that Trace can copy
 * share. Foes with different abilities make the copy random: no copy is known.
 */
export function traceCopiesIntimidate(doubles: DoublesMatchup, slot: DoublesSlotId): boolean {
  const build = doubles.slots[slot].build;
  if (build.abilityId !== "trace" || isFaintedBuild(build) || build.transformedFrom) return false;
  if (build.itemId === "abilityshield" && !doubles.field.magicRoom) return false;
  if (!carriedAbilityOn(doubles, slot)) return false;
  if (build.tracedAbility) return build.tracedAbility === "intimidate";
  const copyable = intimidateFoes(doubles, slot).map((foe) => doubles.slots[foe].build.abilityId).filter((ability) => !NO_TRACE_ABILITIES.has(ability));
  return copyable.length > 0 && copyable.every((ability) => ability === "intimidate");
}

const STAGE_NAMES: Record<CombatStat, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
const COMBAT_STATS: readonly CombatStat[] = ["atk", "def", "spa", "spd", "spe"];
const clampStage = (stage: number) => Math.max(-6, Math.min(6, stage));

/**
 * The Dondozo the slot's Tatsugiri goes inside as they come in (pinned Showdown data/abilities.ts commander onUpdate; Scarlet
 * and Violet only): a Tatsugiri (any form) whose Commander is in effect (carriedAbilityOn: no other Pokémon's Neutralizing
 * Gas, or its Ability Shield outside Magic Room; the gas comes out first at the lead), not transformed, beside a Dondozo
 * that has not fainted, with a living foe for the boost (sim/battle.ts boost: foePokemonLeft). Null otherwise.
 */
export function commanderAlly(doubles: DoublesMatchup, slot: DoublesSlotId): DoublesSlotId | null {
  const { runtime } = doubles;
  const build = doubles.slots[slot].build;
  const ally = allyOf(slot);
  const allyBuild = doubles.slots[ally].build;
  const base = (entry: BattleBuild) => runtime.speciesById.get(entry.speciesId)?.baseSpecies ?? entry.speciesId;
  if (build.abilityId !== "commander" || isFaintedBuild(build) || build.transformedFrom || base(build) !== "tatsugiri") return null;
  if (isFaintedBuild(allyBuild) || allyBuild.transformedFrom || base(allyBuild) !== "dondozo") return null;
  if (!carriedAbilityOn(doubles, slot) || !intimidateFoes(doubles, ally).length) return null;
  return ally;
}

/** A Pokémon's stages as a boost() meets them: its stored stages and the entry boosts the engine adds at calculation (intimidate.ts entryBoosts). */
type Staging = { build: BattleBuild; name: string; entry: EntryBoost[]; start: Record<CombatStat, number>; boosts: Record<CombatStat, number> };

function staging(build: BattleBuild, name: string, foe: BattleBuild, tailwind: boolean, foeTailwind: boolean, battle: IntimidateBattle, runtime: BattleRuntime): Staging {
  const entry = entryBoosts(build, foe, entryBoosts(foe, build, null, foeTailwind, battle, runtime), tailwind, battle, runtime);
  const boosts = Object.fromEntries(COMBAT_STATS.map((stat) => [stat,
    clampStage((build.boosts[stat] ?? 0) + entry.filter((boost) => boost.stat === stat).reduce((sum, boost) => sum + boost.amount, 0))])) as Record<CombatStat, number>;
  return { build, name, entry, start: { ...boosts }, boosts };
}

/**
 * boost() on one Pokémon from its own side (pinned Showdown sim/battle.ts boost: ChangeBoost for Contrary and Simple, the
 * stage cap; TryBoost stops only drops another Pokémon causes, and AfterEachBoost's Defiant and Competitive only those).
 * Pushes "Dondozo's Attack, Defense, Sp. Atk, Sp. Def and Speed rise to +2." and returns the changes after the cap (the
 * table AfterBoost passes to a foe's Opportunist and Mirror Herb).
 */
function selfSideBoost(m: Staging, input: Partial<Record<CombatStat, number>>, lines: string[]): Partial<Record<CombatStat, number>> {
  const ability = m.build.abilityId;
  const change: Partial<Record<CombatStat, number>> = {};
  for (const stat of COMBAT_STATS) {
    if (input[stat] === undefined) continue;
    const amount = ability === "contrary" ? -input[stat]! : ability === "simple" ? input[stat]! * 2 : input[stat]!;
    change[stat] = clampStage(m.boosts[stat] + amount) - m.boosts[stat];
  }
  // One line per run of stats that end the same way, in stat order.
  const groups: { stats: CombatStat[]; words: string }[] = [];
  for (const stat of COMBAT_STATS) {
    if (change[stat] === undefined) continue;
    const before = m.boosts[stat];
    m.boosts[stat] = clampStage(before + change[stat]!);
    const raised = (input[stat] ?? 0) * (ability === "contrary" ? -1 : 1) > 0;
    const words = change[stat] === 0 ? (raised ? "won't go higher" : "won't go lower")
      : `${change[stat]! > 0 ? "rise" : "fall"} to ${m.boosts[stat] > 0 ? "+" : ""}${m.boosts[stat]}`;
    const last = groups.at(-1);
    if (last && last.words === words) last.stats.push(stat);
    else groups.push({ stats: [stat], words });
  }
  for (const { stats, words } of groups) {
    const list = stats.map((stat) => STAGE_NAMES[stat]);
    const named = list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
    // "rise to" / "won't go higher" for several stats; "rises to" / "won't go higher" for one.
    const verb = stats.length > 1 ? words : words.replace(/^(rise|fall) /, "$1s ");
    lines.push(`${m.name}'s ${named} ${verb}.`);
  }
  return change;
}

/** The stored stages after boost() (as intimidate.ts finish does): an unchanged stage keeps its stored value; a changed one leaves out the entry boosts. */
function stagedBuild(m: Staging, item = m.build.itemId): BattleBuild {
  const bonus = (stat: CombatStat) => m.entry.filter((entry) => entry.stat === stat).reduce((sum, entry) => sum + entry.amount, 0);
  const consumed = item !== m.build.itemId;
  return {
    ...m.build, itemId: item,
    boosts: Object.fromEntries(COMBAT_STATS.map((stat) => [stat, m.boosts[stat] === m.start[stat] ? m.build.boosts[stat] ?? 0 : clampStage(m.boosts[stat] - bonus(stat))])) as BattleBuild["boosts"],
    ...(consumed && m.build.abilityId === "unburden" ? { abilityActive: true } : {}),
  };
}

/**
 * Commander as Tatsugiri and Dondozo come in (pinned Showdown data/abilities.ts commander; data/conditions.ts commanded
 * onStart: boost({ atk: 2, spa: 2, spe: 2, def: 2, spd: 2 }) on Dondozo from Tatsugiri), through boost()'s rules
 * (selfSideBoost), into Dondozo's stored stages. Each of Dondozo's living foes then copies the rises at the lead's
 * switch-in (priority −3): its Opportunist (onFoeAfterBoost; in effect: carriedAbilityOn) and its Mirror Herb (not under
 * Magic Room or Klutz; used up, which starts an Unburden), each through its own boost(). The copies are not copied again.
 * Every build it changes keeps the result; the lines show under the slot's button (doublesIntimidateResult).
 */
export function applyDoublesCommander(state: CalculatorState, key: number): CalculatorState {
  const { doubles } = state;
  const slot = slotByKey(doubles, key);
  const dondozo = slot ? commanderAlly(doubles, slot) : null;
  if (!slot || !dondozo) return state;
  const { field, runtime } = doubles;
  const names = namesOf(doubles);
  const battle: IntimidateBattle = { magicRoom: field.magicRoom, wonderRoom: field.wonderRoom, terrain: field.terrain, gameType: "Doubles" };
  const foes = intimidateFoes(doubles, dondozo);
  const across = (entry: DoublesSlotId, others: DoublesSlotId[]) => doubles.slots[others[0] ?? entry].build;
  const target = staging(doubles.slots[dondozo].build, names[dondozo], across(dondozo, foes), sideTailwind(field, dondozo), sideTailwind(field, foes[0] ?? dondozo), battle, runtime);
  const lines = [`${names[slot]}'s Commander:`];
  const rises = selfSideBoost(target, { atk: 2, def: 2, spa: 2, spd: 2, spe: 2 }, lines);
  const copied = Object.fromEntries(COMBAT_STATS.filter((stat) => (rises[stat] ?? 0) > 0).map((stat) => [stat, rises[stat]!])) as Partial<Record<CombatStat, number>>;
  const changed: [DoublesSlotId, BattleBuild][] = [[dondozo, stagedBuild(target)]];
  if (Object.keys(copied).length) {
    for (const foe of foes) {
      const build = doubles.slots[foe].build;
      const opportunist = build.abilityId === "opportunist" && carriedAbilityOn(doubles, foe);
      const herb = build.itemId === "mirrorherb" && !field.magicRoom && build.abilityId !== "klutz";
      if (!opportunist && !herb) continue;
      const copier = staging(build, names[foe], doubles.slots[dondozo].build, sideTailwind(field, foe), sideTailwind(field, dondozo), battle, runtime);
      if (opportunist) {
        lines.push(`${names[foe]}'s Opportunist copies the rises.`);
        selfSideBoost(copier, copied, lines);
      }
      if (herb) {
        lines.push(`${names[foe]}'s Mirror Herb copies the rises (used up).`);
        selfSideBoost(copier, copied, lines);
        if (build.abilityId === "unburden") lines.push(`${names[foe]}'s Unburden activates.`);
      }
      changed.push([foe, stagedBuild(copier, herb ? "" : build.itemId)]);
    }
  }
  let next = state;
  for (const [entry, build] of changed) next = storeBuild(next, entry, build);
  return withApplied(next, doubles, slot, lines);
}

/** The text under the slot's apply button (Intimidate, Trace's Intimidate, Commander), while nothing has changed any of the four builds since. */
export function doublesIntimidateResult(doubles: DoublesMatchup, slot: DoublesSlotId): string | null {
  const last = doubles.intimidate;
  if (!last || last.slot !== slot || !isIntimidateCurrent(doubles, last)) return null;
  return `${last.count > 1 ? `Applied ${last.count} times in a row. ` : ""}${last.lines.join(" ")}`;
}

const UNCHECKED: Pick<RosterSourceCheck, "checkedTeams" | "validSources"> = { checkedTeams: false, validSources: new Map() };

/**
 * Detaches every slot whose roster source the 1v1 matchup's team sources and selection no longer offer (roster-prep
 * reconcileRosterSlot; with a roster snapshot, also the entries it no longer lists) and renames renamed ones. A detached
 * slot keeps its build as a manual one, and its contexts and action clear; the other slots keep theirs. status2 R-U: the bench
 * Pokémon whose roster entry is no longer offered leave the bench (their Replacement picks and a landing from them with them).
 */
export function reconcileDoublesRosters(doubles: DoublesMatchup, matchup: PreparedMatchup, rosters?: CalculatorRosterState): DoublesMatchup {
  const snapshot = rosters ? rosterSourceCheck(matchup, rosters) : null;
  const selection = snapshot?.selection ?? matchup.selection;
  let next = doubles;
  for (const slot of DOUBLES_SLOTS) {
    const combatant = next.slots[slot];
    const reconciled = reconcileRosterSlot(combatant, matchup.teams[combatant.role], selection, snapshot ?? UNCHECKED);
    if (reconciled === combatant) continue;
    if (reconciled.source) {
      next = { ...next, slots: { ...next.slots, [slot]: reconciled } };
      continue;
    }
    const detached = { ...reconciled, contexts: {}, moveEpoch: combatant.moveEpoch + 1 };
    next = {
      ...next,
      slots: { ...next.slots, [slot]: detached },
      actions: { ...next.actions, [slot]: NO_ACTION },
      replacement: next.replacement?.owner.key === combatant.key ? null : next.replacement,
    };
  }
  // status2 R-U (IN §5.4): the bench Pokémon whose roster entry is no longer offered leave the bench; a renamed one keeps its place.
  return mapBenchEntries(next, (entry, side) => {
    const probe: Combatant = { ...next.slots[side === "own" ? "own-left" : "opponent-left"], role: side, source: entry.source };
    const reconciled = reconcileRosterSlot(probe, matchup.teams[side], selection, snapshot ?? UNCHECKED);
    return !reconciled.source ? null : reconciled.source === entry.source ? entry : { ...entry, source: reconciled.source };
  });
}

/**
 * "Charizard detached from its roster entry; its move and move contexts cleared." for the slots reconcileDoublesRosters
 * detached, named by `names` (their builds stay).
 */
function detachedNotice(slots: DoublesSlotId[], names: Record<DoublesSlotId, string>): string {
  const named = slots.map((slot) => names[slot]);
  const joined = named.length <= 2 ? named.join(" and ") : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return slots.length === 1
    ? `${joined} detached from its roster entry; its move and move contexts cleared.`
    : `${joined} detached from their roster entries; their moves and move contexts cleared.`;
}

/**
 * Keeps 2v2 consistent with a 1v1 update (CalculatorClient runs it after every one): a new game or account gives a fresh
 * 2v2; a team source, paste or selection change detaches the slots whose source is no longer valid; a roster snapshot
 * (`rosters`) also checks the entries it lists. 1v1 Reset and Swap change nothing here (the shared cache is the matchup's).
 * A team source change or a paste imported or removed (roster-prep changeTeamSource, applyTeamPaste, removeTeamPaste)
 * gives 2v2 the same notice as 1v1; a detached slot adds a sentence naming it. status2 R-U: a session edit of a bench
 * Pokémon's roster entry (the shared cache) becomes its bench build, its row's HP and status kept.
 */
export function followShared(doubles: DoublesMatchup, before: PreparedMatchup, after: PreparedMatchup, rosters?: CalculatorRosterState): DoublesMatchup {
  if (after.runtime.identity !== doubles.runtime.identity) {
    return { ...freshDoubles(doubles, after.runtime), notice: `${after.runtime.profile.label} selected. Preparation and active mechanics reset; team documents and drafts kept.` };
  }
  if (before.accountReady && after.accountId !== before.accountId) return freshDoubles(doubles, after.runtime);
  // status2 R-U (IN §5.7): a bench Pokémon's build is its roster entry's as prepared, so it follows that entry's session edits.
  const followed = after.cache === before.cache ? doubles : mapBenchEntries(doubles, (entry) => {
    const cached = after.cache.get(entry.key);
    if (!cached || cached === before.cache.get(entry.key) || cached.build.game !== doubles.runtime.profile.id) return entry;
    return { ...entry, base: cached.build, moves: cached.moves.flatMap((move) => move.moveId ? [move.moveId] : []) };
  });
  if (!rosters && after.teams === before.teams && after.selection === before.selection) return followed;
  const next = reconcileDoublesRosters(followed, after, rosters);
  // 1v1 Reset bumps both epochs and keeps each side's mode and paste, so its notice stays 1v1's.
  const sourceChanged = (["own", "opponent"] as const).some((role) => after.teams[role].mode !== before.teams[role].mode || after.teams[role].paste !== before.teams[role].paste);
  const detached = DOUBLES_SLOTS.filter((slot) => doubles.slots[slot].source && !next.slots[slot].source);
  const notice = [sourceChanged ? after.notice : "", detached.length ? detachedNotice(detached, namesOf(next)) : ""].filter(Boolean).join(" ");
  return notice ? { ...next, notice } : next;
}
