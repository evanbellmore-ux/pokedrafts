import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleBuild, BattleConditions, BattleGame, CombatStat, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * Uses to KO's lowest/highest-roll fallback (uses-to-ko.ts usesToKO: "Too many roll sequences: lowest and highest rolls
 * only, no chance.") stands in for every roll sequence only where the two paths bound them and every later use can be
 * calculated. Two cases where that fails are now not estimated:
 * - the exact search met a later use it cannot calculate on a sequence the paths do not take: a Dynamaxed attacker's Max
 *   Darkness (Max Fling) into a target whose Figy Berry heals it on some sequences, still in once Dynamax ends, when Fling
 *   (needs context) or Counter is used ("A later use cannot be calculated", as the paths themselves say);
 * - the highest roll path is still in after the lowest one is out, so the lowest path's count is no guarantee ("Too many
 *   cases to count").
 * Crush Grip, Wring Out and Hard Press no longer take the paths at all: an exact search over their powers counts them.
 * Values: the exact Uses oracle on pinned Showdown c23d2e94
 * (scripts/.cache/calc-audit/zmove-status/verify/u-oracle2.ts; forms-iceface-fling/fix/cases-1v1.json, q-changed-oracle.ts,
 * q-cross-oracle.ts), where the app's answer before was a wrong "Guaranteed" count. Level 50, 31 IVs, 0 EVs, Serious
 * unless set.
 */

