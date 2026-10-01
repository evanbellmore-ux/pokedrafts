import { beforeAll, describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, StatTable, UsesToKO } from "@/app/lib/battle/types";

/**
 * Uses to KO for the items, stat stages and abilities the review of the count found wrong: when items act in a
 * use (Thief and Covet before the hit's berry, Enigma Berry before Knock Off, Sticky Barb moving first, Magician
 * last, no steal on a Gem's use), Sheer Force skipping what acts after the move, items that cannot be taken,
 * Cheek Pouch, Berry Juice and Unnerve, Unburden, a Pickpocket's Rocky Helmet, terrain Seeds and the other entry
 * rises counted once, Clear Amulet, Mold Breaker and Ability Shield, Champions' Weak Armor, and the texts. Every
 * count is from a real pinned Showdown c23d2e94 battle of that matchup, once with every damage roll at 85 and once
 * at 100 (crits off, every hit landing, chances under 100% failing, weather and terrain as set lasting):
 * scripts/.cache/calc-audit/nhko/fix-review/engine-b/cases-b.ts (the target's HP after each use is in the test
 * names), from the reviewers' scripts under scripts/.cache/calc-audit/nhko/review/items and review/stats. Level
 * 50, 31 IVs and Serious unless stated, Singles.
 */
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) runtimes[game] = await loadBattleRuntime(game);
  runtimes.champions = championsRuntime;
});

type Spec = {
  ability?: string; item?: string; nature?: string; evs?: Partial<StatTable<number>>; ivs?: Partial<StatTable<number>>; level?: number; hp?: number;
};
function build(game: BattleGame, id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, runtimes[game]);
  const shared = {
    ...(spec.ability ? { abilityId: spec.ability } : {}), ...(spec.item !== undefined ? { itemId: spec.item } : {}),
    ...(spec.nature ? { nature: spec.nature } : {}), ...(spec.hp !== undefined ? { currentHP: spec.hp } : {}),
  };
  if (base.game === "champions") return { ...base, ...shared, points: { ...base.points, ...spec.evs } } as BattleBuild;
  return { ...base, ...shared, native: { ...base.native, level: spec.level ?? 50, evs: { ...base.native.evs, ...spec.evs }, ivs: { ...base.native.ivs, ...spec.ivs } } } as BattleBuild;
}
function uses(game: BattleGame, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}): UsesToKO {
  const result = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", multipleTargets: false, ...field }, {}, runtimes[game]);
  expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
  const found = result.results.find((entry) => entry.moveId === moveId)!;
  expect(found.kind).toBe("calculated");
  return found.usesToKO!;
}
type Counted = Extract<UsesToKO, { kind: "uses" }>;
function counted(value: UsesToKO): Counted {
  expect(value.kind).toBe("uses");
  return value as Counted;
}
const counts = (value: UsesToKO) => ({ fewest: counted(value).fewest, guaranteed: counted(value).guaranteed });
const S = "scarlet_violet" as const, W = "sword_shield" as const, U = "ultra_sun_ultra_moon" as const, C = "champions" as const;
const kingambit = () => build(S, "kingambit", { nature: "Adamant", evs: { atk: 252 }, item: "", ability: "defiant" });

