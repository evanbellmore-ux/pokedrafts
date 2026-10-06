import { describe, expect, it } from "vitest";
import { createBuild } from "@/app/lib/battle/model";
import { megaEntries } from "@/app/lib/battle/mega-forms";
import type { MoveSlots } from "@/app/lib/battle/move-defaults";
import {
  NO_MOVES, createSetLegality, hasProblems, memberKeys, sheetFromSets, toShowdownTeam, validateTeams,
} from "@/app/(app)/training/sim/showdown-set";
import { TeamValidator } from "@/app/(app)/training/sim/sim";
import type { TrainingMember } from "@/app/(app)/training/model/view-types";
import { AI_TEAM, PLAYER_TEAM, memberFromSet, runtime, suggestedMember } from "./training-sim-fixtures";
import { PLAYER } from "../../scripts/lib/showdown-sim/fixtures.mjs";

// SPEC §7.5 / §13.3: the team adapter, Showdown's validator, member keys and sheets.

const FORMAT = "gen9championsvgc2026regmc";
const validator = new TeamValidator(FORMAT);
const teamSize = (problem: string) => /at least 6|Min Team Size|You must bring/i.test(problem);

describe("toShowdownTeam", () => {
  it("sends Serious with 0 Stat Points as Hardy (team-validator.ts:1333-1335)", () => {
    const fresh: TrainingMember = { ...suggestedMember("garchomp"), build: createBuild("garchomp", runtime) };
    expect(fresh.build.nature).toBe("Serious");
    const [{ set }] = toShowdownTeam([fresh], runtime).sets;
    expect(set.nature).toBe("Hardy");
    expect(set.evs).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(set.ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
    expect(set.level).toBe(50);
  });

  it("sends Charizard-Mega-Y as Charizard holding Charizardite Y with a base ability", () => {
    expect(megaEntries("charizardmegay", runtime)[0]?.itemId).toBe("charizarditey");
    const member = suggestedMember("charizardmegay");
    const [{ set }] = toShowdownTeam([member], runtime).sets;
    expect(set.species).toBe("Charizard");
    expect(set.name).toBe("Charizard");
    expect(set.item).toBe("Charizardite Y");
    expect(runtime.speciesById.get("charizard")!.abilities.map((id) => runtime.abilitiesById.get(id)!.name)).toContain(set.ability);
    expect(validator.validateTeam([structuredClone(set)])?.filter((p) => !teamSize(p)) ?? []).toEqual([]);
  });

  it("reports a member without moves", () => {
    const empty = { moveId: null, origin: "empty" as const, gameType: null };
    const member: TrainingMember = { ...suggestedMember("garchomp"), moves: [empty, empty, empty, empty] as MoveSlots };
    const team = toShowdownTeam([member], runtime);
    expect(team.problems).toEqual({ garchomp: [NO_MOVES] });
  });

  it("never sends an empty gender (it would be rolled from the battle PRNG)", () => {
    for (const team of [PLAYER_TEAM, AI_TEAM]) {
      for (const { set } of toShowdownTeam(team.members, runtime).sets) expect(["M", "F", "N"]).toContain(set.gender);
    }
    const [{ set }] = toShowdownTeam([suggestedMember("rotomwash")], runtime).sets;
    expect(set.gender).toBe("N");
  });

  it("round-trips the probe teams exactly (species, item, ability, moves, nature, Stat Points)", () => {
    const sets = toShowdownTeam(PLAYER_TEAM.members, runtime).sets.map(({ set }) => set);
    expect(sets.map(({ name, species, item, ability, moves, nature, evs }) => ({ name, species, item, ability, moves, nature, evs })))
      .toEqual(PLAYER.map(({ name, species, item, ability, moves, nature, evs }) => ({ name, species, item, ability, moves, nature, evs })));
  });

  it("validates all but the move-less calculator suggested sets alone (probe: 388 of 389)", () => {
    let checked = 0, legal = 0, noMoves = 0;
    const other: string[] = [];
    for (const species of runtime.catalog.species) {
      if (species.battleForm && !megaEntries(species.id, runtime).length) continue;
      checked++;
      const team = toShowdownTeam([suggestedMember(species.id)], runtime);
      if (team.problems[species.id]) { noMoves++; continue; }
      const problems = (validator.validateTeam(structuredClone(team.sets.map(({ set }) => set))) ?? []).filter((p) => !teamSize(p));
      if (problems.length) other.push(`${species.id}: ${problems[0]}`);
      else legal++;
    }
    expect(other).toEqual([]);
    expect(checked).toBe(389);
    expect(legal).toBe(388);
    expect(noMoves).toBe(1);
  }, 60_000);
});

describe("validateTeams", () => {
  it("passes the probe teams and attributes problems to members by name, others to the team", () => {
    const own = toShowdownTeam(PLAYER_TEAM.members, runtime), opponent = toShowdownTeam(AI_TEAM.members, runtime);
    const clean = validateTeams(own, opponent, validator);
    expect(hasProblems(clean.own)).toBe(false);
    expect(hasProblems(clean.opponent)).toBe(false);

    const broken = PLAYER_TEAM.members.map((member) => member.key === "garchomp"
      ? { ...member, moves: [{ moveId: "spore", origin: "manual", gameType: null }, ...member.moves.slice(1)] as MoveSlots }
      : member.key === "kingambit" ? { ...member, build: { ...member.build, itemId: "lifeorb" } } : member);
    const result = validateTeams(toShowdownTeam(broken, runtime), opponent, validator);
    expect(result.own.members.garchomp?.some((problem) => problem.startsWith("Garchomp can't learn Spore"))).toBe(true);
    expect(result.own.team.some((problem) => /Item Clause/.test(problem))).toBe(true);
    expect(result.own.members.incineroar ?? []).toEqual([]);
  });

  it("validates on copies (the validator normalizes sets in place)", () => {
    const own = toShowdownTeam(PLAYER_TEAM.members, runtime);
    const before = JSON.stringify(own);
    validateTeams(own, own, validator);
    expect(JSON.stringify(own)).toBe(before);
  });
});

describe("memberKeys and sheets", () => {
  it("maps ident names to member keys per side", () => {
    const own = toShowdownTeam([memberFromSet(PLAYER[0], "league:1")], runtime);
    const opponent = toShowdownTeam([memberFromSet(PLAYER[0], "paste:a")], runtime);
    const keys = memberKeys(own, opponent);
    expect(keys.keyOf("p1", "Incineroar")).toBe("league:1");
    expect(keys.keyOf("p2", "Incineroar")).toBe("paste:a");
    expect(keys.speciesOf("p1", "league:1")).toBe("Incineroar");
  });

  it("sheetFromSets carries species as sent, fixed gender, nature, item, ability, moves and Stat Points", () => {
    const sheet = sheetFromSets(toShowdownTeam(PLAYER_TEAM.members, runtime));
    expect(sheet[1]).toEqual({
      key: "charizard", speciesId: "charizard", name: "Charizard", gender: "M", nature: "Modest", itemId: "charizarditey", abilityId: "blaze",
      moves: ["heatwave", "airslash", "solarbeam", "protect"], points: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
    });
  });
});

describe("createSetLegality", () => {
  const legality = createSetLegality(validator, runtime);
  it("lists every legal move of any category, from the validator", () => {
    const moves = legality.legalMoves("incineroar");
    for (const id of ["protect", "fakeout", "partingshot", "flareblitz", "willowisp", "snarl"]) expect(moves).toContain(id);
    expect(moves).not.toContain("spore");
    expect(legality.legalMoves("charizardmegay")).toContain("heatwave");
  });
  it("reports one set's problems verbatim", () => {
    expect(legality.problems({ speciesId: "incineroar", moves: ["fakeout", "protect"], itemId: "sitrusberry", abilityId: "intimidate", nature: "Careful", points: { hp: 32, atk: 2, def: 16, spa: 0, spd: 16, spe: 0 } })).toEqual([]);
    expect(legality.problems({ speciesId: "incineroar", moves: ["spore"], itemId: "", abilityId: "intimidate", nature: "Hardy", points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } })[0]).toMatch(/^Incineroar can't learn Spore/);
  });
});
