import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { hitStep, startHits, walkHits, type HitLoopInput } from "@/app/lib/battle/hit-loop";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext, MoveDamageResult, UsesToKO } from "@/app/lib/battle/types";

/**
 * A use's start and its hits against pinned Showdown c23d2e94: an attacker already at or under its berry's line
 * eats it at the Update before it moves, Cramorant's Gulping and Gorging forms hit back with Gulp Missile, a
 * random count into an immune target rolls no count, and Parental Bond's two strikes are two hits. Single-use
 * values are Showdown's own hitStepMoveHitLoop in a full turn with every hit-count draw enumerated and the rolls
 * forced to 85 and 100 (scripts/.cache/calc-audit/hit-ranges/verify/compare.ts and review-engine/probe.ts);
 * Uses to KO values are the exact counts, each within 4 standard errors of 20,000 real-randomness Showdown
 * battles (scripts/.cache/calc-audit/hit-ranges/fix/sample.ts). Level 50, 0 EVs / Stat Points, 31 IVs,
 * Serious nature, Singles, no crit.
 */
function build(runtime: BattleRuntime, id: string, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), nature: "Serious", ...extra } as BattleBuild;
}
function row(runtime: BattleRuntime, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, context?: MoveContext): MoveDamageResult {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
type Counted = Extract<UsesToKO, { kind: "uses" }>;
function counted(value: UsesToKO | undefined): Counted {
  expect(value?.kind).toBe("uses");
  return value as Counted;
}

describe("an attacker at or under its berry's line eats it before it moves", () => {
  it("heals with Sitrus or Oran first, so contact damage takes it down a hit later", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // Lycanroc 30/150: Sitrus to 67, then 18 + 25 a hit, so it faints on hit 2 (Showdown 22–28, 2 hits).
    const lycanroc = row(championsRuntime, "tailslap", build(championsRuntime, "lycanroc", { abilityId: "keeneye", itemId: "sitrusberry", currentHP: 30 }),
      build(championsRuntime, "garchomp", { abilityId: "roughskin", itemId: "rockyhelmet" }));
    expect(lycanroc).toMatchObject({ hits: 2, min: 22, max: 28, ohkoChance: 0, attackerFaintsOnHit: { hit: 2, of: 5, ofMin: 2, by: ["Rough Skin", "Rocky Helmet"] } });
    expect(lycanroc.assumptions).toContain("The attacker Lycanroc's Sitrus Berry was eaten at 30 HP: 67 HP.");
    expect(lycanroc.assumptions).toContain("Lycanroc faints on hit 2 of 2–5 (Rough Skin and Rocky Helmet).");
    // Cinccino 15/150: Oran to 25, then 18 a hit into Rough Skin (Showdown 44–54, 2 hits).
    const cinccino = row(sv, "tailslap", build(sv, "cinccino", { abilityId: "technician", itemId: "oranberry", currentHP: 15 }), build(sv, "garchomp", { abilityId: "roughskin" }));
    expect(cinccino).toMatchObject({ hits: 2, min: 44, max: 54, attackerFaintsOnHit: { hit: 2, of: 5 } });
    expect(cinccino.assumptions).toContain("The attacker Cinccino's Oran Berry was eaten at 15 HP: 25 HP.");
  });

  it("lands every hit a Jaboca or Rowap Berry would have stopped, and takes a healed attacker out of its pinch ability", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    const rowap = (runtime: BattleRuntime) => build(runtime, "garchomp", { abilityId: "sandveil", itemId: "rowapberry" });
    // Farigiraf 19/195: Sitrus to 67, so both beams land (Showdown 56–68).
    const twinBeam = row(sv, "twinbeam", build(sv, "farigiraf", { abilityId: "armortail", itemId: "sitrusberry", currentHP: 19 }), rowap(sv));
    expect(twinBeam).toMatchObject({ hits: 2, min: 56, max: 68 });
    expect(twinBeam.attackerFaintsOnHit).toBeUndefined();
    // Iron Crown 16/165: Sitrus to 57 (Showdown 78–92, 2 hits).
    expect(row(sv, "tachyoncutter", build(sv, "ironcrown", { abilityId: "quarkdrive", itemId: "sitrusberry", currentHP: 16 }), rowap(sv))).toMatchObject({ hits: 2, min: 78, max: 92 });
    // Greninja 14/147: Sitrus to 50, above a third, so no Torrent and 2–5 hits (Showdown 26–89 in both games).
    for (const runtime of [sv, us]) {
      const shuriken = row(runtime, "watershuriken", build(runtime, "greninja", { abilityId: "torrent", itemId: "sitrusberry", currentHP: 14 }), rowap(runtime));
      expect(shuriken, runtime.profile.id).toMatchObject({ hits: 5, min: 26, max: 89 });
      expect(shuriken.hitChances?.map((entry) => entry.hits)).toEqual([2, 3, 4, 5]);
      expect(shuriken.assumptions).toContain("The attacker Greninja's Sitrus Berry was eaten at 14 HP: 50 HP.");
    }
  });

  it("raises the attacking stat with a pinch berry, for the row and its uses", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // Breloom 27/135 with Liechi: +1 Attack on every hit (Showdown 84–245; 20,000 battles: 19.8% in 1 use, 91.7% in 2, 100% in 3).
    const breloom = row(sv, "bulletseed", build(sv, "breloom", { abilityId: "technician", itemId: "liechiberry", currentHP: 27 }), build(sv, "garchomp", { abilityId: "sandveil" }));
    expect(breloom).toMatchObject({ hits: 5, min: 84, max: 245 });
    expect(breloom.rolls).toEqual(Array.from({ length: 5 }, () => [42, 42, 42, 43, 43, 43, 45, 45, 45, 46, 46, 46, 48, 48, 48, 49]));
    expect(breloom.assumptions).toContain("The attacker Breloom's Liechi Berry was eaten at 27 HP: +1 Attack.");
    expect(counted(breloom.usesToKO)).toMatchObject({ guaranteed: 3, fewest: 1, fasterChance: 0.9154653549194327 });
    // Maushold 29/145 with Liechi: all 10 hits at +1 (Showdown 220–270).
    expect(row(sv, "populationbomb", build(sv, "maushold", { abilityId: "technician", itemId: "liechiberry", currentHP: 29 }), build(sv, "garchomp", { abilityId: "sandveil" })))
      .toMatchObject({ hits: 10, min: 220, max: 270 });
  });

  it("keeps the berry above its line, or when Unnerve, Magic Room or Klutz stops it", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const breloom = (extra: Partial<BattleBuild>) => build(sv, "breloom", { abilityId: "technician", itemId: "liechiberry", ...extra });
    const sandVeil = build(sv, "garchomp", { abilityId: "sandveil" });
    // 34/135 is above a quarter: no rise (56–170, the unboosted 28–34 a hit).
    expect(row(sv, "bulletseed", breloom({ currentHP: 34 }), sandVeil)).toMatchObject({ min: 56, max: 170 });
    const room = row(sv, "bulletseed", breloom({ currentHP: 27 }), sandVeil, { magicRoom: true });
    expect(room).toMatchObject({ min: 56, max: 170 });
    expect(room.assumptions.some((line) => /Liechi Berry was eaten/.test(line))).toBe(false);
    const unnerve = build(sv, "tyranitar", { abilityId: "unnerve" });
    const unnerved = row(sv, "bulletseed", breloom({ currentHP: 27 }), unnerve);
    expect(unnerved).toMatchObject({ min: row(sv, "bulletseed", breloom({ currentHP: 34 }), unnerve).min });
    expect(unnerved.assumptions.some((line) => /Liechi Berry was eaten/.test(line))).toBe(false);
  });
});