describe("items as a use meets them, in pinned Showdown's order", () => {
  it("Thief and Covet take an HP berry before the hit's Update: Thief 140 -> 58, 0 (43, 0); Covet 150 -> 102, 54, 6, 0 (93, 36, 0)", () => {
    const thief = counted(uses(S, "thief", kingambit(), build(S, "snorlax", { item: "sitrusberry", ability: "thickfat", hp: 140 })));
    expect(thief).toMatchObject({ fewest: 2, guaranteed: 2 });
    expect(thief.carried).toEqual(["Thief takes the target's item."]);
    expect(counts(uses(S, "covet", build(S, "arcanine", { nature: "Adamant", evs: { atk: 252 }, item: "", ability: "justified" }), build(S, "snorlax", { item: "sitrusberry", ability: "thickfat", hp: 150 }))))
      .toEqual({ fewest: 3, guaranteed: 4 });
  });
  it("Enigma Berry heals in the target's Hit, before Knock Off takes it: 227 -> 119 + 56 = 175, 103, 31, 0 (155, 69, 0)", () => {
    const attacker = (game: BattleGame) => build(game, "weavile", { nature: "Jolly", evs: { atk: 252 }, item: "", ability: "pressure" });
    const target = (game: BattleGame) => build(game, "cresselia", { item: "enigmaberry", ability: "levitate", evs: { hp: 252, def: 252 }, nature: "Bold" });
    const sv = counted(uses(S, "knockoff", attacker(S), target(S)));
    expect(sv).toMatchObject({ fewest: 3, guaranteed: 4 });
    expect(sv.carried).toContain("The target's Enigma Berry heals it once, after a super-effective hit.");
    // USUM: 181, 113, 45, 0 (163, 79, 0).
    expect(counts(uses(U, "knockoff", attacker(U), target(U)))).toEqual({ fewest: 3, guaranteed: 4 });
  });
  it("Magician steals after Maranga Berry has acted, so it finds nothing: 215, 181 ... 11, 0 (204, 162, 120, 78, 36, 0)", () => {
    expect(counts(uses(S, "psychic", build(S, "delphox", { nature: "Modest", evs: { spa: 252 }, item: "", ability: "magician" }),
      build(S, "snorlax", { item: "marangaberry", ability: "thickfat", evs: { hp: 252, spd: 252 }, nature: "Careful" })))).toEqual({ fewest: 6, guaranteed: 8 });
  });
  it("no steal on the use that spends a Gem: Covet takes the Eviolite on use 2, 301, 257, 192, 127, 62, 0 (290, 238, 161, 84, 7, 0)", () => {
    const covet = counted(uses(S, "covet", build(S, "arcanine", { nature: "Adamant", evs: { atk: 252 }, item: "normalgem", ability: "justified" }),
      build(S, "chansey", { item: "eviolite", ability: "naturalcure", evs: { hp: 252, def: 252 }, nature: "Bold" })));
    expect(covet).toMatchObject({ fewest: 6, guaranteed: 6 });
    expect(covet.fasterChance).toBeUndefined();
  });
  it("Sticky Barb moves to an item-less contact attacker before Knock Off: it faints after use 9 with the target in", () => {
    const knock = counted(uses(S, "knockoff", build(S, "weavile", { nature: "Modest", item: "", ability: "pressure" }),
      build(S, "clefable", { item: "stickybarb", ability: "unaware", evs: { hp: 252, def: 252 }, nature: "Bold" })));
    // 177, 160 ... 41 (172, 151 ... 4); the attacker loses 18 a turn from 145.
    expect(knock).toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 9, highest: 9 } });
    expect(knock.carried).toEqual(["Sticky Barb hurts the attacker at the end of each turn."]);
  });
  it("Sheer Force skips AfterMoveSecondary: no Kee Berry (236, 205 ... 19, 0) and no Pickpocket (Life Orb stays: 96, 15, 0; 82, 0)", () => {
    const snorlax = () => build(S, "snorlax", { item: "keeberry", ability: "thickfat", evs: { hp: 252, def: 252 }, nature: "Impish" });
    const kee = counted(uses(S, "icepunch", build(S, "conkeldurr", { nature: "Adamant", evs: { atk: 252 }, item: "", ability: "sheerforce" }), snorlax()));
    expect(kee).toMatchObject({ fewest: 8, guaranteed: 9, carried: [] });
    // Iron Fist: Def +1 after use 1, 239, 220 ... 11, 0 (233, 210 ... 3, 0).
    expect(counts(uses(S, "icepunch", build(S, "conkeldurr", { nature: "Adamant", evs: { atk: 252 }, item: "", ability: "ironfist" }), snorlax()))).toEqual({ fewest: 12, guaranteed: 14 });
    const pickpocket = counted(uses(S, "thunderpunch", build(S, "conkeldurr", { nature: "Adamant", evs: { atk: 252 }, item: "lifeorb", ability: "sheerforce" }),
      build(S, "weavile", { item: "", ability: "pickpocket", evs: { hp: 252, def: 252 }, nature: "Bold" })));
    expect(pickpocket).toMatchObject({ fewest: 2, guaranteed: 3, carried: [] });
  });
  it("Cheek Pouch heals a third for Maranga Berry (174 -> 102 + 58 = 160, 112, 64, 16, 0) and for a Rawst Berry curing Inferno's burn (120 -> 26 + 58 = 84, 0)", () => {
    const dedenne = (item: string, hp?: number) => build(S, "dedenne", { item, ability: "cheekpouch", evs: { hp: 252, spd: 252 }, nature: "Calm", hp });
    expect(counts(uses(S, "flamethrower", build(S, "delphox", { nature: "Modest", evs: { spa: 252 }, item: "", ability: "blaze" }), dedenne("marangaberry")))).toEqual({ fewest: 4, guaranteed: 5 });
    expect(counts(uses(S, "inferno", build(S, "chandelure", { nature: "Modest", evs: { spa: 252 }, item: "", ability: "flashfire" }), dedenne("rawstberry", 120)))).toEqual({ fewest: 2, guaranteed: 2 });
    // Knock Off takes a Kee Berry before it is eaten, so no heal (USUM): 135, 108, 81, 54, 27, 0 (127, 95, 63, 31, 0).
    const knock = counted(uses(U, "knockoff", build(U, "weavile", { nature: "Jolly", evs: { atk: 252 }, item: "", ability: "pressure" }),
      build(U, "dedenne", { item: "keeberry", ability: "cheekpouch", evs: { hp: 252, def: 252 }, nature: "Bold" })));
    expect(knock).toMatchObject({ fewest: 5, guaranteed: 6, carried: ["Knock Off takes the target's item."] });
  });
  it("Berry Juice heals under Unnerve (it is used, not eaten): 234 -> 195, 156, 117 + 20 = 137, 98, 59, 20, 0 (188 ... 24, 0)", () => {
    for (const game of [U, W]) {
      const juice = counted(uses(game, "confusion", build(game, "mewtwo", { ability: "unnerve", item: "" }), build(game, "snorlax", { item: "berryjuice", ability: "thickfat", hp: 234 })));
      expect(juice).toMatchObject({ fewest: 6, guaranteed: 7 });
      expect(juice.carried).toContain("The target's Berry Juice heals it once, at half its HP or less.");
    }
  });
  it("Unnerve ends once Lingering Aroma or Mummy replaces it: 166, 115, 64 + 54 = 118, 67, 16, 0 (156, 95 + 54 = 149, 88, 27, 0)", () => {
    const houndoom = (game: BattleGame) => build(game, "houndoom", { nature: "Adamant", evs: { atk: 252 }, item: "", ability: "unnerve" });
    const aroma = counted(uses(S, "crunch", houndoom(S), build(S, "oinkologne", { item: "sitrusberry", ability: "lingeringaroma", evs: { hp: 252, def: 252 }, nature: "Bold" })));
    expect(aroma).toMatchObject({ fewest: 5, guaranteed: 6 });
    expect(aroma.carried).toContain("The target's Sitrus Berry heals it once, at half its HP or less.");
    // USUM Mummy: 99, 33 + 41 = 74, 8, 0 (85, 46, 0).
    expect(counts(uses(U, "crunch", houndoom(U), build(U, "cofagrigus", { item: "sitrusberry", ability: "mummy", evs: { hp: 252, def: 252 }, nature: "Bold" })))).toEqual({ fewest: 3, guaranteed: 4 });
  });
  it("a Pickpocket target that takes the attacker's Rocky Helmet hurts each later contact hit: the attacker faints on use 3 (128, 79, 30; 119, 61, 3)", () => {
    const slam = counted(uses(S, "bodyslam", build(S, "snorlax", { item: "rockyhelmet", ability: "thickfat", hp: 60 }), build(S, "weavile", { item: "", ability: "pickpocket", evs: { hp: 252, def: 252 }, nature: "Bold" })));
    expect(slam).toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 3, highest: 3 } });
  });
});

