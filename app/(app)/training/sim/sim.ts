// The Training worker's one import of the vendored simulator (@pokedrafts/showdown-sim, pinned Showdown c23d2e94).
// The page never imports this file (SPEC §3 boundary rules).
export {
  Battle, Dex, PRNG, State, TeamValidator, Teams, extractChannelMessages, toID,
} from "@pokedrafts/showdown-sim";
export type {
  BattleAction, ChoiceRequest, ClonedBattle, EffectState, ModdedDex, Pokemon, PokemonSet, PRNGSeed, Side, SideID,
  Species, WritablePokemon, WritableSide,
} from "@pokedrafts/showdown-sim";
import { TRAINING_FORMAT_ID } from "../model/view-types";

export const FORMAT = TRAINING_FORMAT_ID;
