import { calculate, Field, Generations, Move, Pokemon } from "@smogon/calc";
import { beforeAll, describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import { maxUsesPP, USES_REFERENCE } from "@/app/lib/battle/uses-to-ko";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext, MoveDamageResult, StatTable, UsesToKO } from "@/app/lib/battle/types";

/**
 * Uses to KO: the attacker repeats the move every turn into a target that only uses Splash. Every count here
 * is from a real pinned Showdown c23d2e94 battle of that matchup, run once with every damage roll at 85 and
 * once at 100 (crits off, every hit landing, chances under 100% failing, weather and terrain lasting):
 * scripts/.cache/calc-audit/nhko/build-engine/validate.ts, which also compares the target's HP after every
 * use and every end of turn, and the use after which the attacker faints. `guaranteed` is Showdown's KO use
 * with the lowest rolls, unless a mixed sequence takes longer (Ganlon Berry, checked as that sequence);
 * `fewest` is the one with the highest. The chances are exact: below they equal @smogon/calc's own kochance
 * and a count over every roll sequence.
 * Level 50, 31 IVs and Serious unless stated, Singles; Champions points are Stat Points.
 */
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) runtimes[game] = await loadBattleRuntime(game);
  runtimes.champions = championsRuntime;
});

type Spec = {
  ability?: string; item?: string; nature?: string; evs?: Partial<StatTable<number>>; level?: number; hp?: number;
  status?: BattleBuild["status"]; mechanic?: BattleBuild["mechanic"];
};
function build(game: BattleGame, id: string, spec: Spec = {}): BattleBuild {
  const base = createBuild(id, runtimes[game]);
  const shared = {
    ...(spec.ability ? { abilityId: spec.ability } : {}), ...(spec.item !== undefined ? { itemId: spec.item } : {}),
    ...(spec.nature ? { nature: spec.nature } : {}), ...(spec.hp !== undefined ? { currentHP: spec.hp } : {}),
    ...(spec.status ? { status: spec.status } : {}), ...(spec.mechanic ? { mechanic: spec.mechanic } : {}),
  };
  if (base.game === "champions") return { ...base, ...shared, points: { ...base.points, ...spec.evs } } as BattleBuild;
  return { ...base, ...shared, native: { ...base.native, level: spec.level ?? 50, evs: { ...base.native.evs, ...spec.evs } } } as BattleBuild;
}
function singles(field: Partial<BattleConditions> = {}): BattleConditions {
  return { ...createConditions(), gameType: "Singles", multipleTargets: false, ...field };
}
function row(game: BattleGame, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, context?: MoveContext): MoveDamageResult {
  const result = calculateMatchup(attacker, defender, singles(field), context ? { [moveId]: context } : {}, runtimes[game]);
  expect(result.issues).toEqual({ attacker: [], defender: [], field: [] });
  const found = result.results.find((entry) => entry.moveId === moveId)!;
  expect(found.kind).toBe("calculated");
  return found;
}
function uses(game: BattleGame, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}, context?: MoveContext): UsesToKO {
  return row(game, moveId, attacker, defender, field, context).usesToKO!;
}
type Counted = Extract<UsesToKO, { kind: "uses" }>;
function counted(value: UsesToKO): Counted {
  expect(value.kind).toBe("uses");
  return value as Counted;
}
const counts = (value: UsesToKO) => ({ fewest: counted(value).fewest, guaranteed: counted(value).guaranteed });
/** The chance that `uses` uses of these rolls (each equally likely) reach `hp`, with `heal` back after each use that does not, counted over every sequence. */
function everySequence(rolls: number[], hp: number, uses: number, heal = 0): number {
  let ko = 0, total = 0;
  const walk = (left: number, depth: number, weight: number) => {
    for (const roll of rolls) {
      if (roll >= left) ko += weight / rolls.length;
      else if (depth + 1 < uses) walk(left - roll + heal, depth + 1, weight / rolls.length);
      else total += weight / rolls.length;
    }
  };
  walk(hp, 0, 1);
  expect(ko + total).toBeCloseTo(1, 12);
  return ko;
}
const sand = { weather: "Sand" } as const;

