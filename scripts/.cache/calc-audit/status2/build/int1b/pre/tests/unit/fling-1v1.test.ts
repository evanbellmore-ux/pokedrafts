import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { FLING_FAILS, flingData, flingFailure, flungEffect, flungFact, flungStatusLands, firstUseWalk, type FlingItem } from "@/app/lib/battle/fling";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive, getBuildStats } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, CombatStat, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * Fling in 1v1 (status2 SPEC2 §4.7, guards.md §4.5): the held item's power from the game's pinned data (the catalogs' `fling`
 * field), the failure rules, the item's own damage effects kept for the hit, the effect on the target as facts, and Uses to KO
 * as the first use (Fling fails on the second) with what the thrown item does in that use. Every number is pinned Showdown
 * c23d2e94's: the catalog data against status2/design/guards-probes-fling.out, the rows against the exact oracle of
 * scripts/.cache/calc-audit/status2/build/fling/ (oracle.ts: the item sweep sweep.ts, extras.ts, every golden-1v1 Fling row in
 * golden-check.ts). Level 50, 31 IVs, 0 EVs (Champions: no Stat Points), Serious nature unless set.
 */

type Mon = { id: string; ability: string; item?: string; hp?: number; part?: number; status?: BattleStatus; tera?: string; dynamax?: true; boosts?: Partial<Record<CombatStat, number>> };
const SV: BattleGame = "scarlet_violet", CH: BattleGame = "champions", SW: BattleGame = "sword_shield", US: BattleGame = "ultra_sun_ultra_moon";

async function row(game: BattleGame, attacker: Mon, defender: Mon, field: Partial<BattleConditions> = {}): Promise<MoveDamageResult> {
  const runtime = await loadBattleRuntime(game);
  const make = (m: Mon): BattleBuild => {
    let build = {
      ...createBuild(m.id, runtime), nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "", currentHP: m.hp ?? null,
      status: m.status ?? "", boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts },
    } as BattleBuild;
    if (m.tera) build = { ...build, mechanic: "tera", configuration: { ...build.configuration, teraType: m.tera } } as BattleBuild;
    if (m.dynamax) build = { ...build, mechanic: "dynamax" } as BattleBuild;
    if (m.part) build = { ...build, currentHP: Math.max(1, Math.floor((getBuildStats(build, runtime)?.hp ?? 1) * m.part)) };
    return build;
  };
  const out = calculateMatchup(make(attacker), make(defender), { ...createConditions(), gameType: "Singles", ...field } as BattleConditions, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === "fling")!;
}
const weavile = (item: string, extra: Partial<Mon> = {}): Mon => ({ id: "weavile", ability: "pressure", item, ...extra });
const snorlax = (extra: Partial<Mon> = {}): Mon => ({ id: "snorlax", ability: "thickfat", ...extra });
const gengar = (extra: Partial<Mon> = {}): Mon => ({ id: "gengar", ability: "cursedbody", item: "colburberry", ...extra });
const single = (koChance: number) => ({ kind: "single-use", reason: "Fling throws its item away", koChance });

