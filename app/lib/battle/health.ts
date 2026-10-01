import type { Pokemon } from "@smogon/calc";
import { getBuildStats } from "./model";
import { isMaxActive, validateMechanic } from "./mechanics";
import { championsRuntime, type BattleRuntime } from "./runtime";
import type { BattleBuild } from "./types";

export type BuildHealth = {
  baseMax: number;
  baseCurrent: number;
  max: number;
  current: number;
  reason: string | null;
};

/**
 * Current HP once a toggle changes the form's maximum HP, which only Terapagos's Terastallization does
 * (Terastal <-> Stellar). Pinned Showdown formeChange -> updateMaxHp (sim/pokemon.ts) keeps the damage
 * taken: new maximum - (old maximum - HP), at least 1. Blank (full) stays blank, and HP that is not valid
 * for the old form (unfinished text, 0, above its maximum) is left as typed. Values are base/pre-Dynamax HP.
 */
export function rebaseCurrentHP(before: BattleBuild, after: BattleBuild, runtime: BattleRuntime = championsRuntime): number | null {
  const current = before.currentHP;
  const oldMax = getBuildStats(before, runtime)?.hp;
  const newMax = getBuildStats(after, runtime)?.hp;
  if (current === null || !oldMax || !newMax || oldMax === newMax || !Number.isSafeInteger(current) || current < 1 || current > oldMax) return current;
  return Math.max(1, newMax - (oldMax - current));
}

/** Input remains pre-Dynamax HP. Never clamp invalid input or multiply it twice. */
export function getBuildHealth(build: BattleBuild, runtime: BattleRuntime = championsRuntime): BuildHealth | null {
  const stats = getBuildStats(build, runtime);
  if (!stats) return null;
  const baseMax = stats.hp;
  const baseCurrent = build.currentHP ?? baseMax;
  const reason = !Number.isSafeInteger(baseCurrent) || baseCurrent < 1 || baseCurrent > baseMax
    ? `Current HP must be a whole number from 1 to ${baseMax}.`
    : validateMechanic(build, runtime).map((issue) => issue.message).join(" ") || null;
  const multiplier = isMaxActive(build) && baseMax !== 1 ? 150 + 5 * (build.configuration?.dynamaxLevel ?? 10) : 100;
  return { baseMax, baseCurrent, max: Math.floor(baseMax * multiplier / 100), current: Math.floor(baseCurrent * multiplier / 100), reason };
}

/**
 * Pinned Showdown c23d2e9 data/conditions.ts:753–775 floors both HP values on
 * Dynamax entry (Shedinja is exempt). Calc e7fd7e5 pokemon.ts instead ceils current
 * HP, even above its own maximum. Correct only that discrepancy on app-owned
 * instances. calculate() clones its inputs, so every clone must carry the adapter.
 * Raw stats/current HP stay BASE values; original=true retains the engine API.
 */
export function withDynamaxHealth(pokemon: Pokemon): Pokemon {
  if (pokemon.gen.num !== 8 || !pokemon.isDynamaxed) return pokemon;
  pokemon.curHP = function (original = false) {
    if (original || this.species.baseStats.hp === 1) return this.originalCurHP;
    return Math.floor(this.originalCurHP * (150 + 5 * (this.dynamaxLevel ?? 10)) / 100);
  };
  const clone = pokemon.clone.bind(pokemon);
  pokemon.clone = () => withDynamaxHealth(clone());
  return pokemon;
}
