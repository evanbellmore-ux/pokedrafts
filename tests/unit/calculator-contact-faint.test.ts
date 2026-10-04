import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { hitPaths, hitStep, startHits, walkHits, type HitLoopInput } from "@/app/lib/battle/hit-loop";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveContext } from "@/app/lib/battle/types";

/**
 * The attacker fainting to what the target deals back on a hit stops the later hits (pinned Showdown
 * hitStepMoveHitLoop: `if (!pokemon.hp && targets.length === 1) break`). Every value is pinned Showdown
 * c23d2e94's simulator playing the turn (scripts/.cache/calc-audit/hit-ranges/engine/faint.ts: the target uses
 * Splash, rolls forced to 85 and 100, the hit count forced through hitStepMoveHitLoop's own sample() and
 * random() calls), level 50, 0 EVs / Stat Points, 31 IVs, Serious nature, Singles, no crit.
 */
function build(runtime: BattleRuntime, id: string, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), nature: "Serious", ...extra } as BattleBuild;
}
function row(runtime: BattleRuntime, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, context?: MoveContext) {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, context ? { [moveId]: context } : {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const perHit = (count: number, rolls: number[]) => Array.from({ length: count }, () => rolls);
/** Maushold's (Technician) Population Bomb hit into a neutral Garchomp: 15–18 per hit. */
const BOMB_HIT = [15, 15, 15, 15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 18];

describe("Rough Skin, Iron Barbs and Rocky Helmet stop the hits once the attacker faints", () => {
  it("lands 9 of Population Bomb's 10 hits into Rough Skin Garchomp (Maushold: 149 HP, 18 per hit)", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    for (const runtime of [championsRuntime, sv]) {
      for (const gameType of ["Singles", "Doubles"] as const) {
        const bomb = row(runtime, "populationbomb", build(runtime, "maushold", { abilityId: "technician" }), build(runtime, "garchomp", { abilityId: "roughskin" }), { gameType });
        // Showdown: 9 x 15 at the lowest roll, 9 x 18 at the highest, Maushold at 0 HP; the 183 HP target stays in.
        expect(bomb, `${runtime.profile.id} ${gameType}`).toMatchObject({ kind: "calculated", hits: 9, min: 135, max: 162, attackerFaintsOnHit: { hit: 9, of: 10, by: ["Rough Skin"] }, ohkoChance: 0 });
        expect(bomb.rolls).toEqual(perHit(9, BOMB_HIT));
        expect(bomb.hitChances).toBeUndefined();
        expect(bomb.assumptions).toContain("Maushold faints on hit 9 of 10 (Rough Skin).");
        expect(bomb.assumptions).not.toContain("No one-use KO chance for multiple hits.");
        expect(bomb.assumptions.some((line) => /all 10 hits land|Assumes all|retaliation/.test(line))).toBe(false);
      }
    }
  });

  it("counts Rocky Helmet's 1/6, alone and after Rough Skin, and Iron Barbs", async () => {
    const maushold = build(championsRuntime, "maushold", { abilityId: "technician" });
    // 24 per hit: Maushold faints on hit 7 (Showdown 105–126).
    const helmet = row(championsRuntime, "populationbomb", maushold, build(championsRuntime, "garchomp", { abilityId: "sandveil", itemId: "rockyhelmet" }));
    expect(helmet).toMatchObject({ hits: 7, min: 105, max: 126, attackerFaintsOnHit: { hit: 7, of: 10, by: ["Rocky Helmet"] } });
    // 18 + 24 per hit: on hit 4 (Showdown 60–72).
    const both = row(championsRuntime, "populationbomb", maushold, build(championsRuntime, "garchomp", { abilityId: "roughskin", itemId: "rockyhelmet" }));
    expect(both).toMatchObject({ hits: 4, min: 60, max: 72, attackerFaintsOnHit: { hit: 4, of: 10, by: ["Rough Skin", "Rocky Helmet"] } });
    expect(both.assumptions).toContain("Maushold faints on hit 4 of 10 (Rough Skin and Rocky Helmet).");
    // Iron Barbs and Rocky Helmet on Ferrothorn: Cinccino's Skill Link Tail Slap stops on hit 4 (Showdown 24–28).
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    const barbs = row(us, "tailslap", build(us, "cinccino", { abilityId: "skilllink" }), build(us, "ferrothorn", { abilityId: "ironbarbs", itemId: "rockyhelmet" }));
    expect(barbs).toMatchObject({ hits: 4, min: 24, max: 28, attackerFaintsOnHit: { hit: 4, of: 5, by: ["Iron Barbs", "Rocky Helmet"] } });
    expect(barbs.assumptions).toContain("Skill Link: 5 hits.");
  });

  it("starts from the attacker's current HP, and a chosen count it survives is not cut", () => {
    const garchomp = build(championsRuntime, "garchomp", { abilityId: "roughskin" });
    // 40 HP: on hit 3 (Showdown 45–54).
    expect(row(championsRuntime, "populationbomb", build(championsRuntime, "maushold", { abilityId: "technician", currentHP: 40 }), garchomp))
      .toMatchObject({ hits: 3, min: 45, max: 54, attackerFaintsOnHit: { hit: 3, of: 10 } });
    // 5 hits leave it at 59 HP (Showdown 75–90).
    const five = row(championsRuntime, "populationbomb", build(championsRuntime, "maushold", { abilityId: "technician" }), garchomp, {}, { hits: 5 });
    expect(five).toMatchObject({ hits: 5, min: 75, max: 90 });
    expect(five.attackerFaintsOnHit).toBeUndefined();
    expect(five.assumptions).toContain("Population Bomb: 5 of 10 hits land.");
  });

  it("cuts nothing for Magic Guard, Protective Pads, Long Reach or a Punching Glove's punch", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const roughSkin = build(sv, "garchomp", { abilityId: "roughskin" });
    // Clefable at 1 HP keeps it through both hits (Showdown 24–30).
    const guarded = row(championsRuntime, "dualwingbeat", build(championsRuntime, "clefable", { abilityId: "magicguard", currentHP: 1 }), build(championsRuntime, "garchomp", { abilityId: "roughskin", itemId: "rockyhelmet" }));
    expect(guarded).toMatchObject({ hits: 2, min: 24, max: 30 });
    expect(guarded.attackerFaintsOnHit).toBeUndefined();
    // Showdown 150–180, Maushold untouched.
    expect(row(sv, "populationbomb", build(sv, "maushold", { abilityId: "technician", itemId: "protectivepads" }), roughSkin)).toMatchObject({ hits: 10, min: 150, max: 180 });
    // Showdown 34–42.
    expect(row(sv, "dualwingbeat", build(sv, "decidueye", { abilityId: "longreach", currentHP: 1 }), roughSkin)).toMatchObject({ hits: 2, min: 34, max: 42 });
    // Surging Strikes always crits; with Punching Glove it makes no contact (Showdown 99–120), without it Urshifu
    // faints on hit 2 at 30 HP (Showdown 60–72).
    const glove = row(sv, "surgingstrikes", build(sv, "urshifurapidstrike", { abilityId: "unseenfist", itemId: "punchingglove", currentHP: 1 }), roughSkin);
    expect(glove).toMatchObject({ hits: 3, min: 99, max: 120 });
    expect(glove.attackerFaintsOnHit).toBeUndefined();
    expect(row(sv, "surgingstrikes", build(sv, "urshifurapidstrike", { abilityId: "unseenfist", currentHP: 30 }), roughSkin))
      .toMatchObject({ hits: 2, min: 60, max: 72, attackerFaintsOnHit: { hit: 2, of: 3 } });
  });

  it("follows Mold Breaker (Rough Skin is not breakable), Neutralizing Gas and Magic Room", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    // Mold Breaker still takes Rough Skin: on hit 1 of 2 at 1 HP (Showdown 24–28; Ultra Sun/Ultra Moon 22–27).
    expect(row(sv, "dualwingbeat", build(sv, "hawlucha", { abilityId: "moldbreaker", currentHP: 1 }), build(sv, "garchomp", { abilityId: "roughskin" })))
      .toMatchObject({ hits: 1, min: 24, max: 28, attackerFaintsOnHit: { hit: 1, of: 2, by: ["Rough Skin"] } });
    expect(row(us, "doublekick", build(us, "sawk", { abilityId: "moldbreaker", currentHP: 1 }), build(us, "garchomp", { abilityId: "roughskin" })))
      .toMatchObject({ hits: 1, min: 22, max: 27, attackerFaintsOnHit: { hit: 1, of: 2 } });
    // The target's Neutralizing Gas suppresses Technician but not its Rocky Helmet: on hit 7 (Showdown 49–70) ...
    const maushold = build(sv, "maushold", { abilityId: "technician" });
    expect(row(sv, "populationbomb", maushold, build(sv, "weezinggalar", { abilityId: "neutralizinggas", itemId: "rockyhelmet" })))
      .toMatchObject({ hits: 7, min: 49, max: 70, attackerFaintsOnHit: { hit: 7, of: 10, by: ["Rocky Helmet"] } });
    // ... and the attacker's Magic Guard: Clefable faints on hit 1 at 20 HP (Showdown 11–13).
    expect(row(sv, "dualwingbeat", build(sv, "clefable", { abilityId: "magicguard", currentHP: 20 }), build(sv, "weezinggalar", { abilityId: "neutralizinggas", itemId: "rockyhelmet" })))
      .toMatchObject({ hits: 1, min: 11, max: 13, attackerFaintsOnHit: { hit: 1, of: 2 } });
    // Magic Room stops the Rocky Helmet, not Rough Skin: on hit 9 (Showdown 135–162).
    expect(row(sv, "populationbomb", maushold, build(sv, "garchomp", { abilityId: "roughskin", itemId: "rockyhelmet" }), { magicRoom: true }))
      .toMatchObject({ hits: 9, min: 135, max: 162, attackerFaintsOnHit: { hit: 9, of: 10, by: ["Rough Skin"] } });
  });
});

