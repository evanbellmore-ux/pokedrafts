// SPEC 10.6 Field: whether the weather or terrain powers or weakens a Pokémon's best move (and A1.5's ability field effect).
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";
import type { AiView, MonView } from "../model/ai-view";

export type FieldSetting = { weather?: BattleConditions["weather"]; terrain?: BattleConditions["terrain"] };

/** Weather and terrain set on entry (PS/data/abilities.ts drought, drizzle, sandstream, snowwarning and the surges onStart). */
const ABILITY_FIELDS: Readonly<Record<string, FieldSetting>> = {
  drought: { weather: "Sun" }, drizzle: { weather: "Rain" }, sandstream: { weather: "Sand" }, snowwarning: { weather: "Snow" },
  electricsurge: { terrain: "Electric" }, grassysurge: { terrain: "Grassy" }, psychicsurge: { terrain: "Psychic" }, mistysurge: { terrain: "Misty" },
};
export function fieldOfAbility(abilityId: string): FieldSetting | null {
  return ABILITY_FIELDS[abilityId] ?? null;
}

/** The damaging move a Pokémon would lean on: the highest power × STAB × accuracy of its moves (its catalog types now). */
export function bestMoveOf(moves: readonly string[], build: BattleBuild, runtime: BattleRuntime): { id: string; type: string; category: "Physical" | "Special" } | null {
  const types = runtime.speciesById.get(build.speciesId)?.types ?? [];
  let best: { id: string; type: string; category: "Physical" | "Special" } | null = null, score = 0;
  for (const id of moves) {
    const move = runtime.movesById.get(id);
    if (!move || move.category === "Status" || move.power <= 0) continue;
    const value = move.power * (types.includes(move.type) ? 1.5 : 1) * (move.accuracy ?? 100) / 100;
    if (value > score) { best = { id, type: move.type, category: move.category }; score = value; }
  }
  return best;
}

/** Grounded for terrain (PS/sim/pokemon.ts isGrounded): not Flying, no Levitate, no Air Balloon. */
export function isGroundedBuild(build: BattleBuild, runtime: BattleRuntime): boolean {
  const types = runtime.speciesById.get(build.speciesId)?.types ?? [];
  return !types.includes("Flying") && build.abilityId !== "levitate" && build.itemId !== "airballoon";
}

/**
 * +1 when the weather or terrain boosts the best move's type (Sun/Fire, Rain/Water: PS/data/conditions.ts sunnyday/raindance
 * onWeatherModifyDamage; grounded Electric/Grassy/Psychic Terrain: onBasePower ×1.3), −1 when it weakens it (Sun/Water,
 * Rain/Fire; Misty Terrain halves Dragon moves into grounded targets), else 0. Strong weathers count as their weather.
 */
export function favorOf(moves: readonly string[], build: BattleBuild, setting: FieldSetting, runtime: BattleRuntime): number {
  const best = bestMoveOf(moves, build, runtime);
  if (!best) return 0;
  const weather = setting.weather === "Harsh Sunshine" ? "Sun" : setting.weather === "Heavy Rain" ? "Rain" : setting.weather ?? "";
  let favor = 0;
  if (weather === "Sun") favor += best.type === "Fire" ? 1 : best.type === "Water" ? -1 : 0;
  if (weather === "Rain") favor += best.type === "Water" ? 1 : best.type === "Fire" ? -1 : 0;
  const terrain = setting.terrain ?? "";
  if (terrain && isGroundedBuild(build, runtime)) {
    if ((terrain === "Electric" && best.type === "Electric") || (terrain === "Grassy" && best.type === "Grass") || (terrain === "Psychic" && best.type === "Psychic")) favor += 1;
  }
  if (terrain === "Misty" && best.type === "Dragon") favor -= 1;
  return Math.max(-1, Math.min(1, favor));
}
export function fieldFavor(view: AiView, mon: MonView, setting: FieldSetting, runtime: BattleRuntime): number {
  void view;
  return favorOf(mon.moves, mon.build, setting, runtime);
}
