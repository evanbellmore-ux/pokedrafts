import { beforeAll, describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { USES_REFERENCE } from "@/app/lib/battle/uses-to-ko";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext, MoveDamageResult, StatTable, UsesToKO } from "@/app/lib/battle/types";

/**
 * Uses to KO for random hit counts and an attacker that faints mid-move. Each use rolls its own hit count with
 * pinned Showdown's chances (2-5 hit moves 35/35/15/15%, Loaded Dice 4 or 5 at 50% each, Loaded Dice
 * Population Bomb 4-10 at 1/7 each), and the target's Rough Skin, Iron Barbs, Rocky Helmet or Jaboca Berry
 * (and Liquid Ooze on draining) stops a use's hits once the attacker faints, from the HP each use starts at.
 * Every count and chance here is from scripts/.cache/calc-audit/hit-ranges/uses/: a brute-force count over every
 * hit count and every hit's roll written apart from app/lib/battle (brute.ts), which matched pinned Showdown
 * c23d2e94 battles on every forced sequence (a count and a roll per use, and a roll per hit, through
 * hitStepMoveHitLoop's own sample() and random()), and 20,000 real-randomness Showdown battles per case
 * within 4 standard errors (sample.ts). Level 50, 31 IVs and Serious, no EVs, Singles.
 */
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) runtimes[game] = await loadBattleRuntime(game);
  runtimes.champions = championsRuntime;
});
const S = "scarlet_violet", W = "sword_shield", U = "ultra_sun_ultra_moon", C = "champions";

type Spec = { ability?: string; item?: string; evs?: Partial<StatTable<number>>; hp?: number; mechanic?: BattleBuild["mechanic"] };
function build(game: BattleGame, id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, runtimes[game]);
  const shared = {
    ...(spec.ability ? { abilityId: spec.ability } : {}), itemId: spec.item ?? "", ...(spec.hp !== undefined ? { currentHP: spec.hp } : {}),
    ...(spec.mechanic ? { mechanic: spec.mechanic } : {}),
  };
  if (base.game === "champions") return { ...base, ...shared, points: { ...base.points, ...spec.evs } } as BattleBuild;
  return { ...base, ...shared, native: { ...base.native, evs: { ...base.native.evs, ...spec.evs } } } as BattleBuild;
}
function row(game: BattleGame, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, context?: MoveContext): MoveDamageResult {
  const result = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", multipleTargets: false, ...field }, context ? { [moveId]: context } : {}, runtimes[game]);
  expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
  const found = result.results.find((entry) => entry.moveId === moveId)!;
  expect(found.kind).toBe("calculated");
  return found;
}
type Counted = Extract<UsesToKO, { kind: "uses" }>;
function counted(value: UsesToKO | undefined): Counted {
  expect(value?.kind).toBe("uses");
  return value as Counted;
}
const uses = (...args: Parameters<typeof row>) => counted(row(...args).usesToKO);
const chomp = (game: BattleGame, spec: Spec = {}) => build(game, "garchomp", { ability: "roughskin", ...spec });

/**
 * An independent count over every hit count and every hit's roll (each equally likely): the chance the target
 * is out within each number of uses, with `chip` taken from the attacker's `hp` after each hit (no hit after it
 * faints, and a use it faints in with the target still in never knocks out).
 */
function everySequence(rolls: number[], counts: { hits: number; chance: number }[], targetHP: number, uses: number, attackerHP = Infinity, chip = 0): number[] {
  let states = new Map<string, [number, number, number]>([[`${targetHP},${attackerHP}`, [targetHP, attackerHP, 1]]]);
  const within: number[] = [];
  let out = 0;
  for (let use = 0; use < uses; use++) {
    const next = new Map<string, [number, number, number]>();
    for (const [target, attacker, mass] of states.values()) {
      for (const { hits, chance } of counts) {
        // The target's HP after each hit, with its mass (the attacker's HP is the same on every roll path).
        let layer = new Map<number, number>([[target, mass * chance]]);
        let left = attacker;
        for (let hit = 0; hit < hits && layer.size; hit++) {
          const after = new Map<number, number>();
          left -= chip;
          for (const [t, p] of layer) for (const roll of rolls) {
            if (t - roll <= 0) { out += p / rolls.length; continue; }
            if (left > 0) after.set(t - roll, (after.get(t - roll) ?? 0) + p / rolls.length);
          }
          layer = after;
        }
        for (const [t, p] of layer) { const key = `${t},${left}`; const entry = next.get(key); if (entry) entry[2] += p; else next.set(key, [t, left, p]); }
      }
    }
    states = next;
    within.push(out);
  }
  return within;
}
const TWO_TO_FIVE = [{ hits: 2, chance: 0.35 }, { hits: 3, chance: 0.35 }, { hits: 4, chance: 0.15 }, { hits: 5, chance: 0.15 }];
const perHit = (value: MoveDamageResult) => (value.rolls as number[][])[0];

