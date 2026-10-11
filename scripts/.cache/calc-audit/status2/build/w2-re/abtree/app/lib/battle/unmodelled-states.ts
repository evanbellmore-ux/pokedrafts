import type { BattleRuntime } from "./runtime";

/**
 * Common battle states the calculator cannot represent: results assume they are absent. The app
 * has no input for them (the native-game engine reads some, such as Battery, but they are not
 * exposed). Each entry is kept only when the selected game has a Pokémon with one of its abilities
 * or moves, and it names only those present in that game.
 */
type StateEntry = {
  /** The entry text around the joined names of the abilities or moves present in the game. */
  text: (names: string) => string;
  abilities?: string[];
  moves?: string[];
  games?: string[];
};

const STATES: StateEntry[] = [
  { text: (names) => `${names} protecting the whole side`, moves: ["wideguard", "quickguard", "matblock", "craftyshield"] },
  { text: () => "Max Guard from a Dynamaxed Pokémon", games: ["sword_shield"] },
  { text: (names) => `A partner's ${names}`, abilities: ["battery", "powerspot", "steelyspirit", "flowergift"] },
  { text: (names) => `${names} from a Pokémon other than the two shown`, abilities: ["swordofruin", "beadsofruin", "tabletsofruin", "vesselofruin", "darkaura", "aurabreak", "neutralizinggas"] },
  { text: (names) => `An ability suppressed, replaced or swapped by ${names}`, moves: ["gastroacid", "worryseed", "simplebeam", "entrainment", "skillswap", "roleplay", "doodle", "coreenforcer"] },
  { text: (names) => `${names} on the target`, moves: ["foresight", "odorsleuth", "miracleeye"] },
  { text: () => "A target that has used Glaive Rush and not moved since", moves: ["glaiverush"] },
  { text: (names) => `A target in the middle of ${names}`, moves: ["dig", "dive", "fly", "bounce", "skydrop"] },
  { text: () => "A target that used Minimize", moves: ["minimize"] },
  { text: () => "A Substitute", moves: ["substitute"] },
  { text: (names) => `Grounding or lifting from ${names}`, moves: ["smackdown", "thousandarrows", "ingrain", "roost", "magnetrise", "telekinesis"] },
  { text: (names) => `Stats swapped or shared by ${names}`, moves: ["powertrick", "powersplit", "guardsplit", "powerswap", "guardswap", "speedswap", "heartswap"] },
  { text: () => "The order the other Pokémon move in Doubles, beyond the two shown" },
];

function joinOr(names: string[]) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

const cache = new WeakMap<BattleRuntime, string[]>();

/** The entries of `states` the game has (a Pokémon with one of its abilities or moves), each naming only those present. */
function statesFor(runtime: BattleRuntime, states: readonly StateEntry[]): string[] {
  const abilities = new Set(runtime.catalog.species.flatMap((species) => species.abilities));
  const moves = new Set(runtime.catalog.species.flatMap((species) => species.moves ?? []));
  return states.flatMap((state) => {
    if (state.games && !state.games.includes(runtime.profile.id)) return [];
    const names = [
      ...(state.abilities ?? []).filter((id) => abilities.has(id)).map((id) => runtime.abilitiesById.get(id)?.name ?? id),
      ...(state.moves ?? []).filter((id) => moves.has(id)).map((id) => runtime.movesById.get(id)?.name ?? id),
    ];
    if ((state.abilities || state.moves) && !names.length) return [];
    return [state.text(joinOr(names))];
  });
}

export function unmodelledBattleStates(runtime: BattleRuntime): string[] {
  const cached = cache.get(runtime);
  if (cached) return cached;
  const states = statesFor(runtime, STATES);
  cache.set(runtime, states);
  return states;
}

/** Names of the moves of `ids` some Pokémon of the game learns, joined with "or" ("" when none). */
function learnt(runtime: BattleRuntime, ids: readonly string[]): string {
  const moves = new Set(runtime.catalog.species.flatMap((species) => species.moves ?? []));
  return joinOr(ids.filter((id) => moves.has(id)).map((id) => runtime.movesById.get(id)?.name ?? id));
}

/** Gastro Acid and Core Enforcer suppress an ability from an earlier turn; these replace it (no 2v2 input sets either). */
const SUPPRESSING = ["gastroacid", "coreenforcer"];
const REPLACING = ["worryseed", "simplebeam", "entrainment", "skillswap", "roleplay", "doodle"];

/**
 * The 2v2 note's states (status2 IN §5.6, ADDENDUM2 §5.2 with C21 and C28), with the 1v1 note's entry rules: the earlier-turn
 * states the 2v2 calculator has no input for. The 1v1 entries 2v2 sets or works out are gone (Wide Guard and its kin, Max
 * Guard, a partner's Battery and kin, the Ruin abilities and Neutralizing Gas, Foresight and Miracle Eye, Glaive Rush, a
 * semi-invulnerable target, Minimize, a Substitute, grounding, the stat swaps, the Doubles order), and so are the G-Max side
 * conditions and Uproar (each an input now).
 */
const DOUBLES_STATES: StateEntry[] = [
  { text: () => "A Sky Drop from an earlier turn", moves: ["skydrop"] },
  { text: (names) => `A ${names} waiting for the next Pokémon to come in`, moves: ["healingwish", "lunardance"] },
  { text: (names) => `${names} from an earlier turn`, moves: ["torment", "throatchop"] },
  { text: (names) => `A move locked in by ${names}`, moves: ["outrage", "petaldance", "thrash", "ragingfury"] },
];

const doublesCache = new WeakMap<BattleRuntime, string[]>();

/** The 2v2 Field conditions' note "Battle states that cannot be set here" (BattleConditions with variant "doubles"). */
export function unmodelledDoublesStates(runtime: BattleRuntime): string[] {
  const cached = doublesCache.get(runtime);
  if (cached) return cached;
  const suppressed = learnt(runtime, SUPPRESSING), replaced = learnt(runtime, REPLACING);
  const ability = suppressed && replaced ? `An ability suppressed by ${suppressed}, or replaced by ${replaced}, on an earlier turn`
    : suppressed ? `An ability suppressed by ${suppressed} on an earlier turn` : replaced ? `An ability replaced by ${replaced} on an earlier turn` : null;
  const states = [...(ability ? [ability] : []), ...statesFor(runtime, DOUBLES_STATES)];
  doublesCache.set(runtime, states);
  return states;
}