describe("the catalogs' Fling data (the game's pinned mod; status2/design/guards-probes-fling.out)", () => {
  it("has an item's fling data in every game, absent where Fling fails", async () => {
    const counts: Record<BattleGame, [number, number, number]> = { champions: [166, 165, 28], scarlet_violet: [249, 217, 53], sword_shield: [354, 326, 53], ultra_sun_ultra_moon: [339, 279, 55] };
    for (const [game, [items, flung, berries]] of Object.entries(counts) as [BattleGame, [number, number, number]][]) {
      const runtime = await loadBattleRuntime(game);
      const catalog = runtime.catalog.items as FlingItem[];
      expect(catalog.length, game).toBe(items);
      expect(catalog.filter((item) => item.fling).length, game).toBe(flung);
      expect(catalog.filter((item) => item.fling?.berry).length, game).toBe(berries);
    }
  });

  it("gives Showdown's power where @smogon/calc's getFlingPower differs, and the effects", async () => {
    const power = async (game: BattleGame, ids: Record<string, number | undefined>) => {
      const runtime = await loadBattleRuntime(game);
      for (const [id, basePower] of Object.entries(ids)) expect(flingData(runtime, id)?.basePower, `${game} ${id}`).toBe(basePower);
    };
    await power(SV, { abilityshield: 30, bigroot: 10, gripclaw: 90, masterpieceteacup: 80, safetygoggles: 80, flowersweet: 0, ironball: 130, normalgem: undefined, pokeball: undefined, rustedsword: undefined, adamantcrystal: undefined });
    await power(CH, { lopunnite: 80, garchompitez: 80, metronome: 30, shellbell: 30, normalgem: undefined });
    await power(SW, { tr24: 120, bugmemory: 50, burndrive: 70, gripclaw: 90, flowersweet: 0, rustedshield: undefined, normalgem: undefined });
    await power(US, { bignugget: 30, alakazite: 80, firememory: 50, normaliumz: undefined, blueorb: undefined });
    const sv = await loadBattleRuntime(SV);
    expect([flingData(sv, "flameorb"), flingData(sv, "toxicorb"), flingData(sv, "poisonbarb"), flingData(sv, "lightball"), flingData(sv, "kingsrock"), flingData(sv, "whiteherb"), flingData(sv, "sitrusberry")])
      .toEqual([{ basePower: 30, status: "brn" }, { basePower: 30, status: "tox" }, { basePower: 70, status: "psn" }, { basePower: 30, status: "par" }, { basePower: 30, volatileStatus: "flinch" },
        { basePower: 10, effect: "whiteherb" }, { basePower: 10, berry: true }]);
    expect(flungEffect(flingData(sv, "mentalherb")!)).toEqual({ kind: "mentalherb" });
    expect(flungFact(flungEffect(flingData(sv, "toxicorb")!), "Toxic Orb", "Snorlax")).toBe("Toxic Orb: Snorlax is badly poisoned.");
  });
});