describe("a random hit count on every use", () => {
  it("Bullet Seed: the fewest hits at the lowest rolls guarantee, every count and roll weighs the chance (Showdown 99.12% of 20,000 within 3)", () => {
    const value = row(S, "bulletseed", build(S, "breloom", { ability: "technician" }), chomp(S, { ability: "sandveil" }));
    expect(value.hitChances).toEqual(TWO_TO_FIVE);
    // 2 hits of 28 a use take 4 uses into 183 HP; 5 hits of 34 take 2.
    expect(value.usesToKO).toEqual({ kind: "uses", guaranteed: 4, fewest: 2, fasterChance: 0.9911362387910513, limit: 48, limitReason: "pp", carried: ["Each use has its own hit count (2–5)."], notes: [] });
    expect(everySequence(perHit(value), TWO_TO_FIVE, 183, 3)[2]).toBeCloseTo(0.9911362387910513, 10);
    // At 120 HP one use of 4 or 5 hits can knock it out: Showdown 98.79% within 2.
    const low = row(S, "bulletseed", build(S, "breloom", { ability: "technician" }), chomp(S, { ability: "sandveil", hp: 120 }));
    expect(low.usesToKO).toMatchObject({ guaranteed: 3, fewest: 1, fasterChance: 0.9873492431640652 });
    expect(everySequence(perHit(low), TWO_TO_FIVE, 120, 2)[1]).toBeCloseTo(0.9873492431640652, 10);
  });
  it("Loaded Dice Bullet Seed: 4 or 5 hits, so 2 uses whatever the rolls", () => {
    const value = row(S, "bulletseed", build(S, "breloom", { ability: "technician", item: "loadeddice" }), chomp(S, { ability: "sandveil" }));
    expect(value.hitChances).toEqual([{ hits: 4, chance: 0.5 }, { hits: 5, chance: 0.5 }]);
    expect(value.usesToKO).toMatchObject({ kind: "uses", guaranteed: 2, fewest: 2, carried: ["Each use has its own hit count (4–5)."], notes: [] });
  });
  it("Rock Blast: 10 uses at 2 hits of the lowest roll, 4 at 5 of the highest; at 60 HP Showdown 63.27% within 2", () => {
    expect(uses(S, "rockblast", build(S, "rhyperior", { ability: "solidrock" }), chomp(S, { ability: "sandveil" }))).toMatchObject({ guaranteed: 10, fewest: 4, fasterChance: 0.9999999999995397 });
    const low = row(S, "rockblast", build(S, "rhyperior", { ability: "solidrock" }), chomp(S, { ability: "sandveil", hp: 60 }));
    expect(low.usesToKO).toMatchObject({ guaranteed: 3, fewest: 1, fasterChance: 0.6343168640136726 });
    expect(everySequence(perHit(low), TWO_TO_FIVE, 60, 2)[1]).toBeCloseTo(0.6343168640136726, 10);
  });
  it("Loaded Dice Population Bomb: 4-10 hits at 1/7 each; at 100 HP Showdown 57.42% in one use", () => {
    const sevenths = [4, 5, 6, 7, 8, 9, 10].map((hits) => ({ hits, chance: 1 / 7 }));
    const value = row(S, "populationbomb", build(S, "maushold", { ability: "technician", item: "loadeddice" }), chomp(S, { ability: "sandveil" }));
    expect(value.usesToKO).toMatchObject({ guaranteed: 4, fewest: 2, fasterChance: 0.9999855318572743, carried: ["Each use has its own hit count (4–10)."], notes: [] });
    const low = row(S, "populationbomb", build(S, "maushold", { ability: "technician", item: "loadeddice" }), chomp(S, { ability: "sandveil", hp: 100 }));
    expect(low.usesToKO).toMatchObject({ guaranteed: 2, fewest: 1, fasterChance: 0.5724975892475671 });
    expect(everySequence(perHit(low), sevenths, 100, 1)[0]).toBeCloseTo(0.5724975892475671, 10);
  });
  it("a chosen count and Skill Link stay one count on every use", () => {
    const chosen = uses(S, "bulletseed", build(S, "breloom", { ability: "technician" }), chomp(S, { ability: "sandveil" }), {}, { hits: 3 });
    expect(chosen).toMatchObject({ guaranteed: 3, fewest: 2, notes: ["Assumes 3 hits on every use."] });
    expect(uses(S, "tailslap", build(S, "cinccino", { ability: "skilllink" }), chomp(S, { ability: "sandveil" })).notes).toEqual(["Assumes 5 hits on every use."]);
  });
});