describe("the attacker's own berry, and Jaboca and Rowap Berries", () => {
  it("eats its Sitrus Berry at a hit's Update (Cheek Pouch heals more), unless the target's Unnerve stops it", async () => {
    // Sitrus after hit 5: every hit lands, Maushold at 6 HP (Showdown 150–180).
    expect(row(championsRuntime, "populationbomb", build(championsRuntime, "maushold", { abilityId: "technician", itemId: "sitrusberry" }), build(championsRuntime, "garchomp", { abilityId: "roughskin" })))
      .toMatchObject({ hits: 10, min: 150, max: 180 });
    const sv = await loadBattleRuntime("scarlet_violet");
    // Cheek Pouch: Maushold at 55 HP (Showdown 100–130, no Technician).
    expect(row(sv, "populationbomb", build(sv, "maushold", { abilityId: "cheekpouch", itemId: "sitrusberry" }), build(sv, "garchomp", { abilityId: "roughskin" })))
      .toMatchObject({ hits: 10, min: 100, max: 130 });
    // Corviknight's Rocky Helmet: the Sitrus Berry holds Maushold to hit 8, the target's Unnerve to hit 7 (Showdown 56–72 and 49–63).
    const maushold = build(sv, "maushold", { abilityId: "technician", itemId: "sitrusberry" });
    expect(row(sv, "populationbomb", maushold, build(sv, "corviknight", { abilityId: "pressure", itemId: "rockyhelmet" }))).toMatchObject({ hits: 8, min: 56, max: 72, attackerFaintsOnHit: { hit: 8 } });
    expect(row(sv, "populationbomb", maushold, build(sv, "corviknight", { abilityId: "unnerve", itemId: "rockyhelmet" }))).toMatchObject({ hits: 7, min: 49, max: 63, attackerFaintsOnHit: { hit: 7 } });
  });

  it("eats an Oran Berry, Berry Juice or (Ultra Sun/Ultra Moon: half) Figy Berry the same way", async () => {
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    const roughSkin = build(us, "garchomp", { abilityId: "roughskin" });
    const cinccino = (itemId: string, currentHP: number) => build(us, "cinccino", { abilityId: "skilllink", itemId, currentHP });
    // Rough Skin 18 a hit from 40: Oran's 10 lasts to hit 3, Berry Juice's 20 to hit 4 (Showdown 48–57, 64–76);
    // from 60 the Figy Berry's 75 lasts all 5 (Showdown 80–95, Cinccino at 45).
    expect(row(us, "tailslap", cinccino("oranberry", 40), roughSkin)).toMatchObject({ hits: 3, min: 48, max: 57, attackerFaintsOnHit: { hit: 3, of: 5 } });
    expect(row(us, "tailslap", cinccino("berryjuice", 40), roughSkin)).toMatchObject({ hits: 4, min: 64, max: 76, attackerFaintsOnHit: { hit: 4, of: 5 } });
    const figy = row(us, "tailslap", cinccino("figyberry", 60), roughSkin);
    expect(figy).toMatchObject({ hits: 5, min: 80, max: 95 });
    expect(figy.attackerFaintsOnHit).toBeUndefined();
  });

  it("switches the target's Rocky Helmet off with its Klutz", async () => {
    const ss = await loadBattleRuntime("sword_shield");
    const bewear = (abilityId: string) => {
      const target = build(ss, "bewear", { abilityId, itemId: "rockyhelmet" });
      if (target.game !== "champions") target.native = { ...target.native, evs: { ...target.native.evs, hp: 252, def: 252 } };
      return target;
    };
    const cinccino = build(ss, "cinccino", { abilityId: "skilllink", currentHP: 30 });
    // Showdown: all 5 hits into Klutz (65–80), the second the last into Unnerve (26–32).
    expect(row(ss, "tailslap", cinccino, bewear("klutz"))).toMatchObject({ hits: 5, min: 65, max: 80 });
    expect(row(ss, "tailslap", cinccino, bewear("unnerve"))).toMatchObject({ hits: 2, min: 26, max: 32, attackerFaintsOnHit: { hit: 2, of: 5, by: ["Rocky Helmet"] } });
  });

  it("takes a Jaboca Berry's 1/8 once (1/4 with Ripen), not through the attacker's Unnerve", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // 18 + 18, then 18 a hit: on hit 8 (Showdown 120–144).
    expect(row(sv, "populationbomb", build(sv, "maushold", { abilityId: "technician" }), build(sv, "garchomp", { abilityId: "roughskin", itemId: "jabocaberry" })))
      .toMatchObject({ hits: 8, min: 120, max: 144, attackerFaintsOnHit: { hit: 8, of: 10, by: ["Rough Skin", "Jaboca Berry"] } });
    // Ripen's 37 at 30 HP: on the first hit, so it is one hit with its own KO chance (Showdown 16–21).
    const ripen = row(sv, "populationbomb", build(sv, "maushold", { abilityId: "technician", currentHP: 30 }), build(sv, "flapple", { abilityId: "ripen", itemId: "jabocaberry" }));
    expect(ripen).toMatchObject({ hits: 1, min: 16, max: 21, ohkoChance: 0, attackerFaintsOnHit: { hit: 1, of: 10, by: ["Jaboca Berry"] } });
    expect(Array.isArray(ripen.rolls) && ripen.rolls.length === 16 && !Array.isArray(ripen.rolls[0])).toBe(true);
    expect(ripen.assumptions).not.toContain("No one-use KO chance for multiple hits.");
    // Without Ripen, 18 leaves Maushold at 2 HP from 20 (Showdown 130–160 into a 252 HP / 252 Def Appletun).
    const appletun = build(sv, "appletun", { abilityId: "gluttony", itemId: "jabocaberry" });
    if (appletun.game !== "champions") appletun.native = { ...appletun.native, evs: { ...appletun.native.evs, hp: 252, def: 252 } };
    expect(row(sv, "populationbomb", build(sv, "maushold", { abilityId: "technician", currentHP: 20 }), appletun)).toMatchObject({ hits: 10, min: 130, max: 160 });
    // Corviknight's Unnerve keeps the target from eating it: both hits at 1 HP (Showdown 44–54).
    expect(row(sv, "dualwingbeat", build(sv, "corviknight", { abilityId: "unnerve", currentHP: 1 }), build(sv, "garchomp", { abilityId: "sandveil", itemId: "jabocaberry" })))
      .toMatchObject({ hits: 2, min: 44, max: 54 });
  });

  it("stops Dragon Darts against one target, and leaves each dart into two foes one hit", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const dragapult = build(sv, "dragapult", { abilityId: "clearbody", currentHP: 10 });
    const jaboca = build(sv, "garchomp", { abilityId: "sandveil", itemId: "jabocaberry" });
    // Showdown 68–84 for the first dart; the second never lands.
    expect(row(sv, "dragondarts", dragapult, jaboca)).toMatchObject({ hits: 1, min: 68, max: 84, attackerFaintsOnHit: { hit: 1, of: 2, by: ["Jaboca Berry"] } });
    expect(row(sv, "dragondarts", dragapult, jaboca, { gameType: "Doubles", multipleTargets: false })).toMatchObject({ hits: 1, attackerFaintsOnHit: { hit: 1, of: 2 } });
    const split = row(sv, "dragondarts", dragapult, jaboca, { gameType: "Doubles", multipleTargets: true });
    expect(split).toMatchObject({ kind: "calculated", hits: 1 });
    expect(split.attackerFaintsOnHit).toBeUndefined();
  });

  it("reruns a later hit whose attacker changed: Torrent, Swarm, Defeatist, and a Liechi Berry's stage", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const ss = await loadBattleRuntime("sword_shield");
    // Rowap Berry takes Greninja from 60 to 42 HP, under a third: Torrent from hit 2 (Showdown 10 + 16, 13 + 4 x 19).
    const torrent = row(sv, "watershuriken", build(sv, "greninja", { abilityId: "torrent", currentHP: 60 }), build(sv, "garchomp", { abilityId: "sandveil", itemId: "rowapberry" }));
    expect(torrent).toMatchObject({ hits: 5, min: 26, max: 89 });
    expect((torrent.rolls as number[][]).map((rolls) => [Math.min(...rolls), Math.max(...rolls)])).toEqual([[10, 13], [16, 19], [16, 19], [16, 19], [16, 19]]);
    // Jaboca Berry, Swarm from hit 2 (Showdown 18 + 27, 22 + 4 x 33).
    expect(row(sv, "pinmissile", build(sv, "heracross", { abilityId: "swarm", currentHP: 60 }), build(sv, "garchomp", { abilityId: "sandveil", itemId: "jabocaberry" })))
      .toMatchObject({ hits: 5, min: 45, max: 154 });
    // Rough Skin takes Archeops to half HP: Defeatist halves hit 2 (Showdown 33 + 16 and 39 + 21).
    expect(row(ss, "dualwingbeat", build(ss, "archeops", { abilityId: "defeatist", currentHP: 80 }), build(ss, "garchomp", { abilityId: "roughskin" }))).toMatchObject({ hits: 2, min: 49, max: 60 });
    // Liechi Berry after hit 7: hits 8 and 9 at +1 (Showdown 7 x 15 + 2 x 22, 7 x 18 + 2 x 27).
    expect(row(sv, "populationbomb", build(sv, "maushold", { abilityId: "technician", itemId: "liechiberry" }), build(sv, "garchomp", { abilityId: "roughskin" })))
      .toMatchObject({ hits: 9, min: 149, max: 180, attackerFaintsOnHit: { hit: 9, of: 10 } });
    // Contrary: -1 from hit 2 (Showdown 18 + 12, 22 + 4 x 16); Ripen and Simple: +2 (Showdown 17 + 34 and 16 + 31).
    expect(row(sv, "scaleshot", build(sv, "serperior", { abilityId: "contrary", itemId: "liechiberry", currentHP: 50 }), build(sv, "garchomp", { abilityId: "sandveil", itemId: "jabocaberry" })))
      .toMatchObject({ hits: 5, min: 30, max: 86 });
    expect(row(ss, "dualwingbeat", build(ss, "flapple", { abilityId: "ripen", itemId: "liechiberry", currentHP: 50 }), build(ss, "garchomp", { abilityId: "roughskin" }))).toMatchObject({ hits: 2, min: 51, max: 62 });
    expect(row(ss, "dualwingbeat", build(ss, "swoobat", { abilityId: "simple", itemId: "liechiberry", currentHP: 50 }), build(ss, "garchomp", { abilityId: "roughskin" }))).toMatchObject({ hits: 2, min: 47, max: 56 });
    // Gluttony's Figy Berry at half HP changes no damage (Showdown 32–95).
    expect(row(ss, "tailslap", build(ss, "greedent", { abilityId: "gluttony", itemId: "figyberry", currentHP: 120 }), build(ss, "garchomp", { abilityId: "roughskin" })))
      .toMatchObject({ hits: 5, min: 32, max: 95 });
  });
});