describe("Fling's failures (PS/data/moves.ts fling onPrepareHit)", () => {
  it("checks ignoringItem before the item, as pinned Showdown does", async () => {
    const runtime = await loadBattleRuntime(SV);
    const user = { itemId: "", speciesId: "weavile", name: "Weavile", klutz: false, embargo: false };
    const failure = (patch: Partial<typeof user>, magicRoom = false) => flingFailure({ ...user, ...patch }, magicRoom, runtime, (id) => id === "greattusk");
    expect(failure({})).toBe(FLING_FAILS.noItem("Weavile"));
    expect(failure({}, true)).toBe("Fling fails under Magic Room.");
    expect(failure({ embargo: true })).toBe("Fling fails: Weavile is under Embargo.");
    expect(failure({ klutz: true, itemId: "ironball" })).toBe("Fling fails: Weavile has Klutz.");
    expect(failure({ itemId: "boosterenergy", speciesId: "greattusk" })).toBe("Fling fails: Booster Energy cannot be flung.");
    expect(failure({ itemId: "boosterenergy" })).toBeNull();
  });

  it("is a zero row with the fact, before Protect", async () => {
    const fails = (reason: string) => ({ kind: "calculated", min: 0, max: 0, assumptions: expect.arrayContaining([reason]), usesToKO: { kind: "no-damage" } });
    expect(await row(SV, weavile(""), snorlax())).toMatchObject(fails("Fling fails: Weavile has no item."));
    expect(await row(CH, { id: "lopunny", ability: "klutz", item: "ironball" }, snorlax())).toMatchObject(fails("Fling fails: Lopunny has Klutz."));
    expect(await row(SV, weavile("ironball"), snorlax(), { magicRoom: true })).toMatchObject(fails("Fling fails under Magic Room."));
    expect(await row(CH, { id: "lopunny", ability: "cutecharm", item: "lopunnite" }, snorlax())).toMatchObject(fails("Fling fails: Lopunnite cannot be flung."));
    expect(await row(US, weavile("normaliumz"), snorlax())).toMatchObject(fails("Fling fails: Normalium Z cannot be flung."));
    expect(await row(SV, weavile("pokeball"), snorlax())).toMatchObject(fails("Fling fails: Poke Ball cannot be flung."));
    // A terrain Seed on its terrain was used up on entry.
    expect(await row(SV, weavile("electricseed"), snorlax(), { terrain: "Electric" })).toMatchObject(fails("Fling fails: Weavile has no item."));
    // Flower Sweet has fling.basePower 0: it is thrown for no damage.
    expect(await row(SV, weavile("flowersweet"), snorlax())).toMatchObject(fails("Fling throws Flower Sweet for no damage (0 power)."));
    const side = createConditions().defenderSide;
    expect(await row(SV, weavile(""), snorlax(), { defenderSide: { ...side, protect: true } })).toMatchObject(fails("Fling fails: Weavile has no item."));
    expect(await row(SV, weavile("ironball"), snorlax(), { defenderSide: { ...side, protect: true } })).toMatchObject(fails("Protect blocks Fling."));
  });

  it("flies with another species' Mega Stone, an unused Seed, and a Klutz the target's Neutralizing Gas suppresses", async () => {
    expect(await row(CH, weavile("lopunnite"), snorlax())).toMatchObject({ effectiveName: "Fling", effectivePower: 80, min: 75, max: 88 });
    expect(await row(SV, weavile("electricseed"), snorlax(), { terrain: "Grassy" })).toMatchObject({ effectivePower: 10, min: 10, max: 13 });
    expect(await row(SW, { id: "lopunny", ability: "klutz", item: "ironball" }, { id: "weezinggalar", ability: "neutralizinggas" })).toMatchObject({ min: 17, max: 20 });
  });
});

describe("Fling's power and its hit (the item stays held for it)", () => {
  it("throws at the pinned power, with the held item's damage effects", async () => {
    expect(await row(SV, weavile("ironball"), gengar())).toMatchObject({ effectivePower: 130, min: 129, max: 153, ohkoChance: 0.75, usesToKO: single(0.75) });
    expect(await row(SW, weavile("tr24"), gengar())).toMatchObject({ effectivePower: 120, min: 118, max: 141, ohkoChance: 0.3125 });
    expect(await row(CH, weavile("lopunnite"), gengar())).toMatchObject({ min: 79, max: 94 });
    expect(await row(US, weavile("blackglasses"), gengar({ item: "" }))).toMatchObject({ min: 72, max: 86 });
    expect(await row(US, { id: "marowak", ability: "rockhead", item: "thickclub" }, gengar({ item: "" }))).toMatchObject({ min: 170, max: 202 });
    expect(await row(SV, { id: "pikachu", ability: "static", item: "lightball" }, snorlax())).toMatchObject({ min: 21, max: 25 });
    // Technician: 30 power is at most 60.
    expect(await row(US, { id: "ambipom", ability: "technician", item: "kingsrock" }, snorlax())).toMatchObject({ min: 24, max: 29 });
  });

  it("meets a Terastallized user's 60-power floor (sim/battle-actions.ts getDamage: the item's base power, set in onPrepareHit)", async () => {
    expect(await row(SV, weavile("whiteherb", { tera: "Dark" }), snorlax())).toMatchObject({ effectivePower: 60, min: 76, max: 90, assumptions: expect.arrayContaining(["Move power: 60."]) });
    expect(await row(SV, weavile("whiteherb", { tera: "Fire" }), snorlax())).toMatchObject({ effectivePower: 10, min: 10, max: 13 });
  });
});