describe("items that cannot be taken (pinned Showdown onTakeItem)", () => {
  it("a Mega Stone and a Z-Crystal stay with a Pickpocket's attacker: Champions 126, 75, 24, 0 (116, 55, 0), USUM 138, 99, 60, 21, 0 (131, 85, 39, 0)", () => {
    const weavile = (game: BattleGame, evs: Partial<StatTable<number>>) => build(game, "weavile", { item: "", ability: "pickpocket", evs, nature: "Bold" });
    const mega = counted(uses(C, "acrobatics", build(C, "hawluchamega", { nature: "Adamant", evs: { atk: 32 }, item: "hawluchanite", ability: "noguard" }), weavile(C, { hp: 32, def: 32 })));
    expect(mega).toMatchObject({ fewest: 3, guaranteed: 4, carried: [] });
    expect(counts(uses(U, "acrobatics", build(U, "hawlucha", { nature: "Adamant", evs: { atk: 252 }, item: "fightiniumz", ability: "limber" }), weavile(U, { hp: 252, def: 252 })))).toEqual({ fewest: 4, guaranteed: 5 });
    // A Mega Scizor's stone and a Steelium Z stay too: no "takes" text.
    expect(counted(uses(C, "bulletpunch", build(C, "scizormega", { nature: "Adamant", evs: { atk: 32 }, item: "scizorite", ability: "technician" }), weavile(C, { hp: 32, def: 32 }))).carried).toEqual([]);
  });
  it("Thief leaves Arceus its plate (209, 191 ... 11, 0; 205 ... 7, 0) and Mega Venusaur its stone", () => {
    const plate = counted(uses(S, "thief", kingambit(), build(S, "arceusdark", { item: "dreadplate", ability: "multitype", evs: { hp: 252, def: 252 }, nature: "Bold" })));
    expect(plate).toMatchObject({ fewest: 11, guaranteed: 13, carried: [] });
    expect(counted(uses(U, "thief", build(U, "weavile", { nature: "Jolly", evs: { atk: 252 }, item: "", ability: "pressure" }),
      build(U, "venusaurmega", { item: "venusaurite", ability: "thickfat", evs: { hp: 252, def: 252 }, nature: "Bold" }))).carried).toEqual([]);
  });
});

