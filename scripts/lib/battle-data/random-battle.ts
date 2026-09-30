import { toID } from "../champions-data/transform";
import type { RandomBattle, RandomBattleFormat } from "../../../app/lib/battle/types";
import { compare } from "./sources";
import type { NativeCatalog, NativeProfile, NativeResolvedSpecies, NativeSnapshot } from "./types";

/**
 * Quick-move defaults for the native games from pinned Showdown's Random Battle team generators
 * (data/random-battles/gen7|gen8|gen9/teams.ts reading sets.json, and gen9 doubles-sets.json): generated
 * sets, not usage statistics. The build runs each format's generator for a fixed number of teams with a
 * fixed seed and counts, per set key, how often each move appears. Each catalog form then gets up to four
 * legal damaging moves by that frequency, and each format a damaging-move ranking over every key.
 */
type SetRow = { role?: string; movepool: string[]; abilities?: string[] };
export type RandomBattleTable = Record<string, { level?: number; sets: SetRow[] }>;
export type RandomBattleFile = { path: string; sha256: string; sets: RandomBattleTable };
/** One set key's generated sets: how many, each move's count, and each whole set (ability|species|moves). */
export type GeneratedKey = { n: number; moves: Record<string, number>; sets: Record<string, number> };
export type GeneratedFormat = { format: string; seed: string; teams: number; errors: number; keys: Record<string, GeneratedKey> };
/** The part of pinned Showdown's sim/teams.ts Teams the build uses. */
export type TeamsAPI = {
  getGenerator(format: string, seed: string): {
    dex: { species: { get(species: unknown): { id: string } } };
    randomSet: (...args: unknown[]) => { species: string; ability: string; moves: string[] };
    getTeam(): unknown;
  };
};
type Format = "Singles" | "Doubles";
type Source = { key: string; n: number; moves: Record<string, number> };
type Rule = "exact" | "getForme" | "battleOnly" | "cosmetic";
type SourceRow = Omit<NativeResolvedSpecies, "learnset">;
type CatalogSpecies = NativeCatalog["species"][number];
type CatalogMove = NativeCatalog["moves"][number];

/**
 * Runs the pinned generator for `teams` whole teams and records every set it builds, by set key. A
 * team that fails to generate is counted and skipped (none does at the pinned revision).
 */
export function generateRandomBattle(Teams: TeamsAPI, format: string, seed: string, teams: number): GeneratedFormat {
  const generator = Teams.getGenerator(format, seed);
  const keys: Record<string, GeneratedKey> = {};
  const randomSet = generator.randomSet.bind(generator);
  generator.randomSet = (...args: unknown[]) => {
    const set = randomSet(...args);
    const key = generator.dex.species.get(args[0]).id;
    const entry = keys[key] ??= { n: 0, moves: {}, sets: {} };
    const moves = set.moves.map(toID);
    entry.n++;
    for (const id of moves) entry.moves[id] = (entry.moves[id] ?? 0) + 1;
    const tag = `${toID(set.ability)}|${toID(set.species)}|${[...moves].sort(compare).join(",")}`;
    entry.sets[tag] = (entry.sets[tag] ?? 0) + 1;
    return set;
  };
  let errors = 0;
  for (let index = 0; index < teams; index++) {
    try { generator.getTeam(); } catch { errors++; }
  }
  const sortedRecord = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => compare(a, b)));
  return {
    format, seed, teams, errors,
    keys: sortedRecord(Object.fromEntries(Object.entries(keys).map(([key, entry]) => [key, { n: entry.n, moves: sortedRecord(entry.moves), sets: sortedRecord(entry.sets) }]))),
  };
}

