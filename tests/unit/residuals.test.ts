import { describe, expect, it } from "vitest";
import {
  badDreamsDamage, bigRoot, leechSeedDamage, ownResiduals, RESIDUAL_KEYS, weatherResiduals, type ResidualId, type ResidualMon,
} from "@/app/lib/battle/residuals";

/**
 * The shared end-of-turn rules (status-eot SPEC §4.8; pinned Showdown c23d2e94 data/conditions.ts, data/moves.ts,
 * data/abilities.ts, data/items.ts, data/mods/champions). A 235-HP Pokémon (Snorlax at level 50): 1/16 = 14, 1/8 = 29,
 * 1/4 = 58, 1/6 = 39.
 */
const mon = (extra: Partial<ResidualMon> = {}): ResidualMon => ({
  baseMaxHP: 235, types: ["Normal"], ability: "thickfat", item: "", status: "", toxicStage: 0, grounded: true, semiInvulnerable: false, sheltered: false, ...extra,
});
const amounts = (list: { id: ResidualId; amount: number }[]) => list.map(({ id, amount }) => [id, amount]);
const own = (extra: Partial<ResidualMon>, terrain: "" | "Grassy" = "", champions = false) => amounts(ownResiduals(mon(extra), { terrain, champions }));

describe("residuals.ts weather (order 1)", () => {
  it("sand and hail take 1/16 unless immune: types, abilities, Safety Goggles, Magic Guard, underground", () => {
    expect(amounts(weatherResiduals(mon(), "Sand"))).toEqual([["sandstorm", -14]]);
    for (const extra of [{ types: ["Rock"] }, { types: ["Ground", "Flying"] }, { types: ["Steel"] }, { ability: "overcoat" }, { ability: "sandforce" }, { ability: "sandrush" },
      { ability: "sandveil" }, { item: "safetygoggles" }, { ability: "magicguard" }, { sheltered: true, semiInvulnerable: true }]) {
      expect(weatherResiduals(mon(extra), "Sand"), JSON.stringify(extra)).toEqual([]);
    }
    // Fly's charge turn is semi-invulnerable but not sheltered: sand still hits.
    expect(amounts(weatherResiduals(mon({ semiInvulnerable: true }), "Sand"))).toEqual([["sandstorm", -14]]);
    expect(amounts(weatherResiduals(mon(), "Hail"))).toEqual([["hail", -14]]);
    for (const extra of [{ types: ["Ice"] }, { ability: "overcoat" }, { ability: "snowcloak" }, { item: "safetygoggles" }, { ability: "magicguard" }]) {
      expect(weatherResiduals(mon(extra), "Hail"), JSON.stringify(extra)).toEqual([]);
    }
    expect(weatherResiduals(mon(), "Snow")).toEqual([]);
  });

  it("Ice Body heals in hail and snow (no damage), Rain Dish and Dry Skin in rain, Dry Skin and Solar Power hurt in sun", () => {
    expect(amounts(weatherResiduals(mon({ ability: "icebody" }), "Hail"))).toEqual([["icebody", 14]]);
    expect(amounts(weatherResiduals(mon({ ability: "icebody" }), "Snow"))).toEqual([["icebody", 14]]);
    expect(amounts(weatherResiduals(mon({ ability: "raindish" }), "Rain"))).toEqual([["raindish", 14]]);
    expect(amounts(weatherResiduals(mon({ ability: "raindish" }), "Heavy Rain"))).toEqual([["raindish", 14]]);
    expect(amounts(weatherResiduals(mon({ ability: "dryskin" }), "Rain"))).toEqual([["dryskin", 29]]);
    expect(amounts(weatherResiduals(mon({ ability: "dryskin" }), "Sun"))).toEqual([["dryskin", -29]]);
    expect(amounts(weatherResiduals(mon({ ability: "solarpower" }), "Harsh Sunshine"))).toEqual([["solarpower", -29]]);
    // A Utility Umbrella cancels the holder's sun and rain (Pokemon.effectiveWeather); Magic Guard stops the sun damage.
    for (const ability of ["raindish", "dryskin"]) expect(weatherResiduals(mon({ ability, item: "utilityumbrella" }), "Rain")).toEqual([]);
    expect(weatherResiduals(mon({ ability: "solarpower", item: "utilityumbrella" }), "Sun")).toEqual([]);
    expect(weatherResiduals(mon({ ability: "solarpower", status: "brn" }), "Sun").length).toBe(1);
    // Heal Block stops the heals.
    expect(weatherResiduals(mon({ ability: "raindish", healBlocked: true }), "Rain")).toEqual([]);
  });
});