describe("Unburden doubles Speed once its holder's item is gone", () => {
  it("Gyro Ball after the Sitrus Berry: Sneasler 112, 83 then 108 to 0 (99, 57, 127 to 0); Hawlucha 130, 121, 42, 0 (119, 99, 5, 0)", () => {
    const bronzong = build(S, "bronzong", { nature: "Brave", evs: { atk: 252 }, ivs: { spe: 0 }, item: "", ability: "levitate" });
    const sneasler = counted(uses(S, "gyroball", bronzong, build(S, "sneasler", { item: "sitrusberry", ability: "unburden", evs: { hp: 252, def: 252 }, nature: "Impish" })));
    expect(sneasler).toMatchObject({ fewest: 3, guaranteed: 3 });
    expect(sneasler.carried).toContain("The target's Unburden doubles its Speed once its item is gone.");
    const weak = build(S, "bronzong", { nature: "Brave", ivs: { spe: 0 }, ability: "levitate" });
    expect(counts(uses(S, "gyroball", weak, build(S, "hawlucha", { item: "sitrusberry", ability: "unburden", evs: { hp: 252, def: 252 } })))).toEqual({ fewest: 4, guaranteed: 4 });
    // Limber, no doubling: 130, 121, 66, 11, 0 (119, 99, 33, 0).
    expect(counts(uses(S, "gyroball", weak, build(S, "hawlucha", { item: "sitrusberry", ability: "limber", evs: { hp: 252, def: 252 } })))).toEqual({ fewest: 4, guaranteed: 5 });
    // Champions: 99, 83, 102 to 0 (89, 63, 121 to 0).
    expect(counts(uses(C, "gyroball", build(C, "steelix", { nature: "Brave", ivs: { spe: 0 } }), build(C, "hawlucha", { item: "sitrusberry", ability: "unburden" })))).toEqual({ fewest: 3, guaranteed: 3 });
  });
});