describe("the thrown item's effect on the target, as facts", () => {
  it("states a status that lands, and none that does not", async () => {
    const facts = async (...args: Parameters<typeof row>) => (await row(...args)).assumptions;
    expect(await facts(SV, weavile("flameorb"), snorlax({ part: 0.5 }))).toContain("Flame Orb: Snorlax is burned.");
    expect(await facts(SV, { id: "hawlucha", ability: "limber", item: "flameorb" }, { id: "vivillon", ability: "shielddust", hp: 29 })).not.toContain("Flame Orb: Vivillon is burned.");
    expect(await facts(SV, { id: "hawlucha", ability: "moldbreaker", item: "flameorb" }, { id: "vivillon", ability: "shielddust", hp: 29 })).toContain("Flame Orb: Vivillon is burned.");
    expect(await facts(SV, weavile("flameorb"), snorlax({ item: "covertcloak", hp: 46 }))).not.toContain("Flame Orb: Snorlax is burned.");
    expect(await facts(SV, { id: "salazzle", ability: "corrosion", item: "toxicorb" }, { id: "skarmory", ability: "sturdy", part: 0.1 })).toContain("Toxic Orb: Skarmory is badly poisoned.");
    expect(await facts(SV, weavile("toxicorb"), { id: "skarmory", ability: "sturdy", hp: 30 })).not.toContain("Toxic Orb: Skarmory is badly poisoned.");
    expect(await facts(SV, weavile("toxicorb"), snorlax({ hp: 60 }), { terrain: "Misty" })).not.toContain("Toxic Orb: Snorlax is badly poisoned.");
    expect(await facts(SV, { id: "pikachu", ability: "static", item: "lightball" }, snorlax())).toContain("Light Ball: Snorlax is paralysed.");
  });

  it("states a flinch, White Herb on lowered stats and a Berry eaten", async () => {
    expect((await row(SV, weavile("kingsrock"), gengar())).assumptions).toContain("King's Rock: Gengar flinches if it has not moved.");
    expect((await row(SV, weavile("kingsrock"), { id: "dragonite", ability: "innerfocus" })).assumptions.join(" ")).not.toMatch(/flinches/);
    expect((await row(SV, weavile("whiteherb"), snorlax({ boosts: { def: -2 } }))).assumptions).toContain("White Herb: Snorlax's lowered stats are restored.");
    expect((await row(SV, weavile("whiteherb"), snorlax())).assumptions.join(" ")).not.toMatch(/White Herb:/);
    expect((await row(SV, weavile("sitrusberry"), snorlax({ hp: 141 }))).assumptions).toContain("Sitrus Berry: Snorlax eats it.");
  });

  it("decides a status's landing in pinned Showdown's order", () => {
    const target = { status: "" as const, types: ["Normal"], ability: "", item: "", speciesId: "snorlax", grounded: true, safeguard: false };
    const source = { ability: "", moldBreaker: false };
    expect(flungStatusLands("brn", target, source, "", false)).toBe(true);
    expect(flungStatusLands("brn", { ...target, types: ["Fire"] }, source, "", false)).toBe(false);
    expect(flungStatusLands("tox", { ...target, types: ["Steel"] }, { ability: "corrosion", moldBreaker: false }, "", false)).toBe(true);
    expect(flungStatusLands("par", { ...target, ability: "limber" }, { ability: "moldbreaker", moldBreaker: true }, "", false)).toBe(true);
    expect(flungStatusLands("brn", { ...target, ability: "leafguard" }, source, "", true)).toBe(false);
    expect(flungStatusLands("brn", target, source, "Misty", false)).toBe(false);
    expect(flungStatusLands("brn", { ...target, grounded: false }, source, "Misty", false)).toBe(true);
    expect(flungStatusLands("brn", { ...target, safeguard: true }, source, "", false)).toBe(false);
    expect(flungStatusLands("brn", { ...target, safeguard: true }, { ability: "infiltrator", moldBreaker: false }, "", false)).toBe(true);
    expect(flungStatusLands("brn", { ...target, item: "rawstberry" }, source, "", false)).toBe(false);
    expect(flungStatusLands("brn", { ...target, item: "rawstberry" }, { ability: "unnerve", moldBreaker: false }, "", false)).toBe(true);
    expect(flungStatusLands("brn", { ...target, status: "par" }, source, "", false)).toBe(false);
  });
});