describe("the attacker fainting mid-move, from the HP each use starts at", () => {
  it("Maushold faints on hit 9 of 10 into Rough Skin, so no use knocks Garchomp out (Champions and Scarlet/Violet)", () => {
    for (const game of [C, S] as const) {
      const value = row(game, "populationbomb", build(game, "maushold", { ability: "technician" }), chomp(game));
      expect(value).toMatchObject({ hits: 9, attackerFaintsOnHit: { hit: 9, of: 10, by: ["Rough Skin"] } });
      expect(value.usesToKO).toMatchObject({ kind: "uses", guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 1, highest: 1 }, notes: [] });
    }
    // A single target in Doubles: pinned Showdown hitStepMoveHitLoop stops the same way (targets.length === 1).
    const doubles = row(C, "populationbomb", build(C, "maushold", { ability: "technician" }), chomp(C), { gameType: "Doubles" });
    expect(doubles.usesToKO).toEqual(row(C, "populationbomb", build(C, "maushold", { ability: "technician" }), chomp(C)).usesToKO);
    // From 150 HP only 9 hits of the highest rolls knock it out: Showdown 0.14% of 20,000.
    expect(uses(C, "populationbomb", build(C, "maushold", { ability: "technician" }), chomp(C, { hp: 150 })))
      .toMatchObject({ guaranteed: null, fewest: 1, chance: 0.0012004397285636514, faintsFirst: true });
  });
  it("with Loaded Dice later uses land fewer hits as Maushold's HP falls: 9 hits in all on every sequence", () => {
    const dice = build(S, "maushold", { ability: "technician", item: "loadeddice" });
    expect(uses(S, "populationbomb", dice, chomp(S))).toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 3, highest: 1 } });
    // 4 hits leave 77 HP, so the next use faints it on hit 5: the chance is the 9 hits' alone, as without Loaded Dice.
    expect(uses(S, "populationbomb", dice, chomp(S, { hp: 150 }))).toMatchObject({ guaranteed: null, fewest: 1, chance: 0.0012004397285636514, attackerFaints: { lowest: 3, highest: 1 } });
  });
  it("Tail Slap into Rough Skin: 18 a hit from 150 HP (Showdown 76.49% within 2 at 120 HP)", () => {
    const value = row(S, "tailslap", build(S, "cinccino", { ability: "technician" }), chomp(S));
    expect(value.usesToKO).toMatchObject({ guaranteed: 5, fewest: 2, fasterChance: 0.9999025129556653, attackerFaints: { lowest: 5 } });
    const low = row(S, "tailslap", build(S, "cinccino", { ability: "technician" }), chomp(S, { hp: 120 }));
    expect(low.usesToKO).toMatchObject({ guaranteed: 3, fewest: 1, fasterChance: 0.7722489929199219 });
    expect(everySequence(perHit(low), TWO_TO_FIVE, 120, 2, 150, 18)[1]).toBeCloseTo(0.7722489929199219, 10);
    // From 132 HP the attacker can faint first: Showdown 99.28% before it does.
    const worn = uses(S, "tailslap", build(S, "cinccino", { ability: "technician", hp: 132 }), chomp(S));
    expect(worn).toMatchObject({ guaranteed: null, fewest: 2, chance: 0.9935035705566405, faintsFirst: true, attackerFaints: { lowest: 4 } });
    expect(everySequence(perHit(value), TWO_TO_FIVE, 183, 16, 132, 18)[15]).toBeCloseTo(0.9935035705566405, 10);
  });
  it("Leftovers between uses lets a later use land more hits: from 70 HP no KO without it, 39.93% with it (Showdown 40.57%)", () => {
    expect(uses(S, "tailslap", build(S, "cinccino", { ability: "technician", hp: 70 }), chomp(S, { hp: 120 })))
      .toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 2, highest: 1 } });
    expect(uses(S, "tailslap", build(S, "cinccino", { ability: "technician", item: "leftovers", hp: 70 }), chomp(S, { hp: 120 })))
      .toMatchObject({ guaranteed: null, fewest: 2, chance: 0.3992828369140624, faintsFirst: true, attackerFaints: { lowest: 3, highest: 1 } });
    expect(uses(S, "tailslap", build(S, "cinccino", { ability: "technician", item: "leftovers", hp: 132 }), chomp(S)))
      .toMatchObject({ guaranteed: null, fewest: 2, chance: 0.9987331962585447, faintsFirst: true });
  });
  it("the attacker's Sitrus Berry mid-move: from 80 HP the same chance as from full HP", () => {
    expect(uses(S, "tailslap", build(S, "cinccino", { ability: "technician", item: "sitrusberry", hp: 80 }), chomp(S, { hp: 120 })))
      .toMatchObject({ guaranteed: 3, fewest: 1, fasterChance: 0.7722489929199219 });
  });
  it("Rocky Helmet's 25 a hit, with Rough Skin 43, and Iron Barbs", () => {
    expect(uses(S, "tailslap", build(S, "cinccino", { ability: "technician" }), chomp(S, { ability: "sandveil", item: "rockyhelmet" })))
      .toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 3, highest: 2 } });
    const both = row(S, "tailslap", build(S, "cinccino", { ability: "technician" }), chomp(S, { item: "rockyhelmet" }));
    expect(both.attackerFaintsOnHit).toEqual({ hit: 4, of: 5, ofMin: 4, by: ["Rough Skin", "Rocky Helmet"] });
    expect(both.usesToKO).toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 2, highest: 1 }, carried: ["Each use has its own hit count (2–5)."], notes: [] });
    expect(uses(W, "tailslap", build(W, "cinccino", { ability: "technician" }), build(W, "ferrothorn", { ability: "ironbarbs" })))
      .toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 5, highest: 2 } });
  });
  it("Loaded Dice Tail Slap into Rough Skin", () => {
    expect(uses(S, "tailslap", build(S, "cinccino", { ability: "technician", item: "loadeddice" }), chomp(S)))
      .toMatchObject({ guaranteed: 3, fewest: 2, fasterChance: 0.9983758926391602, attackerFaints: { lowest: 3 } });
  });
  it("a Jaboca Berry hits back once: Dragon Darts from 10 HP faints on dart 1, from 30 HP both darts land", () => {
    const darts = row(S, "dragondarts", build(S, "dragapult", { ability: "clearbody", hp: 10 }), chomp(S, { ability: "sandveil", item: "jabocaberry" }));
    expect(darts.attackerFaintsOnHit).toEqual({ hit: 1, of: 2, by: ["Jaboca Berry"] });
    expect(darts.usesToKO).toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 1, highest: 1 } });
    expect(uses(S, "dragondarts", build(S, "dragapult", { ability: "clearbody", hp: 30 }), chomp(S, { ability: "sandveil", item: "jabocaberry" }))).toMatchObject({ guaranteed: 2, fewest: 2 });
    expect(uses(S, "bulletseed", build(S, "breloom", { ability: "technician", hp: 1 }), chomp(S, { ability: "sandveil", item: "jabocaberry" })))
      .toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, carried: ["Each use has its own hit count (2–5)."], notes: [] });
    // 20 HP survives its 18, and nothing hits back after.
    expect(uses(S, "tailslap", build(S, "cinccino", { ability: "technician", hp: 20 }), chomp(S, { ability: "sandveil", item: "jabocaberry" })))
      .toMatchObject({ guaranteed: 5, fewest: 2, fasterChance: 0.9999025129556656 });
  });
  it("Cheek Pouch heals as the Jaboca Berry is eaten on the first hit, before the next hits land", () => {
    expect(uses(S, "tailslap", build(S, "cinccino", { ability: "technician" }), build(S, "dedenne", { ability: "cheekpouch", item: "jabocaberry", hp: 60 })))
      .toMatchObject({ guaranteed: 2, fewest: 1, fasterChance: 0.4216796875 });
  });
  it("Magic Guard stops it until Mummy replaces it on the first hit (Showdown: Clefable faints after use 4)", () => {
    expect(uses(W, "dualwingbeat", build(W, "clefable", { ability: "magicguard" }), build(W, "cofagrigus", { ability: "mummy", item: "rockyhelmet" })))
      .toMatchObject({ guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 4, highest: 4 }, carried: ["The target's Mummy replaces the attacker's ability."] });
  });
});

