// Small battle facts the AI modules share: ids, natures, type effectiveness, Mega forms, Champions shown HP, sets as builds.
// Pure functions over the catalog (BattleRuntime); no simulator.
import { Generations } from "@smogon/calc";
import { PROTECT_MOVES } from "@/app/lib/battle/doubles-actions";
import { megaEntries, getMegaOptions } from "@/app/lib/battle/mega-forms";
import { createBuild, defaultAbilityActive, NATURES } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleStat, CombatStat } from "@/app/lib/battle/types";
import type { ShownHP } from "../model/public-state";
import type { StatPoints } from "../model/sheet";
import type { ShowdownSet } from "../model/showdown-types";

/** Showdown's toID (sim/dex-data.ts toID): lower case, letters and digits only. */
export function toId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const STAT_ORDER: readonly BattleStat[] = ["hp", "atk", "def", "spa", "spd", "spe"];
export const ZERO_POINTS: StatPoints = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
export const STAT_SHORT: Record<BattleStat, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
export function pointsKey(points: StatPoints): string {
  return STAT_ORDER.map((stat) => points[stat]).join("/");
}
/** "2 HP / 32 Atk / 32 Spe"; "0 Stat Points" when none are invested. */
export function pointsText(points: StatPoints): string {
  const parts = STAT_ORDER.filter((stat) => points[stat] > 0).map((stat) => `${points[stat]} ${STAT_SHORT[stat]}`);
  return parts.length ? parts.join(" / ") : "0 Stat Points";
}

/** A nature's raised and lowered stat (model.ts NATURES); null for the neutral ones and unknown names. */
export function natureEffect(name: string): { plus: CombatStat | null; minus: CombatStat | null } {
  const entry = NATURES.find((nature) => nature.name.toLowerCase() === name.toLowerCase());
  return entry ? { plus: entry.plus, minus: entry.minus } : { plus: null, minus: null };
}
/** The nature name raising `plus` and lowering `minus` (NATURES); "Hardy" for neither. */
export function natureName(plus: CombatStat | null, minus: CombatStat | null): string {
  if (!plus || !minus || plus === minus) return "Hardy";
  return NATURES.find((nature) => nature.plus === plus && nature.minus === minus)?.name ?? "Hardy";
}
export const NEUTRAL_NATURES: ReadonlySet<string> = new Set(["Hardy", "Docile", "Serious", "Bashful", "Quirky"]);

/** The protecting moves (doubles-actions.ts PROTECT_MOVES: stallingMove with a protect volatile). */
export function isProtectMove(moveId: string): boolean {
  return Object.hasOwn(PROTECT_MOVES, moveId);
}

const typeChart = Generations.get(9).types;
/** The type multiplier of an attack of `moveType` into `defenderTypes` (pinned type chart via @smogon/calc). */
export function typeEffectiveness(moveType: string, defenderTypes: readonly string[]): number {
  const type = typeChart.get(toId(moveType) as never);
  if (!type) return 1;
  let multiplier = 1;
  for (const each of defenderTypes) multiplier *= (type.effectiveness as Record<string, number>)[each] ?? 1;
  return multiplier;
}
export const TYPE_NAMES = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"] as const;

/**
 * The Mega form a member becomes holding `itemId` (champions scripts.ts:183-195: the stone's megaStone for its species), or
 * null when the item is not its stone.
 */
export function megaFormFor(speciesId: string, itemId: string, runtime: BattleRuntime): string | null {
  if (!itemId) return null;
  return getMegaOptions(speciesId, runtime).find((option) => option.itemId === itemId && option.baseSpeciesId === speciesId)?.formId ?? null;
}
/** The out-of-battle species of a form (a Mega form's base, as SPEC 7.5 sends it) and the stone it must hold, else itself. */
export function outOfBattleForm(speciesId: string, runtime: BattleRuntime): { speciesId: string; stone: string | null } {
  const entry = megaEntries(speciesId, runtime)[0];
  return entry ? { speciesId: entry.baseSpeciesId, stone: entry.itemId } : { speciesId, stone: null };
}

/**
 * Champions shown HP (PS/sim/pokemon.ts:2063-2075 getHealth, Champions branch): floor(100·hp/maxhp) or 1, "y"/"r" at 20 and
 * "g"/"y" at 50 by the exact threshold; 0 when fainted.
 */
