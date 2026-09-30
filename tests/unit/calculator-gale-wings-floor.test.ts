import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";

/**
 * Gale Wings' +1 priority and the Tera/Stellar 60-power floor, against real pinned Showdown c23d2e94
 * lead battles (scripts/.cache/calc-audit/oos/galewings-floor/repro.ts, verify.ts): Showdown's floor
 * reads the dex move's priority (battle-actions.ts getDamage dexMove.priority), so the raise that
 * Queenly Majesty, Dazzling, Armor Tail and Psychic Terrain see leaves the floor on.
 */
const sv = await loadBattleRuntime("scarlet_violet");
function build(id: string, extra: Partial<BattleBuild> = {}): BattleBuild {
  const base = createBuild(id, sv);
  return { ...base, ...extra } as BattleBuild;
}
function talonflame(extra: Partial<BattleBuild> = {}, teraType = "Flying"): BattleBuild {
  const base = createBuild("talonflame", sv);
  return {
    ...base, abilityId: "galewings", itemId: "", mechanic: "tera",
    configuration: { ...base.configuration, teraType },
    native: { ...base.native!, evs: { ...base.native!.evs, atk: 252 } },
    ...extra,
  } as BattleBuild;
}
function row(moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, context?: MoveContext) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, sv);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

describe("Gale Wings and the Tera 60-power floor", () => {
  const snorlax = build("snorlax");
  it("keeps the floor for a Tera Flying Gale Wings user's weak Flying moves", () => {
    expect(row("peck", talonflame(), snorlax)).toMatchObject({ kind: "calculated", effectivePower: 60, min: 72, max: 86 });
    expect(row("acrobatics", talonflame({ itemId: "leftovers" }), snorlax)).toMatchObject({ effectivePower: 60, min: 72, max: 86 });
    // Already at or over 60: no change.
    expect(row("acrobatics", talonflame(), snorlax)).toMatchObject({ effectivePower: 110, min: 130, max: 154 });
    expect(row("acrobatics", talonflame({ itemId: "sharpbeak" }), snorlax)).toMatchObject({ min: 78, max: 94 });
    // Fletchinder too.
    const fletchinder = { ...talonflame(), speciesId: "fletchinder" } as BattleBuild;
    expect(row("peck", fletchinder, snorlax)).toMatchObject({ min: 68, max: 80 });
    // Controls: the same numbers as a user without the raise (not at full HP, or Flame Body).
    expect(row("peck", talonflame({ currentHP: 1 }), snorlax)).toMatchObject({ min: 72, max: 86 });
    expect(row("peck", talonflame({ abilityId: "flamebody" }), snorlax)).toMatchObject({ min: 72, max: 86 });
    // Tera Fire: Peck is no longer the user's type, so there is no floor.
    expect(row("peck", talonflame({}, "Fire"), snorlax)).toMatchObject({ effectivePower: 35, min: 33, max: 39 });
    // Doubles (Peck has one target).
    expect(row("peck", talonflame(), snorlax, { gameType: "Doubles" })).toMatchObject({ min: 72, max: 86 });
  });

  it("keeps the floor on a Stellar first use only", () => {
    const stellar = talonflame({}, "Stellar");
    expect(row("peck", stellar, snorlax, {}, { stellarFirstUse: true })).toMatchObject({ effectivePower: 60, min: 72, max: 86 });
    expect(row("peck", stellar, snorlax, {}, { stellarFirstUse: false })).toMatchObject({ effectivePower: 35, min: 33, max: 39 });
    expect(row("acrobatics", talonflame({ itemId: "leftovers" }, "Stellar"), snorlax, {}, { stellarFirstUse: true })).toMatchObject({ min: 72, max: 86 });
    expect(row("acrobatics", talonflame({ itemId: "leftovers" }, "Stellar"), snorlax, {}, { stellarFirstUse: false })).toMatchObject({ min: 49, max: 58 });
  });

  it("still lets the raised priority be blocked, and keeps the floor when nothing blocks it", () => {
    for (const [id, abilityId] of [["tsareena", "queenlymajesty"], ["farigiraf", "armortail"], ["bruxish", "dazzling"]] as const) {
      expect(row("peck", talonflame(), build(id, { abilityId }))).toMatchObject({ kind: "calculated", min: 0, max: 0 });
    }
    expect(row("peck", talonflame({ currentHP: 1 }), build("tsareena", { abilityId: "queenlymajesty" }))).toMatchObject({ min: 104, max: 124 });
    expect(row("peck", talonflame(), snorlax, { terrain: "Psychic" })).toMatchObject({ min: 0, max: 0 });
    expect(row("peck", talonflame({}, "Stellar"), snorlax, { terrain: "Psychic" }, { stellarFirstUse: true })).toMatchObject({ min: 0, max: 0 });
    // Airborne targets are not protected by Psychic Terrain, so the floor applies.
    expect(row("peck", talonflame(), build("corviknight"), { terrain: "Psychic" })).toMatchObject({ effectivePower: 60, min: 25, max: 30 });
    expect(row("peck", talonflame(), build("bronzong", { abilityId: "levitate" }), { terrain: "Psychic" })).toMatchObject({ min: 22, max: 27 });
    expect(row("peck", talonflame(), build("snorlax", { itemId: "airballoon" }), { terrain: "Psychic" })).toMatchObject({ min: 72, max: 86 });
    expect(row("peck", talonflame(), build("charizard"), { terrain: "Psychic" })).toMatchObject({ min: 62, max: 74 });
    expect(row("peck", talonflame(), build("charizard"), { terrain: "Psychic", gravity: true })).toMatchObject({ min: 0, max: 0 });
    expect(row("peck", talonflame({}, "Stellar"), build("corviknight"), { terrain: "Psychic" }, { stellarFirstUse: true })).toMatchObject({ min: 25, max: 30 });
  });

  it("leaves Grassy Glide unchanged: Grassy Terrain's boost already lifts it over 60", () => {
    const rillaboom = (teraType: string, extra: Partial<BattleBuild> = {}) => {
      const base = createBuild("rillaboom", sv);
      return { ...base, abilityId: "grassysurge", mechanic: "tera", configuration: { ...base.configuration, teraType }, native: { ...base.native!, evs: { ...base.native!.evs, atk: 252 } }, ...extra } as BattleBuild;
    };
    expect(row("grassyglide", rillaboom("Grass"), snorlax, { terrain: "Grassy" })).toMatchObject({ effectivePower: 55, min: 112, max: 134 });
    expect(row("grassyglide", rillaboom("Stellar"), snorlax, { terrain: "Grassy" }, { stellarFirstUse: true })).toMatchObject({ min: 112, max: 134 });
    expect(row("grassyglide", rillaboom("Grass", { itemId: "airballoon" }), snorlax, { terrain: "Grassy" })).toMatchObject({ effectivePower: 60, min: 94, max: 112 });
    expect(row("grassyglide", rillaboom("Grass", { abilityId: "overgrow" }), snorlax)).toMatchObject({ effectivePower: 60, min: 94, max: 112 });
    expect(row("grassyglide", rillaboom("Grass"), build("farigiraf", { abilityId: "armortail" }), { terrain: "Grassy" })).toMatchObject({ min: 0, max: 0 });
  });
});