describe("entry rises are in the stages once (a used Seed is gone)", () => {
  const grassy = { terrain: "Grassy" } as const, psychic = { terrain: "Psychic" } as const;
  it("a Grassy Seed used on entry is not stolen and keeps its rise: Thief 40 a use (227 ... 11, 0), Ice Spinner 30 a use after the terrain ends", () => {
    const thief = counted(uses(S, "thief", kingambit(), build(S, "snorlax", { item: "grassyseed", ability: "thickfat", evs: { hp: 252, def: 252 } }), grassy));
    expect(thief).toMatchObject({ fewest: 8, guaranteed: 11 });
    expect(thief.carried).not.toContain("Thief takes the target's item.");
    expect(counts(uses(S, "icespinner", build(S, "chienpao", { nature: "Adamant", evs: { atk: 252 }, item: "", ability: "swordofruin" }),
      build(S, "snorlax", { item: "grassyseed", ability: "thickfat", evs: { hp: 252, def: 252 }, nature: "Impish" }), grassy))).toEqual({ fewest: 8, guaranteed: 9 });
    // Its own used Seed leaves the attacker item-less, so Thief takes the Eviolite: 281, 191, 101, 11, 0 (267, 156, 45, 0).
    expect(counts(uses(S, "thief", build(S, "kingambit", { nature: "Adamant", evs: { atk: 252 }, item: "grassyseed", ability: "defiant" }),
      build(S, "chansey", { item: "eviolite", ability: "naturalcure", evs: { hp: 252, def: 252 }, nature: "Bold" }), grassy))).toEqual({ fewest: 4, guaranteed: 5 });
    // Magician finds no Psychic Seed: 18 a use (249 ... 15, 0; 245 ... 3, 0).
    expect(counts(uses(S, "flamethrower", build(S, "delphox", { nature: "Modest", evs: { spa: 252 }, item: "", ability: "magician" }),
      build(S, "snorlax", { item: "psychicseed", ability: "thickfat", evs: { hp: 252, spd: 252 }, nature: "Careful" }), psychic))).toEqual({ fewest: 13, guaranteed: 15 });
  });
  it("Clear Smog clears a Seed's rise (161, 136 ... 11, 0), Acid Spray stops at -6 (349, 321, 275, 209, 136, 63, 0)", () => {
    const smog = counted(uses(S, "clearsmog", build(S, "weezing", { ability: "levitate", nature: "Modest", evs: { spa: 252 } }),
      build(S, "indeedeef", { ability: "psychicsurge", item: "psychicseed", evs: { hp: 252, spd: 252 }, nature: "Calm" }), psychic));
    expect(smog).toMatchObject({ fewest: 7, guaranteed: 8, carried: ["Clear Smog resets the target's stat changes."] });
    expect(counts(uses(S, "acidspray", build(S, "gengar", { nature: "Modest" }), build(S, "blissey", { item: "psychicseed", evs: { hp: 252, spd: 252 }, nature: "Calm" }), psychic)))
      .toEqual({ fewest: 7, guaranteed: 7 });
  });
  it("Dauntless Shield's rise meets White Herb once: Def +1, 0, -1 restored, -1, -2: 172, 130, 88, 28, 0 (166, 117, 68, 0)", () => {
    expect(counts(uses(W, "firelash", build(W, "centiskorch", { nature: "Adamant", evs: { atk: 100 } }), build(W, "zamazenta", { item: "whiteherb", evs: { hp: 252, def: 252 }, nature: "Impish" }))))
      .toEqual({ fewest: 4, guaranteed: 5 });
  });
});