describe("Parental Bond, draining and random counts", () => {
  it("stops Parental Bond's second strike, and draining makes the faint follow the first strike's roll", async () => {
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    const kangaskhan = (currentHP: number) => build(us, "kangaskhanmega", { abilityId: "parentalbond", itemId: "kangaskhanite", currentHP });
    const roughSkin = build(us, "garchomp", { abilityId: "roughskin" });
    // Rough Skin's 22 at 20 HP: one strike, with its own KO chance (Showdown 73–87).
    const ret = row(us, "return", kangaskhan(20), roughSkin);
    expect(ret).toMatchObject({ hits: 1, min: 73, max: 87, ohkoChance: 0, attackerFaintsOnHit: { hit: 1, of: 2, by: ["Rough Skin"] } });
    expect(ret.assumptions).toContain("Kangaskhan-Mega faints on hit 1 of 2 (Rough Skin).");
    // Drain Punch at 2 HP: it faints on the first strike at rolls 85-95 (36–40 drains 18–20), lands both at 96-100
    // (Showdown: 36 alone at the lowest roll, 43 + 11 at the highest).
    const drain = row(us, "drainpunch", kangaskhan(2), roughSkin);
    expect(drain).toMatchObject({ hits: 2, min: 36, max: 54 });
    expect(drain.attackerFaintsOnHit).toBeUndefined();
    expect(drain.assumptions).toContain("Kangaskhan-Mega faints on hit 1 of 2 (Rough Skin) on 68.75% of rolls.");
    // Liquid Ooze turns the drain into damage: 20 HP ends at 5 or 1, both strikes land, so 2 hits (Showdown 29–36).
    const ooze = row(us, "drainpunch", kangaskhan(20), build(us, "tentacruel", { abilityId: "liquidooze" }));
    expect(ooze).toMatchObject({ hits: 2, min: 29, max: 36 });
    expect(ooze.attackerFaintsOnHit).toBeUndefined();
  });

  it("merges the counts a faint cuts short into the hit it faints on", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // 18 + 25 a hit: Cinccino faints on hit 4 (Showdown 2 x 22 at the lowest roll, 4 x 27 at the highest).
    const slap = row(sv, "tailslap", build(sv, "cinccino", { abilityId: "technician" }), build(sv, "garchomp", { abilityId: "roughskin", itemId: "rockyhelmet" }));
    expect(slap).toMatchObject({ hits: 4, min: 44, max: 108, attackerFaintsOnHit: { hit: 4, of: 5 } });
    expect(slap.hitChances).toEqual([{ hits: 2, chance: 7 / 20 }, { hits: 3, chance: 7 / 20 }, { hits: 4, chance: 3 / 10 }]);
    expect(slap.assumptions).toContain("Tail Slap: 2–4 hits (2 and 3: 35% each, 4: 30%).");
    expect(slap.assumptions).toContain("Cinccino faints on hit 4 of 4 or 5 (Rough Skin and Rocky Helmet).");
    // Loaded Dice Population Bomb into Rough Skin (Showdown 4 x 15, 9 x 18).
    const bomb = row(sv, "populationbomb", build(sv, "maushold", { abilityId: "technician", itemId: "loadeddice" }), build(sv, "garchomp", { abilityId: "roughskin" }));
    expect(bomb).toMatchObject({ hits: 9, min: 60, max: 162, attackerFaintsOnHit: { hit: 9, of: 10 } });
    expect(bomb.hitChances?.map(({ hits }) => hits)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(bomb.hitChances?.[5].chance).toBeCloseTo(2 / 7, 12);
    expect(bomb.assumptions).toContain("Population Bomb: 4–9 hits (Loaded Dice; 4–8: 14.29% each, 9: 28.57%).");
    expect(bomb.assumptions).toContain("Maushold faints on hit 9 of 9 or 10 (Rough Skin).");
    // Every count reaching the faint: one count, so no range (Showdown 2 x 28 ... the Jaboca Berry at 1 HP stops hit 2).
    const one = row(sv, "bulletseed", build(sv, "breloom", { abilityId: "technician", currentHP: 1 }), build(sv, "garchomp", { abilityId: "sandveil", itemId: "jabocaberry" }));
    expect(one).toMatchObject({ hits: 1, min: 28, max: 34, attackerFaintsOnHit: { hit: 1, of: 5 } });
    expect(one.hitChances).toBeUndefined();
    expect(one.assumptions).toContain("Breloom faints on hit 1 of 2–5 (Jaboca Berry).");
  });

  it("hits once as a Z-Move, so nothing is cut", async () => {
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    // Showdown: Breakneck Blitz 79–94 at 1 HP, Cinccino left at 1 HP (a Z-Move makes no contact here).
    const z = row(us, "tailslap", build(us, "cinccino", { abilityId: "skilllink", itemId: "normaliumz", currentHP: 1 }), build(us, "garchomp", { abilityId: "roughskin" }), {}, { useZ: true });
    expect(z).toMatchObject({ hits: 1, min: 79, max: 94 });
    expect(z.attackerFaintsOnHit).toBeUndefined();
  });
});

