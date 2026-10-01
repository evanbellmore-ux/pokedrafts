import { beforeAll, describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, MoveContext, MoveDamageResult, StatTable, UsesToKO } from "@/app/lib/battle/types";

/**
 * Uses to KO for the mechanics the review of the count found missing: Max Moves and the attacker's own move
 * once Dynamax ends, False Swipe and Endeavor finished by the end of turn, Anger Shell, the attacker's own
 * HP berry, Power Herb, Hydration, Smack Down, charge turns underground, weather a use sets, PP limits, and
 * the chances, flags and texts. Every count is from a real pinned Showdown c23d2e94 battle of that matchup,
 * once with every damage roll at 85 and once at 100 (crits off, every hit landing, chances under 100%
 * failing, weather and terrain as set lasting): scripts/.cache/calc-audit/nhko/fix-review/engine-a/cases-a.ts
 * (the target's HP after each use is in the test names), and the reviewers' scripts under
 * scripts/.cache/calc-audit/nhko/review. Level 50, 31 IVs and Serious unless stated, Singles.
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
    ...(spec.mechanic === "gigantamax" ? { configuration: { ...base.configuration, gigantamax: true } } : {}),
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
function uses(game: BattleGame, moveId: string, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}): UsesToKO {
  return row(game, moveId, attacker, defender, field).usesToKO!;
}
type Counted = Extract<UsesToKO, { kind: "uses" }>;
function counted(value: UsesToKO): Counted {
  expect(value.kind).toBe("uses");
  return value as Counted;
}
const counts = (value: UsesToKO) => ({ fewest: counted(value).fewest, guaranteed: counted(value).guaranteed });
const sand = { weather: "Sand" } as const;
const W = "sword_shield" as const, S = "scarlet_violet" as const, U = "ultra_sun_ultra_moon" as const, C = "champions" as const;

describe("a Dynamaxed attacker: its Max Move for 3 turns, then the row's own move", () => {
  const blissS = () => build(W, "blissey", { nature: "Calm", evs: { hp: 252, spd: 252 } });
  const blissP = (spec: Spec = {}) => build(W, "blissey", { nature: "Bold", evs: { hp: 252, def: 252 }, ...spec });
  it("only the row's own move changes stats each use: Max Flare from Overheat 362, 293, 190, 87, 0 (no Sp. Atk drop), Max Ooze from Acid Spray 11 uses", () => {
    const overheat = counted(uses(W, "overheat", build(W, "charizard", { nature: "Modest", evs: { spa: 252 }, mechanic: "dynamax" }), blissS()));
    expect(overheat).toMatchObject({ fewest: 4, guaranteed: 4 });
    expect(overheat.carried).toContain("After Dynamax ends, Overheat lowers the attacker's Sp. Atk after each use.");
    // 696, 669, 633 with the target's Sp. Def at 0, then -2 each Acid Spray: 608 ... 73, 0.
    expect(counts(uses(W, "acidspray", build(W, "toxtricity", { nature: "Modest", evs: { spa: 252 }, mechanic: "dynamax" }), build(W, "blissey", { nature: "Calm", evs: { hp: 252, spd: 252 }, level: 100 }))))
      .toEqual({ fewest: 10, guaranteed: 11 });
    // Max Knuckle +1 Attack each use, no Superpower drop: 207 then 0, 179 then 0.
    expect(counts(uses(W, "superpower", build(W, "rillaboom", { ability: "overgrow", nature: "Adamant", evs: { atk: 252 }, mechanic: "dynamax" }), build(W, "chansey", { item: "eviolite", nature: "Bold", evs: { hp: 252, def: 252 } }))))
      .toEqual({ fewest: 2, guaranteed: 2 });
  });
  it("a move that works once is a Max Move first: Explosion 3 uses (232, 102, 0), Final Gambit's 145 on use 4, Steel Beam's cost only after Dynamax", () => {
    expect(uses(W, "explosion", build(W, "weezing", { nature: "Adamant", evs: { atk: 252 }, mechanic: "dynamax" }), blissP()))
      .toMatchObject({ kind: "uses", fewest: 3, guaranteed: 3, limit: 4, limitReason: "cap" });
    expect(uses(W, "finalgambit", build(W, "lucario", { nature: "Adamant", evs: { atk: 252 }, mechanic: "dynamax" }), blissP()))
      .toMatchObject({ kind: "uses", fewest: 4, guaranteed: 4, limit: 4, attackerFaints: { lowest: 4, highest: 4 } });
    // Three Max Steelspikes at no cost, then two Steel Beams: 289, 216, 143, 70, 0; the user faints after use 5.
    expect(uses(W, "steelbeam", build(W, "duraludon", { nature: "Modest", evs: { spa: 252 }, mechanic: "dynamax" }), blissS()))
      .toMatchObject({ kind: "uses", fewest: 5, guaranteed: 5, limit: 5, limitReason: "self-cost", attackerFaints: { lowest: 5, highest: 5 } });
  });
  it("into Rotom-Wash at 125 HP: Explosion 2, Fake Out 3, Endeavor 2, Bind 3 (Showdown 51 then 0; 80, 35, 0; 60 then 0)", () => {
    const mew = build(W, "mew", { nature: "Adamant", evs: { atk: 252, spa: 252 }, mechanic: "dynamax" }), rotom = build(W, "rotomwash", { hp: 125 });
    expect(counts(uses(W, "explosion", mew, rotom))).toEqual({ fewest: 2, guaranteed: 2 });
    expect(counts(uses(W, "fakeout", mew, rotom))).toEqual({ fewest: 3, guaranteed: 3 });
    expect(counts(uses(W, "endeavor", mew, rotom))).toEqual({ fewest: 2, guaranteed: 2 });
    expect(counts(uses(W, "bind", mew, rotom))).toEqual({ fewest: 3, guaranteed: 3 });
  });
  it("past the Max uses nothing is estimated: Fake Out fails after Dynamax ends (Blissey at 89 or 38 then)", () => {
    expect(uses(W, "fakeout", build(W, "incineroar", { nature: "Adamant", evs: { atk: 252 }, mechanic: "dynamax" }), blissP())).toEqual({ kind: "not-estimated", reason: "Fails after Dynamax ends" });
    expect(counts(uses(W, "fakeout", build(W, "incineroar", { nature: "Adamant", evs: { atk: 252 }, mechanic: "dynamax" }), blissP({ hp: 200 })))).toEqual({ fewest: 2, guaranteed: 3 });
  });
  it("the row's own move once Dynamax ends: Super Fang halves from 609 (14 uses), Brave Bird's recoil faints the user first, Inferno burns", () => {
    const l100 = build(W, "blissey", { nature: "Bold", evs: { hp: 252, def: 252 }, level: 100 });
    // 679, 644, 609, then 305, 153 ... 1, 0.
    expect(counts(uses(W, "superfang", build(W, "mew", { mechanic: "dynamax" }), l100))).toEqual({ fewest: 14, guaranteed: 14 });
    // Lowest rolls: 21 HP left after use 16, when the recoil faints Mew.
    expect(uses(W, "bravebird", build(W, "mew", { mechanic: "dynamax" }), l100))
      .toMatchObject({ kind: "uses", guaranteed: null, fewest: 14, faintsFirst: true, attackerFaints: { lowest: 16, highest: 14 } });
    // 556, 408, 260, then Inferno 146 and its burn 102, then 0.
    expect(uses(W, "inferno", build(W, "chandelure", { mechanic: "dynamax", level: 100 }), build(W, "chansey", { item: "utilityumbrella", evs: { hp: 252, spd: 252 }, level: 100 })))
      .toMatchObject({ kind: "uses", fewest: 4, guaranteed: 5, endOfTurn: true });
  });
  it("Max Darkness takes no item (Thief 190, 18, 0) and Truant loafs while Dynamaxed (Iron Head 165, loaf, 95, loaf, then 63 a use)", () => {
    expect(counts(uses(W, "thief", build(W, "grimmsnarl", { item: "", hp: 60, nature: "Adamant", evs: { atk: 252 }, mechanic: "dynamax" }), blissP({ item: "lifeorb" })))).toEqual({ fewest: 2, guaranteed: 3 });
    const durant = build(W, "durant", { ability: "truant", nature: "Adamant", evs: { atk: 252 }, mechanic: "dynamax" });
    expect(uses(W, "ironhead", durant, build(W, "snorlax", { item: "leftovers", nature: "Impish", evs: { hp: 252, def: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 4, guaranteed: 6, turns: "Truant: one use every other turn" });
    expect(counts(uses(W, "ironhead", durant, build(W, "toxapex", { nature: "Bold", evs: { hp: 252, def: 252 } })))).toEqual({ fewest: 7, guaranteed: 8 });
  });
  it("G-Max Wind Rage clears Grassy Terrain (228, 99, 0, no heal) and G-Max Sweetness cures the user's burn (81, then 162 a use)", () => {
    expect(counts(uses(W, "bravebird", build(W, "corviknight", { nature: "Adamant", evs: { atk: 252 }, mechanic: "gigantamax" }), build(W, "chansey", { item: "eviolite", nature: "Bold", evs: { hp: 252, def: 252 } }), { terrain: "Grassy" })))
      .toEqual({ fewest: 3, guaranteed: 3 });
    const sweetness = counted(uses(W, "seedbomb", build(W, "appletun", { ability: "ripen", status: "brn", nature: "Adamant", evs: { atk: 252 }, mechanic: "gigantamax" }), blissP()));
    expect(sweetness).toMatchObject({ fewest: 3, guaranteed: 3 });
    expect(sweetness.carried).toEqual(["G-Max Sweetness cures the attacker's status.", "Dynamax ends after 3 turns."]);
  });
  it("a weather a Max Move sets lasts 5 turns: Meteor Beam's Max Rockfall sand stops after the fourth end of turn (KO on use 5 both ways)", () => {
    expect(counts(uses(W, "meteorbeam", build(W, "aerodactyl", { ability: "rockhead", nature: "Modest", evs: { spa: 252 }, mechanic: "dynamax" }), blissS()))).toEqual({ fewest: 5, guaranteed: 5 });
  });
});

describe("False Swipe, Hold Back and Endeavor: the end of turn can finish what they leave", () => {
  const scizor = () => build(S, "scizor", { nature: "Adamant", evs: { atk: 252 } });
  it("False Swipe into a poisoned Clefable: 137 (116), 83 (62), 29 (8), 1 then 0, or 3 uses with the highest rolls", () => {
    expect(uses(S, "falseswipe", scizor(), build(S, "clefable", { status: "psn" }))).toMatchObject({ kind: "uses", fewest: 3, guaranteed: 4, fasterChance: 0.541015625, endOfTurn: true });
  });
  it("False Swipe leaves 1 HP and sand or poison takes it: Pikachu at 20 HP is out after one use", () => {
    expect(counts(uses(S, "falseswipe", scizor(), build(S, "pikachu", { hp: 20 }), sand))).toEqual({ fewest: 1, guaranteed: 1 });
    expect(counts(uses(S, "falseswipe", scizor(), build(S, "pikachu", { hp: 20, status: "psn" })))).toEqual({ fewest: 1, guaranteed: 1 });
  });
  it("Hold Back into a burned Snorlax at 60 HP: 32 (18), 1 then 0", () => {
    expect(counts(uses(W, "holdback", build(W, "metagross"), build(W, "snorlax", { hp: 60, status: "brn" })))).toEqual({ fewest: 2, guaranteed: 2 });
  });
  it("Endeavor brings the target to the user's HP and the end of turn finishes it", () => {
    expect(counts(uses(S, "endeavor", build(S, "pikachu", { hp: 1 }), build(S, "blissey", { status: "brn" })))).toEqual({ fewest: 1, guaranteed: 1 });
    expect(counts(uses(S, "endeavor", build(S, "carbink", { hp: 20 }), build(S, "blissey"), sand))).toEqual({ fewest: 1, guaranteed: 1 });
    expect(counts(uses(C, "endeavor", build(C, "aggron", { hp: 10 }), build(C, "clefable", { status: "psn" })))).toEqual({ fewest: 1, guaranteed: 1 });
  });
  it("never, with nothing at the end of the turn", () => {
    expect(uses(S, "falseswipe", scizor(), build(S, "pikachu", { hp: 20 }))).toEqual({ kind: "never", reason: "False Swipe leaves at least 1 HP" });
  });
});

describe("Anger Shell", () => {
  it("does not act after a Sheer Force move: Sludge Bomb 34 every use (143 ... 7, 0), Rock Slide 39 every use", () => {
    const landorus = (nature: string, evs: Partial<StatTable<number>>) => build(S, "landorus", { ability: "sheerforce", nature, evs });
    expect(counts(uses(S, "sludgebomb", landorus("Modest", { spa: 252 }), build(S, "klawf", { ability: "angershell", nature: "Calm", evs: { hp: 252, spd: 252 } })))).toEqual({ fewest: 5, guaranteed: 6 });
    const rockSlide = counted(uses(S, "rockslide", landorus("Adamant", { atk: 252 }), build(S, "klawf", { ability: "angershell", nature: "Impish", evs: { hp: 252, def: 252 } })));
    expect(rockSlide).toMatchObject({ fewest: 4, guaranteed: 5 });
    expect(rockSlide.carried).not.toContain("The target's Anger Shell acts at half HP.");
  });
  it("checks half HP before the Sitrus Berry it holds, and again after each heal: Ice Beam 114, 51 (Sitrus 95), 0", () => {
    expect(counts(uses(S, "icebeam", build(S, "mew", { nature: "Modest", evs: { spa: 252 } }), build(S, "klawf", { ability: "angershell", item: "sitrusberry", evs: { hp: 252, spd: 252 } }))))
      .toEqual({ fewest: 3, guaranteed: 4 });
    // 135, 93, 51 (Sitrus 95), then 34 after the second boost, 0.
    expect(counts(uses(S, "dragonclaw", build(S, "garchomp", { nature: "Jolly", evs: { atk: 100 } }), build(S, "klawf", { ability: "angershell", item: "sitrusberry", nature: "Impish", evs: { hp: 252, def: 252 } }))))
      .toEqual({ fewest: 4, guaranteed: 5 });
  });
});

describe("the attacker's own HP berry", () => {
  it("Sitrus heals the attacker: Kingambit's target is out on use 5 before Rough Skin and Rocky Helmet faint it", () => {
    const value = counted(uses(C, "ironhead", build(C, "kingambit", { ability: "defiant", item: "sitrusberry" }), build(C, "garchomp", { ability: "roughskin", item: "rockyhelmet", nature: "Impish", evs: { hp: 32, def: 32 } })));
    expect(value).toMatchObject({ fewest: 5, guaranteed: 5, attackerFaints: { lowest: 5, highest: 5 } });
    expect(value.faintsFirst).toBeUndefined();
    expect(value.carried).toContain("The attacker's Sitrus Berry heals it once, at half its HP or less.");
  });
  it("Brave Bird's recoil from 100 HP, Steel Beam's cost and Acrobatics doubling once the berry is eaten", () => {
    expect(uses(S, "bravebird", build(S, "talonflame", { nature: "Jolly", item: "sitrusberry", hp: 100 }), build(S, "chansey", { item: "eviolite", nature: "Bold", evs: { hp: 252, def: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 5, guaranteed: 5 });
    // 115, 55, 0: Sitrus after the first Steel Beam makes room for a third.
    expect(uses(S, "steelbeam", build(S, "archaludon", { nature: "Modest", evs: { spa: 252 }, item: "sitrusberry" }), build(S, "chansey", { item: "eviolite", nature: "Calm", evs: { hp: 252, spd: 252 }, hp: 175 })))
      .toMatchObject({ kind: "uses", fewest: 3, guaranteed: 3, limit: 3, limitReason: "self-cost" });
    // 155, 137, 119, 101, then 36 a use: 65, 29, 0.
    expect(counts(uses(S, "acrobatics", build(S, "talonflame", { nature: "Adamant", evs: { atk: 252 }, item: "sitrusberry" }), build(S, "corviknight", { item: "rockyhelmet" })))).toEqual({ fewest: 6, guaranteed: 7 });
  });
});

describe("turns and PP", () => {
  it("Power Herb skips only the first charge turn: Meteor Beam 301, then a charge turn before each use, KO on use 6 or 5", () => {
    expect(uses(S, "meteorbeam", build(S, "mew", { nature: "Modest", evs: { spa: 252 }, item: "powerherb" }), build(S, "blissey", { item: "leftovers", evs: { hp: 252, spd: 252 } })))
      .toMatchObject({ kind: "uses", fewest: 5, guaranteed: 6, turns: "Charges for a turn before each use" });
  });
  it("Mega Sol: Solar Beam never charges (204, 157, 110, 63, 16, 0 with Leftovers between)", () => {
    const value = counted(uses(C, "solarbeam", build(C, "meganiummega", { ability: "megasol", item: "meganiumite" }), build(C, "snorlax", { item: "leftovers", nature: "Careful", evs: { hp: 32, spd: 32 } })));
    expect(value).toMatchObject({ fewest: 5, guaranteed: 6 });
    expect(value.turns).toBeUndefined();
  });
  it("Dig: underground on its charge turn, the user is out of the sand, and gets no Grassy Terrain heal", () => {
    // The user stays at 25 through each charge turn: 180 (160), charge 140, 10 then 0.
    expect(counts(uses(S, "dig", build(S, "arcanine", { hp: 25 }), build(S, "blissey"), sand))).toEqual({ fewest: 2, guaranteed: 2 });
    // At 15 HP with Life Orb: no heal underground, and Life Orb faints it after the first hit.
    expect(uses(S, "dig", build(S, "arcanine", { hp: 15, item: "lifeorb" }), build(S, "blissey"), { terrain: "Grassy" }))
      .toMatchObject({ kind: "uses", guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 1, highest: 1 } });
  });
  it("a copied move has 5 PP (Imposter: pinned Showdown transformInto)", () => {
    expect(uses(S, "seismictoss", build(S, "ditto", { ability: "imposter" }), build(S, "blissey"))).toMatchObject({ kind: "uses", guaranteed: null, fewest: null, limit: 5, limitReason: "pp", needed: 7 });
  });
  it("a lock-in takes 1 PP for its 2 or 3 turns: Uproar KO on use 13 (Showdown PP 11, 11, 11, 10 ...), Outrage on use 7", () => {
    const altaria = build(C, "altaria"), corviknight = build(C, "corviknight");
    expect(uses(C, "uproar", altaria, corviknight)).toMatchObject({ kind: "uses", fewest: 11, guaranteed: 13, limit: 36, limitReason: "cap" });
    expect(uses(C, "outrage", altaria, corviknight)).toMatchObject({ kind: "uses", fewest: 6, guaranteed: 7, limit: 24, limitReason: "cap" });
  });
  it("Leppa Berry restores the PP: Fire Blast KO on use 11 (154 ... 14, 0) after 8 PP", () => {
    const value = counted(uses(C, "fireblast", build(C, "snorlax", { item: "leppaberry" }), build(C, "blastoise")));
    expect(value).toMatchObject({ fewest: 10, guaranteed: 11, limit: 16, limitReason: "pp" });
    expect(value.carried).toContain("The attacker's Leppa Berry restores 8 PP once the move runs out.");
  });
});

describe("the end of turn", () => {
  it("Hydration cures the status in the rain before it acts: Seismic Toss 155, 105, 55, 5, 0; a cured attacker's Liquidation doubles", () => {
    const rain = { weather: "Rain" } as const;
    expect(counts(uses(S, "seismictoss", build(S, "blissey"), build(S, "vaporeon", { ability: "hydration", status: "psn" }), rain))).toEqual({ fewest: 5, guaranteed: 5 });
    // 294, then 136 a use: 158, 22, 0.
    expect(counts(uses(S, "liquidation", build(S, "vaporeon", { ability: "hydration", status: "brn", nature: "Adamant", evs: { atk: 252 } }), build(S, "blissey", { nature: "Bold", evs: { hp: 252, def: 252 } }), rain)))
      .toEqual({ fewest: 3, guaranteed: 4 });
  });
  it("weather a use sets hurts the attacker: Sand Spit's sand faints Arcanine at 10 HP after the first use, Max Rockfall's a Charizard at 10 HP after use 3", () => {
    expect(uses(S, "flamethrower", build(S, "arcanine", { hp: 10 }), build(S, "sandaconda", { ability: "sandspit" })))
      .toMatchObject({ kind: "uses", guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 1, highest: 1 } });
    expect(uses(W, "rockslide", build(W, "charizard", { hp: 10, mechanic: "dynamax" }), build(W, "blissey", { nature: "Bold", evs: { hp: 252, def: 252 } })))
      .toMatchObject({ kind: "uses", guaranteed: null, fewest: null, faintsFirst: true, attackerFaints: { lowest: 3, highest: 3 } });
  });
  it("Smack Down grounds a Flying target for Grassy Terrain's heal (137 then 147, ...), and Eelevate floats (no heal)", () => {
    expect(counts(uses(S, "smackdown", build(S, "tyranitar"), build(S, "corviknight", { ability: "mirrorarmor" }), { terrain: "Grassy" }))).toEqual({ fewest: 5, guaranteed: 7 });
    expect(counts(uses(C, "flamethrower", build(C, "charizard"), build(C, "eelektrossmega", { ability: "eelevate", item: "eelektrossite" }), { terrain: "Grassy" }))).toEqual({ fewest: 3, guaranteed: 3 });
  });
  it("Bad Dreams damages a Comatose target every turn: 123 (102), 53 (32), 0", () => {
    expect(counts(uses(S, "darkpulse", build(S, "darkrai", { ability: "baddreams" }), build(S, "komala", { ability: "comatose", nature: "Calm", evs: { hp: 252, spd: 252 } })))).toEqual({ fewest: 3, guaranteed: 3 });
  });
  it("not estimated: sleep that wears off under Bad Dreams, Perish Body, Shed Skin, the attacker's Power Construct", () => {
    expect(uses(S, "darkpulse", build(S, "darkrai", { ability: "baddreams" }), build(S, "blissey", { status: "slp", evs: { hp: 252, spd: 252 } }))).toEqual({ kind: "not-estimated", reason: "Sleep wears off at random" });
    expect(uses(W, "ironhead", build(W, "garchomp"), build(W, "cursola", { ability: "perishbody", nature: "Bold", evs: { hp: 252, def: 252 } }))).toEqual({ kind: "not-estimated", reason: "Perish Body: both faint after 4 turns" });
    expect(uses(S, "seismictoss", build(S, "blissey"), build(S, "scrafty", { ability: "shedskin", status: "brn", evs: { hp: 252 }, hp: 160 }))).toEqual({ kind: "not-estimated", reason: "Shed Skin may cure its status" });
    expect(uses(U, "dragonpulse", build(U, "zygarde10", { ability: "powerconstruct", item: "lifeorb", nature: "Modest", evs: { spa: 252 } }), build(U, "blissey", { nature: "Calm", evs: { hp: 252, spd: 252 } })))
      .toEqual({ kind: "not-estimated", reason: "Power Construct changes its form" });
  });
  it("counted: a Zygarde-Complete target (no form to change to), and Venoshock into a sleeping target (it reads poison only)", () => {
    expect(counts(uses(W, "icebeam", build(W, "mew", { nature: "Modest", evs: { spa: 252 } }), build(W, "zygardecomplete", { ability: "powerconstruct" })))).toEqual({ fewest: 2, guaranteed: 2 });
    expect(counts(uses(S, "venoshock", build(S, "gengar"), build(S, "garchomp", { status: "slp" })))).toEqual({ fewest: 6, guaranteed: 8 });
  });
});

describe("chances, survival and the end-of-turn flag", () => {
  it("Focus Sash stops nothing when the end of turn takes its 1 HP: Earthquake into Sash Smeargle in sand is a guaranteed OHKO", () => {
    const garchomp = build(S, "garchomp", { nature: "Adamant", evs: { atk: 252 } }), smeargle = build(S, "smeargle", { ability: "owntempo", item: "focussash" });
    const sanded = counted(uses(S, "earthquake", garchomp, smeargle, sand));
    expect(sanded).toMatchObject({ fewest: 1, guaranteed: 1, endOfTurn: true });
    expect(sanded.survival).toBeUndefined();
    expect(uses(S, "earthquake", garchomp, smeargle)).toMatchObject({ kind: "uses", fewest: 2, guaranteed: 2, survival: "Focus Sash" });
  });
  it("a 2HKO's chance of one use: Dragon Darts 137/256 (two 84-102 darts reaching 184), Stomping Tantrum 1/16 with the sand", () => {
    expect(uses(S, "dragondarts", build(S, "dragapult", { nature: "Jolly", evs: { atk: 252 } }), build(S, "garchomp", { evs: { hp: 4 } })))
      .toMatchObject({ kind: "uses", fewest: 1, guaranteed: 2, fasterChance: 137 / 256 });
    expect(uses(S, "stompingtantrum", build(S, "garchomp", { nature: "Jolly", evs: { atk: 252 } }), build(S, "fluttermane", { evs: { hp: 4 } }), sand))
      .toMatchObject({ kind: "uses", fewest: 1, guaranteed: 2, fasterChance: 1 / 16, endOfTurn: true });
  });
  it("a chance that is not certain is below 1: Low Kick's 24 uses (2 HP left on the lowest rolls), Icy Wind within its 24 PP", () => {
    const lowKick = counted(uses(S, "lowkick", build(S, "teddiursa"), build(S, "slowkinggalar")));
    expect(lowKick).toMatchObject({ fewest: 19, guaranteed: 25 });
    expect(lowKick.fasterChance).toBeLessThan(1);
    const icyWind = counted(uses(U, "icywind", build(U, "dragonair"), build(U, "aurorus")));
    expect(icyWind).toMatchObject({ fewest: 20, guaranteed: null, needed: 25 });
    expect(icyWind.chance).toBeLessThan(1);
  });
  it("one use with its end of turn: Explosion into Castform in sand, only the highest roll (136, then 9 to the sand)", () => {
    expect(uses(C, "explosion", build(C, "gourgeist"), build(C, "castform"), sand)).toEqual({ kind: "single-use", reason: "The user faints", koChance: 0.0625 });
  });
});

describe("what the count carries and assumes", () => {
  it("names the item a use takes only when it is taken, and the residuals after the first use", () => {
    expect(counted(uses(S, "knockoff", build(S, "weavile"), build(S, "garchomp", { item: "leftovers" }))).carried).toEqual(["Knock Off takes the target's item."]);
    expect(counted(uses(S, "flashcannon", build(S, "klefki", { ability: "magician", item: "" }), build(S, "garchomp", { item: "leftovers" }))).carried)
      .toEqual(["The attacker's Magician takes the target's item.", "Leftovers heals the attacker at the end of each turn."]);
    expect(counted(uses(S, "bugbite", build(S, "scizor"), build(S, "garchomp", { item: "leftovers" }))).carried).toEqual(["Leftovers heals the target at the end of each turn."]);
    expect(counted(uses(U, "knockoff", build(U, "weavile"), build(U, "muk", { ability: "stickyhold", item: "leftovers" }))).carried).toEqual(["Leftovers heals the target at the end of each turn."]);
  });
  it("Multiscale and Tera Shell only when they act", () => {
    const dragonite = build(S, "dragonite", { ability: "multiscale", evs: { hp: 252, def: 252 } });
    expect(counted(uses(S, "dragonclaw", build(S, "haxorus", { ability: "moldbreaker", nature: "Adamant", evs: { atk: 252 } }), dragonite)).carried).toEqual([]);
    expect(counted(uses(S, "dragonclaw", build(S, "garchomp", { nature: "Adamant", evs: { atk: 252 } }), dragonite)).carried).toEqual(["Multiscale weakens only the first use."]);
    expect(counted(uses(S, "earthquake", build(S, "haxorus", { ability: "moldbreaker", nature: "Adamant", evs: { atk: 252 } }), build(S, "terapagos", { evs: { hp: 252 } }))).carried).toEqual([]);
  });
  it("Poltergeist fails once the Weakness Policy is used up (29 or 3 HP left on every later use)", () => {
    const value = counted(uses(S, "poltergeist", build(S, "gholdengo", { ability: "goodasgold", nature: "Adamant", evs: { atk: 252 } }), build(S, "gengar", { item: "weaknesspolicy", evs: { hp: 252, def: 252 } })));
    expect(value).toMatchObject({ fewest: null, guaranteed: null, limit: 8 });
    expect(value.carried).toEqual(["Poltergeist fails once the target's item is used up."]);
  });
  it("the timed field it assumes, without what the move ends; the target's partner in Doubles", () => {
    expect(counted(uses(C, "brickbreak", build(C, "charizard"), build(C, "snorlax"), { defenderSide: { ...createSide(), reflect: true } })).notes).toEqual([]);
    expect(counted(uses(C, "dragonclaw", build(C, "garchomp"), build(C, "snorlax"), { defenderSide: { ...createSide(), reflect: true } })).notes).toEqual(["Assumes the screens last through every use."]);
    const spinner = counted(uses(C, "icespinner", build(C, "weavile"), build(C, "snorlax"), { terrain: "Grassy" }));
    expect([spinner.carried, spinner.notes]).toEqual([["Ice Spinner ends the terrain."], []]);
    const doubles = { gameType: "Doubles", multipleTargets: true } as const;
    expect(counted(uses(C, "heatwave", build(C, "charizard"), build(C, "blastoise"), doubles)).notes)
      .toEqual(["Assumes the target's partner stays in for every use.", "Assumes the target's partner has no Pressure, which would take a PP more each use."]);
    expect(uses(C, "outrage", build(C, "dragonite"), build(C, "blastoise"), doubles)).toEqual({ kind: "not-estimated", reason: "Hits a random foe each turn" });
  });
});