describe("residuals.ts ownResiduals", () => {
  it("Grassy Terrain heals a grounded Pokémon that is not semi-invulnerable", () => {
    expect(own({}, "Grassy")).toEqual([["grassyterrain", 14]]);
    expect(own({ grounded: false }, "Grassy")).toEqual([]);
    expect(own({ semiInvulnerable: true }, "Grassy")).toEqual([]);
    expect(own({ healBlocked: true }, "Grassy")).toEqual([]);
  });

  it("Leftovers, Black Sludge (Poison heals, others lose 1/8; Magic Guard), Sticky Barb", () => {
    expect(own({ item: "leftovers" })).toEqual([["leftovers", 14]]);
    expect(own({ item: "blacksludge", types: ["Poison"] })).toEqual([["blacksludge", 14]]);
    expect(own({ item: "blacksludge" })).toEqual([["blacksludge", -29]]);
    expect(own({ item: "blacksludge", ability: "magicguard" })).toEqual([]);
    expect(own({ item: "stickybarb" })).toEqual([["stickybarb", -29]]);
    expect(own({ item: "stickybarb", ability: "magicguard" })).toEqual([]);
  });

  it("Aqua Ring and Ingrain heal 1/16, Big Root ×5324/4096", () => {
    expect(own({ aquaRing: true, ingrain: true })).toEqual([["aquaring", 14], ["ingrain", 14]]);
    expect(own({ aquaRing: true, ingrain: true, item: "bigroot" })).toEqual([["aquaring", 18], ["ingrain", 18]]);
    expect(bigRoot(22)).toBe(29);
    expect(bigRoot(19)).toBe(25);
    expect(bigRoot(14)).toBe(18);
  });

  it("poison 1/8; bad poison clampIntRange(1/16, 1) × the stage after it rises (at most 15); Poison Heal heals 1/8 instead", () => {
    expect(own({ status: "psn" })).toEqual([["psn", -29]]);
    expect(own({ status: "tox" })).toEqual([["tox", -14]]);
    expect(own({ status: "tox", toxicStage: 3 })).toEqual([["tox", -56]]);
    expect(own({ status: "tox", toxicStage: 15 })).toEqual([["tox", -210]]);
    expect(own({ status: "tox", baseMaxHP: 10 })).toEqual([["tox", -1]]);
    expect(own({ status: "tox", ability: "poisonheal" })).toEqual([["poisonheal", 29]]);
    expect(own({ status: "psn", ability: "poisonheal", healBlocked: true })).toEqual([]);
    expect(own({ status: "tox", ability: "magicguard" })).toEqual([]);
  });

  it("burn 1/16; Heatproof halves the clamped value, at least 1", () => {
    expect(own({ status: "brn" })).toEqual([["brn", -14]]);
    expect(own({ status: "brn", ability: "heatproof" })).toEqual([["brn", -7]]);
    expect(own({ status: "brn", ability: "heatproof", baseMaxHP: 20 })).toEqual([["brn", -1]]);
    expect(own({ status: "brn", ability: "magicguard" })).toEqual([]);
  });

  it("Curse 1/4, a partial trap 1/8 or 1/6 (Binding Band), Salt Cure 1/8 (Water, Steel 1/4; Champions 1/16 and 1/8)", () => {
    expect(own({ curse: true })).toEqual([["curse", -58]]);
    expect(own({ trapDivisor: 8 })).toEqual([["partiallytrapped", -29]]);
    expect(own({ trapDivisor: 6 })).toEqual([["partiallytrapped", -39]]);
    expect(own({ saltCure: true })).toEqual([["saltcure", -29]]);
    expect(own({ saltCure: true, types: ["Water"] })).toEqual([["saltcure", -58]]);
    expect(own({ saltCure: true, types: ["Bug", "Steel"] })).toEqual([["saltcure", -58]]);
    expect(own({ saltCure: true }, "", true)).toEqual([["saltcure", -14]]);
    expect(own({ saltCure: true, types: ["Water"] }, "", true)).toEqual([["saltcure", -29]]);
    for (const extra of [{ curse: true }, { trapDivisor: 8 as const }, { saltCure: true }]) expect(own({ ...extra, ability: "magicguard" })).toEqual([]);
  });

  it("lists them in key order, each with its pinned key", () => {
    const list = ownResiduals(mon({ item: "leftovers", aquaRing: true, ingrain: true, status: "brn", curse: true, trapDivisor: 8, saltCure: true }), { terrain: "Grassy", champions: false });
    expect(list.map((each) => each.id)).toEqual(["grassyterrain", "leftovers", "aquaring", "ingrain", "brn", "curse", "partiallytrapped", "saltcure"]);
    for (const each of list) expect(each.key).toBe(RESIDUAL_KEYS[each.id]);
    expect(RESIDUAL_KEYS.grassyterrain).toEqual({ order: 5, subOrder: 2, priority: 0 });
    expect(RESIDUAL_KEYS.leftovers).toEqual({ order: 5, subOrder: 4, priority: 0 });
    expect(RESIDUAL_KEYS.psn).toEqual({ order: 9, subOrder: 0, priority: 0 });
    expect(RESIDUAL_KEYS.partiallytrapped).toEqual(RESIDUAL_KEYS.saltcure);
  });
});

describe("residuals.ts two-Pokémon amounts", () => {
  it("Bad Dreams: 1/8 to a sleeping or Comatose foe; Magic Guard none", () => {
    expect(badDreamsDamage(mon({ status: "slp" }))).toBe(29);
    expect(badDreamsDamage(mon({ ability: "comatose" }))).toBe(29);
    expect(badDreamsDamage(mon())).toBe(0);
    expect(badDreamsDamage(mon({ status: "slp", ability: "magicguard" }))).toBe(0);
  });
  it("Leech Seed drains 1/8 (at least 1); Magic Guard none", () => {
    expect(leechSeedDamage(mon())).toBe(29);
    expect(leechSeedDamage(mon({ baseMaxHP: 5 }))).toBe(1);
    expect(leechSeedDamage(mon({ ability: "magicguard" }))).toBe(0);
  });
});
