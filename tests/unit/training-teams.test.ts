import { describe, expect, it } from "vitest";
import { megaEntries } from "@/app/lib/battle/mega-forms";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import { TeamValidator } from "@/app/(app)/training/sim/sim";
import { FORMAT } from "@/app/(app)/training/sim/sim";
import { toShowdownTeam, validateTeams } from "@/app/(app)/training/sim/showdown-set";
import { MEGA_POSITIONS, TEAM_FIXTURES, fixturePaste, fixturesIn, fixtureTeam, positionTeam, type TeamFixture } from "@/tests/fixtures/training-teams";

// SPEC §14.1: every Training fixture team is legal under the bundled pinned validator and parses as a Champions paste.
const validator = new TeamValidator(FORMAT);
const moveIds = (fixture: TeamFixture) => fixtureTeam(fixture).members.map((member) => member.moves.flatMap((slot) => slot.moveId ? [slot.moveId] : []));
const megaCapable = (fixture: TeamFixture) => fixtureTeam(fixture).members.filter((member) =>
  megaEntries(member.speciesId, runtime).length > 0
  || runtime.catalog.items.find((item) => item.id === member.build.itemId)?.megaTargets.some((target) => target.baseSpeciesId === member.speciesId));

describe("training team fixtures (SPEC §14.1)", () => {
  it("has the five pools at their sizes", () => {
    expect(fixturesIn(["S"])).toHaveLength(12);
    expect(fixturesIn(["V"])).toHaveLength(12);
    expect(fixturesIn(["U"])).toHaveLength(6);
    expect(fixturesIn(["A"])).toHaveLength(8);
    expect(fixturesIn(["E"])).toHaveLength(2);
    expect(new Set(TEAM_FIXTURES.map((fixture) => fixture.id)).size).toBe(TEAM_FIXTURES.length);
  });

  it.each(TEAM_FIXTURES.map((fixture) => [fixture.id, fixture] as const))("%s: six members, distinct species and items", (_id, fixture) => {
    const team = fixtureTeam(fixture);
    expect(team.members).toHaveLength(6);
    expect(new Set(team.members.map((member) => member.key)).size).toBe(6);
    expect(new Set(team.members.map((member) => member.speciesId)).size).toBe(6);
    const items = team.members.map((member) => member.build.itemId).filter(Boolean);
    expect(new Set(items).size).toBe(items.length);
    // SPEC C15: no member reaches the validator as Serious with 0 Stat Points.
    for (const member of team.members) {
      const total = member.build.game === "champions" ? Object.values(member.build.points).reduce<number>((sum, value) => sum + (value ?? 0), 0) : 1;
      expect(member.build.nature === "Serious" && total === 0).toBe(false);
    }
  });

  it.each(TEAM_FIXTURES.map((fixture) => [fixture.id, fixture] as const))("%s: 0 problems from the bundled TeamValidator", (_id, fixture) => {
    const adapted = toShowdownTeam(fixtureTeam(fixture).members, runtime);
    const { own } = validateTeams(adapted, adapted, validator);
    expect(own.team).toEqual([]);
    expect(Object.values(own.members).flat()).toEqual([]);
  });

  it.each(TEAM_FIXTURES.filter((fixture) => fixture.pool !== "S").map((fixture) => [fixture.id, fixture] as const))("%s: parses with parseTeamImport(…, \"champions\")", (_id, fixture) => {
    const team = parseTeamImport(fixturePaste(fixture)!, "champions", runtime);
    expect(team.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(team.members).toHaveLength(6);
    for (const member of team.members) {
      expect(member.selectable).toBe(true);
      expect(member.diagnostics.filter((entry) => entry.severity !== "info")).toEqual([]);
    }
  });

  it("Pool S is the calculator's suggestion: Hardy, 0 Stat Points, damaging moves only", () => {
    for (const fixture of fixturesIn(["S"])) {
      for (const member of fixtureTeam(fixture).members) {
        expect(member.build.nature).toBe("Hardy");
        expect(member.build.game === "champions" && Object.values(member.build.points).every((value) => !value)).toBe(true);
        for (const slot of member.moves) if (slot.moveId) expect(runtime.movesById.get(slot.moveId)?.category).not.toBe("Status");
      }
    }
  });

  it("Pool V covers the SPEC §14.1 behaviours", () => {
    const pool = fixturesIn(["V"]);
    const all = pool.flatMap(moveIds);
    const users = (moveId: string) => all.filter((moves) => moves.includes(moveId)).length;
    expect(all.filter((moves) => moves.includes("protect") || moves.includes("detect") || moves.includes("spikyshield")).length / all.length).toBeGreaterThan(0.75);
    for (const moveId of ["fakeout", "tailwind", "trickroom", "sleeppowder", "willowisp", "thunderwave"]) expect(users(moveId), moveId).toBeGreaterThan(0);
    expect(users("followme") + users("ragepowder")).toBeGreaterThan(0);
    const abilities = pool.flatMap((fixture) => fixtureTeam(fixture).members.map((member) => member.build.abilityId));
    for (const abilityId of ["intimidate", "drought", "drizzle", "sandstream", "psychicsurge"]) expect(abilities, abilityId).toContain(abilityId);
    // Snow comes from Mega Froslass (Snow Warning on Mega Evolution).
    expect(pool.some((fixture) => fixtureTeam(fixture).members.some((member) => member.build.itemId === "froslassite"))).toBe(true);
    for (const fixture of pool) expect(megaCapable(fixture), fixture.id).toHaveLength(1);
  });

  it("Pool U has Tailwind, Trick Room, Follow Me and Rage Powder users and a Mega-capable member on every team (A1.4)", () => {
    const pool = fixturesIn(["U"]);
    const all = pool.flatMap(moveIds);
    for (const moveId of ["tailwind", "trickroom", "followme", "ragepowder"]) expect(all.some((moves) => moves.includes(moveId)), moveId).toBe(true);
    for (const fixture of pool) expect(megaCapable(fixture).length, fixture.id).toBeGreaterThan(0);
    // A1.2 Protect rule: Protect on every member that learns it unless it holds Choice Scarf.
    for (const fixture of pool) {
      for (const member of fixtureTeam(fixture).members) {
        const learns = runtime.speciesById.get(member.speciesId)?.moves.includes("protect");
        const moves = member.moves.map((slot) => slot.moveId);
        if (learns && member.build.itemId !== "choicescarf") expect(moves, `${fixture.id} ${member.speciesId}`).toContain("protect");
      }
    }
  });

  it.each(MEGA_POSITIONS.map((position) => [position.id, position] as const))("Mega position %s: both sides legal, one Mega-capable AI member (A1.5)", (_id, position) => {
    for (const side of ["ai", "player"] as const) {
      const team = positionTeam(position, side);
      expect(team.members).toHaveLength(6);
      const adapted = toShowdownTeam(team.members, runtime);
      const { own } = validateTeams(adapted, adapted, validator);
      expect([...own.team, ...Object.values(own.members).flat()], `${position.id} ${side}`).toEqual([]);
    }
    expect(megaCapable({ id: position.id, pool: "V", sets: position.ai })).toHaveLength(1);
  });
});
