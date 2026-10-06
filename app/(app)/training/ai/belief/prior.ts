// SPEC 10.1.1 Stat Points and Natures: the deterministic archetype prior (prototype spec/prior-probe.ts), and addendum A1.4's
// usage spreads in front of it. Open categories are point masses from the sheet.
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleStat, CombatStat } from "@/app/lib/battle/types";
import type { SheetMember } from "../../model/sheet";
import type { StatPoints } from "../../model/sheet";
import { natureEffect, natureName, NEUTRAL_NATURES, pointsKey, STAT_ORDER, ZERO_POINTS } from "../battle-facts";
import type { Archetype, SpreadSource } from "./types";
import type { UsageSource } from "./usage";

export type SpreadOption = { source: SpreadSource; points: StatPoints; nature: string; weight: number };
/** One point vector of the archetype table with the archetypes that give it and each one's share of its weight. */
export type ArchetypeSpread = { archetypes: { id: Archetype; weight: number }[]; points: StatPoints; weight: number };

/** Support moves of the archetype rule (SPEC 10.1.1: two or more favour the walls and fast support). */
export const SUPPORT_MOVES: ReadonlySet<string> = new Set([
  "tailwind", "trickroom", "followme", "ragepowder", "helpinghand", "reflect", "lightscreen", "auroraveil", "spore", "sleeppowder",
  "willowisp", "thunderwave", "encore", "taunt", "partingshot", "fakeout", "icywind", "electroweb", "snarl", "wideguard", "quickguard", "recover",
]);
/** The least prior mass the archetypes keep beside usage spreads: a custom spread outside the usage top 12 stays possible. */
const ARCHETYPE_FLOOR = 0.1;

const points = (values: Partial<StatPoints>): StatPoints => ({ ...ZERO_POINTS, ...values });

type Roles = { main: CombatStat; other: CombatStat; weakDef: CombatStat; strongDef: CombatStat };
/** main = the attacking stat of most of its damaging moves (ties: the higher base stat); other = the unused one; weakDef = the lower of Def and SpD. */
export function roles(speciesId: string, moves: readonly string[], runtime: BattleRuntime): Roles {
  const base = runtime.speciesById.get(speciesId)?.baseStats ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const damaging = moves.map((id) => runtime.movesById.get(id)).filter((move) => !!move && move.category !== "Status");
  const physical = damaging.filter((move) => move!.category === "Physical").length;
  const special = damaging.length - physical;
  const main: CombatStat = physical > special ? "atk" : special > physical ? "spa" : base.atk >= base.spa ? "atk" : "spa";
  const weakDef: CombatStat = base.def <= base.spd ? "def" : "spd";
  return { main, other: main === "atk" ? "spa" : "atk", weakDef, strongDef: weakDef === "def" ? "spd" : "def" };
}

/**
 * The archetype table with its multipliers in SPEC order (base Speed, Trick Room on the sheet, support moves, no damaging
 * move, the open nature), merged where points are equal, normalised. `nature` null: Natures closed.
 */