describe("later hits that deal other damage, and draining", () => {
  it("Defeatist halves a later hit once Rough Skin takes Archeops to half HP: 4 uses, not 3", () => {
    expect(uses(W, "dualwingbeat", build(W, "archeops", { ability: "defeatist" }), chomp(W)))
      .toMatchObject({ guaranteed: 4, fewest: 3, fasterChance: 0.9996337890625, carried: ["Dual Wingbeat's damage follows the attacker's HP."] });
  });
  it("a Liechi Berry eaten mid-move raises the later hits' Attack", () => {
    expect(uses(S, "tailslap", build(S, "cinccino", { ability: "technician", item: "liechiberry" }), chomp(S))).toMatchObject({ guaranteed: 4, fewest: 2, fasterChance: 0.8285033646998927 });
  });
  it("Parental Bond's Drain Punch drains after each strike; into Liquid Ooze the drain hurts", () => {
    const kangaskhan = (hp: number) => build(U, "kangaskhanmega", { ability: "parentalbond", item: "kangaskhanite", hp });
    expect(uses(U, "drainpunch", kangaskhan(25), chomp(U, { hp: 100 }))).toMatchObject({ guaranteed: null, fewest: 2, chance: 0.3061676025390625, faintsFirst: true });
    expect(uses(U, "drainpunch", kangaskhan(30), build(U, "tentacruel", { ability: "liquidooze", hp: 60 })))
      .toMatchObject({ guaranteed: null, fewest: 2, chance: 0.73193359375, faintsFirst: true, attackerFaints: { lowest: 2, highest: 2 } });
  });
});

