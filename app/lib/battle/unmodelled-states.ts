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

export function unmodelledBattleStates(runtime: BattleRuntime): string[] {
  const cached = cache.get(runtime);
  if (cached) return cached;
  const abilities = new Set(runtime.catalog.species.flatMap((species) => species.abilities));
  const moves = new Set(runtime.catalog.species.flatMap((species) => species.moves ?? []));
  const states = STATES.flatMap((state) => {
    if (state.games && !state.games.includes(runtime.profile.id)) return [];
    const names = [
      ...(state.abilities ?? []).filter((id) => abilities.has(id)).map((id) => runtime.abilitiesById.get(id)?.name ?? id),
      ...(state.moves ?? []).filter((id) => moves.has(id)).map((id) => runtime.movesById.get(id)?.name ?? id),
    ];
    if ((state.abilities || state.moves) && !names.length) return [];
    return [state.text(joinOr(names))];
  });
  cache.set(runtime, states);
  return states;
}