export function archetypePoints(speciesId: string, moves: readonly string[], nature: string | null, sheetHasTrickRoom: boolean, runtime: BattleRuntime):
  ArchetypeSpread[] {
  const base = runtime.speciesById.get(speciesId)?.baseStats ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const { main, weakDef } = roles(speciesId, moves, runtime);
  const damaging = moves.some((id) => { const move = runtime.movesById.get(id); return !!move && move.category !== "Status"; });
  const support = moves.filter((id) => SUPPORT_MOVES.has(id)).length;
  const list: { id: Archetype; points: StatPoints; w: number }[] = [
    { id: "fast-attacker", points: points({ [main]: 32, spe: 32, hp: 2 }), w: 0.30 },
    { id: "bulky-attacker", points: points({ hp: 32, [main]: 32, [weakDef]: 2 }), w: 0.25 },
    { id: "fast-support", points: points({ hp: 32, spe: 32, [weakDef]: 2 }), w: 0.10 },
    { id: "physical-wall", points: points({ hp: 32, def: 32, spd: 2 }), w: 0.08 },
    { id: "special-wall", points: points({ hp: 32, spd: 32, def: 2 }), w: 0.08 },
    { id: "mixed-wall", points: points({ hp: 32, def: 17, spd: 17 }), w: 0.07 },
    { id: "trick-room", points: points({ hp: 32, [main]: 32, [weakDef]: 2 }), w: 0.07 },
    { id: "uninvested", points: points({}), w: 0.05 },
  ];
  const effect = nature === null ? null : natureEffect(nature);
  for (const a of list) {
    if (base.spe >= 90 && a.points.spe === 32) a.w *= 1.5;
    if (base.spe <= 50) { if (a.points.spe === 32) a.w *= 0.3; if (a.id === "trick-room") a.w *= 2; }
    if (a.id === "trick-room" && sheetHasTrickRoom && base.spe <= 60) a.w *= 3;
    if (support >= 2) {
      if (a.id === "fast-support" || a.id.endsWith("wall")) a.w *= 1.5;
      if (a.id.endsWith("attacker")) a.w *= 0.7;
    }
    if (!damaging && a.id.endsWith("attacker")) a.w *= 0.2;
    if (nature !== null && effect) {
      if (!effect.plus || NEUTRAL_NATURES.has(nature)) a.w *= a.id === "uninvested" ? 20 : 0.5;
      else {
        if (a.id === "uninvested") a.w *= 0.05;
        if (a.id === "trick-room") a.w *= effect.minus === "spe" ? 4 : 0.1;
        else if (effect.minus === "spe" && a.points.spe > 0) a.w *= 0.1;
        if (a.points[effect.plus] === 0) a.w *= 0.2;
        if (effect.minus && a.points[effect.minus] > 2) a.w *= 0.1;
      }
    }
  }
  const merged: ArchetypeSpread[] = [];
  for (const a of list) {
    const same = merged.find((entry) => pointsKey(entry.points) === pointsKey(a.points));
    if (same) { same.weight += a.w; same.archetypes.push({ id: a.id, weight: a.w }); } else merged.push({ archetypes: [{ id: a.id, weight: a.w }], points: a.points, weight: a.w });
  }
  const total = merged.reduce((sum, entry) => sum + entry.weight, 0);
  return merged.map((entry) => ({
    points: entry.points, weight: entry.weight / total,
    archetypes: entry.archetypes.map((part) => ({ id: part.id, weight: entry.weight > 0 ? part.weight / entry.weight : 1 / entry.archetypes.length })),
  })).sort((a, b) => b.weight - a.weight);
}

/** The natures of a merged archetype entry: each archetype's natures by its share of the entry. */
function entryNatures(entry: ArchetypeSpread, role: Roles): { nature: string; weight: number }[] {
  const out = new Map<string, number>();
  for (const part of entry.archetypes) for (const { nature, weight } of archetypeNatures(part.id, role)) out.set(nature, (out.get(nature) ?? 0) + part.weight * weight);
  return [...out].map(([nature, weight]) => ({ nature, weight }));
}

/** SPEC 10.1.1 Natures, when closed: the archetype's natures by (raised, lowered), `other` the unused attacking stat. */
export function archetypeNatures(archetype: Archetype, role: Roles): { nature: string; weight: number }[] {
  const { main, other, strongDef } = role;
  const pairs: [CombatStat | null, CombatStat | null, number][] = {
    "fast-attacker": [["spe", other, 0.6], [main, other, 0.4]],
    "bulky-attacker": [[main, other, 0.8], [strongDef, other, 0.2]],
    "fast-support": [["spe", other, 0.7], ["def", other, 0.3]],
    "physical-wall": [["def", other, 1]],
    "special-wall": [["spd", other, 1]],
    "mixed-wall": [["def", other, 0.5], ["spd", other, 0.5]],
    "trick-room": [[main, "spe", 1]],
    "uninvested": [[null, null, 1]],
  }[archetype] as [CombatStat | null, CombatStat | null, number][];
  const out = new Map<string, number>();
  for (const [plus, minus, weight] of pairs) {
    const name = natureName(plus, minus);
    out.set(name, (out.get(name) ?? 0) + weight);
  }
  return [...out].map(([nature, weight]) => ({ nature, weight }));
}

const l1 = (a: StatPoints, b: StatPoints) => STAT_ORDER.reduce((sum, stat: BattleStat) => sum + Math.abs(a[stat] - b[stat]), 0);

/**
 * Stat Points this close (L1, same nature, same Speed points) are one spread to the belief: at level 50 a Stat Point is
 * one stat point (PS/data/mods/champions/scripts.ts:10-38), below what a shown HP percentage or a damage roll separates,
 * while Speed points decide orders the battle shows. Smogon's usage keeps such spreads apart ("2/32/0/0/0/32" and
 * "1/32/1/0/0/32"); split, they hold the truth's posterior below one half on Pool A (scripts/.cache/training/build/fixer/belief-diag.out).
 */