describe("Gulp Missile hits back once from Cramorant's Gulping or Gorging form", () => {
  const input = (extra: Partial<HitLoopInput>): HitLoopInput => ({
    hp: 60, maxHP: 150, baseMaxHP: 150, attackerAbility: "", attackerItem: "", targetAbility: "gulpmissile", targetItem: "", attackerShielded: false, targetShielded: false,
    targetDynamaxed: false, contact: true, category: "Physical", drain: null, takesBerry: false, targetGulping: true, generation: 9, ...extra,
  });

  it("deals a quarter of the attacker's HP on its first hit only, with or without contact, not through Magic Guard", () => {
    // Showdown (Cinccino 60/150, Skill Link Tail Slap into Cramorant-Gulping): 60 to 23 on hit 1, then 23 throughout.
    const walk = walkHits(input({}), 5);
    expect(walk.before.map((state) => state.hp)).toEqual([60, 23, 23, 23, 23]);
    expect(walk.after.hp).toBe(23);
    expect(walk.after.gulping).toBe(false);
    expect(walkHits(input({ contact: false, category: "Special" }), 2).after.hp).toBe(23);
    // Magic Guard takes no damage, and the form still changes back.
    const guarded = hitStep(input({ attackerAbility: "magicguard" }), startHits(input({ attackerAbility: "magicguard" })), 0);
    expect(guarded.state).toMatchObject({ hp: 60, gulping: false });
    // A transformed copy's Gulp Missile does nothing (notransform): the calculation passes no gulping form then.
    expect(walkHits(input({ targetGulping: false }), 2).faint).toBeNull();
  });

  it("faints an attacker at a quarter or less on the first hit, so the rest never land", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    for (const form of ["cramorantgulping", "cramorantgorging"]) {
      // Cinccino 30/150 takes 37: Showdown lands 1 hit, 33–39.
      const slap = row(sv, "tailslap", build(sv, "cinccino", { abilityId: "technician", currentHP: 30 }), build(sv, form, { abilityId: "gulpmissile" }));
      expect(slap, form).toMatchObject({ hits: 1, min: 33, max: 39, attackerFaintsOnHit: { hit: 1, of: 5, ofMin: 2, by: ["Gulp Missile"] } });
      expect(slap.hitChances).toBeUndefined();
      expect(slap.assumptions).toContain("Cinccino faints on hit 1 of 2–5 (Gulp Missile).");
      expect(counted(slap.usesToKO)).toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 1, highest: 1 } });
    }
    // Neutralizing Gas does not stop it (cantsuppress): Galarian Weezing 28/140 faints after use 1.
    const gas = row(sv, "strangesteam", build(sv, "weezinggalar", { abilityId: "neutralizinggas", currentHP: 28 }), build(sv, "cramorantgulping", { abilityId: "gulpmissile" }));
    expect(counted(gas.usesToKO)).toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true });
  });

  it("counts the hit back in Uses to KO, once, then the target is Cramorant again", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // Garchomp 36/183 takes 45 on its first Dragon Claw: Showdown faints it after use 1, before the 2HKO.
    const claw = row(sv, "dragonclaw", build(sv, "garchomp", { abilityId: "roughskin", currentHP: 36 }), build(sv, "cramorantgulping", { abilityId: "gulpmissile" }));
    expect(claw).toMatchObject({ hits: 1, min: 91, max: 108 });
    expect(counted(claw.usesToKO)).toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, carried: ["The target's Gulp Missile hits back once."] });
    // Cinccino 60/150 survives at 23 and nothing hits back after: Skill Link's 110–135 twice (Showdown 2 uses).
    const skillLink = row(sv, "tailslap", build(sv, "cinccino", { abilityId: "skilllink", currentHP: 60 }), build(sv, "cramorantgulping", { abilityId: "gulpmissile" }));
    expect(skillLink).toMatchObject({ hits: 5, min: 110, max: 135 });
    expect(skillLink.attackerFaintsOnHit).toBeUndefined();
    expect(counted(skillLink.usesToKO)).toMatchObject({ guaranteed: 2, fewest: 2 });
  });

  it("paralyses the attacker from the Gorging form, so Guts boosts the hits after (not past a Lum Berry), and lowers its Defense from the Gulping form", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const ww = await loadBattleRuntime("sword_shield");
    const gorging = build(sv, "cramorantgorging", { abilityId: "gulpmissile" });
    // Heracross (Guts) Pin Missile: Showdown 14 then 21 a hit at the lowest roll, 17 then 24 at the highest.
    const guts = row(sv, "pinmissile", build(sv, "heracross", { abilityId: "guts" }), gorging);
    expect(guts).toMatchObject({ hits: 5, min: 35, max: 113 });
    expect((guts.rolls as number[][]).map((hit) => [Math.min(...hit), Math.max(...hit)])).toEqual([[14, 17], [21, 24], [21, 24], [21, 24], [21, 24]]);
    const used = counted(guts.usesToKO);
    expect(used).toMatchObject({ guaranteed: 4, fewest: 2, fasterChance: 0.9489958198927342 });
    expect(used.carried).toContain("The target's Gulp Missile hits back and paralyses the attacker once.");
    expect(used.notes).toContain("Assumes the paralysed attacker is never fully paralysed.");
    // A Lum Berry cures it at that hit's Update: 14–17 every hit (Showdown 28 at the lowest roll for 2 hits).
    expect(row(sv, "pinmissile", build(sv, "heracross", { abilityId: "guts", itemId: "lumberry" }), gorging)).toMatchObject({ min: 28, max: 85 });
    // Rillaboom at 87/175 takes 43 and Overgrow boosts the hits after (Showdown 28 then 42, 34 then 49).
    const overgrow = row(ww, "bulletseed", build(ww, "rillaboom", { abilityId: "overgrow", currentHP: 87 }), build(ww, "cramorantgulping", { abilityId: "gulpmissile" }));
    expect(overgrow).toMatchObject({ min: 70, max: 230 });
    // Corviknight's Body Press reads its Defense, which the Gulping form lowers once.
    const press = counted(row(sv, "bodypress", build(sv, "corviknight", { abilityId: "pressure" }), build(sv, "cramorantgulping", { abilityId: "gulpmissile" })).usesToKO);
    expect(press.carried).toContain("The target's Gulp Missile hits back and lowers the attacker's Defense once.");
  });
});

