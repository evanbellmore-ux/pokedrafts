import { describe, expect, it } from "vitest";
import { Pokemon } from "@smogon/calc";
import { abilitiesById, speciesById } from "@/app/lib/battle/catalog";
import {
  createBuild, createConditions, getBuildStats, NATURES, parseIntegerInput,
  rankResults, validateBuild, validateConditions,
} from "@/app/lib/battle/model";
import type { MoveDamageResult } from "@/app/lib/battle/types";

function result(moveId: string, min: number | null, max: number | null): MoveDamageResult {
  return {
    moveId, kind: min === null ? "unsupported" : "calculated", min, max,
    minPercent: null, maxPercent: null, rolls: null, ohkoChance: null,
    description: "", assumptions: [], reason: null, hits: null,
  };
}

describe("Champions build model", () => {
  it("starts with a legal, uninvested level-50 build and doubles conditions", () => {
    const build = createBuild();
    expect(validateBuild(build)).toEqual([]);
    expect(getBuildStats(build)).toEqual({ hp: 153, atk: 104, def: 98, spa: 129, spd: 105, spe: 120 });
    const field = createConditions();
    expect(field.gameType).toBe("Doubles");
    expect(field.attackerSide).not.toBe(field.defenderSide);
  });

  it("strictly parses integers without accepting parseInt prefixes or nonfinite values", () => {
    expect(parseIntegerInput("32")).toBe(32);
    expect(parseIntegerInput("-6")).toBe(-6);
    for (const text of ["", " ", "1.5", "1e2", "32abc", "Infinity", "NaN", "9007199254740992"]) {
      expect(parseIntegerInput(text), text).toBeNull();
    }
  });

  it("accepts 32 per stat / 66 total, and rejects 33 or 67", () => {
    const build = createBuild();
    build.points = { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 };
    expect(validateBuild(build)).toEqual([]);
    build.points.hp = 3;
    expect(validateBuild(build)).toContainEqual(expect.objectContaining({ field: "points" }));
    build.points.hp = 1;
    build.points.spa = 33;
    expect(validateBuild(build)).toContainEqual(expect.objectContaining({ field: "points.spa" }));
  });

  it.each([null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid point value %s instead of calculating", (value) => {
    const build = createBuild();
    build.points.atk = value;
    expect(validateBuild(build)).toContainEqual(expect.objectContaining({ field: "points.atk" }));
    expect(getBuildStats(build)).toBeNull();
  });

  it("rounds nature after adding the Stat Points", () => {
    const build = createBuild();
    build.nature = "Timid";
    build.points = { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 };
    expect(getBuildStats(build)).toEqual({ hp: 155, atk: 93, def: 98, spa: 161, spd: 105, spe: 167 });
    for (const nature of NATURES) {
      build.nature = nature.name;
      expect(getBuildStats(build)).toEqual(new Pokemon(0, "Charizard", { nature: nature.name, evs: { hp: 2, spa: 32, spe: 32 } }).rawStats);
    }
  });

  it("checks current HP and stage bounds, with blank HP explicitly meaning full", () => {
    const build = createBuild();
    expect(build.currentHP).toBeNull();
    for (const value of [0, 154, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      build.currentHP = value;
      expect(validateBuild(build)).toContainEqual(expect.objectContaining({ field: "currentHP" }));
    }
    build.currentHP = 1;
    build.boosts.atk = -6;
    expect(validateBuild(build)).toEqual([]);
    build.boosts.atk = 6;
    expect(validateBuild(build)).toEqual([]);
    build.boosts.atk = 7;
    expect(validateBuild(build)).toContainEqual(expect.objectContaining({ field: "boosts.atk" }));
  });

  it("never treats arbitrary names, natures, abilities or items as valid", () => {
    expect(validateBuild(createBuild("madeupmon"))[0].field).toBe("speciesId");
    const build = createBuild();
    build.nature = "anything";
    build.abilityId = "levitate";
    build.itemId = "madeupitem";
    expect(validateBuild(build).map((issue) => issue.field)).toEqual(expect.arrayContaining(["nature", "abilityId", "itemId"]));
  });

  it("requires the exact Mega stone and resets dependent selection state", () => {
    const mega = createBuild("charizardmegax");
    expect(mega.itemId).toBe("charizarditex");
    expect(validateBuild(mega)).toEqual([]);
    mega.itemId = "choicespecs";
    expect(validateBuild(mega)).toContainEqual(expect.objectContaining({ field: "itemId" }));
    const regular = createBuild("blastoise");
    expect(regular.itemId).toBe("");
    expect(regular.currentHP).toBeNull();
    expect(regular.abilityActive).toBe(false);
  });

  it("blocks an unsupported optional ability without disabling supported builds", () => {
    const build = createBuild("greninja");
    expect(speciesById.get(build.speciesId)?.unsupported).toEqual([]);
    expect(validateBuild(build)).toEqual([]);
    build.abilityId = "battlebond";
    expect(abilitiesById.get("battlebond")?.unsupported.length).toBeGreaterThan(0);
    expect(validateBuild(build)).toContainEqual(expect.objectContaining({ field: "abilityId" }));
  });

  it("checks field options rather than accepting an arbitrary ruleset", () => {
    const field = createConditions();
    expect(validateConditions(field)).toEqual([]);
    field.weather = "Hail" as typeof field.weather;
    expect(validateConditions(field)).toContainEqual(expect.objectContaining({ field: "weather" }));
  });

  it("sorts calculated results deterministically and leaves unknown damage unranked", () => {
    const rows = [result("flamethrower", 30, 50), result("surf", 40, 45), result("pound", null, null)];
    expect(rankResults(rows).map((row) => row.moveId)).toEqual(["surf", "flamethrower", "pound"]);
    expect(rankResults(rows, "maximum").map((row) => row.moveId)).toEqual(["flamethrower", "surf", "pound"]);
    expect(rows[0].moveId).toBe("flamethrower");
    expect(rankResults([result("surf", 40, 50), result("flamethrower", 40, 50)]).map((row) => row.moveId)).toEqual(["flamethrower", "surf"]);
  });
});
