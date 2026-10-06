// Training members (calculator builds) → pinned Showdown sets, validation with Showdown's own validator, member keys,
// and the sheets each side sees (SPEC §7.5). Worker only.
import { megaEntries } from "@/app/lib/battle/mega-forms";
import { usualAbility } from "@/app/lib/battle/move-defaults";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleStat } from "@/app/lib/battle/types";
import type { FullSheetMember, StatPoints } from "../model/sheet";
import { showdownNature } from "../model/sets";
import type { SetLegality } from "../model/usage";
import type { ShowdownSet, SideID } from "../model/showdown-types";
import type { TeamProblems, TrainingMember } from "../model/view-types";
import type { MemberKeys } from "./choices";
import { Dex, FORMAT, toID, type ModdedDex, type TeamValidator } from "./sim";

export type AdaptedTeam = { sets: { key: string; set: ShowdownSet }[]; problems: Record<string, string[]> };

const STATS: readonly BattleStat[] = ["hp", "atk", "def", "spa", "spd", "spe"];
const IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } as const;
export const NO_MOVES = "Has no moves.";

let formatDex: ModdedDex | null = null;
function dex(): ModdedDex {
  formatDex ??= Dex.forFormat(FORMAT);
  return formatDex;
}

type SetFields = { speciesId: string; itemId: string; abilityId: string; nature: string; points: Partial<Record<BattleStat, number | null>> | null; moves: readonly string[]; gender?: "M" | "F" | "N" | null };

/** The species a form is sent as: a Mega as its base holding its stone (megaEntries[0]), a battle form as `changesFrom`. */
function sentAs(speciesId: string, runtime: BattleRuntime): { speciesId: string; stone: string | null } {
  const mega = megaEntries(speciesId, runtime)[0];
  if (mega) return { speciesId: mega.baseSpeciesId, stone: mega.itemId };
  const species = runtime.speciesById.get(speciesId);
  if (species?.battleForm && species.changesFrom) return { speciesId: toID(species.changesFrom), stone: null };
  return { speciesId, stone: null };
}

function showdownSet(fields: SetFields, runtime: BattleRuntime): ShowdownSet {
  const sent = sentAs(fields.speciesId, runtime);
  const species = runtime.speciesById.get(sent.speciesId);
  const name = species?.name ?? dex().species.get(sent.speciesId).name ?? sent.speciesId;
  // A Mega's own ability is not the base's: the base's usual Doubles ability instead (SPEC 7.5).
  const abilityId = sent.speciesId !== fields.speciesId && species && !species.abilities.includes(fields.abilityId)
    ? usualAbility(sent.speciesId, "Doubles", runtime) ?? species.abilities[0] ?? fields.abilityId
    : fields.abilityId;
  const itemId = sent.stone ?? fields.itemId;
  const fixed = dex().species.get(name).gender;
  // An empty gender is rolled from the battle PRNG at construction (spec/belief-battle-probe.mjs): always fix it.
  const gender: "M" | "F" | "N" = fixed === "M" || fixed === "F" || fixed === "N" ? fixed : fields.gender ?? "M";
  const evs = Object.fromEntries(STATS.map((stat) => [stat, fields.points?.[stat] ?? 0])) as Record<BattleStat, number>;
  return {
    name, species: name,
    item: itemId ? runtime.itemsById.get(itemId)?.name ?? itemId : "",
    ability: runtime.abilitiesById.get(abilityId)?.name ?? abilityId,
    moves: [...new Set(fields.moves)].map((id) => runtime.movesById.get(id)?.name ?? id),
    nature: fields.nature,
    gender, evs, ivs: { ...IVS }, level: 50,
  };
}

/** One Showdown set per member, in team order; "Has no moves." for a member without moves. */
export function toShowdownTeam(members: readonly TrainingMember[], runtime: BattleRuntime): AdaptedTeam {
  const problems: Record<string, string[]> = {};
  const sets = members.map((member) => {
    const build = showdownNature(member.build);
    const moves = member.moves.map((slot) => slot.moveId).filter((id): id is string => !!id);
    if (!moves.length) problems[member.key] = [NO_MOVES];
    const set = showdownSet({
      speciesId: member.speciesId, itemId: build.itemId, abilityId: build.abilityId, nature: build.nature,
      points: build.game === "champions" ? build.points : null, moves, gender: build.configuration?.gender ?? null,
    }, runtime);
    return { key: member.key, set };
  });
  return { sets, problems };
}

const isTeamSize = (problem: string) => /at least 6|Min Team Size|You must bring/i.test(problem);

