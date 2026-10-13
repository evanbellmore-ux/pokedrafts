import { GAME_LABELS } from "@/app/lib/pokemon/rules";
import type { BattleConditions, BattleGame } from "./types";

export type BattleProfile = {
  id: BattleGame;
  version: 1;
  label: string;
  generation: 0 | 7 | 8 | 9;
  mod: "champions" | "gen7" | "gen8" | "gen9";
  training: "points" | "native";
  mega: boolean;
  zMoves: boolean;
  dynamax: boolean;
  tera: boolean;
  weather: readonly BattleConditions["weather"][];
};

export const BATTLE_GAMES: readonly BattleGame[] = [
  "champions", "ultra_sun_ultra_moon", "sword_shield", "scarlet_violet",
];
const commonWeather = ["", "Sun", "Rain", "Sand"] as const;
export const BATTLE_PROFILES: Readonly<Record<BattleGame, BattleProfile>> = {
  champions: {
    id: "champions", version: 1, label: GAME_LABELS.champions, generation: 0, mod: "champions",
    training: "points", mega: true, zMoves: false, dynamax: false, tera: false,
    weather: [...commonWeather, "Snow"],
  },
  ultra_sun_ultra_moon: {
    id: "ultra_sun_ultra_moon", version: 1, label: GAME_LABELS.ultra_sun_ultra_moon, generation: 7, mod: "gen7",
    training: "native", mega: true, zMoves: true, dynamax: false, tera: false,
    weather: [...commonWeather, "Hail", "Harsh Sunshine", "Heavy Rain", "Strong Winds"],
  },
  sword_shield: {
    id: "sword_shield", version: 1, label: GAME_LABELS.sword_shield, generation: 8, mod: "gen8",
    training: "native", mega: false, zMoves: false, dynamax: true, tera: false,
    weather: [...commonWeather, "Hail"],
  },
  scarlet_violet: {
    id: "scarlet_violet", version: 1, label: GAME_LABELS.scarlet_violet, generation: 9, mod: "gen9",
    training: "native", mega: false, zMoves: false, dynamax: false, tera: true,
    weather: [...commonWeather, "Snow"],
  },
};

export const TERA_TYPES = [
  "Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground",
  "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy", "Stellar",
] as const;

export function isBattleGame(value: string): value is BattleGame {
  return BATTLE_GAMES.some((game) => game === value);
}