/** Pikachu's cap forms, which gen 8 and 9 Random Battles draw from the plain Pikachu key. */
const PIKACHU_CAPS = ["", "Original", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Partner", "World"];

/**
 * The catalog forms a set key stands for, as pinned Showdown's teams.ts getForme picks them (gen 7 and
 * 8 inherit gen 9's): a battle-only key names its own form (its entry form when that is not in the
 * game), cosmetic formes and Gigantamax keys stand for their family, and a few species draw any of
 * their other formes.
 */
function keyForms(key: string, gen: number, sourceById: ReadonlyMap<string, SourceRow>, has: (id: string) => boolean): string[] {
  const row = sourceById.get(key);
  if (!row) return [];
  if (typeof row.battleOnly === "string") return [has(key) ? key : toID(row.battleOnly)];
  if (row.cosmeticFormes?.length) return [row.name, ...row.cosmeticFormes].map(toID);
  if (row.name.endsWith("-Gmax")) return [toID(row.name.slice(0, -5))];
  if (["Dudunsparce", "Maushold", "Polteageist", "Sinistcha", "Zarude"].includes(row.baseSpecies)) return [row.name, ...(row.otherFormes ?? [])].map(toID);
  if (row.baseSpecies === "Basculin") return ["basculin", "basculinbluestriped"];
  if (row.baseSpecies === "Magearna") return ["magearna", "magearnaoriginal"];
  if (row.baseSpecies === "Keldeo" && gen <= 7) return ["keldeo", "keldeoresolute"];
  if (row.baseSpecies === "Pikachu" && gen >= 8) return PIKACHU_CAPS.map((forme) => toID(`Pikachu${forme}`));
  return [row.id];
}

/** Move counts over the generated sets that pass `keep` (ability and move ids). */
function countsOf(key: GeneratedKey, keep: (ability: string, moves: string[]) => boolean): { n: number; moves: Record<string, number> } {
  let n = 0;
  const moves: Record<string, number> = {};
  for (const [tag, count] of Object.entries(key.sets)) {
    const [ability, , list] = tag.split("|");
    const ids = list ? list.split(",") : [];
    if (!keep(ability, ids)) continue;
    n += count;
    for (const id of ids) moves[id] = (moves[id] ?? 0) + count;
  }
  return { n, moves };
}

/**
 * Each catalog form's sources: its getForme keys; else, for a battle-only form, its entry forms'
 * generated sets that can reach it (the form's required ability and move); else its cosmetic family's.
 */
function mapSpecies(catalog: NativeCatalog, speciesById: ReadonlyMap<string, CatalogSpecies>, sourceById: ReadonlyMap<string, SourceRow>, table: RandomBattleTable, generated: GeneratedFormat, gen: number) {
  const has = (id: string) => speciesById.has(id);
  const out = new Map<string, { rule: Rule; sources: Source[]; keys: string[] }>();
  const keysWithoutForm: string[] = [];
  const keysNotGenerated: string[] = [];
  for (const key of Object.keys(table).sort(compare)) {
    const forms = keyForms(key, gen, sourceById, has).filter(has);
    if (!forms.length) keysWithoutForm.push(key);
    const stats = generated.keys[key];
    if (!stats?.n) { if (forms.length) keysNotGenerated.push(key); continue; }
    for (const id of forms) {
      const row = out.get(id) ?? { rule: "getForme" as Rule, sources: [], keys: [] };
      if (id === key) row.rule = "exact";
      row.sources.push({ key, n: stats.n, moves: stats.moves });
      row.keys.push(key);
      out.set(id, row);
    }
  }
  const species = [...catalog.species].sort((a, b) => compare(a.id, b.id));
  for (const row of species) {
    if (out.has(row.id) || !row.battleOnly?.length) continue;
    const source = sourceById.get(row.id);
    const ability = source?.requiredAbility ? toID(source.requiredAbility) : undefined;
    const move = source?.requiredMove ? toID(source.requiredMove) : undefined;
    const sources = row.battleOnly.flatMap((parent) => out.get(parent)?.keys ?? []).map((key) => ({
      key, ...countsOf(generated.keys[key], (setAbility, moves) => (!ability || setAbility === ability) && (!move || moves.includes(move))),
    })).filter((entry) => entry.n);
    if (sources.length) out.set(row.id, { rule: "battleOnly", sources, keys: sources.map((entry) => entry.key) });
  }
  for (const row of species) {
    if (out.has(row.id) || row.baseSpecies === row.id) continue;
    const family = speciesById.get(row.baseSpecies);
    if (family && family.calcName === row.calcName && out.has(family.id)) out.set(row.id, { ...out.get(family.id)!, rule: "cosmetic" });
  }
  return { out, keysWithoutForm, keysNotGenerated };
}

const strength = (move: { power: number | string | null; accuracy: number | null }) => (typeof move.power === "number" && move.power > 0 ? move.power : 0) * (move.accuracy ?? 100);
const rounded = (value: number) => Math.round(value * 1e9);

/**
 * Up to four legal damaging moves by how often the generator gave them to this form (each source key's
 * share of its sets, keys weighted equally), then STAB, power x accuracy and id. A form never gets two
 * Hidden Powers (the generator's own rule). Generated moves this form cannot know are dropped and reported.
 */
function rankMoves(species: CatalogSpecies, movesById: ReadonlyMap<string, CatalogMove>, sources: Source[]) {
  const legal = new Set(species.moves);
  const weight = new Map<string, number>();
  const dropped = new Set<string>();
  for (const source of sources) for (const [id, count] of Object.entries(source.moves)) {
    const move = movesById.get(id);
    if (!move || !legal.has(id)) { if (move?.category !== "Status") dropped.add(id); continue; }
    if (move.category === "Status") continue;
    weight.set(id, (weight.get(id) ?? 0) + count / source.n / sources.length);
  }
  const stab = (id: string) => species.types.includes(movesById.get(id)!.type) ? 1 : 0;
  const ranked = [...weight.keys()].sort((a, b) => rounded(weight.get(b)!) - rounded(weight.get(a)!) || stab(b) - stab(a)
    || strength(movesById.get(b)!) - strength(movesById.get(a)!) || compare(a, b));
  const moves: string[] = [];
  for (const id of ranked) {
    if (moves.length === 4) break;
    if (id.startsWith("hiddenpower") && moves.some((entry) => entry.startsWith("hiddenpower"))) continue;
    moves.push(id);
  }
  return { moves, dropped: [...dropped].sort(compare) };
}

/** Every generated key's damaging moves by their share of its sets, summed, then id: the format-wide fill order. */
function aggregateOf(movesById: ReadonlyMap<string, CatalogMove>, generated: GeneratedFormat, skip: readonly string[]): string[] {
  const sum = new Map<string, number>();
  for (const [key, entry] of Object.entries(generated.keys).sort(([a], [b]) => compare(a, b))) {
    if (skip.includes(key) || !entry.n) continue;
    for (const [id, count] of Object.entries(entry.moves)) {
      const move = movesById.get(id);
      if (!move || move.category === "Status") continue;
      sum.set(id, (sum.get(id) ?? 0) + count / entry.n);
    }
  }
  return [...sum.keys()].sort((a, b) => rounded(sum.get(b)!) - rounded(sum.get(a)!) || compare(a, b));
}

export type RandomBattleReport = Record<string, {
  path: string; generator: string; keys: number; rows: number; mapping: Record<string, number>;
  keysWithoutForm: string[]; keysNotGenerated: string[]; noDamagingMoves: string[]; illegalMovesDropped: { speciesId: string; moveIds: string[] }[];
}>;

/** The catalog's randomBattle block and its manifest report, from the profile's pinned set files and their generated sets. */
export function randomBattleCatalog(catalog: NativeCatalog, source: NativeSnapshot, profile: NativeProfile, files: readonly RandomBattleFile[], generated: readonly GeneratedFormat[]): { block: RandomBattle; report: RandomBattleReport } {
  const sourceById = new Map(source.species.map((row) => [row.id, row as SourceRow]));
  const speciesById = new Map(catalog.species.map((row) => [row.id, row]));
  const movesById = new Map(catalog.moves.map((move) => [move.id, move]));
  const formats: Partial<Record<Format, RandomBattleFormat>> = {};
  const report: RandomBattleReport = {};
  for (const [format, path] of Object.entries(profile.randomBattleSets) as [Format, string][]) {
    const file = files.find((entry) => entry.path === path);
    const generatorFormat = (profile.randomBattleFormats as Partial<Record<Format, string>>)[format];
    const run = generated.find((entry) => entry.format === generatorFormat);
    if (!file || !run) throw new Error(`Missing pinned Random Battle sets or generated teams for ${path}.`);
    const { out, keysWithoutForm, keysNotGenerated } = mapSpecies(catalog, speciesById, sourceById, file.sets, run, profile.gen);
    const species: Record<string, string[]> = {};
    const mapping: Record<string, number> = {};
    const noDamagingMoves: string[] = [];
    const illegalMovesDropped: { speciesId: string; moveIds: string[] }[] = [];
    for (const row of [...catalog.species].sort((a, b) => compare(a.id, b.id))) {
      const mapped = out.get(row.id);
      if (!mapped) continue;
      mapping[mapped.rule] = (mapping[mapped.rule] ?? 0) + 1;
      const ranked = rankMoves(row, movesById, mapped.sources);
      if (ranked.dropped.length) illegalMovesDropped.push({ speciesId: row.id, moveIds: ranked.dropped });
      if (ranked.moves.length) species[row.id] = ranked.moves;
      else noDamagingMoves.push(row.id);
    }
    formats[format] = { file: path, species, aggregate: aggregateOf(movesById, run, keysWithoutForm) };
    report[format] = {
      path, generator: `${run.format}, seed ${run.seed}, ${run.teams} teams (${run.errors} failed)`,
      keys: Object.keys(file.sets).length, rows: Object.keys(species).length,
      mapping: Object.fromEntries(Object.entries(mapping).sort(([a], [b]) => compare(a, b))),
      keysWithoutForm, keysNotGenerated, noDamagingMoves, illegalMovesDropped,
    };
  }
  return { block: { formats }, report };
}
