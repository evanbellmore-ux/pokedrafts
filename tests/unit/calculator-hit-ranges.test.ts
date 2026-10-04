import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { hitCountRule, randomHitChances } from "@/app/lib/battle/hit-count";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";

/**
 * A random hit count with none chosen is a calculated row over every count (types.ts hitChances). Reference
 * values from pinned Showdown c23d2e94's simulator (scripts/.cache/calc-audit/hit-ranges/engine: dist.ts
 * enumerates hitStepMoveHitLoop's sample() and random() answers; faint.ts plays the turn with the rolls forced
 * to 85 and 100), level 50, 0 EVs / Stat Points, 31 IVs, Serious nature, Singles, no crit.
 */
function build(runtime: BattleRuntime, id: string, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), nature: "Serious", ...extra } as BattleBuild;
}
function row(runtime: BattleRuntime, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, context?: MoveContext) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}

const twoToFive = [{ hits: 2, chance: 7 / 20 }, { hits: 3, chance: 7 / 20 }, { hits: 4, chance: 3 / 20 }, { hits: 5, chance: 3 / 20 }];
const diceTwoToFive = [{ hits: 4, chance: 1 / 2 }, { hits: 5, chance: 1 / 2 }];
const diceBomb = [4, 5, 6, 7, 8, 9, 10].map((hits) => ({ hits, chance: 1 / 7 }));
const perHit = (count: number, rolls: number[]) => Array.from({ length: count }, () => rolls);