describe("stat changes and the abilities and items that stop them", () => {
  it("Clear Amulet blocks a foe's drops: Acid Spray 36 a use (231 ... 15, 0), Mew's 16-19 into Blissey 21 and 18 uses", () => {
    const snorlax = counted(uses(S, "acidspray", build(S, "gengar", { nature: "Modest", evs: { spa: 252 } }), build(S, "snorlax", { item: "clearamulet", evs: { hp: 252 } })));
    expect(snorlax).toMatchObject({ fewest: 7, guaranteed: 8, carried: [] });
    expect(counts(uses(S, "acidspray", build(S, "mew", { evs: { atk: 252, spa: 252 } }), build(S, "blissey", { item: "clearamulet" })))).toEqual({ fewest: 18, guaranteed: 21 });
  });
  it("an attacker's Clear Amulet blocks Gooey, so Defiant never acts (121, 45, 0; 106, 15, 0), nor Mirror Armor's bounce (181, 157 ... 13, 0)", () => {
    const goodra = () => build(S, "goodra", { ability: "gooey", evs: { hp: 252, def: 252 } });
    expect(counts(uses(S, "ironhead", build(S, "kingambit", { ability: "defiant", item: "clearamulet", nature: "Adamant", evs: { atk: 252 } }), goodra()))).toEqual({ fewest: 3, guaranteed: 3 });
    expect(counts(uses(S, "gyroball", build(S, "bronzong", { ability: "levitate", item: "clearamulet", nature: "Brave", evs: { atk: 252 }, ivs: { spe: 0 } }), goodra()))).toEqual({ fewest: 4, guaranteed: 4 });
    const bounce = counted(uses(S, "breakingswipe", build(S, "haxorus", { ability: "unnerve", item: "clearamulet", nature: "Adamant", evs: { atk: 252 } }),
      build(S, "corviknight", { ability: "mirrorarmor", evs: { hp: 252, def: 252 } })));
    expect(bounce).toMatchObject({ fewest: 8, guaranteed: 9, carried: [] });
  });
  it("Ability Shield keeps Mirror Armor through Mold Breaker: the attacker's Attack falls each use, 181, 165, 153 ... 21 within 24 uses (177 ... 8, 0 on use 20)", () => {
    const shield = counted(uses(S, "breakingswipe", build(S, "haxorus", { ability: "moldbreaker", nature: "Adamant", evs: { atk: 252 } }),
      build(S, "corviknight", { ability: "mirrorarmor", item: "abilityshield", evs: { hp: 252, def: 252 } })));
    expect(shield).toMatchObject({ fewest: 20, guaranteed: null, limit: 24 });
    expect(shield.carried).toContain("The target's Mirror Armor turns Breaking Swipe's drop back on the attacker.");
  });
  it("Mold Breaker ignores the target's Contrary and Simple for its own Kee Berry during the move: Def +1, 126, 81, 36, 0 (114, 60, 6, 0)", () => {
    const malamar = () => build(S, "malamar", { ability: "contrary", item: "keeberry", evs: { hp: 252, def: 252 } });
    expect(counts(uses(S, "ironhead", build(S, "excadrill", { ability: "moldbreaker", nature: "Adamant", evs: { atk: 252 } }), malamar()))).toEqual({ fewest: 4, guaranteed: 4 });
    // Sand Rush: Contrary turns it into Def -1, 126, 26, 0 (114, 0).
    expect(counts(uses(S, "ironhead", build(S, "excadrill", { ability: "sandrush", nature: "Adamant", evs: { atk: 252 } }), malamar()))).toEqual({ fewest: 2, guaranteed: 3 });
    // Simple: +1, not +2: 303, 288 ... 3, 0 (298 ... 10, 0).
    expect(counts(uses(S, "ironhead", build(S, "excadrill", { ability: "moldbreaker", nature: "Adamant" }), build(S, "numel", { ability: "simple", item: "keeberry", evs: { hp: 252, def: 252 }, level: 100 }))))
      .toEqual({ fewest: 18, guaranteed: 22 });
  });
  it("Champions keeps gen9's Weak Armor, Speed +2 a hit: Gyro Ball into Garbodor 110 then 0 (101, 0), into Skarmory 163, 138, 87, 24, 0 (161, 131, 71, 0)", () => {
    expect(counts(uses(C, "gyroball", build(C, "steelix", { nature: "Brave", evs: { atk: 32 }, ivs: { spe: 0 } }), build(C, "garbodor", { ability: "weakarmor" })))).toEqual({ fewest: 2, guaranteed: 2 });
    expect(counts(uses(C, "gyroball", build(C, "steelix", { nature: "Brave", ivs: { spe: 0 } }), build(C, "skarmory", { ability: "weakarmor", evs: { hp: 32, def: 32 } })))).toEqual({ fewest: 4, guaranteed: 5 });
  });
});