export function shownHP(hp: number, maxhp: number): ShownHP {
  if (hp <= 0) return { percent: 0, color: null };
  const percent = Math.floor(100 * hp / maxhp) || 1;
  const color = percent === 20 ? (hp * 5 > maxhp ? "y" : "r") : percent === 50 ? (hp * 2 > maxhp ? "g" : "y") : null;
  return { percent, color };
}
export function sameShown(a: ShownHP, b: ShownHP): boolean {
  return a.percent === b.percent && (a.color === null || b.color === null || a.color === b.color);
}
const bands = new Map<string, readonly number[]>();
/** Every HP in 1..maxhp that shows as `shown` (empty for a fainted reading). */
export function hpBand(shown: ShownHP, maxhp: number): readonly number[] {
  const key = `${maxhp}|${shown.percent}|${shown.color ?? ""}`;
  let band = bands.get(key);
  if (!band) {
    const values: number[] = [];
    if (shown.percent > 0) for (let hp = 1; hp <= maxhp; hp++) if (sameShown(shownHP(hp, maxhp), shown)) values.push(hp);
    bands.set(key, band = values);
  }
  return band;
}
/** The band's middle HP (its rounded mean), or maxhp at 100%. */
export function bandMidpoint(shown: ShownHP, maxhp: number): number {
  const band = hpBand(shown, maxhp);
  if (!band.length) return shown.percent > 0 ? maxhp : 0;
  return band[Math.floor((band.length - 1) / 2)];
}

/**
 * A Showdown set as a calculator build in its current form (Champions: Stat Points = the set's EVs). A Mega form (or any
 * other shown form) takes that form's first catalog ability, as Mega Evolution sets it (PS/sim/pokemon.ts formeChange).
 */
export function buildFromSet(set: ShowdownSet, runtime: BattleRuntime, formId?: string): BattleBuild {
  const baseId = toId(set.species);
  const speciesId = formId && runtime.speciesById.has(formId) ? formId : baseId;
  const build = createBuild(speciesId, runtime);
  const changed = speciesId !== baseId;
  const abilityId = changed ? runtime.speciesById.get(speciesId)?.abilities[0] ?? toId(set.ability) : toId(set.ability);
  const points = { hp: set.evs.hp, atk: set.evs.atk, def: set.evs.def, spa: set.evs.spa, spd: set.evs.spd, spe: set.evs.spe };
  const base = { ...build, nature: set.nature, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: toId(set.item) };
  return base.game === "champions" ? { ...base, points } : base;
}
/** A believed set (points, nature, item, ability) as a build of `speciesId`. */
export function buildFromCandidate(speciesId: string, candidate: { points: StatPoints; nature: string; itemId: string; abilityId: string }, runtime: BattleRuntime): BattleBuild {
  const build = createBuild(speciesId, runtime);
  const base = { ...build, nature: candidate.nature, abilityId: candidate.abilityId, abilityActive: defaultAbilityActive(candidate.abilityId), itemId: candidate.itemId };
  return base.game === "champions" ? { ...base, points: { ...candidate.points } } : base;
}
/** A build in another form (Mega Evolution): the form's first catalog ability; stages, status and item kept. */
export function inForm(build: BattleBuild, formId: string, runtime: BattleRuntime): BattleBuild {
  const abilityId = runtime.speciesById.get(formId)?.abilities[0] ?? build.abilityId;
  return { ...build, speciesId: formId, abilityId, abilityActive: defaultAbilityActive(abilityId) };
}

/** The other seat. */
export function otherSide(side: "p1" | "p2"): "p1" | "p2" {
  return side === "p1" ? "p2" : "p1";
}
/** A PublicMon key (`${side}:${member}`) split into its side and TrainingMember.key. */
export function splitPublicKey(key: string): { side: string; member: string } {
  const at = key.indexOf(":");
  return at < 0 ? { side: "", member: key } : { side: key.slice(0, at), member: key.slice(at + 1) };
}

/** Showdown weather ids (PS/data/conditions.ts) and terrain ids as the calculator's field names. */
const WEATHER_BY_ID: Readonly<Record<string, BattleConditionsWeather>> = {
  sunnyday: "Sun", raindance: "Rain", sandstorm: "Sand", snowscape: "Snow", snow: "Snow", hail: "Hail",
  desolateland: "Harsh Sunshine", primordialsea: "Heavy Rain", deltastream: "Strong Winds",
};
type BattleConditionsWeather = "" | "Sun" | "Rain" | "Sand" | "Snow" | "Hail" | "Harsh Sunshine" | "Heavy Rain" | "Strong Winds";
const TERRAIN_BY_ID: Readonly<Record<string, "" | "Electric" | "Grassy" | "Misty" | "Psychic">> = {
  electricterrain: "Electric", grassyterrain: "Grassy", mistyterrain: "Misty", psychicterrain: "Psychic",
};
export function weatherOf(id: string | null | undefined): BattleConditionsWeather {
  return WEATHER_BY_ID[toId(id ?? "")] ?? "";
}
export function terrainOf(id: string | null | undefined): "" | "Electric" | "Grassy" | "Misty" | "Psychic" {
  return TERRAIN_BY_ID[toId(id ?? "")] ?? "";
}