describe("Triage and Hidden Power priority", () => {
  // Real lead battles (oos/galewings-floor/repro.ts section F, typed.ts).
  it("gives Triage's draining moves +3, which priority shields block, while the Tera floor still applies", () => {
    const comfey = (extra: Partial<BattleBuild> = {}) => {
      const base = createBuild("comfey", sv);
      return { ...base, abilityId: "triage", itemId: "", native: { ...base.native!, evs: { ...base.native!.evs, spa: 252 } }, ...extra } as BattleBuild;
    };
    expect(row("drainingkiss", comfey(), build("snorlax"), { terrain: "Psychic" })).toMatchObject({ kind: "calculated", min: 0, max: 0 });
    expect(row("drainingkiss", comfey(), build("farigiraf", { abilityId: "armortail" }))).toMatchObject({ kind: "calculated", min: 0, max: 0 });
    const teraFairy = comfey({ mechanic: "tera", configuration: { ...createBuild("comfey", sv).configuration, teraType: "Fairy" } });
    expect(row("drainingkiss", teraFairy, build("snorlax"))).toMatchObject({ effectivePower: 60, min: 48, max: 58 });
  });

  it("does not raise Hidden Power with Gale Wings, as Showdown queues it as the Normal dex move (Ultra Sun/Ultra Moon)", async () => {
    const usum = await loadBattleRuntime("ultra_sun_ultra_moon");
    const base = createBuild("talonflame", usum);
    if (base.game === "champions") throw new Error("native build expected");
    const flying = { ...base, abilityId: "galewings", itemId: "", native: { ...base.native, evs: { ...base.native.evs, atk: 252, spa: 252 }, ivs: { hp: 30, atk: 30, def: 30, spa: 30, spd: 30, spe: 31 } } } as BattleBuild;
    const hit = (moveId: string, defender: BattleBuild, field: Partial<BattleConditions> = {}) => {
      const out = calculateMatchup(flying, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, usum);
      expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
      return out.results.find((result) => result.moveId === moveId)!;
    };
    for (const moveId of ["hiddenpower", "hiddenpowerflying"]) {
      expect(hit(moveId, { ...createBuild("tsareena", usum), abilityId: "queenlymajesty" } as BattleBuild)).toMatchObject({ effectiveType: "Flying", min: 72, max: 86 });
      expect(hit(moveId, createBuild("snorlax", usum), { terrain: "Psychic" })).toMatchObject({ min: 33, max: 40 });
    }
  });
});