type Mon = { id: string; ability: string; item?: string; hp?: number; nature?: string; evs?: Partial<Record<"hp" | CombatStat, number>>; dynamax?: true };
async function row(game: BattleGame, moveId: string, attacker: Mon, defender: Mon): Promise<MoveDamageResult> {
  const runtime = await loadBattleRuntime(game);
  const build = (m: Mon): BattleBuild => {
    const base = createBuild(m.id, runtime);
    return {
      ...base, nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "", currentHP: m.hp ?? null,
      boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ...(m.evs ? { native: { ...base.native!, evs: { ...base.native!.evs, ...m.evs } } } : {}),
      ...(m.dynamax ? { mechanic: "dynamax" } : {}),
    } as BattleBuild;
  };
  const field: BattleConditions = { ...createConditions(), gameType: "Singles" };
  const out = calculateMatchup(build(attacker), build(defender), field, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const SW: BattleGame = "sword_shield", SV: BattleGame = "scarlet_violet";
const hawlucha = (hp: number, item?: string): Mon => ({ id: "hawlucha", ability: "limber", hp, ...(item ? { item } : {}) });
const FALLBACK = "Too many roll sequences: lowest and highest rolls only, no chance.";

describe("Max Fling into a Hawlucha holding a Figy Berry at 55%", () => {
  it("is not estimated: a sequence still in once Dynamax ends uses Fling, which is not calculated", async () => {
    // Showdown, Weavile: out after 2 uses 0.5625, after 3 0.921143, after 4 (the Iron Ball's Fling) 1; the app said
    // "Guaranteed 2" and fewest 3 (its high roll path eats the Figy Berry: 84 → 35 → 86).
    const weavile = await row(SW, "fling", { id: "weavile", ability: "pressure", item: "ironball", dynamax: true }, hawlucha(84, "figyberry"));
    expect(weavile).toMatchObject({ effectiveName: "Max Darkness", min: 42, max: 49 });
    expect(weavile.usesToKO).toEqual({ kind: "not-estimated", reason: "A later use cannot be calculated" });
    // The first use is as Showdown's: the high roll eats the Berry.
    expect(weavile.afterUse).toMatchObject({ start: 84, low: 42, high: 86, average: 61.125 });
    // Bisharp: 0.3125, 0.993652, then 1.
    const bisharp = await row(SW, "fling", { id: "bisharp", ability: "defiant", item: "ironball", dynamax: true }, hawlucha(84, "figyberry"));
    expect(bisharp).toMatchObject({ min: 43, max: 51, usesToKO: { kind: "not-estimated", reason: "A later use cannot be calculated" } });
    expect(bisharp.afterUse).toMatchObject({ start: 84, low: 41, high: 84, average: 71.875 });
  });

  it("is still counted when every sequence is out while Dynamax lasts", async () => {
    const low = await row(SW, "fling", { id: "weavile", ability: "pressure", item: "ironball", dynamax: true }, hawlucha(30));
    expect(low.usesToKO).toMatchObject({ kind: "uses", guaranteed: 1, fewest: 1, limit: 4 });
  });
});

describe("the other fallback rows this changes", () => {
  it("a Max Move whose base move cannot be calculated later (Counter)", async () => {
    // sweep-fb.ts sword_shield:maxctx:54: Max Knuckle into an Iapapa Berry Cleffa at 142. Showdown: out after 3 uses 0.938965,
    // and never more (Counter does nothing once Dynamax ends); the app said "Guaranteed 3".
    const counter = await row(SW, "counter",
      { id: "blastoise", ability: "raindish", item: "choiceband", nature: "Lonely", evs: { hp: 36, atk: 140, def: 224, spa: 0, spd: 108, spe: 0 }, dynamax: true },
      { id: "cleffa", ability: "cutecharm", item: "iapapaberry", hp: 142, evs: { hp: 136, atk: 4, def: 0, spa: 236, spd: 0, spe: 132 } });
    expect(counter).toMatchObject({ effectiveName: "Max Knuckle", usesToKO: { kind: "not-estimated", reason: "A later use cannot be calculated" } });
  });
});

describe("the roll paths past the exact search's budget", () => {
  it("are not taken where a roll changes what a later use reads: an HP line a Berry or Anger Shell acts at", async () => {
    // fix/sweep-fb.ts scarlet_violet:random:209: Rock Blast (2-5 hits) into a level 100 Klawf with Anger Shell and a Figy Berry
    // passes the budget; a sequence between the two paths can cross half or a quarter of its HP on another use than either,
    // so they bound nothing (the paths had said fewest 9).
    const runtime = await loadBattleRuntime(SV);
    const attacker = { ...createBuild("stonjourner", runtime), nature: "Impish", abilityId: "powerspot", abilityActive: false, itemId: "lumberry", currentHP: 27, status: "slp",
      native: { level: 50, evs: { hp: 88, atk: 16, def: 244, spa: 4, spd: 20, spe: 116 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } } } as BattleBuild;
    const defender = { ...createBuild("klawf", runtime), nature: "Jolly", abilityId: "angershell", abilityActive: true, itemId: "figyberry",
      boosts: { atk: -1, def: -2, spa: 2, spd: 2, spe: 1 }, native: { level: 100, evs: { hp: 192, atk: 0, def: 128, spa: 0, spd: 188, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } } } as BattleBuild;
    const base = createConditions();
    const field: BattleConditions = { ...base, gameType: "Singles", weather: "Sand", terrain: "Electric", multipleTargets: false,
      attackerSide: { ...base.attackerSide, priorityShield: true }, defenderSide: { ...base.defenderSide, reflect: true, helpingHand: true, friendGuard: true } };
    const out = calculateMatchup(attacker, defender, field, {}, runtime);
    expect(out.results.find((result) => result.moveId === "rockblast")!.usesToKO).toEqual({ kind: "not-estimated", reason: "Too many cases to count" });
  });
});

describe("Crush Grip, Wring Out and Hard Press: an exact search over their powers, not the roll paths", () => {
  // Their power reads the target's HP, so a higher earlier roll lowers a later use's damage: the lowest and highest roll paths
  // bound nothing (Showdown disagreed with them on 97 of 506 rows, forms-iceface-fling/verify/f3-hp.ts). Each power (up to 120)
  // gets one calculation per state (uses-to-ko.ts hpCode), so the search is exact. Values: the exact Uses oracle
  // (forms-iceface-fling/verify/q-rows.ts), out after n uses.
  it("Crush Grip after Dynamax into a Figy Berry holder", async () => {
    // Choice Band Regigigas into Snorlax: 0.144531 after 3, 0.144567 after 5, 0.767390 after 6, 1 after 7 (the paths had said
    // "Guaranteed 3", fewest 5).
    const band = await row(SW, "crushgrip", { id: "regigigas", ability: "slowstart", item: "choiceband", dynamax: true }, { id: "snorlax", ability: "thickfat", item: "figyberry" });
    expect(band).toMatchObject({ effectiveName: "Max Strike", min: 84, max: 100, usesToKO: { kind: "uses", guaranteed: 7, fewest: 3, limit: 8 } });
    expect((band.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.76739, 5);
    expect(band.afterUse).toMatchObject({ start: 235, low: 151, high: 135, average: 143.125 });
    // Into Garchomp: no guarantee within the 8 uses its PP allows, 0.863427 by then (the paths had said "Guaranteed 3", fewest 6).
    const plain = await row(SW, "crushgrip", { id: "regigigas", ability: "slowstart", dynamax: true }, { id: "garchomp", ability: "roughskin", item: "figyberry" });
    expect(plain.usesToKO).toMatchObject({ kind: "uses", guaranteed: null, fewest: 3, limit: 8 });
    expect((plain.usesToKO as { chance: number }).chance).toBeCloseTo(0.863427, 5);
  });

  it("Hard Press into Snorlax and into a Berry-holding Blissey", async () => {
    // 13 and 9 uses, 0.576536 after 12; Figy Berry: 7 and 4, 0.892187 after 6; Sitrus Berry: 6 and 4, 0.565043 after 5 (the paths
    // had said fewest 5).
    const snorlax = await row(SV, "hardpress", { id: "regirock", ability: "clearbody", item: "choiceband" }, { id: "snorlax", ability: "thickfat" });
    expect(snorlax).toMatchObject({ min: 80, max: 95, usesToKO: { kind: "uses", guaranteed: 13, fewest: 9 } });
    expect((snorlax.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.576536, 5);
    expect((snorlax.usesToKO as { notes: string[] }).notes).not.toContain(FALLBACK);
    const figy = await row(SV, "hardpress", { id: "regirock", ability: "clearbody", item: "choiceband" }, { id: "blissey", ability: "naturalcure", item: "figyberry" });
    expect(figy).toMatchObject({ min: 226, max: 266, usesToKO: { kind: "uses", guaranteed: 7, fewest: 4 } });
    expect((figy.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.892187, 5);
    const sitrus = await row(SV, "hardpress", { id: "regirock", ability: "clearbody", item: "choiceband" }, { id: "blissey", ability: "naturalcure", item: "sitrusberry" });
    expect(sitrus).toMatchObject({ usesToKO: { kind: "uses", guaranteed: 6, fewest: 4 } });
    expect((sitrus.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.565043, 5);
  });
});