describe("Uses to KO: the first use with its end of turn (Fling fails on the second)", () => {
  it("counts the burn or poison it gives at that end of turn", async () => {
    expect((await row(SV, weavile("toxicorb"), snorlax({ hp: 61 }), { weather: "Sand" })).usesToKO).toEqual(single(0.3125));
    expect((await row(US, weavile("flameorb"), snorlax({ hp: 46 }))).usesToKO).toEqual(single(0.3125));
    expect((await row(CH, weavile("poisonbarb"), snorlax({ hp: 103 }))).usesToKO).toEqual(single(0.25));
    expect((await row(SV, { id: "hawlucha", ability: "moldbreaker", item: "flameorb" }, { id: "vivillon", ability: "shielddust", hp: 29 })).usesToKO).toEqual(single(0.875));
    expect((await row(SV, { id: "hawlucha", ability: "limber", item: "flameorb" }, { id: "vivillon", ability: "shielddust", hp: 29 })).usesToKO).toEqual(single(0));
    // Marvel Scale reads the burn only after the hit.
    expect((await row(US, weavile("flameorb"), { id: "milotic", ability: "marvelscale", hp: 36 })).usesToKO).toEqual(single(0.6875));
    // A Rawst Berry cures the burn at once, unless the attacker's Unnerve stops it.
    expect((await row(US, weavile("flameorb"), snorlax({ item: "rawstberry", hp: 46 }))).usesToKO).toEqual(single(0));
  });

  it("counts from the attacker without its item after the hit: no Life Orb recoil, Sticky Barb or Shell Bell", async () => {
    expect((await row(SV, weavile("lifeorb", { hp: 10 }), snorlax({ hp: 55 }), { weather: "Sand" })).usesToKO).toEqual(single(0.3125));
    expect((await row(SV, weavile("stickybarb", { hp: 10 }), snorlax({ hp: 100 }), { weather: "Sand" })).usesToKO).toEqual(single(0.125));
    expect((await row(SV, weavile("shellbell", { hp: 30 }), snorlax({ hp: 40 }), { weather: "Sand" })).usesToKO).toEqual(single(1));
  });

  it("gives the first use's outcome with a flung Berry's heal, and leaves the count where the heal could change it", async () => {
    const low = await row(SV, weavile("sitrusberry"), snorlax({ hp: 18 }), { weather: "Sand" });
    expect(low.afterUse).toMatchObject({ start: 18, low: 66, high: 63, average: 64.4375, min: 63, max: 66, koChance: 0, heals: ["Sitrus Berry: +58 HP."] });
    expect(low.usesToKO).toEqual({ kind: "not-estimated", reason: "The flung Sitrus Berry heals it" });
    // Its own Sitrus Berry is past its line once the flung one has healed it.
    const own = await row(SV, weavile("sitrusberry"), snorlax({ item: "sitrusberry", hp: 141 }));
    expect(own.afterUse).toMatchObject({ start: 141, low: 189, high: 186, average: 187.4375, heals: ["Sitrus Berry: +58 HP."] });
    expect(own.usesToKO).toEqual(single(0));
    expect((await row(SW, weavile("oranberry"), { id: "greedent", ability: "cheekpouch", part: 0.3 })).afterUse)
      .toMatchObject({ start: 58, low: 126, high: 123, average: 124.0625, heals: ["Oran Berry: +10 HP.", "Cheek Pouch: +65 HP."] });
    expect((await row(SV, weavile("lumberry"), { id: "dedenne", ability: "cheekpouch", part: 0.3 })).afterUse).toMatchObject({ start: 42, low: 83, high: 82, heals: ["Cheek Pouch: +47 HP."] });
    expect((await row(SV, weavile("sitrusberry"), gengar({ item: "enigmaberry", part: 0.6 }))).afterUse)
      .toMatchObject({ start: 81, low: 127, high: 121, average: 123.875, heals: ["Sitrus Berry: +33 HP.", "Enigma Berry: +33 HP."] });
    expect((await row(US, weavile("figyberry"), snorlax({ part: 0.3 }))).afterUse).toMatchObject({ start: 70, low: 177, high: 174, heals: ["Figy Berry: +117 HP."] });
    // A Klutz target eats it with no effect.
    expect((await row(SW, weavile("sitrusberry"), { id: "lopunny", ability: "klutz", part: 0.4 })).afterUse).toMatchObject({ start: 56, low: 49, high: 46, heals: [] });
    expect((await row(SV, weavile("rawstberry"), snorlax({ part: 0.08, status: "brn" }), { weather: "Sand" })).usesToKO)
      .toEqual({ kind: "not-estimated", reason: "The flung Rawst Berry cures its status" });
  });

  it("walks one hit as uses-to-ko.ts firstUse does", () => {
    const rolls = [10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 13, 13, 13, 13];
    expect(firstUseWalk({ start: 20, maxHP: 100, rolls, endure: false, onHit: [], update: null }))
      .toMatchObject({ start: 20, low: 10, high: 7, average: 8.5, min: 7, max: 10, koChance: 0, heals: [] });
    expect(firstUseWalk({ start: 11, maxHP: 100, rolls, endure: false, onHit: [{ source: "Sitrus Berry", amount: 25 }], update: null }))
      .toMatchObject({ low: 26, high: 0, min: 0, max: 26, average: 6.5, koChance: 0.75, heals: ["Sitrus Berry: +25 HP."] });
    expect(firstUseWalk({ start: 11, maxHP: 11, rolls, endure: true, onHit: [], update: null })).toMatchObject({ low: 1, high: 1, koChance: 0 });
  });

  it("counts a Dynamaxed attacker's Max Darkness, then the Iron Ball's Fling (zmove-status/verify/u-oracle2.ts)", async () => {
    // Showdown: out after 2 uses 0.5625, after 3 0.921143, after 4 (the Fling) 1.
    const max = await row(SW, weavile("ironball", { dynamax: true }), { id: "hawlucha", ability: "limber", item: "figyberry", hp: 84 });
    expect(max).toMatchObject({ effectiveName: "Max Darkness", min: 42, max: 49, usesToKO: { kind: "uses", guaranteed: 4, fewest: 2, limit: 4 } });
    expect((max.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.921143, 5);
    // A Fling that would burn after Dynamax is not followed.
    expect((await row(SW, weavile("flameorb", { dynamax: true }), snorlax())).usesToKO).toMatchObject({ kind: "not-estimated" });
  });
});

describe("Fling and a Mirror Herb copy before or after it", () => {
  it("needs the turn order when the attacker's Mirror Herb copies the target's rise either way", async () => {
    const runtime = await loadBattleRuntime(SV);
    const garchomp = { ...createBuild("garchomp", runtime), abilityId: "roughskin", itemId: "mirrorherb" } as BattleBuild;
    const dragonite = createBuild("dragonite", runtime);
    const target = { ...dragonite, abilityId: "innerfocus", itemId: "salacberry", currentHP: Math.floor((getBuildStats(dragonite, runtime)?.hp ?? 1) * 0.2) } as BattleBuild;
    const out = calculateMatchup(garchomp, target, { ...createConditions(), gameType: "Doubles" }, {}, runtime);
    expect(out.results.find((result) => result.moveId === "fling")).toMatchObject({
      kind: "needs-context", reason: "Fling: needs the turn order (Garchomp's Mirror Herb is used before or after it).",
    });
  });
});