describe("the hit count of the uses after the first", () => {
  // scripts/.cache/calc-audit/hit-ranges/fix/sample.ts: 20,000 Showdown battles each, within 4 standard errors.
  it("Pickpocket takes Loaded Dice in the first use: 4–5 hits, then 2–5 (Showdown 49.58% in one use)", () => {
    const value = uses(S, "tailslap", build(S, "cinccino", { ability: "technician", item: "loadeddice" }), build(S, "weavile", { ability: "pickpocket" }));
    expect(value).toMatchObject({ guaranteed: 2, fewest: 1, fasterChance: 0.5, notes: [] });
    expect(value.carried).toEqual(["The target's Pickpocket takes the attacker's item.", "The first use has its own hit count (4–5), then each use has its own (2–5)."]);
  });
  it("Pickpocket takes Loaded Dice from Population Bomb: 4–10 hits, then all 10 (Showdown 5.03% in one use)", () => {
    const value = uses(S, "populationbomb", build(S, "maushold", { ability: "friendguard", item: "loadeddice" }), build(S, "weavile", { ability: "pickpocket" }));
    expect(value).toMatchObject({ guaranteed: 2, fewest: 1, fasterChance: 0.04827352821095181, notes: [] });
    expect(value.carried).toContain("The first use has its own hit count (4–10), then each use has 10 hits.");
  });
  it("Lingering Aroma replaces Skill Link in the first use: 5 hits, then 2–5 (Showdown 88.01% within 3)", () => {
    const value = uses(S, "tailslap", build(S, "cinccino", { ability: "skilllink" }), build(S, "oinkologne", { ability: "lingeringaroma" }));
    expect(value).toMatchObject({ guaranteed: 4, fewest: 2, fasterChance: 0.8835079286344262, notes: [] });
    expect(value.carried).toEqual(["The target's Lingering Aroma replaces the attacker's ability.", "The first use has 5 hits, then each use has its own hit count (2–5)."]);
  });
});