describe("the same damage every use", () => {
  it("Champions Garchomp Dragon Claw into Incineroar: 64-76 into 202 HP is 3 to 4 uses (Showdown 138, 74, 10, 0 and 126, 50, 0)", () => {
    const value = row("champions", "dragonclaw", build("champions", "garchomp", { nature: "Adamant", evs: { atk: 32 } }), build("champions", "incineroar", { evs: { hp: 32, def: 32 } }));
    expect([value.min, value.max]).toEqual([64, 76]);
    expect(value.usesToKO).toMatchObject({ kind: "uses", fewest: 3, guaranteed: 4, fasterChance: 0.87109375, limit: 16, limitReason: "pp", carried: [], notes: [] });
    expect(everySequence(value.rolls as number[], 202, 3)).toBe(0.87109375);
  });
  it("the user's example: a 20% lowest roll is a 5HKO; at 160 HP 4 uses have a 0.53% chance", () => {
    const attacker = build("champions", "garchomp");
    const full = row("champions", "thunderfang", attacker, build("champions", "incineroar"));
    expect([full.min, full.max, full.minPercent]).toEqual([34, 41, 20]);
    expect(full.usesToKO).toMatchObject({ kind: "uses", fewest: 5, guaranteed: 5 });
    expect(counted(full.usesToKO!).fasterChance).toBeUndefined();
    // Showdown at 160 HP: 126, 92, 58, 24, 0 with the lowest rolls and 119, 78, 37, 0 with the highest.
    const value = row("champions", "thunderfang", attacker, build("champions", "incineroar", { hp: 160 }));
    expect(value.usesToKO).toMatchObject({ kind: "uses", fewest: 4, guaranteed: 5, fasterChance: 0.0053253173828125 });
    expect(everySequence(value.rolls as number[], 160, 4)).toBe(0.0053253173828125);
  });
  it("Ultra Sun/Ultra Moon Mew Psychic into Eviolite Chansey: 8 to 10 uses", () => {
    expect(counts(uses("ultra_sun_ultra_moon", "psychic", build("ultra_sun_ultra_moon", "mew", { nature: "Modest", evs: { spa: 252 } }),
      build("ultra_sun_ultra_moon", "chansey", { item: "eviolite", evs: { hp: 252, spd: 252 } })))).toEqual({ fewest: 8, guaranteed: 10 });
  });
  it("counts from the target's current HP", () => {
    expect(uses("scarlet_violet", "dragonclaw", build("scarlet_violet", "garchomp", { nature: "Jolly", evs: { atk: 252 } }), build("scarlet_violet", "gholdengo", { hp: 80, evs: { hp: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 2, guaranteed: 3, fasterChance: 0.265625 });
  });
  it("Seismic Toss's fixed 100 every use: 5 uses", () => {
    expect(counts(uses("scarlet_violet", "seismictoss", build("scarlet_violet", "blissey", { level: 100 }), build("scarlet_violet", "garchomp", { level: 100, evs: { hp: 252 } })))).toEqual({ fewest: 5, guaranteed: 5 });
  });
  it("equals @smogon/calc's exact kochance for 2 to 4 uses at every HP", () => {
    const gen = Generations.get(9);
    const runtime = runtimes.scarlet_violet;
    const attacker = { ...build("scarlet_violet", "garchomp"), abilityId: "sandveil", itemId: "" } as BattleBuild;
    let chances = 0, guaranteed = 0;
    for (let hp = 1; hp <= 170; hp++) {
      const defender = { ...build("scarlet_violet", "incineroar"), abilityId: "blaze", itemId: "", currentHP: hp === 170 ? null : hp } as BattleBuild;
      const result = calculateMatchup(attacker, defender, singles(), {}, runtime);
      for (const id of ["thunderfang", "dragonclaw", "ironhead"]) {
        const entry = result.results.find((candidate) => candidate.moveId === id)!;
        const smogon = calculate(gen, new Pokemon(gen, "Garchomp", { level: 50, ability: "Sand Veil", nature: "Serious" }),
          new Pokemon(gen, "Incineroar", { level: 50, ability: "Blaze", nature: "Serious", curHP: hp }), new Move(gen, runtime.movesById.get(id)!.name), new Field({ gameType: "Singles" }));
        expect(entry.rolls).toEqual(smogon.damage);
        const ko = smogon.kochance(false), value = counted(entry.usesToKO!);
        if (!ko.n || ko.n > 4 || ko.chance === undefined || (ko.n === 1 && ko.chance < 1)) continue;
        if (ko.chance === 1) { expect(value.guaranteed).toBe(ko.n); guaranteed++; continue; }
        expect(value.fewest).toBe(ko.n);
        if (value.guaranteed! - 1 === ko.n) { expect(value.fasterChance).toBe(ko.chance); chances++; }
      }
    }
    expect(chances).toBeGreaterThan(50);
    expect(guaranteed).toBeGreaterThan(50);
  });
});

describe("Focus Sash, Sturdy and multi-hit moves", () => {
  it("a full-HP Focus Sash leaves 1 HP, so a 332-392 hit into 153 HP takes 2 uses", () => {
    const value = row("champions", "stoneedge", build("champions", "garchomp", { nature: "Adamant", evs: { atk: 32 } }), build("champions", "talonflame", { item: "focussash" }));
    expect([value.min, value.max]).toEqual([332, 392]);
    expect(value.usesToKO).toMatchObject({ kind: "uses", fewest: 2, guaranteed: 2, survival: "Focus Sash" });
  });
  it("Sturdy at full HP: 2 uses", () => {
    expect(uses("scarlet_violet", "earthquake", build("scarlet_violet", "garchomp", { nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "magnezone", { ability: "sturdy" })))
      .toMatchObject({ kind: "uses", fewest: 2, guaranteed: 2, survival: "Sturdy" });
  });
  it("the next hit of the same use breaks through: Dual Wingbeat into Focus Sash, 5 Bullet Seed hits into Sturdy", () => {
    const wingbeat = counted(uses("scarlet_violet", "dualwingbeat", build("scarlet_violet", "corviknight", { nature: "Adamant", evs: { atk: 252 }, level: 100 }), build("scarlet_violet", "breloom", { item: "focussash" })));
    expect(wingbeat).toMatchObject({ fewest: 1, guaranteed: 1 });
    expect(wingbeat.survival).toBeUndefined();
    const seed = counted(uses("scarlet_violet", "bulletseed", build("scarlet_violet", "breloom", { nature: "Adamant", evs: { atk: 252 }, level: 100 }), build("scarlet_violet", "donphan", { ability: "sturdy", level: 20 }), {}, { hits: 5 }));
    expect(seed).toMatchObject({ fewest: 1, guaranteed: 1 });
    expect(seed.notes).toContain("Assumes 5 hits on every use.");
  });
  it("Parental Bond's two hits; Scale Shot's 5", () => {
    expect(counts(uses("ultra_sun_ultra_moon", "return", build("ultra_sun_ultra_moon", "kangaskhanmega", { ability: "parentalbond", item: "kangaskhanite", nature: "Adamant", evs: { atk: 252 } }),
      build("ultra_sun_ultra_moon", "chansey", { item: "eviolite", evs: { hp: 252, def: 252 } })))).toEqual({ fewest: 2, guaranteed: 3 });
    expect(counts(uses("scarlet_violet", "scaleshot", build("scarlet_violet", "garchomp", { nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "blissey", { evs: { hp: 252 } }), {}, { hits: 5 }))).toEqual({ fewest: 1, guaranteed: 1 });
  });
});

describe("stat stages carried between uses", () => {
  it("Draco Meteor's -2 Sp. Atk: 3 to 4 uses (Showdown 105, 56, 23, 0 and 87, 29, 0)", () => {
    const value = row("champions", "dracometeor", build("champions", "garchomp", { nature: "Modest", evs: { spa: 32 } }), build("champions", "incineroar", { evs: { hp: 32 } }));
    expect([value.min, value.max]).toEqual([97, 115]);
    expect(value.usesToKO).toMatchObject({ kind: "uses", fewest: 3, guaranteed: 4, fasterChance: 0.140625, limit: 8, carried: ["Draco Meteor lowers the attacker's Sp. Atk after each use."] });
  });
  it("Make It Rain lowers Sp. Atk by 2 in Champions (3 to 5 uses) and by 1 in Scarlet/Violet (3 uses)", () => {
    expect(counts(uses("champions", "makeitrain", build("champions", "gholdengo", { nature: "Modest", evs: { spa: 32 } }), build("champions", "garchomp", { evs: { hp: 32, spd: 32 } })))).toEqual({ fewest: 3, guaranteed: 5 });
    expect(counts(uses("scarlet_violet", "makeitrain", build("scarlet_violet", "gholdengo", { nature: "Modest", evs: { spa: 252 } }), build("scarlet_violet", "garchomp", { evs: { hp: 252, spd: 252 } })))).toEqual({ fewest: 3, guaranteed: 3 });
  });
  it("Contrary turns Leaf Storm's drop into a rise; Superpower lowers Attack; Power-Up Punch raises it", () => {
    expect(uses("scarlet_violet", "leafstorm", build("scarlet_violet", "serperior", { ability: "contrary", nature: "Timid", evs: { spa: 252 } }), build("scarlet_violet", "blissey", { evs: { hp: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 3, guaranteed: 4, carried: ["Leaf Storm raises the attacker's Sp. Atk after each use."] });
    const chansey = build("ultra_sun_ultra_moon", "chansey", { item: "eviolite", evs: { hp: 252, def: 252 } });
    expect(counts(uses("ultra_sun_ultra_moon", "superpower", build("ultra_sun_ultra_moon", "azumarill", { ability: "thickfat", nature: "Adamant", evs: { atk: 252 } }), chansey))).toEqual({ fewest: 4, guaranteed: 6 });
    expect(counts(uses("ultra_sun_ultra_moon", "poweruppunch", build("ultra_sun_ultra_moon", "lucario", { nature: "Adamant", evs: { atk: 252 } }), chansey))).toEqual({ fewest: 3, guaranteed: 3 });
  });
  it("the target's drops: Lumina Crash, Fire Lash, and Snarl turned back by Mirror Armor", () => {
    const blissey = build("scarlet_violet", "blissey", { evs: { hp: 252 } });
    expect(counts(uses("scarlet_violet", "luminacrash", build("scarlet_violet", "espathra", { nature: "Modest", evs: { spa: 252 } }), blissey))).toEqual({ fewest: 4, guaranteed: 4 });
    expect(counts(uses("scarlet_violet", "firelash", build("scarlet_violet", "salazzle", { nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "garganacl", { evs: { hp: 252 } })))).toEqual({ fewest: 9, guaranteed: 11 });
    expect(uses("scarlet_violet", "snarl", build("scarlet_violet", "mew", { nature: "Modest", evs: { spa: 252 } }), build("scarlet_violet", "corviknight", { ability: "mirrorarmor", evs: { hp: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 13, guaranteed: 17, carried: ["The target's Mirror Armor turns Snarl's drop back on the attacker."] });
  });
  it("Stamina and Weak Armor change Defense after every hit", () => {
    const garchomp = build("scarlet_violet", "garchomp", { nature: "Adamant", evs: { atk: 252 } });
    expect(counts(uses("scarlet_violet", "dragonclaw", garchomp, build("scarlet_violet", "mudsdale", { ability: "stamina", evs: { hp: 252 } })))).toEqual({ fewest: 4, guaranteed: 5 });
    expect(counts(uses("scarlet_violet", "dragonclaw", garchomp, build("scarlet_violet", "skarmory", { ability: "weakarmor", evs: { hp: 252, def: 252 } })))).toEqual({ fewest: 4, guaranteed: 5 });
  });
  it("Speed Boost raises Stored Power at every end of turn", () => {
    expect(uses("scarlet_violet", "storedpower", build("scarlet_violet", "espathra", { ability: "speedboost", nature: "Modest", evs: { spa: 252 } }), build("scarlet_violet", "blissey", { evs: { hp: 252, spd: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 8, guaranteed: 9, carried: ["Speed Boost raises Speed at the end of each turn."] });
  });
  it("a Max move's stat rise each use, and Dynamax ending after 3 turns", () => {
    expect(uses("sword_shield", "sludgebomb", build("sword_shield", "mew", { nature: "Modest", evs: { spa: 252 }, mechanic: "dynamax" }), build("sword_shield", "blissey", { evs: { hp: 252, spd: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 6, guaranteed: 6, carried: ["Max Ooze changes a stat each use.", "Dynamax ends after 3 turns."] });
  });
});

describe("the target's HP changes later damage", () => {
  it("Multiscale halves only the first use: 66-78 into 198 HP, then a KO", () => {
    const value = row("champions", "stoneedge", build("champions", "garchomp", { nature: "Adamant", evs: { atk: 32 } }), build("champions", "dragonite", { ability: "multiscale", evs: { hp: 32 } }));
    expect([value.min, value.max]).toEqual([66, 78]);
    expect(value.usesToKO).toMatchObject({ kind: "uses", fewest: 2, guaranteed: 2, carried: ["Multiscale weakens only the first use."] });
  });
  it("Brine doubles at half HP: 7 to 9 uses", () => {
    expect(counts(uses("scarlet_violet", "brine", build("scarlet_violet", "lapras", { nature: "Modest", evs: { spa: 252 } }), build("scarlet_violet", "blissey", { evs: { hp: 252 } })))).toEqual({ fewest: 7, guaranteed: 9 });
  });
  it("Hard Press falls with the target's HP: 5 to 7 uses, an exact search over its powers", () => {
    // Showdown (u-oracle2.ts, forms-iceface-fling/verify/q-rows.ts ut-hardpress-blissey): out after 5 uses 0.000691, 6 0.574408, 7 1.
    const value = counted(uses("scarlet_violet", "hardpress", build("scarlet_violet", "mew", { nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "blissey", { evs: { hp: 252 } })));
    expect(value).toMatchObject({ fewest: 5, guaranteed: 7 });
    expect(value.fasterChance).toBeCloseTo(0.574408, 6);
    expect(value.notes).not.toContain("Too many roll sequences: lowest and highest rolls only, no chance.");
  });
  it("Super Fang halves the HP each use: 10 uses into 267 HP, 12 into a Dynamaxed Chansey", () => {
    expect(counts(uses("ultra_sun_ultra_moon", "superfang", build("ultra_sun_ultra_moon", "mew"), build("ultra_sun_ultra_moon", "snorlax", { evs: { hp: 252 } })))).toEqual({ fewest: 10, guaranteed: 10 });
    expect(counts(uses("sword_shield", "superfang", build("sword_shield", "mew"), build("sword_shield", "chansey", { mechanic: "dynamax", evs: { hp: 252 } })))).toEqual({ fewest: 12, guaranteed: 12 });
  });
  it("a Dynamaxed target loses its doubled HP after 3 turns (Showdown 647, 580, 513 then 257, 190, 123, 56, 0)", () => {
    expect(uses("sword_shield", "psychic", build("sword_shield", "mew", { nature: "Modest", evs: { spa: 252 } }), build("sword_shield", "chansey", { mechanic: "dynamax", evs: { hp: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 6, guaranteed: 7, carried: ["Dynamax ends after 3 turns."] });
  });
  it("forms that follow HP at the end of the turn: Shields Down, Schooling, Zen Mode", () => {
    expect(counts(uses("scarlet_violet", "dragonclaw", build("scarlet_violet", "mew", { nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "miniormeteor", { ability: "shieldsdown", evs: { hp: 252 } })))).toEqual({ fewest: 3, guaranteed: 4 });
    expect(counts(uses("ultra_sun_ultra_moon", "thunderbolt", build("ultra_sun_ultra_moon", "mew", { nature: "Modest", evs: { spa: 252 } }), build("ultra_sun_ultra_moon", "wishiwashischool", { ability: "schooling", evs: { hp: 252 } })))).toEqual({ fewest: 2, guaranteed: 3 });
    expect(counts(uses("sword_shield", "psychic", build("sword_shield", "mew", { nature: "Modest", evs: { spa: 252 } }), build("sword_shield", "darmanitan", { ability: "zenmode", evs: { hp: 252 } })))).toEqual({ fewest: 3, guaranteed: 4 });
  });
  it("Anger Shell lowers the target's defenses once it falls to half", () => {
    expect(counts(uses("scarlet_violet", "psychic", build("scarlet_violet", "mew", { nature: "Modest", evs: { spa: 252 } }), build("scarlet_violet", "klawf", { ability: "angershell", evs: { hp: 252 } })))).toEqual({ fewest: 2, guaranteed: 2 });
  });
});

describe("items used up, taken or changing", () => {
  it("a Sitrus Berry heals once at half HP: 4 uses where 3 could do", () => {
    expect(counts(uses("champions", "dragonclaw", build("champions", "garchomp", { nature: "Adamant", evs: { atk: 32 } }), build("champions", "incineroar", { item: "sitrusberry", evs: { hp: 32, def: 32 } })))).toEqual({ fewest: 4, guaranteed: 4 });
  });
  it("Unnerve stops the Sitrus Berry: 2 uses, against 2 to 3 without it", () => {
    const incineroar = build("champions", "incineroar", { item: "sitrusberry", evs: { hp: 32, def: 32 } });
    expect(counts(uses("champions", "rockslide", build("champions", "tyranitar", { ability: "unnerve", nature: "Adamant", evs: { atk: 32 } }), incineroar))).toEqual({ fewest: 2, guaranteed: 2 });
    expect(counts(uses("champions", "rockslide", build("champions", "tyranitar", { ability: "sandstream", nature: "Adamant", evs: { atk: 32 } }), incineroar))).toEqual({ fewest: 2, guaranteed: 3 });
  });
  it("Ganlon Berry: the lowest rolls KO in 3, but the highest then the lowest need 4, so 4 is guaranteed", () => {
    expect(uses("scarlet_violet", "bodyslam", build("scarlet_violet", "snorlax", { ability: "immunity", evs: { atk: 252 } }), build("scarlet_violet", "snorlax", { ability: "immunity", item: "ganlonberry", evs: { hp: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 3, guaranteed: 4, fasterChance: 0.946044921875 });
  });
  it("Knock Off removes a Sitrus Berry before it is eaten, and Eviolite after the first use", () => {
    expect(counts(uses("scarlet_violet", "knockoff", build("scarlet_violet", "conkeldurr", { ability: "ironfist", nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "blissey", { item: "sitrusberry", evs: { hp: 252, def: 252 } })))).toEqual({ fewest: 4, guaranteed: 4 });
    expect(counts(uses("ultra_sun_ultra_moon", "knockoff", build("ultra_sun_ultra_moon", "weavile", { nature: "Jolly", evs: { atk: 252 } }), build("ultra_sun_ultra_moon", "chansey", { item: "eviolite", evs: { hp: 252, def: 252 } })))).toEqual({ fewest: 3, guaranteed: 4 });
  });
  it("a resist berry and a Gem act on the first use only", () => {
    expect(uses("ultra_sun_ultra_moon", "bodyslam", build("ultra_sun_ultra_moon", "snorlax", { nature: "Adamant", evs: { atk: 252 } }), build("ultra_sun_ultra_moon", "chansey", { item: "chilanberry", evs: { hp: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 2, guaranteed: 2, carried: ["The target's Chilan Berry is eaten by the first use."] });
    expect(counts(uses("ultra_sun_ultra_moon", "bodyslam", build("ultra_sun_ultra_moon", "snorlax", { nature: "Adamant", evs: { atk: 252 }, item: "normalgem" }), build("ultra_sun_ultra_moon", "chansey", { item: "eviolite", nature: "Bold", evs: { hp: 252, def: 252 } })))).toEqual({ fewest: 3, guaranteed: 4 });
  });
  it("Metronome's boost grows each consecutive use, counting only a charge move's attack turns", () => {
    expect(uses("scarlet_violet", "dragonclaw", build("scarlet_violet", "garchomp", { nature: "Adamant", evs: { atk: 252 }, item: "metronome" }), build("scarlet_violet", "blissey", { evs: { hp: 252, def: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 2, guaranteed: 3, carried: ["The attacker's Metronome boosts each consecutive use."] });
    expect(uses("scarlet_violet", "solarbeam", build("scarlet_violet", "venusaur", { item: "metronome", nature: "Modest", evs: { spa: 252 } }), build("scarlet_violet", "blissey", { evs: { hp: 252, spd: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 4, guaranteed: 4, turns: "Charges for a turn before each use" });
  });
  it("Fickle Beam's 30% doubled power is rolled on every use", () => {
    const value = counted(uses("scarlet_violet", "ficklebeam", build("scarlet_violet", "hydrapple", { nature: "Modest", evs: { spa: 252 } }), build("scarlet_violet", "blissey", { evs: { hp: 252 } })));
    expect(value).toMatchObject({ fewest: 3, guaranteed: 7 });
    expect(value.notes).toContain("Each use has its own 30% chance of doubled power.");
  });
});

describe("the end of each turn", () => {
  it("Leftovers at 199 of 235 HP: 2 to 3 uses (Showdown 99 + 14, 13 + 14, 0 and 81 + 14, 0)", () => {
    const value = row("scarlet_violet", "earthquake", build("scarlet_violet", "garchomp"), build("scarlet_violet", "snorlax", { hp: 199, item: "leftovers" }));
    expect(value.usesToKO).toMatchObject({ kind: "uses", fewest: 2, guaranteed: 3, fasterChance: 0.69921875, carried: ["Leftovers heals the target at the end of each turn."] });
    expect(everySequence(value.rolls as number[], 199, 2, 14)).toBe(0.69921875);
  });
  it("sandstorm chip: 4 uses where 5 hits would do (Showdown 126, 82, 38, 0 after each turn)", () => {
    const value = counted(uses("champions", "thunderfang", build("champions", "garchomp"), build("champions", "incineroar"), sand));
    expect(value).toMatchObject({ fewest: 4, guaranteed: 4, carried: ["Sandstorm damages the target at the end of each turn."] });
    expect(value.notes).toContain("Assumes the weather lasts through every use.");
    // No chip on a Rock type.
    expect(counts(uses("champions", "dragonclaw", build("champions", "garchomp"), build("champions", "tyranitar"), sand))).toEqual({ fewest: 3, guaranteed: 4 });
  });
  it("hail chips; snow does not, and Ice Body heals in it", () => {
    expect(counts(uses("ultra_sun_ultra_moon", "psychic", build("ultra_sun_ultra_moon", "mew", { nature: "Modest", evs: { spa: 252 } }), build("ultra_sun_ultra_moon", "snorlax", { evs: { hp: 252 } }), { weather: "Hail" }))).toEqual({ fewest: 3, guaranteed: 4 });
    expect(counts(uses("scarlet_violet", "dragonclaw", build("scarlet_violet", "garchomp"), build("scarlet_violet", "glalie", { ability: "icebody" }), { weather: "Snow" }))).toEqual({ fewest: 4, guaranteed: 4 });
  });
  it("burn, Heatproof's halved burn, and Poison Heal", () => {
    expect(counts(uses("scarlet_violet", "dragonclaw", build("scarlet_violet", "garchomp", { nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "snorlax", { status: "brn", evs: { hp: 252 } })))).toEqual({ fewest: 2, guaranteed: 3 });
    expect(counts(uses("scarlet_violet", "earthquake", build("scarlet_violet", "garchomp"), build("scarlet_violet", "bronzong", { ability: "heatproof", status: "brn" })))).toEqual({ fewest: 1, guaranteed: 2 });
    const healed = counted(uses("scarlet_violet", "dragonclaw", build("scarlet_violet", "garchomp"), build("scarlet_violet", "gliscor", { ability: "poisonheal", status: "tox" })));
    expect(healed).toMatchObject({ fewest: 4, guaranteed: 5, carried: ["Poison Heal heals the target at the end of each turn."] });
    expect(healed.notes.some((note) => note.startsWith("Assumes bad poison started this turn"))).toBe(true);
  });
  it("Grassy Terrain heals a grounded target, not a Flying one", () => {
    expect(counted(uses("scarlet_violet", "dragonclaw", build("scarlet_violet", "garchomp"), build("scarlet_violet", "blissey"), { terrain: "Grassy" })).carried)
      .toEqual(["Grassy Terrain heals the target at the end of each turn.", "Grassy Terrain heals the attacker at the end of each turn."]);
    expect(uses("champions", "dragonclaw", build("champions", "garchomp"), build("champions", "incineroar", { item: "leftovers" }), { terrain: "Grassy" }))
      .toMatchObject({ kind: "uses", fewest: 3, guaranteed: 4, carried: ["Grassy Terrain and Leftovers heal the target at the end of each turn.", "Grassy Terrain heals the attacker at the end of each turn."] });
    expect(uses("scarlet_violet", "dragonclaw", build("scarlet_violet", "garchomp"), build("scarlet_violet", "corviknight"), { terrain: "Grassy" }))
      .toMatchObject({ kind: "uses", fewest: 6, guaranteed: 7, carried: ["Grassy Terrain heals the attacker at the end of each turn."] });
  });
  it("Rain Dish and Dry Skin heal in rain; Dry Skin and Solar Power hurt in sun", () => {
    const garchomp = build("scarlet_violet", "garchomp");
    expect(counts(uses("scarlet_violet", "dragonclaw", garchomp, build("scarlet_violet", "ludicolo", { ability: "raindish" }), { weather: "Rain" }))).toEqual({ fewest: 2, guaranteed: 3 });
    expect(counts(uses("scarlet_violet", "dragonclaw", garchomp, build("scarlet_violet", "toxicroak", { ability: "dryskin" }), { weather: "Rain" }))).toEqual({ fewest: 2, guaranteed: 3 });
    expect(counts(uses("scarlet_violet", "dragonclaw", garchomp, build("scarlet_violet", "toxicroak", { ability: "dryskin" }), { weather: "Sun" }))).toEqual({ fewest: 2, guaranteed: 2 });
    expect(counts(uses("scarlet_violet", "dragonclaw", garchomp, build("scarlet_violet", "charizard", { ability: "solarpower" }), { weather: "Sun" }))).toEqual({ fewest: 2, guaranteed: 2 });
  });
  it("a Dynamaxed Chansey's Leftovers heals 1/16 of its HP without Dynamax", () => {
    expect(counts(uses("sword_shield", "psychic", build("sword_shield", "mew", { nature: "Modest", evs: { spa: 252 } }), build("sword_shield", "chansey", { mechanic: "dynamax", item: "leftovers", evs: { hp: 252 } })))).toEqual({ fewest: 8, guaranteed: 9 });
  });
  it("Inferno burns the target; Salt Cure damages it each turn in Scarlet/Violet and Champions", () => {
    expect(counts(uses("scarlet_violet", "inferno", build("scarlet_violet", "charizard", { nature: "Modest", evs: { spa: 252 } }), build("scarlet_violet", "blissey", { evs: { hp: 252, spd: 252 } })))).toEqual({ fewest: 5, guaranteed: 5 });
    expect(counts(uses("scarlet_violet", "saltcure", build("scarlet_violet", "garganacl"), build("scarlet_violet", "blissey")))).toEqual({ fewest: 3, guaranteed: 3 });
    expect(counts(uses("champions", "saltcure", build("champions", "garganacl"), build("champions", "incineroar")))).toEqual({ fewest: 3, guaranteed: 3 });
  });
  it("the attacker's own end of turn: sand chip turns on Charizard's Blaze", () => {
    expect(counts(uses("scarlet_violet", "flamethrower", build("scarlet_violet", "charizard", { hp: 55, nature: "Modest", evs: { spa: 252 } }), build("scarlet_violet", "blissey", { evs: { hp: 252 } }), sand))).toEqual({ fewest: 4, guaranteed: 4 });
  });
});

describe("turns that are not uses", () => {
  it("Hyper Beam recharges and Solar Beam charges, so Leftovers heals twice per use; in sun Solar Beam does not charge", () => {
    expect(uses("scarlet_violet", "hyperbeam", build("scarlet_violet", "porygonz", { nature: "Modest", evs: { spa: 252 } }), build("scarlet_violet", "blissey", { item: "leftovers", evs: { hp: 252, spd: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 4, guaranteed: 4, turns: "Recharges after each use" });
    const snorlax = build("scarlet_violet", "snorlax", { item: "leftovers" });
    expect(uses("scarlet_violet", "solarbeam", build("scarlet_violet", "venusaur"), snorlax)).toMatchObject({ kind: "uses", fewest: 5, guaranteed: 6, turns: "Charges for a turn before each use" });
    const sunny = counted(uses("scarlet_violet", "solarbeam", build("scarlet_violet", "venusaur"), snorlax, { weather: "Sun" }));
    expect(sunny).toMatchObject({ fewest: 4, guaranteed: 5 });
    expect(sunny.turns).toBeUndefined();
  });
  it("Truant loafs every other turn; Gigaton Hammer cannot be used twice in a row", () => {
    expect(uses("scarlet_violet", "doubleedge", build("scarlet_violet", "slaking", { ability: "truant" }), build("scarlet_violet", "blissey"), sand))
      .toMatchObject({ kind: "uses", fewest: 1, guaranteed: 1, turns: "Truant: one use every other turn" });
    expect(uses("scarlet_violet", "gigatonhammer", build("scarlet_violet", "tinkaton"), build("scarlet_violet", "blissey")))
      .toMatchObject({ kind: "uses", fewest: 1, guaranteed: 2, turns: "Can't be used twice in a row" });
  });
});

describe("PP, Pressure and the attacker's own HP", () => {
  it("max PP with PP Ups, as pinned Showdown's battles give it (scripts/.cache/calc-audit/nhko/build-engine/pp.ts: 2516 move slots, no difference)", () => {
    const pp = (game: BattleGame, id: string) => maxUsesPP(runtimes[game].movesById.get(id)!, game);
    // Champions: (base / 5 + 1) x 4 from a base capped at 20; Revival Blessing takes no PP Ups.
    expect(["dracometeor", "rockslide", "flamethrower", "accelerock", "revivalblessing"].map((id) => pp("champions", id))).toEqual([8, 12, 16, 20, 1]);
    expect(runtimes.champions.catalog.moves.every((move) => move.pp !== undefined && move.pp <= 20)).toBe(true);
    // The main games: base x 8 / 5; Sketch takes no PP Ups, and Trump Card none in Ultra Sun/Ultra Moon.
    expect(["dracometeor", "earthquake", "flamethrower", "accelerock", "bite", "metalclaw", "sketch"].map((id) => pp("scarlet_violet", id))).toEqual([8, 16, 24, 32, 40, 56, 1]);
    expect(["trumpcard", "wringout", "sketch"].map((id) => pp("ultra_sun_ultra_moon", id))).toEqual([5, 8, 1]);
  });
  it("a 5-PP move has 8 uses: more are needed than PP allows", () => {
    expect(uses("scarlet_violet", "fireblast", build("scarlet_violet", "charizard", { level: 1 }), build("scarlet_violet", "blissey")))
      .toMatchObject({ kind: "uses", fewest: null, guaranteed: null, limit: 8, limitReason: "pp", needed: 330 });
    expect(uses("champions", "overheat", build("champions", "charizard"), build("champions", "garganacl", { evs: { hp: 32, spd: 32 } })))
      .toMatchObject({ kind: "uses", fewest: null, guaranteed: null, limit: 8, limitReason: "pp", needed: 22 });
  });
  it("the target's Pressure halves the uses: 4", () => {
    expect(uses("scarlet_violet", "fireblast", build("scarlet_violet", "charizard", { level: 1 }), build("scarlet_violet", "corviknight", { ability: "pressure" })))
      .toMatchObject({ kind: "uses", fewest: null, guaranteed: null, limit: 4, limitReason: "pressure", needed: 87 });
  });
  it("Steel Beam costs half the user's HP: 2 uses at most", () => {
    expect(uses("scarlet_violet", "steelbeam", build("scarlet_violet", "magearna"), build("scarlet_violet", "blissey")))
      .toMatchObject({ kind: "uses", fewest: null, guaranteed: null, limit: 2, limitReason: "self-cost", attackerFaints: { lowest: 2, highest: 2 } });
    // No count past the limit: the cost that sets it faints the user on every sequence (ngas-pp N2: `needed` is a guarantee).
    expect(counted(uses("scarlet_violet", "steelbeam", build("scarlet_violet", "magearna"), build("scarlet_violet", "blissey"))).needed).toBeUndefined();
  });
  it("Steel Beam keeps its limit: a chance within its 2 uses, and its last use's cost is not a faint first", () => {
    // Showdown at 170 HP: 94, 18 with the lowest rolls (Magearna faints after use 2) and 79, 0 with the highest.
    const value = counted(uses("scarlet_violet", "steelbeam", build("scarlet_violet", "magearna"), build("scarlet_violet", "blissey", { hp: 170 })));
    expect(value).toMatchObject({ fewest: 2, guaranteed: null, chance: 0.34765625, limit: 2, limitReason: "self-cost", attackerFaints: { lowest: 2, highest: 2 } });
    expect(value.faintsFirst).toBeUndefined();
    expect(value.needed).toBeUndefined();
    // From 100 HP the first use leaves it 22, and the second knocks out before its cost faints it.
    expect(uses("scarlet_violet", "steelbeam", build("scarlet_violet", "magearna", { hp: 100 }), build("scarlet_violet", "blissey", { hp: 150 })))
      .toMatchObject({ kind: "uses", fewest: 2, guaranteed: 2, limitReason: "self-cost" });
  });
});

/**
 * A roll sequence on which the attacker faints with the target still in never knocks it out; one that knocks
 * it out first counts, even when that use's recoil or Life Orb then faints the attacker (pinned Showdown
 * faints the target before recoil). Every chance here also equals a count over every roll sequence with
 * Showdown's arithmetic, checked against Showdown battles on random sequences
 * (scripts/.cache/calc-audit/nhko/fix-engine/brute.ts), and the counts the battles in fix-engine/check.ts.
 */
describe("the attacker fainting first", () => {
  it("Life Orb Brave Bird into Eviolite Chansey: the highest rolls faint Talonflame after use 3, so nothing is guaranteed", () => {
    // Showdown: 260, 163, 66, 0 with the lowest rolls (the fourth use's recoil faints it after the KO); 243, 129, 15 with the highest, then it faints.
    expect(uses("scarlet_violet", "bravebird", build("scarlet_violet", "talonflame", { nature: "Jolly", item: "lifeorb" }), build("scarlet_violet", "chansey", { item: "eviolite", nature: "Bold", evs: { hp: 252, def: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 4, guaranteed: null, chance: 0.87109375, faintsFirst: true, limit: 24, attackerFaints: { lowest: 4, highest: 3 } });
  });
  it("Head Smash: a first use of 345 or more costs Rampardos its 172 HP; the KO use's recoil comes after the KO", () => {
    // Showdown: 297 -> 65 -> 0 with the lowest rolls; 349 -> 13 with the highest, and Rampardos faints.
    expect(uses("scarlet_violet", "headsmash", build("scarlet_violet", "rampardos", { ability: "sheerforce", nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "blissey", { nature: "Bold", evs: { hp: 252, def: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 2, guaranteed: null, chance: 0.875, faintsFirst: true, attackerFaints: { lowest: 2, highest: 1 } });
  });
  it("recoil it survives, or that faints it only after the KO, keeps the count", () => {
    expect(uses("scarlet_violet", "doubleedge", build("scarlet_violet", "tauros", { item: "lifeorb", nature: "Jolly", evs: { atk: 252 } }), build("scarlet_violet", "blissey", { nature: "Bold", evs: { hp: 252, def: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 2, guaranteed: 2, attackerFaints: { lowest: 2 } });
    // From 90 HP the first recoil turns Blaze on: Showdown 194, then 250 (and Cinderace faints after the KO).
    expect(uses("scarlet_violet", "flareblitz", build("scarlet_violet", "cinderace", { nature: "Jolly", evs: { atk: 252 }, hp: 90 }), build("scarlet_violet", "blissey", { nature: "Bold", evs: { hp: 252, def: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 2, guaranteed: 2, attackerFaints: { lowest: 2, highest: 2 } });
    const survived = counted(uses("scarlet_violet", "flareblitz", build("scarlet_violet", "arcanine", { nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "garganacl", { nature: "Impish", evs: { hp: 252, def: 252 } })));
    expect(survived).toMatchObject({ fewest: 6, guaranteed: 7, fasterChance: 0.007618844509124756 });
    expect(survived.faintsFirst).toBeUndefined();
  });
  it("Rough Skin and Rocky Helmet: 21 + 29 a hit faints Kingambit after use 4, with the target at 43 or 7", () => {
    const value = counted(uses("scarlet_violet", "ironhead", build("scarlet_violet", "kingambit"), build("scarlet_violet", "garchomp", { ability: "roughskin", item: "rockyhelmet", nature: "Impish", evs: { hp: 252, def: 252 } })));
    expect(value).toMatchObject({ fewest: null, guaranteed: null, faintsFirst: true, attackerFaints: { lowest: 4, highest: 4 } });
    expect(value.chance).toBeUndefined();
  });
  it("a multi-hit move stops when the contact damage faints the attacker: 18 a hit leaves Cinccino 60 after 5 hits, so 4 land on the second use", () => {
    // Showdown: 88, then 4 hits of 19 leave 12 with the lowest rolls; 63, then 3 hits of 24 knock out with the highest.
    expect(uses("scarlet_violet", "tailslap", build("scarlet_violet", "cinccino", { ability: "skilllink", nature: "Jolly", evs: { atk: 252 } }), build("scarlet_violet", "garchomp", { ability: "roughskin" })))
      .toMatchObject({ kind: "uses", fewest: 2, guaranteed: null, chance: 0.9818944809376262, faintsFirst: true, attackerFaints: { lowest: 2 } });
  });
  it("Life Orb's 15 a use from 100 HP faints Charizard after use 7 on every sequence: the closed form stops there", () => {
    // Showdown: 47 a use leaves 33 after 7 uses; 56 a use knocks out on use 7.
    expect(uses("scarlet_violet", "flamethrower", build("scarlet_violet", "charizard", { ability: "solarpower", item: "lifeorb", hp: 100 }), build("scarlet_violet", "blissey", { evs: { hp: 252, spd: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 7, guaranteed: null, chance: 0.3361688517034054, faintsFirst: true, attackerFaints: { lowest: 7, highest: 7 } });
    // Life Orb Ember: Charizard faints after use 11, before the 12 uses the best rolls need.
    const ember = counted(uses("scarlet_violet", "ember", build("scarlet_violet", "charizard", { item: "lifeorb" }), build("scarlet_violet", "blissey", { evs: { hp: 252, spd: 252 } })));
    expect(ember).toMatchObject({ fewest: null, guaranteed: null, faintsFirst: true, attackerFaints: { lowest: 11, highest: 11 } });
    expect(ember.chance).toBeUndefined();
  });
  it("in sand both fall at the end of use 5: the sand is one handler for both, so the target's counts", () => {
    // Showdown: 315 (293 after the sand) ... 39 (17) with the lowest rolls; 72 (50), then 56 and the sand knock out on use 5.
    expect(uses("scarlet_violet", "flamethrower", build("scarlet_violet", "charizard", { ability: "solarpower", item: "lifeorb", hp: 120 }), build("scarlet_violet", "blissey", { evs: { hp: 252, spd: 252 } }), sand))
      .toMatchObject({ kind: "uses", fewest: 5, guaranteed: null, chance: 0.7525310516357422, faintsFirst: true, attackerFaints: { lowest: 5, highest: 5 } });
    // 20 HP left after a 50 Seismic Toss and 20 of sand each: both are out at once.
    expect(uses("scarlet_violet", "seismictoss", build("scarlet_violet", "blissey", { hp: 20 }), build("scarlet_violet", "blissey", { hp: 60 }), sand))
      .toMatchObject({ kind: "uses", fewest: 1, guaranteed: 1 });
  });
  it("its own end of turn against the target's, in residual order", () => {
    // The attacker's sand (order 1) faints it before the target's burn (order 10) would finish the target.
    expect(uses("scarlet_violet", "seismictoss", build("scarlet_violet", "blissey", { hp: 20 }), build("scarlet_violet", "garganacl", { hp: 60, status: "brn" }), sand))
      .toMatchObject({ kind: "uses", fewest: null, guaranteed: null, faintsFirst: true });
    // The target's sand comes before the attacker's burn.
    expect(uses("scarlet_violet", "seismictoss", build("scarlet_violet", "blissey", { hp: 15, status: "brn", item: "safetygoggles" }), build("scarlet_violet", "blissey", { hp: 60 }), sand))
      .toMatchObject({ kind: "uses", fewest: 1, guaranteed: 1 });
    // Life Orb faints it during the use, before the sand would finish the target.
    expect(uses("scarlet_violet", "seismictoss", build("scarlet_violet", "blissey", { hp: 30, item: "lifeorb" }), build("scarlet_violet", "blissey", { hp: 60 }), sand))
      .toMatchObject({ kind: "uses", fewest: null, guaranteed: null, faintsFirst: true });
  });
  it("Draco Meteor with Life Orb from low HP: the exact search follows the attacker's HP", () => {
    // Showdown: 103, 52, 20 (and 0 on use 4) with the lowest rolls; 85, 25, 0 with the highest.
    const garchomp = (hp: number) => build("scarlet_violet", "garchomp", { item: "lifeorb", nature: "Modest", evs: { spa: 252 }, hp });
    const incineroar = build("scarlet_violet", "incineroar", { evs: { hp: 252, spd: 252 } });
    // 50 HP: Life Orb's 18 a use faints it after use 3.
    expect(uses("scarlet_violet", "dracometeor", garchomp(50), incineroar))
      .toMatchObject({ kind: "uses", fewest: 3, guaranteed: null, chance: 0.309814453125, faintsFirst: true, attackerFaints: { lowest: 3, highest: 3 } });
    // 60 HP: it stands until the fourth use's KO, and that use's Life Orb faints it after.
    const standing = counted(uses("scarlet_violet", "dracometeor", garchomp(60), incineroar));
    expect(standing).toMatchObject({ fewest: 3, guaranteed: 4, fasterChance: 0.309814453125, attackerFaints: { lowest: 4 } });
    expect(standing.faintsFirst).toBeUndefined();
  });
  it("no risk: Life Orb's 17 a use leaves Mew standing through the 9 uses Psychic needs, and the closed form keeps the count", () => {
    const value = counted(uses("scarlet_violet", "psychic", build("scarlet_violet", "mew", { item: "lifeorb" }), build("scarlet_violet", "blissey", { evs: { hp: 252, spd: 252 } })));
    expect(value).toMatchObject({ fewest: 7, guaranteed: 9, fasterChance: 0.9930024156346917 });
    expect(value.faintsFirst).toBeUndefined();
    expect(value.chance).toBeUndefined();
  });
});

describe("one use, never, no damage and not estimated", () => {
  it("one use at most: Explosion faints the user, Fake Out works only on the first turn out, a Z-Move once per battle", () => {
    expect(uses("scarlet_violet", "explosion", build("scarlet_violet", "electrode"), build("scarlet_violet", "blissey"))).toEqual({ kind: "single-use", reason: "The user faints", koChance: 0 });
    expect(uses("scarlet_violet", "fakeout", build("scarlet_violet", "incineroar"), build("scarlet_violet", "blissey"))).toEqual({ kind: "single-use", reason: "Works only on its first turn out", koChance: 0 });
    // A target at 30 HP in sand: the one use and the sand at the end of the turn knock it out.
    expect(uses("scarlet_violet", "fakeout", build("scarlet_violet", "incineroar"), build("scarlet_violet", "blissey", { hp: 30 }), sand)).toEqual({ kind: "single-use", reason: "Works only on its first turn out", koChance: 1 });
    expect(uses("ultra_sun_ultra_moon", "dragonclaw", build("ultra_sun_ultra_moon", "garchomp", { item: "dragoniumz" }), build("ultra_sun_ultra_moon", "skarmory", { evs: { hp: 252, def: 252 } }), {}, { useZ: true }))
      .toEqual({ kind: "single-use", reason: "Z-Moves are once per battle", koChance: 0 });
    expect(uses("scarlet_violet", "steelroller", build("scarlet_violet", "smeargle", { ability: "owntempo", nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "blissey", { evs: { hp: 252, def: 252 } }), { terrain: "Electric" }))
      .toEqual({ kind: "single-use", reason: "Steel Roller ends the terrain", koChance: 0 });
  });
  it("never: False Swipe leaves 1 HP and Endeavor stops at the user's HP", () => {
    expect(uses("scarlet_violet", "falseswipe", build("scarlet_violet", "scizor", { nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "pikachu", { hp: 20 }))).toEqual({ kind: "never", reason: "False Swipe leaves at least 1 HP" });
    expect(uses("scarlet_violet", "endeavor", build("scarlet_violet", "pikachu", { hp: 30 }), build("scarlet_violet", "blissey"))).toEqual({ kind: "never", reason: "Can't lower HP below the user's" });
  });
  it("no damage: an immune target or an Air Balloon", () => {
    expect(uses("scarlet_violet", "earthquake", build("scarlet_violet", "garchomp"), build("scarlet_violet", "corviknight"))).toEqual({ kind: "no-damage" });
    expect(uses("scarlet_violet", "earthquake", build("scarlet_violet", "garchomp", { nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "blissey", { item: "airballoon" }))).toEqual({ kind: "no-damage" });
  });
  it("every calculated row has a count and no other row does", () => {
    for (const game of ["champions", "scarlet_violet", "sword_shield", "ultra_sun_ultra_moon"] as const) {
      const result = calculateMatchup(build(game, "garchomp"), build(game, "incineroar"), singles(), {}, runtimes[game]);
      for (const entry of result.results) {
        expect(entry.usesToKO !== undefined, `${game} ${entry.moveId}`).toBe(entry.kind === "calculated");
        const value = entry.usesToKO;
        if (value && "reason" in value) expect(value.reason.length, `${game} ${entry.moveId}: ${value.reason}`).toBeLessThanOrEqual(38);
      }
    }
  });
  it("not estimated, with a short reason: Focus Band, a Protecting target, a trapping move, Moody", () => {
    expect(uses("scarlet_violet", "dragonclaw", build("scarlet_violet", "garchomp", { nature: "Adamant", evs: { atk: 252 } }), build("scarlet_violet", "blissey", { item: "focusband", nature: "Bold", evs: { hp: 252, def: 252 } })))
      .toEqual({ kind: "not-estimated", reason: "Focus Band: 10% to survive each KO hit" });
    expect(uses("sword_shield", "psychic", build("sword_shield", "mew", { mechanic: "dynamax" }), build("sword_shield", "chansey"), { defenderSide: { ...createSide(), protect: true } }))
      .toEqual({ kind: "not-estimated", reason: "The target may not protect again" });
    expect(uses("scarlet_violet", "firespin", build("scarlet_violet", "charizard"), build("scarlet_violet", "blissey"))).toEqual({ kind: "not-estimated", reason: "Its trap lasts 4 or 5 turns at random" });
    expect(uses("scarlet_violet", "dragonclaw", build("scarlet_violet", "garchomp"), build("scarlet_violet", "smeargle", { ability: "moody" }))).toEqual({ kind: "not-estimated", reason: "Moody changes stats at random" });
  });
});

describe("self-check against the reference search, which reruns the whole calculation for every state", () => {
  const cases: [BattleGame, string, Spec, string, Spec, Partial<BattleConditions>][] = [
    ["champions", "garchomp", { item: "lifeorb", nature: "Adamant", evs: { atk: 32 } }, "incineroar", { item: "sitrusberry", ability: "intimidate" }, {}],
    ["champions", "incineroar", {}, "garchomp", { item: "focussash" }, sand],
    ["scarlet_violet", "mew", { item: "metronome" }, "blissey", { item: "leftovers" }, { terrain: "Grassy" }],
    ["sword_shield", "mew", { mechanic: "dynamax" }, "chansey", {}, {}],
    ["ultra_sun_ultra_moon", "mew", { item: "lifeorb" }, "dragonite", { ability: "multiscale" }, {}],
    // The attacker's HP followed: recoil, and Life Orb from low HP into a Sitrus Berry in sand.
    ["scarlet_violet", "talonflame", { item: "lifeorb", nature: "Jolly" }, "chansey", { item: "eviolite", nature: "Bold", evs: { hp: 252, def: 252 } }, {}],
    ["champions", "garchomp", { item: "lifeorb", hp: 90 }, "incineroar", { item: "sitrusberry" }, sand],
  ];
  it.each(cases)("%s %s into %s: every row agrees", (game, attackerId, attackerSpec, defenderId, defenderSpec, field) => {
    const attacker = build(game, attackerId, attackerSpec), defender = build(game, defenderId, defenderSpec);
    const searched = calculateMatchup(attacker, defender, singles(field), {}, runtimes[game]);
    USES_REFERENCE.on = true;
    let reference: ReturnType<typeof calculateMatchup>;
    try {
      reference = calculateMatchup(attacker, defender, singles(field), {}, runtimes[game]);
    } finally {
      USES_REFERENCE.on = false;
    }
    // The budget's fallback is a different method; the reference walks `needed` only so far.
    const fellBack = (value: UsesToKO | undefined) => value?.kind === "uses" && value.notes.some((note) => note.startsWith("Too many roll sequences"));
    // The two searches add the same chances in a different order.
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