describe("rows with no hit, and Parental Bond's two strikes", () => {
  it("rolls no count into an immune target: no range and no hit count", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // Showdown: hitStepTypeImmunity and hitStepTryHitEvent stop the move before hitStepMoveHitLoop.
    for (const [moveId, attacker, defender] of [
      ["tailslap", build(sv, "cinccino", { abilityId: "technician" }), build(sv, "gengar")],
      ["bulletseed", build(sv, "breloom", { abilityId: "technician" }), build(sv, "azumarill", { abilityId: "sapsipper" })],
      ["populationbomb", build(sv, "maushold", { abilityId: "technician", itemId: "loadeddice" }), build(sv, "gengar")],
    ] as const) {
      const immune = row(sv, moveId, attacker, defender);
      expect(immune, moveId).toMatchObject({ kind: "calculated", min: 0, max: 0, hits: null, rolls: 0 });
      expect(immune.hitChances).toBeUndefined();
      expect(immune.assumptions.some((line) => / hits \(/.test(line)), moveId).toBe(false);
    }
  });

  it("counts both strikes, cut or not", async () => {
    // Kangaskhan-Mega's Drain Punch into Liquid Ooze Swalot from 54 HP: both strikes land (Showdown).
    const kangaskhan = build(championsRuntime, "kangaskhanmega", { abilityId: "parentalbond", itemId: "kangaskhanite", currentHP: 54 });
    const ooze = row(championsRuntime, "drainpunch", kangaskhan, build(championsRuntime, "swalot", { abilityId: "liquidooze" }));
    expect(ooze.hits).toBe(2);
    expect((ooze.rolls as number[][]).length).toBe(2);
    // Both strikes' one use is exact (MoveDamageResult.afterUse), so the row has its one-use KO chance.
    expect(ooze.ohkoChance).toBe(ooze.afterUse!.koChance);
    expect(ooze.assumptions).not.toContain("No one-use KO chance for multiple hits.");
  });
});
