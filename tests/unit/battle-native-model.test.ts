import { describe, expect, it } from "vitest";
import { Pokemon } from "@smogon/calc";
import usum from "@/data/battle/ultra_sun_ultra_moon/catalog.json";
import swsh from "@/data/battle/sword_shield/catalog.json";
import sv from "@/data/battle/scarlet_violet/catalog.json";
import { championsRuntime, createBattleRuntime } from "@/app/lib/battle/runtime";
import { createBuild, createConditions, getBuildStats, NATURES, validateBuild, validateConditions } from "@/app/lib/battle/model";
import { getBuildHealth } from "@/app/lib/battle/health";
import type { BattleBuild, NativeBattleGame, NativeBuild, NativeCatalog } from "@/app/lib/battle/types";

const runtimes = {
  ultra_sun_ultra_moon: createBattleRuntime(usum as NativeCatalog, "1".repeat(64)),
  sword_shield: createBattleRuntime(swsh as NativeCatalog, "2".repeat(64)),
  scarlet_violet: createBattleRuntime(sv as NativeCatalog, "3".repeat(64)),
};
function native(game: NativeBattleGame, id = "charizard"): NativeBuild {
  const build = createBuild(id, runtimes[game]);
  if (build.game === "champions") throw new Error("Native fixture required");
  return build;
}

