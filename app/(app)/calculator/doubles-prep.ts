import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { defaultDoublesTarget, doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import {
  allyOf, DOUBLES_SLOTS, foesOf, relativePosition, SHOWDOWN_POSITION, SLOT_POSITION, slotSide,
  type DoublesAction, type DoublesPokemonInput, type DoublesSlotId, type DoublesTargetRule, type DoublesTurnInput,
} from "@/app/lib/battle/doubles-types";
import { applyIntimidateToFoes } from "@/app/lib/battle/intimidate";
import { createBuild, createConditions, validateBuild, withUsualAbility } from "@/app/lib/battle/model";
import { createMoveSlots, usualAbility, withHiddenPowerIVs } from "@/app/lib/battle/move-defaults";
import type { BattleBuild, BattleConditions, BattleMechanic, BuildIssue, MoveContext } from "@/app/lib/battle/types";
import type { CalculatorRosterState } from "./roster-data";
import {
  activateMoveSlot, dismissMoveReplacement, equipRequiredMove, getMoveOwner, orientField, reconcileRosterSlot, replaceMatchupMove,
  rosterSourceCheck, sameMoveOwner, selectMatchupMove, selectRosterPokemon, toggleMatchupMechanic, toggleMatchupMega, updateMatchupBuild,
  updateMatchupHP, updateMatchupMoveContext, withPreparedMoves,
  type Combatant, type MoveOwner, type MoveReplacement, type PreparedMatchup, type RosterChoice, type RosterSourceCheck,
} from "./roster-prep";

export type DoublesMatchup = {
  runtime: BattleRuntime;
  /** Bumps on 2v2 Reset, game change and account change. Combatant keys are revision * 4 + DOUBLES_SLOTS index. */
  revision: number;
  notice: string;
  slots: Record<DoublesSlotId, Combatant>;
  actions: Record<DoublesSlotId, DoublesAction>;
  /** It used Charge on an earlier turn; cleared when the slot gets another Pokémon. */
  charged: Record<DoublesSlotId, boolean>;
  /** attackerSide: your side; defenderSide: the opponent's. gameType "Doubles". */
  field: BattleConditions;
  /** The Moves pane: whose moves it lists and which Pokémon its rows are into (never the same slot). */
  moves: { slot: DoublesSlotId; into: DoublesSlotId };
  replacement: MoveReplacement | null;
  replacementSession: number;
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

/** The slot's Pokémon as a notice names it: "your left Pokémon". */
function positionLabel(slot: DoublesSlotId): string {
  return `${SLOT_POSITION[slot]} Pokémon`;
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
    actions: perSlot(() => NO_ACTION), charged: perSlot(() => false), field,
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

/**
 * In 2v2, current HP 0 is a Pokémon that fainted before the turn with no replacement left (pinned Showdown keeps it in
 * side.active with fainted set, and getAllActive, adjacency and targeting skip it). 1v1 still asks for 1 or more.
 */
export function isFaintedBuild(build: BattleBuild): boolean {
  return build.currentHP === 0;
}

/** The slots whose Pokémon has fainted before the turn. */
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
 */
export function doublesTurnInput(runtime: BattleRuntime, field: BattleConditions, pokemon: Record<DoublesSlotId, DoublesPokemonInput>): DoublesTurnInput {
  if (!DOUBLES_SLOTS.some((slot) => isFaintedBuild(pokemon[slot].build))) return { runtime, field, pokemon };
  const full: DoublesTurnInput = { runtime, field, pokemon };
  const living: DoublesTurnInput = { runtime, field, pokemon: perSlot((slot) => isFaintedBuild(pokemon[slot].build) ? null : pokemon[slot]) };
  return {
    runtime, field,
    pokemon: perSlot((slot) => {
      const entry = living.pokemon[slot];
      const { moveId, target } = entry?.action ?? NO_ACTION;
      if (!entry || moveId === null) return entry;
      const next = pickTarget(doublesTargetRule(living, slot, moveId), doublesTargetRule(full, slot, moveId), slot, target, null);
      return next === target ? entry : { ...entry, action: { moveId, target: next } };
    }),
  };
}

function slotInputs(doubles: DoublesMatchup): Record<DoublesSlotId, DoublesPokemonInput> {
  return perSlot((slot) => {
    const { build, contexts } = doubles.slots[slot];
    return { build, contexts, charged: doubles.charged[slot], action: doubles.actions[slot] };
  });
}

export function getDoublesTurnInput(doubles: DoublesMatchup): DoublesTurnInput {
  return doublesTurnInput(doubles.runtime, doubles.field, slotInputs(doubles));
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

/** The target a move change defaults to: the Moves pane's `into` while the pane shows this slot, else the left foe. */
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

/** `into` while it is another slot whose Pokémon has not fainted, else the first such slot of left foe, right foe, ally; else `into`. */
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
 * Runs a 1v1 one-Pokémon transition on a 2v2 slot: the slot stands as "attacker", its left foe as "defender", the field
 * oriented to the slot's side. Reads back only the slot, the shared cache, the replacement/session and the action's move;
 * notices name the slot through the transitions' positionLabel. Discards every other change (clearMoveInteractions, the
 * other Pokémon, field). A replacement another slot owns is kept.
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
    replacement: owned(doubles.replacement) || owned(next.replacement) ? next.replacement : doubles.replacement,
    replacementSession: next.replacementSession,
  };
  return {
    matchup: next.cache === matchup.cache ? matchup : { ...matchup, cache: next.cache },
    doubles: livingPane(retarget(updated, slot)),
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

/** Why `choice` cannot go into `slot`: the ally slot already shows that roster entry. */
export function doublesRosterDisabled(doubles: DoublesMatchup, slot: DoublesSlotId, choice: RosterChoice): string | null {
  const ally = allyOf(slot);
  return choice.source && doubles.slots[ally].source?.key === choice.source.key ? `Active as ${SLOT_POSITION[ally]} Pokémon.` : null;
}

export function selectDoublesRoster(state: CalculatorState, key: number, choice: RosterChoice): CalculatorState {
  const slot = slotByKey(state.doubles, key);
  if (!slot || doublesRosterDisabled(state.doubles, slot, choice)) return state;
  return onSlot(state, slot, (pair) => selectRosterPokemon(pair, "attacker", choice, positionLabel(slot)));
}

export function updateDoublesBuild(state: CalculatorState, key: number, build: BattleBuild): CalculatorState {
  const slot = slotByKey(state.doubles, key);
  return slot ? onSlot(state, slot, (pair) => updateMatchupBuild(pair, "attacker", build, positionLabel(slot))) : state;
}

export function updateDoublesHP(state: CalculatorState, key: number, text: string): CalculatorState {
  const slot = slotByKey(state.doubles, key);
  return slot ? onSlot(state, slot, (pair) => updateMatchupHP(pair, "attacker", text, positionLabel(slot))) : state;
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
 * Points the Moves pane at `slot`: into its target, else the current receiver when it is another slot, else its left foe;
 * a living one (livingInto). Not at a fainted slot.
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
  return slot ? onSlot(state, slot, (pair) => selectMatchupMove(pair, moveId, owner)) : state;
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
  let doubles: DoublesMatchup = { ...state.doubles, field: { ...field, gameType: "Doubles" } };
  for (const slot of DOUBLES_SLOTS) doubles = retarget(doubles, slot);
  return withDoubles(state, doubles);
}

export function setDoublesCharged(state: CalculatorState, key: number, charged: boolean): CalculatorState {
  const slot = slotByKey(state.doubles, key);
  if (!slot || state.doubles.charged[slot] === charged) return state;
  return withDoubles(state, { ...state.doubles, charged: { ...state.doubles.charged, [slot]: charged } });
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
 * Showdown's adjacentFoes() order: foe position 0, then 1 (sim/pokemon.ts:732-735, sim/side.ts:397-403), so the
 * opponent's right (p2a) first for your Pokémon and your left (p1a) first for theirs. Every build it reads keeps the
 * result. A fainted foe is skipped, and a fainted Pokémon intimidates no one (intimidateFoes).
 */
export function applyDoublesIntimidate(state: CalculatorState, key: number): CalculatorState {
  const { doubles } = state;
  const slot = slotByKey(doubles, key);
  if (!slot || doubles.slots[slot].build.abilityId !== "intimidate") return state;
  const foes = intimidateFoes(doubles, slot);
  if (!foes.length) return state;
  const { field } = doubles;
  const tailwind = (entry: DoublesSlotId) => (slotSide(entry) === "own" ? field.attackerSide : field.defenderSide).tailwind;
  const result = applyIntimidateToFoes(doubles.slots[slot].build, foes.map((foe) => ({
    build: doubles.slots[foe].build, tailwind: tailwind(foe), position: relativePosition(slot, foe).replace("-", " "),
  })), {
    magicRoom: field.magicRoom, wonderRoom: field.wonderRoom, terrain: field.terrain, gameType: "Doubles",
    sourceTailwind: tailwind(slot), sourcePosition: SLOT_POSITION[slot],
  }, doubles.runtime);
  const store = (current: CalculatorState, entry: DoublesSlotId, build: BattleBuild) => onSlot(current, entry, (pair) => updateMatchupBuild(pair, "attacker", build));
  let next = store(state, slot, result.source);
  foes.forEach((foe, index) => { next = store(next, foe, result.foes[index]); });
  const again = doubles.intimidate?.slot === slot && isIntimidateCurrent(doubles, doubles.intimidate);
  return withDoubles(next, {
    ...next.doubles, notice: "",
    intimidate: { slot, lines: result.lines, count: again ? doubles.intimidate!.count + 1 : 1, builds: builds(next.doubles) },
  });
}

/** The text under the slot's Intimidate button, while nothing has changed any of the four builds since. */
export function doublesIntimidateResult(doubles: DoublesMatchup, slot: DoublesSlotId): string | null {
  const last = doubles.intimidate;
  if (!last || last.slot !== slot || !isIntimidateCurrent(doubles, last)) return null;
  return `${last.count > 1 ? `Applied ${last.count} times in a row. ` : ""}${last.lines.join(" ")}`;
}

const UNCHECKED: Pick<RosterSourceCheck, "checkedTeams" | "validSources"> = { checkedTeams: false, validSources: new Map() };

/**
 * Detaches every slot whose roster source the 1v1 matchup's team sources and selection no longer offer (roster-prep
 * reconcileRosterSlot; with a roster snapshot, also the entries it no longer lists) and renames renamed ones. A detached
 * slot keeps its build as a manual one, and its contexts and action clear; the other slots keep theirs.
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
  return next;
}

/** "Your left Pokémon detached from its roster entry; its move and move contexts cleared." for the slots reconcileDoublesRosters detached. */
function detachedNotice(slots: DoublesSlotId[]): string {
  const where = slots.map((slot) => SLOT_POSITION[slot]);
  const joined = where.length <= 2 ? where.join(" and ") : `${where.slice(0, -1).join(", ")} and ${where.at(-1)}`;
  const text = slots.length === 1
    ? `${joined} Pokémon detached from its roster entry; its move and move contexts cleared.`
    : `${joined} Pokémon detached from their roster entries; their moves and move contexts cleared.`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Keeps 2v2 consistent with a 1v1 update (CalculatorClient runs it after every one): a new game or account gives a fresh
 * 2v2; a team source, paste or selection change detaches the slots whose source is no longer valid; a roster snapshot
 * (`rosters`) also checks the entries it lists. 1v1 Reset and Swap change nothing here (the shared cache is the matchup's).
 * A team source change or a paste imported or removed (roster-prep changeTeamSource, applyTeamPaste, removeTeamPaste)
 * gives 2v2 the same notice as 1v1; a detached slot adds a sentence naming it.
 */
export function followShared(doubles: DoublesMatchup, before: PreparedMatchup, after: PreparedMatchup, rosters?: CalculatorRosterState): DoublesMatchup {
  if (after.runtime.identity !== doubles.runtime.identity) {
    return { ...freshDoubles(doubles, after.runtime), notice: `${after.runtime.profile.label} selected. Preparation and active mechanics reset; team documents and drafts kept.` };
  }
  if (before.accountReady && after.accountId !== before.accountId) return freshDoubles(doubles, after.runtime);
  if (!rosters && after.teams === before.teams && after.selection === before.selection) return doubles;
  const next = reconcileDoublesRosters(doubles, after, rosters);
  // 1v1 Reset bumps both epochs and keeps each side's mode and paste, so its notice stays 1v1's.
  const sourceChanged = (["own", "opponent"] as const).some((role) => after.teams[role].mode !== before.teams[role].mode || after.teams[role].paste !== before.teams[role].paste);
  const detached = DOUBLES_SLOTS.filter((slot) => doubles.slots[slot].source && !next.slots[slot].source);
  const notice = [sourceChanged ? after.notice : "", detached.length ? detachedNotice(detached) : ""].filter(Boolean).join(" ");
  return notice ? { ...next, notice } : next;
}
