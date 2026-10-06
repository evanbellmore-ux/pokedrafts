// SPEC 10.3: a move's chance to hit one target, from pinned Showdown's accuracy steps (PS/sim/battle-actions.ts:690-740
// hitStepAccuracy, its ModifyAccuracy and Accuracy events). The player's Pokémon use belief world 0's ability and item.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleConditions } from "@/app/lib/battle/types";
import type { AiView, MonKey, MonView } from "../model/ai-view";

/** Weather negated by an active Cloud Nine or Air Lock (PS/data/abilities.ts cloudnine/airlock suppressingWeather). */
export function effectiveWeather(view: AiView): BattleConditions["weather"] {
  const negated = view.mons.some((mon) => mon.slot !== null && !mon.fainted && (mon.build.abilityId === "cloudnine" || mon.build.abilityId === "airlock"));
  return negated ? "" : view.field.weather;
}
/** Utility Umbrella blocks sun and rain for its holder (PS/data/items.ts utilityumbrella; pokemon.effectiveWeather). */
function weatherFor(view: AiView, mon: MonView | null): BattleConditions["weather"] {
  const weather = effectiveWeather(view);
  if (mon?.build.itemId === "utilityumbrella" && (weather === "Sun" || weather === "Rain" || weather === "Harsh Sunshine" || weather === "Heavy Rain")) return "";
  return weather;
}
const RAIN: ReadonlySet<string> = new Set(["Rain", "Heavy Rain"]);
const SUN: ReadonlySet<string> = new Set(["Sun", "Harsh Sunshine"]);
/** Moves that never miss in rain and hit at 50 in sun, by the target's weather (PS/data/moves.ts thunder 19449, hurricane 9036, and the storms). */
const RAIN_SURE: ReadonlySet<string> = new Set(["thunder", "hurricane", "bleakwindstorm", "sandsearstorm", "wildboltstorm"]);
const SUN_HALF: ReadonlySet<string> = new Set(["thunder", "hurricane"]);
/** Abilities whose holder's moves ignore evasion (PS/data/abilities.ts keeneye, mindseye, illuminate onModifyMove ignoreEvasion). */
const IGNORE_EVASION: ReadonlySet<string> = new Set(["keeneye", "mindseye", "illuminate"]);

/** The chain modifiers' 4096ths as Showdown rounds them (chainModify) are within 0.01%; plain products here. */
const COMPOUND_EYES = 5325 / 4096, HUSTLE = 3277 / 4096, VICTORY_STAR = 4506 / 4096, WIDE_LENS = 4505 / 4096, BRIGHT_POWDER = 3686 / 4096;
const SAND_VEIL = 3277 / 4096, GRAVITY = 6840 / 4096;

/**
 * effectiveAccuracy (0–1) of `actor` using `moveId` into `target` (null: no target, e.g. a spread or self move's own check):
 * accuracy true (catalog null) → 1; OHKO moves 30 (+ level difference: equal at level 50) and nothing else; else the base,
 * then ModifyAccuracy (Compound Eyes, Hustle on physical, Victory Star on the user's side, Wide Lens, the target's Bright
 * Powder or Lax Incense, Sand Veil in sand, Snow Cloak in snow or hail, Tangled Feet when confused, Wonder Skin on status
 * moves, Gravity), the accuracy − evasion stage (clamped to ±6; (3+s)/3 or 3/(3−s); Keen Eye, Mind's Eye and Illuminate
 * ignore evasion), then alwaysHit cases (Toxic by a Poison type, a self-targeting status move) and No Guard on either side,
 * then the weather moves (Thunder/Hurricane sure in rain and 50 in sun, Blizzard sure in snow or hail); capped at 1.
 */
export function effectiveAccuracy(view: AiView, actor: MonKey, moveId: string, target: MonKey | null, runtime: BattleRuntime): number {
  const move = runtime.movesById.get(moveId);
  const user = view.mons.find((mon) => mon.key === actor) ?? null;
  const foe = target ? view.mons.find((mon) => mon.key === target) ?? null : null;
  if (!move || !user) return 1;
  if (user.build.abilityId === "noguard" || foe?.build.abilityId === "noguard") return 1;
  if (move.target === "self" && move.category === "Status") return 1;
  if (move.id === "toxic" && runtime.speciesById.get(user.build.speciesId)?.types.includes("Poison")) return 1;
  const targetWeather = weatherFor(view, foe);
  if (RAIN.has(targetWeather) && RAIN_SURE.has(move.id)) return 1;
  if (move.id === "blizzard" && (effectiveWeather(view) === "Snow" || effectiveWeather(view) === "Hail")) return 1;
  if (move.accuracy === null) return 1;
  if (move.ohko) return Math.min(1, (move.id === "sheercold" && !runtime.speciesById.get(user.build.speciesId)?.types.includes("Ice") ? 20 : 30) / 100);
  let accuracy = SUN.has(targetWeather) && SUN_HALF.has(move.id) ? 50 : move.accuracy;
  const weather = effectiveWeather(view);
  if (user.build.abilityId === "compoundeyes") accuracy *= COMPOUND_EYES;
  if (user.build.abilityId === "hustle" && move.category === "Physical") accuracy *= HUSTLE;
  const victoryStar = view.mons.some((mon) => mon.side === user.side && mon.slot !== null && !mon.fainted && mon.build.abilityId === "victorystar");
  if (victoryStar) accuracy *= VICTORY_STAR;
  if (user.build.itemId === "widelens") accuracy *= WIDE_LENS;
  if (foe) {
    const breaks = user.build.abilityId === "moldbreaker" || user.build.abilityId === "teravolt" || user.build.abilityId === "turboblaze";
    if (foe.build.itemId === "brightpowder" || foe.build.itemId === "laxincense") accuracy *= BRIGHT_POWDER;
    if (!breaks && foe.build.abilityId === "sandveil" && weather === "Sand") accuracy *= SAND_VEIL;
    if (!breaks && foe.build.abilityId === "snowcloak" && (weather === "Snow" || weather === "Hail")) accuracy *= SAND_VEIL;
    if (!breaks && foe.build.abilityId === "tangledfeet" && foe.volatiles.includes("confusion")) accuracy *= 0.5;
    if (!breaks && foe.build.abilityId === "wonderskin" && move.category === "Status") accuracy = Math.min(accuracy, 50);
  }
  if (view.field.gravity) accuracy *= GRAVITY;
  let stage = Math.max(-6, Math.min(6, user.accuracyStage));
  if (foe && !IGNORE_EVASION.has(user.build.abilityId)) stage = Math.max(-6, Math.min(6, stage - foe.evasionStage));
  if (stage > 0) accuracy = accuracy * (3 + stage) / 3;
  else if (stage < 0) accuracy = accuracy * 3 / (3 - stage);
  return Math.max(0, Math.min(1, accuracy / 100));
}