describe("random hit counts as a range", () => {
  it("has pinned Showdown's chances: 2–5 hits 35/35/15/15, Loaded Dice 4 or 5 at 50% each, Loaded Dice Population Bomb 4–10 at 1/7 each", async () => {
    // Showdown (dist.ts) in Scarlet/Violet, Champions, Ultra Sun/Ultra Moon and Sword/Shield alike.
    expect(randomHitChances([2, 5], false)).toEqual(twoToFive);
    expect(randomHitChances([2, 5], true)).toEqual(diceTwoToFive);
    expect(randomHitChances(10, true)).toEqual(diceBomb);
    // Any other range is random(min, max + 1); no catalog has one.
    expect(randomHitChances([1, 3], false)).toEqual([1, 2, 3].map((hits) => ({ hits, chance: 1 / 3 })));
    const sv = await loadBattleRuntime("scarlet_violet");
    for (const runtime of [championsRuntime, sv, ...await Promise.all((["ultra_sun_ultra_moon", "sword_shield"] as const).map((game) => loadBattleRuntime(game)))]) {
      for (const move of runtime.movesById.values()) {
        if (Array.isArray(move.multihit)) expect(move.multihit, `${runtime.profile.id} ${move.id}`).toEqual([2, 5]);
      }
      expect(hitCountRule(runtime.movesById.get("bulletseed")!, { abilityId: "technician", itemId: "" }, runtime)).toMatchObject({ kind: "choose", defaultHits: null, chances: twoToFive });
    }
    expect(hitCountRule(sv.movesById.get("bulletseed")!, { abilityId: "technician", itemId: "loadeddice" }, sv)).toMatchObject({ min: 4, max: 5, chances: diceTwoToFive });
    expect(hitCountRule(sv.movesById.get("populationbomb")!, { abilityId: "technician", itemId: "loadeddice" }, sv)).toMatchObject({ min: 4, max: 10, chances: diceBomb });
    // A move that checks accuracy for every hit has no random count.
    expect(hitCountRule(sv.movesById.get("populationbomb")!, { abilityId: "technician", itemId: "" }, sv)).toMatchObject({ defaultHits: 10, chances: null });
  });

  it("runs a 2–5 hit move from 2 hits at the lowest rolls to 5 at the highest, instead of asking", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // Showdown: 28 + 28 at the lowest roll, 5 x 34 at the highest.
    const seed = row(sv, "bulletseed", build(sv, "breloom", { abilityId: "technician" }), build(sv, "garchomp", { abilityId: "sandveil" }));
    expect(seed).toMatchObject({ kind: "calculated", reason: null, hits: 5, min: 56, max: 170, hitChances: twoToFive, ohkoChance: 0 });
    expect(seed.rolls).toEqual(perHit(5, [28, 28, 30, 30, 30, 30, 30, 31, 31, 31, 31, 33, 33, 33, 33, 34]));
    expect(seed.attackerFaintsOnHit).toBeUndefined();
    expect(seed.assumptions).toContain("Bullet Seed: 2–5 hits (2 and 3: 35% each, 4 and 5: 15% each).");
    expect(seed.assumptions).not.toContain("No one-use KO chance for multiple hits.");
    expect(seed.assumptions.some((line) => /Needs the hit count|Assumes all/.test(line))).toBe(false);
    expect(seed.description).toBe("Bullet Seed: 56–170 HP (30.6–92.9% of maximum HP). Applied: Technician.");
  });

  it("gives Loaded Dice 4 or 5 hits, unless Magic Room or an active Klutz switches it off", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const garchomp = build(sv, "garchomp", { abilityId: "sandveil" });
    const dice = build(sv, "breloom", { abilityId: "technician", itemId: "loadeddice" });
    // Showdown: 4 x 28 to 5 x 34; under Magic Room 2 x 28 to 5 x 34 again.
    const loaded = row(sv, "bulletseed", dice, garchomp);
    expect(loaded).toMatchObject({ kind: "calculated", hits: 5, min: 112, max: 170, hitChances: diceTwoToFive });
    expect(loaded.assumptions).toContain("Bullet Seed: 4–5 hits (Loaded Dice, 50% each).");
    const room = row(sv, "bulletseed", dice, garchomp, { magicRoom: true });
    expect(room).toMatchObject({ kind: "calculated", hits: 5, min: 56, max: 170, hitChances: twoToFive });
    expect(room.assumptions).toContain("Bullet Seed: 2–5 hits (2 and 3: 35% each, 4 and 5: 15% each).");
    // Klutz switches it off (Showdown: 2 x 10 to 5 x 13), unless the target's Neutralizing Gas suppresses Klutz
    // (4 x 4 to 5 x 6, pinned Showdown ignoringItem -> hasAbility('klutz')).
    const capsakid = build(sv, "capsakid", { abilityId: "klutz", itemId: "loadeddice" });
    expect(row(sv, "bulletseed", capsakid, garchomp)).toMatchObject({ kind: "calculated", min: 20, max: 65, hitChances: twoToFive });
    expect(row(sv, "bulletseed", capsakid, build(sv, "weezinggalar", { abilityId: "neutralizinggas" }))).toMatchObject({ kind: "calculated", min: 16, max: 30, hitChances: diceTwoToFive });
    expect(hitCountRule(sv.movesById.get("bulletseed")!, { abilityId: "klutz", itemId: "loadeddice" }, sv, { opponentAbilityId: "neutralizinggas" })).toMatchObject({ min: 4, loadedDice: true });
    expect(hitCountRule(sv.movesById.get("bulletseed")!, { abilityId: "klutz", itemId: "loadeddice" }, sv)).toMatchObject({ min: 2, loadedDice: false });
  });

  it("runs Loaded Dice Population Bomb from 4 to 10 hits, with or without Skill Link", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const garchomp = build(sv, "garchomp", { abilityId: "sandveil" });
    // Showdown: 4 x 15 to 10 x 18.
    const bomb = row(sv, "populationbomb", build(sv, "maushold", { abilityId: "technician", itemId: "loadeddice" }), garchomp);
    expect(bomb).toMatchObject({ kind: "calculated", hits: 10, min: 60, max: 180, hitChances: diceBomb });
    expect(bomb.assumptions).toContain("Population Bomb: 4–10 hits (Loaded Dice, 14.29% each).");
    expect(bomb.assumptions).not.toContain("Population Bomb: all 10 hits land.");
    expect(hitCountRule(sv.movesById.get("populationbomb")!, { abilityId: "skilllink", itemId: "loadeddice" }, sv)).toMatchObject({ kind: "choose", chances: diceBomb });
  });

  it("keeps Skill Link's count, a chosen count, and every hit of a move that checks accuracy for each", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const garchomp = build(sv, "garchomp", { abilityId: "sandveil" });
    const skillLink = row(sv, "tailslap", build(sv, "cinccino", { abilityId: "skilllink" }), garchomp);
    expect(skillLink).toMatchObject({ kind: "calculated", hits: 5 });
    expect(skillLink.hitChances).toBeUndefined();
    expect(skillLink.assumptions).toContain("Skill Link: 5 hits.");
    const breloom = build(sv, "breloom", { abilityId: "technician" });
    const three = row(sv, "bulletseed", breloom, garchomp, {}, { hits: 3 });
    expect(three).toMatchObject({ kind: "calculated", hits: 3, min: 84, max: 102 });
    expect(three.hitChances).toBeUndefined();
    // A chosen count Loaded Dice cannot make is asked for again, as before.
    expect(row(sv, "bulletseed", build(sv, "breloom", { abilityId: "technician", itemId: "loadeddice" }), garchomp, {}, { hits: 2 })).toMatchObject({ kind: "needs-context", reason: "Needs the hit count (4–5)." });
    expect(row(sv, "bulletseed", breloom, garchomp, {}, { hits: 6 })).toMatchObject({ kind: "needs-context", reason: "Needs the hit count (2–5)." });
    const axel = row(sv, "tripleaxel", build(sv, "weavile", { abilityId: "pressure" }), garchomp);
    expect(axel).toMatchObject({ kind: "calculated", hits: 3 });
    expect(axel.hitChances).toBeUndefined();
  });

  it("hits once as a Z-Move or a Max Move", async () => {
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    // Showdown: Breakneck Blitz from Tail Slap, 79–94 in one hit.
    const z = row(us, "tailslap", build(us, "cinccino", { abilityId: "skilllink", itemId: "normaliumz" }), build(us, "garchomp", { abilityId: "roughskin" }), {}, { useZ: true });
    expect(z).toMatchObject({ kind: "calculated", effectiveName: "Breakneck Blitz", hits: 1, min: 79, max: 94 });
    expect(z.hitChances).toBeUndefined();
    expect(Array.isArray(z.rolls) && !Array.isArray(z.rolls[0])).toBe(true);
    const bloom = row(us, "bulletseed", build(us, "breloom", { abilityId: "technician", itemId: "grassiumz" }), build(us, "garchomp", { abilityId: "roughskin" }), {}, { useZ: true });
    expect(bloom).toMatchObject({ kind: "calculated", effectiveName: "Bloom Doom", hits: 1 });
    expect(bloom.hitChances).toBeUndefined();
    const ss = await loadBattleRuntime("sword_shield");
    const max = row(ss, "tailslap", build(ss, "cinccino", { abilityId: "technician", mechanic: "dynamax" }), build(ss, "garchomp", { abilityId: "roughskin" }));
    expect(max).toMatchObject({ kind: "calculated", effectiveName: "Max Strike", hits: 1 });
    expect(max.hitChances).toBeUndefined();
  });

  it("shows the range in Doubles and in every game", async () => {
    const champion = row(championsRuntime, "bulletseed", build(championsRuntime, "chesnaught"), build(championsRuntime, "garchomp", { abilityId: "sandveil" }), { gameType: "Doubles" });
    expect(champion).toMatchObject({ kind: "calculated", hits: 5, hitChances: twoToFive });
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    expect(row(us, "rockblast", build(us, "rhyperior", { abilityId: "solidrock" }), build(us, "snorlax", { abilityId: "thickfat" }))).toMatchObject({ kind: "calculated", hits: 5, hitChances: twoToFive });
    const ss = await loadBattleRuntime("sword_shield");
    expect(row(ss, "iciclespear", build(ss, "mamoswine", { abilityId: "oblivious" }), build(ss, "snorlax", { abilityId: "thickfat" }))).toMatchObject({ kind: "calculated", hits: 5, hitChances: twoToFive });
  });
});