describe("carried texts follow what acts", () => {
  it("leave out a stat change Sheer Force, Shield Dust, Covert Cloak, a stat guard or Mirror Armor stops, and a White Herb Contrary never needs", () => {
    // The counts match Showdown: constant damage (scripts/.cache/calc-audit/nhko/review/stats/r7-carried-text.ts).
    expect(counted(uses(U, "poweruppunch", build(U, "conkeldurr", { ability: "sheerforce", nature: "Adamant", evs: { atk: 252 } }), build(U, "cresselia", { nature: "Bold", evs: { hp: 252, def: 252 } }))).carried).toEqual([]);
    const espathra = () => build(S, "espathra", { nature: "Modest", evs: { spa: 252 } });
    for (const [id, spec] of [["metagross", { ability: "clearbody" }], ["vivillon", { ability: "shielddust" }], ["blissey", { item: "covertcloak" }]] as const) {
      expect(counted(uses(S, "luminacrash", espathra(), build(S, id, spec))).carried).not.toContain("Lumina Crash lowers the target's Sp. Def each use.");
    }
    expect(counted(uses(S, "firelash", build(S, "salazzle", { nature: "Adamant", evs: { atk: 252 } }), build(S, "corviknight", { ability: "mirrorarmor" }))).carried).toEqual([]);
    expect(counted(uses(S, "leafstorm", build(S, "serperior", { ability: "contrary", item: "whiteherb", nature: "Modest", evs: { spa: 252 } }), build(S, "blissey", { evs: { hp: 252, spd: 252 } }))).carried)
      .toEqual(["Leaf Storm raises the attacker's Sp. Atk after each use."]);
  });
  it("leave out an item that is taken first, never used, or cannot be taken", () => {
    // Knock Off takes a Kee Berry before it acts (USUM); a neutral Foul Play never uses Weakness Policy.
    expect(counted(uses(U, "knockoff", build(U, "weavile", { nature: "Jolly", evs: { atk: 252 }, item: "", ability: "pressure" }),
      build(U, "dedenne", { item: "keeberry", ability: "cheekpouch", evs: { hp: 252, def: 252 }, nature: "Bold" }))).carried).toEqual(["Knock Off takes the target's item."]);
    expect(counted(uses(S, "foulplay", kingambit(), build(S, "snorlax", { item: "weaknesspolicy", ability: "thickfat", evs: { hp: 252, def: 252 }, nature: "Adamant" }))).carried).toEqual([]);
    // Magician finds nothing once Maranga Berry is eaten.
    expect(counted(uses(S, "psychic", build(S, "delphox", { nature: "Modest", evs: { spa: 252 }, item: "", ability: "magician" }),
      build(S, "snorlax", { item: "marangaberry", ability: "thickfat", evs: { hp: 252, spd: 252 }, nature: "Careful" }))).carried).toEqual(["The target's Maranga Berry raises a stat once."]);
  });
});