export const SAME_SPREAD_POINTS = 2;
export function sameSpread(a: { points: StatPoints; nature: string }, b: { points: StatPoints; nature: string }): boolean {
  return a.nature === b.nature && a.points.spe === b.points.spe && l1(a.points, b.points) <= SAME_SPREAD_POINTS;
}
/** Spreads merged into the heaviest one they are the same spread as (weights added), heaviest first. */
function mergeSpreads(options: SpreadOption[]): SpreadOption[] {
  const out: SpreadOption[] = [];
  for (const option of options) {
    const into = out.find((kept) => sameSpread(kept, option));
    if (into) into.weight += option.weight; else out.push({ ...option });
  }
  return out;
}

/**
 * The spread (Stat Points × nature) prior of one member, normalised and merged by (points, nature), heaviest first:
 * - both open: the sheet's;
 * - Stat Points open, Natures closed: the usage spreads with exactly those points (A1.4), with the nearest archetype's
 *   natures for the uncovered share;
 * - Stat Points closed: the usage spreads (only the open nature's when Natures are open) for the share of sets the
 *   usage top spreads cover (A1.4), the archetype prior (SPEC 10.1.1) for the rest, never less than ARCHETYPE_FLOOR.
 */
export function spreadPrior(member: SheetMember, moves: readonly string[], sheetHasTrickRoom: boolean, source: UsageSource, runtime: BattleRuntime): SpreadOption[] {
  const role = roles(member.speciesId, moves, runtime);
  if (member.points && member.nature !== null) return [{ source: "sheet", points: { ...member.points }, nature: member.nature, weight: 1 }];
  const out = new Map<string, SpreadOption>();
  const add = (option: SpreadOption) => {
    if (option.weight <= 0) return;
    const key = `${pointsKey(option.points)}|${option.nature}`;
    const known = out.get(key);
    if (known) known.weight += option.weight; else out.set(key, { ...option });
  };
  const usageSpreads = source.rows.flatMap(({ row, share }) => row.spreads.map((spread) => ({ ...spread, weight: spread.weight * share })));
  const coverage = Math.min(1 - ARCHETYPE_FLOOR, usageSpreads.reduce((sum, spread) => sum + spread.weight, 0));
  if (member.points) {
    const known = member.points;
    const matching = usageSpreads.filter((spread) => pointsKey(spread.points) === pointsKey(known));
    const matched = matching.reduce((sum, spread) => sum + spread.weight, 0);
    const usageShare = matched > 0 ? Math.min(1 - ARCHETYPE_FLOOR, coverage > 0 ? matched / coverage : 0) : 0;
    for (const spread of matching) add({ source: "usage", points: { ...known }, nature: spread.nature, weight: usageShare * spread.weight / matched });
    const nearest = archetypePoints(member.speciesId, moves, null, sheetHasTrickRoom, runtime)
      .map((entry) => ({ entry, distance: l1(entry.points, known) })).sort((a, b) => a.distance - b.distance || b.entry.weight - a.entry.weight)[0];
    for (const { nature, weight } of entryNatures(nearest.entry, role)) add({ source: nearest.entry.archetypes[0].id, points: { ...known }, nature, weight: (1 - usageShare) * weight });
  } else {
    const nature = member.nature;
    const usable = nature === null ? usageSpreads : usageSpreads.filter((spread) => spread.nature.toLowerCase() === nature.toLowerCase());
    const usableTotal = usable.reduce((sum, spread) => sum + spread.weight, 0);
    // With an open nature, the usage spreads of that nature stand for the same share of its sets as all of them do overall.
    const usageShare = usableTotal > 0 ? coverage : 0;
    for (const spread of usable) add({ source: "usage", points: { ...spread.points }, nature: nature ?? spread.nature, weight: usageShare * spread.weight / usableTotal });
    for (const entry of archetypePoints(member.speciesId, moves, nature, sheetHasTrickRoom, runtime)) {
      const natures = nature !== null ? [{ nature, weight: 1 }] : entryNatures(entry, role);
      for (const each of natures) add({ source: entry.archetypes[0].id, points: entry.points, nature: each.nature, weight: (1 - usageShare) * entry.weight * each.weight });
    }
  }
  const total = [...out.values()].reduce((sum, option) => sum + option.weight, 0);
  const sorted = [...out.values()].map((option) => ({ ...option, weight: option.weight / total })).sort((a, b) => b.weight - a.weight || (pointsKey(a.points) < pointsKey(b.points) ? -1 : 1));
  return mergeSpreads(sorted).sort((a, b) => b.weight - a.weight || (pointsKey(a.points) < pointsKey(b.points) ? -1 : 1));
}