describe("a Dynamaxed attacker's own move after Dynamax ends", () => {
  // A Max Move never makes contact (pinned Showdown getActiveMaxMove), its own move does: Ferrothorn's Iron Barbs
  // takes 18 a hit from the fourth use on. Showdown, Dynamax on turn 1, 6,000 battles each (fix/sample.ts).
  it("follows the contact damage of the hits after Dynamax: no item 68.13% before the user faints, with Liechi 98.6%", () => {
    const ferrothorn = build(W, "ferrothorn", { ability: "ironbarbs", item: "leftovers", hp: 104 });
    const plain = uses(W, "tailslap", build(W, "cinccino", { ability: "technician", hp: 100, mechanic: "dynamax" }), ferrothorn);
    expect(plain).toMatchObject({ guaranteed: null, fewest: 4, chance: 0.6899154219348202, faintsFirst: true, attackerFaints: { lowest: 6 } });
    expect(plain.carried).toContain("After Dynamax ends, each use has its own hit count (2–5).");
    const liechi = uses(W, "tailslap", build(W, "cinccino", { ability: "technician", item: "liechiberry", hp: 100, mechanic: "dynamax" }), ferrothorn);
    expect(liechi).toMatchObject({ guaranteed: null, fewest: 4, chance: 0.985071417545405, faintsFirst: true });
  });
});

describe("self-check against the reference search, which reruns the whole calculation for every state", () => {
  const cases: [BattleGame, string, Spec, string, Spec][] = [
    [S, "cinccino", { ability: "technician", item: "loadeddice" }, "weavile", { ability: "pickpocket" }],
    [S, "cinccino", { ability: "skilllink" }, "oinkologne", { ability: "lingeringaroma" }],
    [S, "heracross", { ability: "guts" }, "cramorantgorging", { ability: "gulpmissile" }],
    [S, "cinccino", { ability: "technician", hp: 60 }, "cramorantgulping", { ability: "gulpmissile" }],
    [W, "cinccino", { ability: "technician", hp: 100, mechanic: "dynamax" }, "ferrothorn", { ability: "ironbarbs", item: "leftovers", hp: 104 }],
    [S, "breloom", { ability: "technician" }, "garchomp", { ability: "sandveil", hp: 120 }],
    [S, "cinccino", { ability: "technician" }, "garchomp", { ability: "roughskin", hp: 120 }],
    [S, "cinccino", { ability: "technician", item: "leftovers", hp: 70 }, "garchomp", { ability: "roughskin", item: "rockyhelmet" }],
    [S, "cinccino", { ability: "technician", item: "liechiberry" }, "garchomp", { ability: "roughskin" }],
    [S, "maushold", { ability: "technician", item: "loadeddice" }, "garchomp", { ability: "roughskin", hp: 150 }],
    [W, "archeops", { ability: "defeatist" }, "garchomp", { ability: "roughskin" }],
    [U, "kangaskhanmega", { ability: "parentalbond", item: "kangaskhanite", hp: 40 }, "garchomp", { ability: "roughskin", item: "jabocaberry" }],
  ];
  it.each(cases)("%s %s into %s: every row agrees", (game, attackerId, attackerSpec, defenderId, defenderSpec) => {
    const attacker = build(game, attackerId, attackerSpec), defender = build(game, defenderId, defenderSpec);
    const field = { ...createConditions(), gameType: "Singles" as const, multipleTargets: false };
    const searched = calculateMatchup(attacker, defender, field, {}, runtimes[game]);
    USES_REFERENCE.on = true;
    let reference: ReturnType<typeof calculateMatchup>;
    try {
      reference = calculateMatchup(attacker, defender, field, {}, runtimes[game]);
    } finally {
      USES_REFERENCE.on = false;
    }
    // The budget's fallback is a different method; the reference walks `needed` only so far; the chances add in another order.
    const fellBack = (value: UsesToKO | undefined) => value?.kind === "uses" && value.notes.some((note) => note.startsWith("Too many roll sequences"));
    const comparable = (value: UsesToKO | undefined) => value?.kind === "uses"
      ? { ...value, needed: undefined, fasterChance: value.fasterChance?.toPrecision(12), chance: value.chance?.toPrecision(12) } : value;
    let compared = 0;
    for (const [index, entry] of searched.results.entries()) {
      const other = reference.results[index].usesToKO;
      if (fellBack(entry.usesToKO) || fellBack(other)) continue;
      expect(comparable(entry.usesToKO), `${entry.moveId}`).toEqual(comparable(other));
      if (entry.usesToKO) compared++;
    }
    expect(compared).toBeGreaterThan(20);
  });
});