/** Showdown's problems, verbatim, split by member (a problem starting with the set's name) and team. */
function attribute(team: AdaptedTeam, problems: readonly string[], includeTeamSize: boolean): TeamProblems {
  const result: TeamProblems = { team: [], members: {} };
  for (const [key, list] of Object.entries(team.problems)) result.members[key] = [...list];
  for (const problem of problems) {
    if (!includeTeamSize && isTeamSize(problem)) continue;
    const owner = team.sets.find(({ set }) => problem.startsWith(`${set.name}'s `) || problem.startsWith(`${set.name} `));
    if (owner) (result.members[owner.key] ??= []).push(problem);
    else result.team.push(problem);
  }
  return result;
}

/** Validates both teams on copies (the validator normalizes sets in place). */
export function validateTeams(own: AdaptedTeam, opponent: AdaptedTeam, validator: TeamValidator): { own: TeamProblems; opponent: TeamProblems } {
  const check = (team: AdaptedTeam) => attribute(team, validator.validateTeam(structuredClone(team.sets.map(({ set }) => set))) ?? [], true);
  return { own: check(own), opponent: check(opponent) };
}

export const hasProblems = (problems: TeamProblems) => problems.team.length > 0 || Object.values(problems.members).some((list) => list.length > 0);

/**
 * Showdown ident names ↔ member keys (Nickname Clause: the name is the species name; Species Clause makes it unique).
 * p1 = your team (own), p2 = the AI's (opponent).
 */
export function memberKeys(own: AdaptedTeam, opponent: AdaptedTeam): MemberKeys {
  const teams: Record<SideID, AdaptedTeam> = { p1: own, p2: opponent };
  const byName: Record<SideID, (name: string) => string | null> = { p1: teamKeyOf(own), p2: teamKeyOf(opponent) };
  return {
    keyOf: (side, name) => byName[side](name) ?? `?${name}`,
    speciesOf: (side, key) => teams[side].sets.find((entry) => entry.key === key)?.set.species ?? key,
  };
}

/** One team's ident names → member keys (memberKeys for one side). */
export function teamKeyOf(team: AdaptedTeam): (name: string) => string | null {
  const byName = new Map<string, string>();
  for (const { key, set } of team.sets) {
    // A set named as its species battles under its base species' name (pinned sim/pokemon.ts:329-334): "Rotom" for Rotom-Wash.
    for (const name of [set.name, dex().species.get(set.species).baseSpecies]) {
      byName.set(name, key);
      byName.set(toID(name), key);
    }
  }
  return (name) => byName.get(name) ?? byName.get(toID(name)) ?? null;
}

/** The sheet of a team as its own side knows it, from the Showdown sets (species as sent, fixed gender, Stat Points). */
export function sheetFromSets(team: AdaptedTeam): FullSheetMember[] {
  return team.sets.map(({ key, set }) => ({
    key, speciesId: toID(set.species), name: set.name, gender: set.gender,
    nature: set.nature, itemId: toID(set.item), abilityId: toID(set.ability), moves: set.moves.map(toID),
    points: Object.fromEntries(STATS.map((stat) => [stat, set.evs[stat] ?? 0])) as StatPoints,
  }));
}

/**
 * SetLegality (model/usage.ts) backed by the bundled validator: one-move checks over the species' Showdown move pool
 * (cached per species), and one set's problems. A Mega or battle form answers as the set it is sent as.
 */
export function createSetLegality(validator: TeamValidator, runtime: BattleRuntime): SetLegality {
  const cache = new Map<string, readonly string[]>();
  const validate = (fields: SetFields) => (validator.validateTeam([showdownSet(fields, runtime)]) ?? []).filter((problem) => !isTeamSize(problem));
  return {
    legalMoves(speciesId) {
      const known = cache.get(speciesId);
      if (known) return known;
      const sent = sentAs(speciesId, runtime);
      const species = runtime.speciesById.get(sent.speciesId);
      const abilityId = usualAbility(sent.speciesId, "Doubles", runtime) ?? species?.abilities[0] ?? "";
      const pool = [...dex().species.getMovePool(sent.speciesId)].filter((id) => runtime.movesById.has(id)).sort();
      const legal = pool.filter((moveId) => validate({ speciesId, itemId: sent.stone ?? "", abilityId, nature: "Hardy", points: null, moves: [moveId] }).length === 0);
      cache.set(speciesId, legal);
      return legal;
    },
    problems(set) {
      return validate({ speciesId: set.speciesId, itemId: set.itemId, abilityId: set.abilityId, nature: set.nature, points: set.points, moves: set.moves });
    },
  };
}