describe("native build boundaries and statistics", () => {
  it.each(Object.keys(runtimes) as NativeBattleGame[])("starts %s with real level-50 native training, never reverse-converted points", (game) => {
    const build = native(game);
    expect(build).toMatchObject({ game, native: { level: 50, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } } });
    expect(build).not.toHaveProperty("points");
    expect(build.mechanic).toBeUndefined();
    expect(validateBuild(build, runtimes[game])).toEqual([]);
    // Independently: floor((2*78 +31)*50/100)+50+10=153 HP.
    expect(getBuildStats(build, runtimes[game])).toEqual({ hp: 153, atk: 104, def: 98, spa: 129, spd: 105, spe: 120 });
  });

  it("uses all native levels, IVs, EV floors and natures", () => {
    const runtime = runtimes.ultra_sun_ultra_moon;
    const build = native("ultra_sun_ultra_moon");
    build.native.level = 100;
    build.native.ivs.atk = 0;
    build.native.evs = { hp: 6, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 };
    build.nature = "Timid";
    expect(getBuildStats(build, runtime)).toEqual({ hp: 298, atk: 155, def: 192, spa: 317, spd: 206, spe: 328 });
    for (const level of [1, 50, 100]) for (const nature of NATURES) {
      build.native.level = level;
      build.nature = nature.name;
      expect(getBuildStats(build, runtime)).toEqual(new Pokemon(7, "Charizard", { level, nature: nature.name, evs: { hp: 6, spa: 252, spe: 252 }, ivs: { atk: 0 } }).rawStats);
    }
  });

  it("keeps invalid and unfinished native input representable, without engine defaults or clamps", () => {
    const runtime = runtimes.sword_shield;
    for (const value of [null, -1, 101, 1.5, NaN, Infinity]) {
      const build = native("sword_shield");
      build.native.level = value;
      expect(validateBuild(build, runtime)).toEqual(expect.arrayContaining([expect.objectContaining({ field: "native.level" })]));
      expect(getBuildStats(build, runtime)).toBeNull();
      expect(build.native.level).toBe(value);
    }
    const build = native("sword_shield");
    build.native.evs.hp = 253;
    build.native.ivs.spe = null;
    expect(validateBuild(build, runtime).map((issue) => issue.field)).toEqual(expect.arrayContaining(["native.evs.hp", "native.ivs.spe"]));
    expect(getBuildStats(build, runtime)).toBeNull();
    build.native.evs = { hp: 6, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 };
    build.native.ivs.spe = 31;
    expect(validateBuild(build, runtime)).toEqual([]);
    build.native.evs.hp = 7;
    expect(validateBuild(build, runtime)).toContainEqual(expect.objectContaining({ field: "native.evs" }));
  });

  it("rejects cross-profile and forged mixed-training builds", () => {
    const build = native("sword_shield");
    expect(validateBuild(build).map((issue) => issue.field)).toContain("game");
    expect(getBuildStats(build)).toBeNull();
    expect(validateBuild(build, runtimes.scarlet_violet).map((issue) => issue.field)).toContain("game");
    const forged = { ...build, points: createBuild().points } as unknown as BattleBuild;
    expect(validateBuild(forged, runtimes.sword_shield).map((issue) => issue.field)).toContain("points");
    expect(getBuildStats(forged, runtimes.sword_shield)).toBeNull();
    const wrongKind = { ...createBuild(), native: build.native } as unknown as BattleBuild;
    expect(validateBuild(wrongKind).map((issue) => issue.field)).toContain("native");
  });

  it("retains foreign configuration without activating it or changing Champions stats", () => {
    const build = createBuild();
    const baseline = getBuildStats(build);
    build.configuration = { teraType: "Fighting", gigantamax: true, dynamaxLevel: 3, happiness: 0, gender: "F" };
    expect(validateBuild(build)).toEqual([]);
    expect(getBuildStats(build)).toEqual(baseline);
    for (const mechanic of ["tera", "dynamax", "gigantamax"] as const) {
      build.mechanic = mechanic;
      expect(validateBuild(build).map((issue) => issue.field)).toContain("mechanic");
    }
  });

  it("validates configuration ranges, fixed gender and applicable Gmax species eligibility", () => {
    const build = native("sword_shield", "zacian");
    build.configuration = { gender: "M", teraType: "Typeless", happiness: 256, dynamaxLevel: -1, gigantamax: true };
    expect(validateBuild(build, runtimes.sword_shield).map((issue) => issue.field)).toEqual(expect.arrayContaining([
      "configuration.gender", "configuration.teraType", "configuration.happiness", "configuration.dynamaxLevel", "configuration.gigantamax",
    ]));
    build.configuration = {};
    build.mechanic = "dynamax";
    expect(validateBuild(build, runtimes.sword_shield)).toContainEqual(expect.objectContaining({ field: "mechanic", message: expect.stringContaining("cannot Dynamax") }));
  });

  it("requires the stored Gigantamax factor to agree with the explicit activation", () => {
    const runtime = runtimes.sword_shield;
    const build = native("sword_shield");
    build.configuration = { gigantamax: true };
    expect(validateBuild(build, runtime)).toEqual([]);
    build.mechanic = "dynamax";
    expect(validateBuild(build, runtime)).toContainEqual(expect.objectContaining({ field: "mechanic", message: expect.stringContaining("Gigantamax factor requires Gigantamax") }));
    expect(getBuildHealth(build, runtime)?.reason).toContain("Remove the factor");
    expect(build.mechanic).toBe("dynamax");
    build.mechanic = "gigantamax";
    expect(validateBuild(build, runtime)).toEqual([]);
    build.configuration.gigantamax = false;
    expect(validateBuild(build, runtime)).toContainEqual(expect.objectContaining({ field: "mechanic", message: expect.stringContaining("factor explicitly enabled") }));
    build.mechanic = "dynamax";
    expect(validateBuild(build, runtime)).toEqual([]);
  });

  it("requires proof of Rayquaza's equipped move, rejects its Z-Crystal, and accepts exact Ultra/Primal requirements", () => {
    const runtime = runtimes.ultra_sun_ultra_moon;
    const rayquaza = native("ultra_sun_ultra_moon", "rayquazamega");
    expect(validateBuild(rayquaza, runtime).map((issue) => issue.field)).toContain("preparedMoves");
    rayquaza.preparedMoves = ["dragonascent"];
    expect(validateBuild(rayquaza, runtime)).toEqual([]);
    rayquaza.itemId = "flyiniumz";
    expect(validateBuild(rayquaza, runtime)).toContainEqual(expect.objectContaining({ field: "itemId", message: expect.stringContaining("Z-Crystal") }));
    for (const id of ["necrozmaultra", "groudonprimal", "kyogreprimal"]) {
      const build = native("ultra_sun_ultra_moon", id);
      expect(validateBuild(build, runtime)).toEqual([]);
      build.itemId = "";
      expect(validateBuild(build, runtime).map((issue) => issue.field)).toContain("itemId");
    }
  });

  it("does not mistake Yanmega's species name for a Mega form", () => {
    const build = native("scarlet_violet", "yanmega");
    expect(validateBuild(build, runtimes.scarlet_violet)).toEqual([]);
  });

  it("validates explicit innate IVs separately from effective Hyper Training IVs", () => {
    const build = native("ultra_sun_ultra_moon");
    const runtime = runtimes.ultra_sun_ultra_moon;
    build.native.innateIVs = { ...build.native.ivs, atk: 30 };
    expect(validateBuild(build, runtime).map((issue) => issue.field)).toContain("native.innateIVs.atk");
    build.native.level = 100;
    expect(validateBuild(build, runtime)).toEqual([]);
    build.native.ivs.atk = 29;
    expect(validateBuild(build, runtime).map((issue) => issue.field)).toContain("native.innateIVs.atk");
  });

  it("allows Hail versus Snow and primal weather only in their declared profiles", () => {
    for (const runtime of [championsRuntime, ...Object.values(runtimes)]) {
      for (const weather of ["", "Sun", "Rain", "Sand", "Hail", "Snow", "Harsh Sunshine", "Heavy Rain", "Strong Winds"] as const) {
        const issues = validateConditions({ ...createConditions(), weather }, runtime);
        expect(issues.length === 0, `${runtime.profile.id}/${weather}`).toBe(runtime.profile.weather.includes(weather));
      }
    }
  });

  it("keeps pre-Max current HP bounds even when transformed HP is larger", () => {
    const runtime = runtimes.sword_shield;
    const build = native("sword_shield");
    build.mechanic = "dynamax";
    expect(getBuildHealth(build, runtime)).toEqual({ baseMax: 153, baseCurrent: 153, max: 306, current: 306, reason: null });
    build.currentHP = 154;
    expect(validateBuild(build, runtime).map((issue) => issue.field)).toContain("currentHP");
    expect(getBuildHealth(build, runtime)).toMatchObject({ baseCurrent: 154, current: 308, reason: expect.stringContaining("1 to 153") });
    build.currentHP = 1;
    expect(validateBuild(build, runtime)).toEqual([]);
    expect(getBuildHealth(build, runtime)).toMatchObject({ baseCurrent: 1, current: 2 });
    expect(build.currentHP).toBe(1);
  });
});
