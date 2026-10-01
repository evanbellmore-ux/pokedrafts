import type { BattleRuntime } from "./runtime";
import type { BattleBuild, MoveContext } from "./types";

/**
 * Power that depends on a count a two-build snapshot cannot see, per pinned Showdown:
 * - Supreme Overlord (data/abilities.ts): 1.1x per ally fainted before the user entered, at
 *   most 5. The count lives on the build (faintedAllies) and goes to the engine's alliesFainted.
 * - Last Respects (data/moves.ts basePowerCallback): 50 + 50 per fainted party member
 *   (side.totalFainted).
 * - Rage Fist: 50 + 50 per hit the user has taken, at most 350 (timesAttacked). The Champions
 *   mod resets the count when the user switches out (clearVolatile); other games keep it.
 * - Beat Up: one hit per party member that is not fainted and has no status, the user always
 *   included; each hit has 5 + floor(base Attack / 10) of that member's team species.
 * Counts default to 0, the start of a battle, and each result states the count it used.
 */
export const MAX_FAINTED_ALLIES = 5;
export const MAX_TIMES_HIT = 6;
export const MAX_BEAT_UP_ALLIES = 5;

const SUPREME_OVERLORD_MODS = [4096, 4506, 4915, 5325, 5734, 6144];

export type CountPower = { power: number; line: string } | { reason: string };

function countIn(value: number | undefined, maximum: number): number | null {
  const count = value ?? 0;
  return Number.isInteger(count) && count >= 0 && count <= maximum ? count : null;
}

/** Last Respects and Rage Fist: the power for the chosen count, or why it cannot be used. */
export function countPower(moveId: string, context: MoveContext | undefined, runtime: BattleRuntime): CountPower | null {
  if (moveId === "lastrespects") {
    const fainted = countIn(context?.fainted, MAX_FAINTED_ALLIES);
    if (fainted === null) return { reason: `Last Respects: fainted count must be 0 to ${MAX_FAINTED_ALLIES}.` };
    const power = 50 + 50 * fainted;
    return { power, line: `Last Respects: ${fainted} fainted, ${power} power.` };
  }
  if (moveId === "ragefist") {
    const hits = countIn(context?.timesHit, MAX_TIMES_HIT);
    if (hits === null) return { reason: `Rage Fist: hit count must be 0 to ${MAX_TIMES_HIT}.` };
    const power = Math.min(350, 50 + 50 * hits);
    const scope = runtime.profile.id === "champions" ? " since switching in" : "";
    return { power, line: `Rage Fist: hit ${hits === MAX_TIMES_HIT ? `${hits} or more times` : `${hits} time${hits === 1 ? "" : "s"}`}${scope}, ${power} power.` };
  }
  return null;
}

/** The team species whose base Attack sets a Beat Up hit: battle-only forms use their base form. */
function teamSpecies(speciesId: string, runtime: BattleRuntime) {
  const species = runtime.speciesById.get(speciesId);
  return species?.battleForm && species.baseSpecies ? runtime.speciesById.get(species.baseSpecies) ?? species : species;
}

/** A team's members as Beat Up party choices, a Mega or other battle-only form as its team form. */
export function beatUpPartyOptions(speciesIds: readonly string[], runtime: BattleRuntime): { speciesId: string; name: string }[] {
  const options = new Map<string, { speciesId: string; name: string }>();
  for (const id of speciesIds) {
    const species = teamSpecies(id, runtime);
    if (species && !species.battleForm) options.set(species.id, { speciesId: species.id, name: species.name });
  }
  return [...options.values()];
}

export type BeatUpPlan = { hits: { name: string; power: number }[] } | { reason: string };

/** Beat Up's hits for the user and the chosen party members (context.party). */
export function beatUpPlan(attacker: Pick<BattleBuild, "speciesId">, context: MoveContext | undefined, runtime: BattleRuntime): BeatUpPlan {
  const party = context?.party;
  if (!party) return { reason: "Beat Up: party needed." };
  if (party.some((id) => id === "")) return { reason: "Beat Up: a party member has no Pokémon." };
  if (party.length > MAX_BEAT_UP_ALLIES || party.some((id) => !runtime.speciesById.has(id))) {
    return { reason: `Beat Up: at most ${MAX_BEAT_UP_ALLIES} other party members, each a Pokémon in this game.` };
  }
  const hits = [attacker.speciesId, ...party].map((id) => {
    const species = teamSpecies(id, runtime)!;
    return { name: species.name, power: 5 + Math.floor(species.baseStats.atk / 10) };
  });
  return { hits };
}

/** Supreme Overlord's power multiplier for the fainted-ally count, as Showdown chains it. */
export function supremeOverlordMultiplier(faintedAllies: number): number {
  return SUPREME_OVERLORD_MODS[Math.min(MAX_FAINTED_ALLIES, faintedAllies)] / 4096;
}