describe("Mummy, Lingering Aroma and Wandering Spirit in the damage of later hits", () => {
  it("replace the attacker's Technician after a contact hit, except through Protective Pads or Ability Shield", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const oinkologne = build(sv, "oinkologne", { abilityId: "lingeringaroma" });
    const cinccino = (itemId: string) => build(sv, "cinccino", { abilityId: "technician", itemId });
    // Showdown, 5 hits: 25 then 4 x 18 at the lowest roll, 31 then 4 x 22 at the highest.
    const replaced = row(sv, "tailslap", cinccino(""), oinkologne, {}, { hits: 5 });
    expect(replaced).toMatchObject({ min: 97, max: 119 });
    // No contact or no replacement: 5 x 25 to 5 x 31.
    for (const itemId of ["protectivepads", "abilityshield"]) {
      expect(row(sv, "tailslap", cinccino(itemId), oinkologne, {}, { hits: 5 }), itemId).toMatchObject({ min: 125, max: 155 });
    }
  });
});

describe("hit-loop.ts against pinned Showdown's HP from hit to hit", () => {
  const input = (extra: Partial<HitLoopInput>): HitLoopInput => ({
    hp: 100, maxHP: 180, baseMaxHP: 180, attackerAbility: "", attackerItem: "", targetAbility: "", targetItem: "", attackerShielded: false, targetShielded: false,
    targetDynamaxed: false, contact: true, category: "Physical", drain: null, takesBerry: false, targetGulping: false, generation: 9, ...extra,
  });

  it("lets Mummy, Lingering Aroma and Wandering Spirit replace Magic Guard after the first hit, not past Ability Shield", () => {
    // Clefable (170 HP) at 60 into a Rocky Helmet: the first hit is guarded, the second takes 28 (Showdown 32 after Dual Wingbeat).
    for (const targetAbility of ["mummy", "lingeringaroma", "wanderingspirit"]) {
      const walk = walkHits(input({ hp: 60, maxHP: 170, baseMaxHP: 170, attackerAbility: "magicguard", targetAbility, targetItem: "rockyhelmet" }), 2);
      expect(walk.before.map((state) => state.hp), targetAbility).toEqual([60, 60]);
      expect(walk.after.hp).toBe(32);
      expect(walk.after.attackerAbility).toBe(targetAbility);
      expect(walk.after.targetAbility).toBe(targetAbility === "wanderingspirit" ? "magicguard" : targetAbility);
    }
    // Ability Shield keeps Magic Guard (Showdown: 20 HP after both hits).
    expect(walkHits(input({ hp: 20, maxHP: 170, baseMaxHP: 170, attackerAbility: "magicguard", attackerItem: "abilityshield", attackerShielded: true, targetAbility: "lingeringaroma", targetItem: "rockyhelmet" }), 2).after.hp).toBe(20);
    // Wandering Spirit hands the target the attacker's Rough Skin for the next hit.
    const handed = walkHits(input({ hp: 30, attackerAbility: "roughskin", targetAbility: "wanderingspirit" }), 3);
    expect(handed.before.map((state) => state.hp)).toEqual([30, 30, 8]);
    expect(handed.faint).toEqual({ hit: 3, by: ["Rough Skin"] });
  });

  it("drains before the target's handlers, with Big Root, and Liquid Ooze turns it into damage", () => {
    const kangaskhan = (extra: Partial<HitLoopInput>) => input({ drain: [1, 2], ...extra });
    // Big Root at 10 HP into Rough Skin: 29 dealt heals 19 (to 29), Rough Skin 22 (7); 7 dealt heals 5 (12), then 0.
    const bigRoot = walkHits(kangaskhan({ hp: 10, attackerItem: "bigroot", targetAbility: "roughskin" }), 2, (hit) => [29, 7][hit - 1]);
    expect(bigRoot.before.map((state) => state.hp)).toEqual([10, 7]);
    expect(bigRoot.faint).toEqual({ hit: 2, by: ["Rough Skin"] });
    expect(walkHits(kangaskhan({ hp: 10, attackerItem: "bigroot", targetAbility: "roughskin" }), 2, (hit) => [35, 9][hit - 1]).before[1].hp).toBe(11);
    // Liquid Ooze deals the unboosted drain: 30 -> 20 -> 18 (19 + 4 dealt), 30 -> 18 -> 15 (23 + 5), and at full HP 168.
    expect(walkHits(kangaskhan({ hp: 30, attackerItem: "bigroot", targetAbility: "liquidooze" }), 2, (hit) => [19, 4][hit - 1]).after.hp).toBe(18);
    expect(walkHits(kangaskhan({ hp: 30, attackerItem: "bigroot", targetAbility: "liquidooze" }), 2, (hit) => [23, 5][hit - 1]).after.hp).toBe(15);
    expect(walkHits(kangaskhan({ hp: 180, targetAbility: "liquidooze" }), 2, (hit) => [19, 4][hit - 1]).after.hp).toBe(168);
    // Mega Kangaskhan at 20 into Liquid Ooze: 5 after 24 + 5, 1 after 29 + 7 (Showdown).
    expect(walkHits(kangaskhan({ hp: 20, targetAbility: "liquidooze" }), 2, (hit) => [24, 5][hit - 1]).after.hp).toBe(5);
    expect(walkHits(kangaskhan({ hp: 20, targetAbility: "liquidooze" }), 2, (hit) => [29, 7][hit - 1]).after.hp).toBe(1);
    // The roll paths: at 2 HP into Rough Skin it faints on the first strike for 11 of its 16 rolls.
    const rolls = [[36, 36, 37, 37, 38, 38, 39, 39, 39, 40, 40, 41, 41, 42, 42, 43], [9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11]];
    const paths = hitPaths(kangaskhan({ hp: 2, targetAbility: "roughskin" }), rolls);
    expect(paths.faints[0]).toBeCloseTo(11 / 16, 12);
    expect(paths).toMatchObject({ min: 36, max: 54 });
  });

  it("eats the attacker's berry at each hit's Update: Sitrus, Cheek Pouch, Gluttony's Figy Berry", () => {
    // Maushold (149 HP) into Rough Skin, ten hits: 6 HP with a Sitrus Berry, 55 with Cheek Pouch too (Showdown).
    expect(walkHits(input({ hp: 149, maxHP: 149, baseMaxHP: 149, attackerItem: "sitrusberry", targetAbility: "roughskin" }), 10).after.hp).toBe(6);
    expect(walkHits(input({ hp: 149, maxHP: 149, baseMaxHP: 149, attackerAbility: "cheekpouch", attackerItem: "sitrusberry", targetAbility: "roughskin" }), 10).after.hp).toBe(55);
    // Greedent (195 HP) at 120: two hits leave 137, five leave 65 (Showdown, Sword/Shield).
    const greedent = input({ hp: 120, maxHP: 195, baseMaxHP: 195, attackerAbility: "gluttony", attackerItem: "figyberry", targetAbility: "roughskin", generation: 8 });
    expect(walkHits(greedent, 2).after.hp).toBe(137);
    expect(walkHits(greedent, 5).after.hp).toBe(65);
    // A pinch berry's stage: Liechi Berry after hit 7 (Maushold), x2 with Ripen or Simple, reversed by Contrary.
    const liechi = walkHits(input({ hp: 149, maxHP: 149, baseMaxHP: 149, attackerItem: "liechiberry", targetAbility: "roughskin" }), 10);
    expect(liechi.before.map((state) => state.stages.atk ?? 0)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1]);
    for (const [attackerAbility, stage] of [["ripen", 2], ["simple", 2], ["contrary", -1]] as const) {
      expect(hitStep(input({ hp: 40, attackerAbility, attackerItem: "liechiberry", targetAbility: "roughskin" }), startHits(input({ hp: 40, attackerAbility, attackerItem: "liechiberry", targetAbility: "roughskin" })), 0).state.stages.atk).toBe(stage);
    }
  });

  it("takes the Jaboca or Rowap Berry only from the matching category, once, and none through Magic Guard", () => {
    const jaboca = input({ hp: 30, baseMaxHP: 149, maxHP: 149, targetItem: "jabocaberry", contact: false });
    expect(walkHits(jaboca, 3).before.map((state) => state.hp)).toEqual([30, 12, 12]);
    expect(walkHits({ ...jaboca, category: "Special" }, 3).after.hp).toBe(30);
    expect(walkHits({ ...jaboca, targetItem: "rowapberry", category: "Special" }, 3).after.hp).toBe(12);
    expect(walkHits({ ...jaboca, attackerAbility: "magicguard" }, 3).after).toMatchObject({ hp: 30, targetItem: "jabocaberry" });
    // Bug Bite, Pluck and Incinerate take it in their onHit, before it can act.
    expect(walkHits({ ...jaboca, takesBerry: true }, 2).after).toMatchObject({ hp: 30, targetItem: "" });
  });
});
