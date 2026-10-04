import { describe, expect, it } from "vitest";
import { calculateMatchup, type MatchupResult } from "@/app/lib/battle/calculate";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, MoveDamageResult, UsesToKO } from "@/app/lib/battle/types";

/**
 * Items a Pokémon uses before the move, both sides alike, against pinned Showdown c23d2e94 run from the state set at
 * the start of a turn: its Custap Berry at its line is eaten as its move is chosen, its HP and pinch berries at the
 * turn's first Update (after the beforeTurn action), so the move starts from the healed HP or raised stage with the
 * item gone. States, first-hit rolls and the KO chance are Showdown's own when the attacker's move starts
 * (scripts/.cache/calc-audit/target-berry/engine/compare-states.ts, 80 cases); Uses to KO values are exact over
 * every roll sequence of real turns (uses-exact.ts). Level 50, 0 EVs / Stat Points, 31 IVs, Serious nature, Singles,
 * no crit. Garchomp's maximum HP is 183 (Sitrus line 91, Figy and pinch line 45).
 */
function build(runtime: BattleRuntime, id: string, extra: Partial<BattleBuild> = {}): BattleBuild {
  return { ...createBuild(id, runtime), nature: "Serious", ...extra } as BattleBuild;
}
function matchup(runtime: BattleRuntime, attacker: BattleBuild, defender: BattleBuild, field: Partial<BattleConditions> = {}): MatchupResult {
  const out = calculateMatchup(attacker, defender, { ...createConditions(), gameType: "Singles", ...field }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out;
}
function row(out: MatchupResult, moveId: string): MoveDamageResult {
  const found = out.results.find((result) => result.moveId === moveId);
  expect(found?.kind, moveId).toBe("calculated");
  return found!;
}
type Counted = Extract<UsesToKO, { kind: "uses" }>;
function counted(value: UsesToKO | undefined): Counted {
  expect(value?.kind).toBe("uses");
  return value as Counted;
}
const range = ({ min, max }: MoveDamageResult) => `${min}–${max}`;
const eaten = (result: MoveDamageResult) => result.assumptions.filter((line) => / was (eaten|used) at | cured its /.test(line));
/** Garchomp 0 EV Dragon Claw into Garchomp (Showdown's 16 rolls). */
const CLAW = [116, 120, 120, 122, 122, 126, 126, 128, 128, 132, 132, 134, 134, 138, 138, 140];

describe("a target at or under its berry's line eats it before the move", () => {
  it("starts from the HP a Sitrus Berry at half HP or less healed; one HP above, the berry waits for the hit", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const chomp = (extra: Partial<BattleBuild> = {}) => build(sv, "garchomp", { abilityId: "roughskin", ...extra });
    // Showdown: 91 is eaten at the first Update, 91 to 136, so 3 of 16 Dragon Claw rolls (138, 138, 140) knock it out.
    const half = matchup(sv, chomp(), chomp({ itemId: "sitrusberry", currentHP: 91 }));
    expect(half.settledHP).toEqual({ defender: { hp: 136, entered: 91, maxHP: 183, item: "Sitrus Berry" } });
    const claw = row(half, "dragonclaw");
    expect(claw).toMatchObject({ min: 116, max: 140, rolls: CLAW, ohkoChance: 0.1875 });
    expect(eaten(claw)).toEqual(["The target Garchomp's Sitrus Berry was eaten at 91 HP: 136 HP."]);
    expect(counted(claw.usesToKO)).toMatchObject({ guaranteed: 2, fewest: 1, fasterChance: 0.1875, carried: [] });
    // 92 is above 183 / 2: Showdown keeps the berry, and every roll knocks it out first.
    const above = matchup(sv, chomp(), chomp({ itemId: "sitrusberry", currentHP: 92 }));
    expect(above.settledHP).toBeUndefined();
    expect(row(above, "dragonclaw")).toMatchObject({ ohkoChance: 1 });
    expect(eaten(row(above, "dragonclaw"))).toEqual([]);
    expect(counted(row(above, "dragonclaw").usesToKO).carried).toContain("The target's Sitrus Berry heals it once, at half its HP or less.");
  });

  it("counts the uses from the healed HP, and from a berry eaten after the hit (Showdown's exact counts)", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const hydreigon = build(sv, "hydreigon", { abilityId: "levitate" });
    const chomp = (currentHP: number) => build(sv, "garchomp", { abilityId: "roughskin", itemId: "sitrusberry", currentHP });
    // Crunch 51–60. From 91: 136 before the move, 3 uses always (Showdown [0, 0, 1]).
    const half = row(matchup(sv, hydreigon, chomp(91)), "crunch");
    expect(range(half)).toBe("51–60");
    expect(counted(half.usesToKO)).toMatchObject({ guaranteed: 3, fewest: 3 });
    // At 51% (93) it keeps the berry until a hit takes it to its line: 3 uses always (Showdown [0, 0, 1]).
    const above = matchup(sv, hydreigon, chomp(93));
    expect(above.settledHP).toBeUndefined();
    expect(counted(row(above, "crunch").usesToKO)).toMatchObject({ guaranteed: 3, fewest: 3, carried: ["The target's Sitrus Berry heals it once, at half its HP or less."] });
    // From 120 the berry is eaten after a hit: 47.65625% within 3 uses, every sequence within 4 (Showdown 0.4765625 within 3).
    expect(counted(row(matchup(sv, hydreigon, chomp(120)), "crunch").usesToKO)).toMatchObject({ guaranteed: 4, fewest: 3, fasterChance: 0.4765625 });
  });

  it("heals with Oran, Berry Juice and the Figy family by game, and at half HP with Gluttony", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    const ss = await loadBattleRuntime("sword_shield");
    const target = (runtime: BattleRuntime, itemId: string, currentHP: number) => build(runtime, "garchomp", { abilityId: "roughskin", itemId, currentHP });
    const settled = (runtime: BattleRuntime, itemId: string, currentHP: number) => matchup(runtime, build(runtime, "garchomp", { abilityId: "roughskin" }), target(runtime, itemId, currentHP)).settledHP?.defender;
    expect(settled(sv, "oranberry", 50)).toEqual({ hp: 60, entered: 50, maxHP: 183, item: "Oran Berry" });
    // Figy heals a third in Scarlet/Violet and Sword/Shield (Iapapa too), half in Ultra Sun/Moon (gen7 mod), at a quarter or less.
    expect(settled(sv, "figyberry", 45)).toMatchObject({ hp: 106 });
    expect(settled(sv, "figyberry", 46)).toBeUndefined();
    expect(settled(ss, "iapapaberry", 45)).toMatchObject({ hp: 106, item: "Iapapa Berry" });
    const usum = matchup(us, build(us, "garchomp", { abilityId: "roughskin" }), target(us, "figyberry", 45));
    expect(usum.settledHP?.defender).toMatchObject({ hp: 136 });
    expect(row(usum, "dragonclaw")).toMatchObject({ rolls: CLAW, ohkoChance: 0.1875 });
    // Berry Juice is used, not eaten: +20 (Showdown 91 to 111).
    const juice = matchup(us, build(us, "garchomp", { abilityId: "roughskin" }), target(us, "berryjuice", 91));
    expect(juice.settledHP?.defender).toEqual({ hp: 111, entered: 91, maxHP: 183, item: "Berry Juice" });
    expect(eaten(row(juice, "dragonclaw"))).toEqual(["The target Garchomp's Berry Juice was used at 91 HP: 111 HP."]);
    // Figy from 45 to 106, then Crunch 51–60: 83.203125% within 2 uses (Showdown exact).
    expect(counted(row(matchup(sv, build(sv, "hydreigon", { abilityId: "levitate" }), target(sv, "figyberry", 45)), "crunch").usesToKO))
      .toMatchObject({ guaranteed: 3, fewest: 2, fasterChance: 0.83203125 });
    // Snorlax (235 HP): Gluttony eats a Figy Berry at half, 117 to 195; 118 keeps it; Sitrus keeps its own half line (117 to 175).
    const snorlax = (itemId: string, currentHP: number) => build(sv, "snorlax", { abilityId: "gluttony", itemId, currentHP });
    const gluttony = matchup(sv, build(sv, "hydreigon", { abilityId: "levitate" }), snorlax("figyberry", 117));
    expect(gluttony.settledHP?.defender).toEqual({ hp: 195, entered: 117, maxHP: 235, item: "Figy Berry" });
    expect(counted(row(gluttony, "crunch").usesToKO)).toMatchObject({ guaranteed: 3, fewest: 3 });
    expect(matchup(sv, build(sv, "garchomp"), snorlax("figyberry", 118)).settledHP).toBeUndefined();
    expect(matchup(sv, build(sv, "garchomp"), snorlax("sitrusberry", 117)).settledHP?.defender).toMatchObject({ hp: 175 });
  });

  it("applies Ripen, Cheek Pouch, Contrary and Simple as Showdown's heal and boost do", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const ss = await loadBattleRuntime("sword_shield");
    const claw = (runtime: BattleRuntime, defender: BattleBuild) => matchup(runtime, build(runtime, "garchomp", { abilityId: "roughskin" }), defender);
    // Ripen doubles Sitrus's 46 (Appletun 185 HP: 70 to 162) and Ganlon's rise.
    expect(claw(sv, build(sv, "appletun", { abilityId: "ripen", itemId: "sitrusberry", currentHP: 70 })).settledHP?.defender).toMatchObject({ hp: 162 });
    const ripen = row(claw(sv, build(sv, "appletun", { abilityId: "ripen", itemId: "ganlonberry", currentHP: 40 })), "dragonclaw");
    expect(range(ripen)).toBe("68–84");
    expect(eaten(ripen)).toEqual(["The target Appletun's Ganlon Berry was eaten at 40 HP: +2 Defense."]);
    // Cheek Pouch heals a third as any Berry is eaten (Greedent 195 HP: Sitrus 97 to 195; a Lum Berry curing a burn 97 to 162).
    expect(claw(sv, build(sv, "greedent", { abilityId: "cheekpouch", itemId: "sitrusberry", currentHP: 97 })).settledHP?.defender).toMatchObject({ hp: 195 });
    const lum = claw(sv, build(sv, "greedent", { abilityId: "cheekpouch", itemId: "lumberry", currentHP: 97, status: "brn" }));
    expect(lum.settledHP?.defender).toEqual({ hp: 162, entered: 97, maxHP: 195, item: "Lum Berry" });
    expect(eaten(row(lum, "dragonclaw"))).toEqual(["The target Greedent's Lum Berry cured its burn (used up), then Cheek Pouch: 162 HP."]);
    // Contrary lowers Defense instead (90–106 into Serperior), Simple doubles the rise (46–55 into Swoobat).
    const contrary = row(claw(sv, build(sv, "serperior", { abilityId: "contrary", itemId: "ganlonberry", currentHP: 35 })), "dragonclaw");
    expect(range(contrary)).toBe("90–106");
    expect(eaten(contrary)).toEqual(["The target Serperior's Ganlon Berry was eaten at 35 HP: -1 Defense (Contrary)."]);
    const simple = row(claw(ss, build(ss, "swoobat", { abilityId: "simple", itemId: "ganlonberry", currentHP: 30 })), "dragonclaw");
    expect(range(simple)).toBe("46–55");
    expect(eaten(simple)).toEqual(["The target Swoobat's Ganlon Berry was eaten at 30 HP: +2 Defense (Simple)."]);
  });

  it("lowers the damage with a Ganlon or Apicot rise, and changes none with Liechi but Foul Play's", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const chomp = (itemId: string, currentHP: number, abilityId = "roughskin") => build(sv, "garchomp", { abilityId, itemId, currentHP });
    const attacker = build(sv, "garchomp", { abilityId: "roughskin" });
    const ganlon = row(matchup(sv, attacker, chomp("ganlonberry", 45)), "dragonclaw");
    expect(ganlon.rolls).toEqual([80, 80, 80, 84, 84, 84, 86, 86, 86, 90, 90, 90, 92, 92, 92, 96]);
    expect(eaten(ganlon)).toEqual(["The target Garchomp's Ganlon Berry was eaten at 45 HP: +1 Defense."]);
    expect(row(matchup(sv, attacker, chomp("ganlonberry", 46)), "dragonclaw").rolls).toEqual(CLAW);
    expect(row(matchup(sv, attacker, chomp("apicotberry", 45)), "dracometeor").rolls).toEqual([96, 96, 98, 98, 98, 102, 102, 102, 104, 104, 108, 108, 108, 110, 110, 114]);
    const liechi = row(matchup(sv, attacker, chomp("liechiberry", 45)), "dragonclaw");
    expect(liechi.rolls).toEqual(CLAW);
    expect(eaten(liechi)).toEqual(["The target Garchomp's Liechi Berry was eaten at 45 HP: +1 Attack."]);
    expect(range(row(matchup(sv, build(sv, "grimmsnarl", { abilityId: "prankster" }), chomp("liechiberry", 45)), "foulplay"))).toBe("105–124");
    // Salac's Speed rise raises Gyro Ball's power from the target's Speed (Showdown 48–57).
    expect(range(row(matchup(sv, build(sv, "bronzong", { abilityId: "levitate" }), chomp("salacberry", 45)), "gyroball"))).toBe("48–57");
    // Rock Slide 19–23 into +1 Defense from 45 HP: 2.734375% within 2 uses (Showdown exact).
    expect(counted(row(matchup(sv, build(sv, "tyranitar", { abilityId: "sandstream" }), chomp("ganlonberry", 45, "sandveil")), "rockslide").usesToKO))
      .toMatchObject({ guaranteed: 3, fewest: 2, fasterChance: 0.02734375 });
  });

  it("keeps a Berry Unnerve or As One stops, not Berry Juice, and any item Magic Room or Klutz holds back", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const ss = await loadBattleRuntime("sword_shield");
    const chomp = (runtime: BattleRuntime, itemId: string, currentHP: number) => build(runtime, "garchomp", { abilityId: "roughskin", itemId, currentHP });
    const unnerve = (runtime: BattleRuntime) => build(runtime, "tyranitar", { abilityId: "unnerve" });
    const kept = matchup(sv, unnerve(sv), chomp(sv, "sitrusberry", 91));
    expect(kept.settledHP).toBeUndefined();
    expect(eaten(row(kept, "crunch"))).toEqual([]);
    expect(counted(row(kept, "crunch").usesToKO)).toMatchObject({ guaranteed: 2, fewest: 2 });
    const juice = matchup(ss, unnerve(ss), chomp(ss, "berryjuice", 91));
    expect(juice.settledHP?.defender).toMatchObject({ hp: 111 });
    expect(counted(row(juice, "crunch").usesToKO)).toMatchObject({ guaranteed: 2, fewest: 2 });
    expect(matchup(sv, build(sv, "calyrexice", { abilityId: "asoneglastrier" }), chomp(sv, "oranberry", 50)).settledHP).toBeUndefined();
    // Magic Room: Crunch 51–60 from 91, 2 uses (Showdown [0, 1]).
    const room = matchup(sv, build(sv, "hydreigon", { abilityId: "levitate" }), chomp(sv, "sitrusberry", 91), { magicRoom: true });
    expect(room.settledHP).toBeUndefined();
    expect(counted(row(room, "crunch").usesToKO)).toMatchObject({ guaranteed: 2, fewest: 2 });
    expect(matchup(sv, build(sv, "garchomp"), build(sv, "golurk", { abilityId: "klutz", itemId: "sitrusberry", currentHP: 60 })).settledHP).toBeUndefined();
    // The holder's own Neutralizing Gas suppresses the foe's Unnerve (Weezing-Galar 70 to 105); the foe's gas suppresses Gluttony.
    expect(matchup(sv, unnerve(sv), build(sv, "weezinggalar", { abilityId: "neutralizinggas", itemId: "sitrusberry", currentHP: 70 })).settledHP?.defender).toMatchObject({ hp: 105 });
    expect(matchup(sv, build(sv, "weezinggalar", { abilityId: "neutralizinggas" }), build(sv, "snorlax", { abilityId: "gluttony", itemId: "figyberry", currentHP: 117 })).settledHP).toBeUndefined();
  });

  it("leaves the target without its item: Knock Off has no boost, Poltergeist fails, Unburden doubles its Speed; HP moves read the healed HP", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const sitrus = build(sv, "garchomp", { abilityId: "roughskin", itemId: "sitrusberry", currentHP: 91 });
    expect(range(row(matchup(sv, build(sv, "conkeldurr", { abilityId: "ironfist" }), sitrus), "knockoff"))).toBe("34–41");
    expect(range(row(matchup(sv, build(sv, "gengar", { abilityId: "cursedbody" }), sitrus), "poltergeist"))).toBe("0–0");
    const hawlucha = row(matchup(sv, build(sv, "bronzong", { abilityId: "levitate" }), build(sv, "hawlucha", { abilityId: "unburden", itemId: "sitrusberry", currentHP: 70 })), "gyroball");
    expect(range(hawlucha)).toBe("85–102");
    expect(hawlucha.assumptions).toContain("The target Hawlucha's Unburden is active (Sitrus Berry used up).");
    // 136 is above half: Brine is not doubled; Hard Press reads 136 of 183; Super Fang takes half of 136.
    expect(range(row(matchup(sv, build(sv, "empoleon", { abilityId: "torrent" }), sitrus), "brine"))).toBe("46–55");
    expect(range(row(matchup(sv, build(sv, "archaludon", { abilityId: "stamina" }), sitrus), "hardpress"))).toBe("46–55");
    expect(range(row(matchup(sv, build(sv, "cinccino", { abilityId: "technician" }), sitrus), "superfang"))).toBe("68–68");
  });

  it("eats Lansat and Custap Berries at a quarter, but a Micle Berry only at the end of a turn", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const conkeldurr = build(sv, "conkeldurr", { abilityId: "ironfist" });
    const knockOff = (defender: BattleBuild, attacker = conkeldurr) => row(matchup(sv, attacker, defender), "knockoff");
    const chomp = (itemId: string, currentHP: number) => build(sv, "garchomp", { abilityId: "roughskin", itemId, currentHP });
    const lansat = knockOff(chomp("lansatberry", 45));
    expect(range(lansat)).toBe("34–41");
    expect(eaten(lansat)).toEqual(["The target Garchomp's Lansat Berry was eaten at 45 HP: +2 critical-hit ratio."]);
    expect(range(knockOff(chomp("micleberry", 45)))).toBe("51–61");
    // Custap is eaten as the target's move is chosen (resolveAction's FractionalPriority), Gluttony at half (Snorlax 117 of 235).
    const custap = knockOff(chomp("custapberry", 45));
    expect(range(custap)).toBe("34–41");
    expect(eaten(custap)).toEqual(["The target Garchomp's Custap Berry was eaten at 45 HP."]);
    expect(range(knockOff(chomp("custapberry", 46)))).toBe("51–61");
    expect(range(knockOff(chomp("custapberry", 45), build(sv, "tyranitar", { abilityId: "unnerve" })))).toBe("75–88");
    expect(range(knockOff(build(sv, "snorlax", { abilityId: "gluttony", itemId: "custapberry", currentHP: 117 })))).toBe("46–55");
    // The attacker's: Acrobatics doubles once its Custap or Lansat Berry is gone (Hawlucha 30 of 153), not with a Micle Berry.
    const hawlucha = (itemId: string) => build(sv, "hawlucha", { abilityId: "limber", itemId, currentHP: 30 });
    const target = build(sv, "garchomp", { abilityId: "roughskin" });
    expect(range(row(matchup(sv, hawlucha("custapberry"), target), "acrobatics"))).toBe("61–73");
    expect(range(row(matchup(sv, hawlucha("custapberry"), target), "aerialace"))).toBe("33–40");
    expect(range(row(matchup(sv, hawlucha("lansatberry"), target), "acrobatics"))).toBe("61–73");
    expect(range(row(matchup(sv, hawlucha("micleberry"), target), "acrobatics"))).toBe("31–37");
  });

  it("states a Starf Berry's random stat, with each outcome's damage exact", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const attacker = build(sv, "garchomp", { abilityId: "roughskin" });
    const starf = (extra: Partial<BattleBuild> = {}) => build(sv, "garchomp", { abilityId: "roughskin", itemId: "starfberry", currentHP: 45, ...extra });
    // Showdown's five sampled stats: +2 Defense gives 60–72, the other four Dragon Claw's usual 116–140.
    const claw = row(matchup(sv, attacker, starf()), "dragonclaw");
    expect(claw).toMatchObject({ rolls: CLAW, ohkoChance: 1 });
    expect(claw.alternate).toMatchObject({
      chance: 0.2, label: "the target's +2 Defense (Starf Berry)", usualLabel: "the target's +2 Attack, Sp. Atk, Sp. Def or Speed",
      min: 60, max: 72, rolls: [60, 60, 60, 62, 62, 62, 62, 66, 66, 66, 66, 68, 68, 68, 68, 72],
    });
    expect(claw.assumptions.slice(-2)).toEqual([
      "The target Garchomp's Starf Berry was eaten at 45 HP: +2 to a random stat.",
      "Starf Berry: the target's +2 Defense (20% chance) gives 60–72 HP (32.8–39.3%). The KO chance includes both cases.",
    ]);
    expect(claw.usesToKO).toEqual({ kind: "not-estimated", reason: "Starf Berry raises a random stat" });
    // With Defense at +6 it raises one of the other four, none of which changes Dragon Claw: one row, counted.
    const capped = row(matchup(sv, attacker, starf({ boosts: { ...createBuild("garchomp", sv).boosts, def: 6 } })), "dragonclaw");
    expect(capped).toMatchObject({ min: 32, max: 38, ohkoChance: 0 });
    expect(capped.alternate).toBeUndefined();
    expect(eaten(capped)).toEqual(["The target Garchomp's Starf Berry was eaten at 45 HP: +2 to one of Attack, Sp. Atk, Sp. Def or Speed at random."]);
    expect(counted(capped.usesToKO)).toMatchObject({ guaranteed: 2, fewest: 2 });
    // A multi-hit row states the other outcome's range.
    const bomb = row(matchup(sv, build(sv, "maushold", { abilityId: "technician" }), starf()), "populationbomb");
    expect(bomb.assumptions).toContain("Starf Berry: these rolls are for the target's +2 Attack, Sp. Atk, Sp. Def or Speed (80% chance).");
    expect(bomb.assumptions).toContain("Starf Berry: the target's +2 Defense (20% chance) gives 63–90 HP (34.4–49.2%).");
    // The attacker's own: +2 Attack (Hawlucha Close Combat 132–156, Showdown) 20% of the time.
    const close = row(matchup(sv, build(sv, "hawlucha", { abilityId: "limber", itemId: "starfberry", currentHP: 30 }), attacker), "closecombat");
    expect(close).toMatchObject({ min: 67, max: 79, ohkoChance: 0 });
    expect(close.alternate).toMatchObject({ chance: 0.2, min: 132, max: 156, rolls: [132, 133, 135, 136, 138, 139, 141, 142, 144, 145, 147, 148, 150, 151, 153, 156] });
    // Into a full-HP Sturdy Archaludon (165 HP) only the +2 Attack outcome reaches its HP, and Sturdy leaves it 1 (Showdown).
    const sturdy = row(matchup(sv, build(sv, "hawlucha", { abilityId: "limber", itemId: "starfberry", currentHP: 30 }), build(sv, "archaludon", { abilityId: "sturdy" })), "closecombat");
    expect(sturdy).toMatchObject({ min: 102, max: 122, ohkoChance: 0, survival: "Sturdy" });
    expect(sturdy.alternate?.rolls).toEqual([204, 204, 206, 210, 212, 216, 216, 218, 222, 224, 228, 228, 230, 234, 236, 240]);
  });

  it("keeps the stat Protosynthesis or Quark Drive picked before the berry's rise", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // Iron Valiant 30 of 149 on Electric Terrain: Quark Drive picked Attack, then Petaya gave +1 Sp. Atk (Showdown Moonblast 216–254).
    const valiant = row(matchup(sv, build(sv, "ironvaliant", { abilityId: "quarkdrive", itemId: "petayaberry", currentHP: 30 }), build(sv, "garchomp", { abilityId: "roughskin" }), { terrain: "Electric" }), "moonblast");
    expect(range(valiant)).toBe("216–254");
    expect(valiant.assumptions).toContain("The attacker Iron Valiant's Quark Drive boosts its Attack (its highest stat), on Electric Terrain. Assumes no stage changes since it activated.");
    // Great Tusk in the sun: Protosynthesis picked Attack (tied with Defense), then Ganlon gave +1 Defense (Showdown 31–37).
    const tusk = row(matchup(sv, build(sv, "garchomp", { abilityId: "roughskin" }), build(sv, "greattusk", { abilityId: "protosynthesis", itemId: "ganlonberry", currentHP: 45 }), { weather: "Sun" }), "dragonclaw");
    expect(range(tusk)).toBe("31–37");
    expect(tusk.assumptions).toContain("The target Great Tusk's Protosynthesis boosts its Attack (its highest stat), in the sun. Assumes no stage changes since it activated.");
  });

  it("uses a transformed Imposter user's own maximum HP, eats before Dynamax, and works in Doubles and Champions", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const ss = await loadBattleRuntime("sword_shield");
    const chomp = (runtime: BattleRuntime, extra: Partial<BattleBuild> = {}) => build(runtime, "garchomp", { abilityId: "roughskin", ...extra });
    // Ditto keeps its 123 HP: 61 to 91, 62 above the line (Showdown).
    expect(matchup(sv, chomp(sv), build(sv, "ditto", { abilityId: "imposter", itemId: "sitrusberry", currentHP: 61 })).settledHP?.defender).toEqual({ hp: 91, entered: 61, maxHP: 123, item: "Sitrus Berry" });
    expect(matchup(sv, chomp(sv), build(sv, "ditto", { abilityId: "imposter", itemId: "sitrusberry", currentHP: 62 })).settledHP).toBeUndefined();
    expect(matchup(sv, build(sv, "ditto", { abilityId: "imposter", itemId: "sitrusberry", currentHP: 61 }), chomp(sv)).settledHP?.attacker).toMatchObject({ hp: 91 });
    // A Dynamaxed target eats at its HP before Dynamax (91 to 136), then has 272 of 366 (Showdown Body Slam 55–66).
    const dynamax = matchup(ss, build(ss, "snorlax", { abilityId: "thickfat" }), chomp(ss, { itemId: "sitrusberry", currentHP: 91, mechanic: "dynamax" }));
    expect(dynamax.settledHP?.defender).toMatchObject({ hp: 136, entered: 91, maxHP: 183 });
    expect(row(dynamax, "bodyslam")).toMatchObject({ min: 55, max: 66, ohkoChance: 0 });
    // Doubles: Crunch from 136, 3 uses (Showdown [0, 0, 1]); Champions: Dragon Claw's 3 in 16.
    const doubles = matchup(sv, build(sv, "hydreigon", { abilityId: "levitate" }), chomp(sv, { itemId: "sitrusberry", currentHP: 91 }), { gameType: "Doubles" });
    expect(doubles.settledHP?.defender).toMatchObject({ hp: 136 });
    expect(counted(row(doubles, "crunch").usesToKO)).toMatchObject({ guaranteed: 3, fewest: 3 });
    const champions = matchup(championsRuntime, chomp(championsRuntime), chomp(championsRuntime, { itemId: "sitrusberry", currentHP: 91 }));
    expect(row(champions, "dragonclaw")).toMatchObject({ rolls: CLAW, ohkoChance: 0.1875 });
  });

  it("sets each side's settled HP, and a multi-hit move starts from the target's", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const both = matchup(sv, build(sv, "garchomp", { abilityId: "roughskin", itemId: "sitrusberry", currentHP: 80 }), build(sv, "garchomp", { abilityId: "roughskin", itemId: "sitrusberry", currentHP: 91 }));
    expect(both.settledHP).toEqual({
      attacker: { hp: 125, entered: 80, maxHP: 183, item: "Sitrus Berry" },
      defender: { hp: 136, entered: 91, maxHP: 183, item: "Sitrus Berry" },
    });
    expect(eaten(row(both, "dragonclaw"))).toEqual(["The attacker Garchomp's Sitrus Berry was eaten at 80 HP: 125 HP.", "The target Garchomp's Sitrus Berry was eaten at 91 HP: 136 HP."]);
    expect(matchup(championsRuntime, build(championsRuntime, "lycanroc", { abilityId: "keeneye", itemId: "sitrusberry", currentHP: 30 }), build(championsRuntime, "garchomp")).settledHP)
      .toEqual({ attacker: { hp: 67, entered: 30, maxHP: 150, item: "Sitrus Berry" } });
    // Population Bomb's first hit 15–18 into the healed 136 (Showdown); Maushold faints to Rough Skin on hit 9.
    const bomb = matchup(sv, build(sv, "maushold", { abilityId: "technician" }), build(sv, "garchomp", { abilityId: "roughskin", itemId: "sitrusberry", currentHP: 91 }));
    expect(bomb.settledHP?.defender).toMatchObject({ hp: 136 });
    const hits = row(bomb, "populationbomb");
    expect(hits).toMatchObject({ hits: 9, min: 135, max: 162 });
    expect((hits.rolls as number[][])[0]).toEqual([15, 15, 15, 15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 18]);
    expect(counted(hits.usesToKO).carried).not.toContain("The target's Sitrus Berry heals it once, at half its HP or less.");
  });

  it("leaves the uses uncounted when Harvest or Cud Chew can bring back a Berry eaten before the move", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const attacker = build(sv, "garchomp", { abilityId: "roughskin" });
    const harvest = matchup(sv, attacker, build(sv, "exeggutor", { abilityId: "harvest", itemId: "sitrusberry", currentHP: 85 }));
    expect(harvest.settledHP?.defender).toMatchObject({ entered: 85, item: "Sitrus Berry" });
    expect(row(harvest, "dragonclaw").usesToKO).toEqual({ kind: "not-estimated", reason: "Harvest may regrow its Berry" });
    const cudChew = matchup(sv, attacker, build(sv, "farigiraf", { abilityId: "cudchew", itemId: "sitrusberry", currentHP: 90 }));
    expect(cudChew.settledHP?.defender).toEqual({ hp: 138, entered: 90, maxHP: 195, item: "Sitrus Berry" });
    expect(row(cudChew, "dragonclaw").usesToKO).toEqual({ kind: "not-estimated", reason: "Cud Chew eats its Berry again" });
    // The attacker's Neutralizing Gas suppresses Cud Chew: the uses are counted.
    expect(row(matchup(sv, build(sv, "weezinggalar", { abilityId: "neutralizinggas" }), build(sv, "farigiraf", { abilityId: "cudchew", itemId: "sitrusberry", currentHP: 90 })), "sludgebomb").usesToKO?.kind).toBe("uses");
  });

  it("leaves the uses uncounted when the attacker's Cud Chew eats its Berry again", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // Farigiraf at 48 of 195 ate its Petaya Berry (Showdown +1 Sp. Atk, 64–76); Cud Chew eats it again after a turn.
    const psychic = row(matchup(sv, build(sv, "farigiraf", { abilityId: "cudchew", itemId: "petayaberry", currentHP: 48 }), build(sv, "blissey", { abilityId: "naturalcure" })), "psychic");
    expect(range(psychic)).toBe("64–76");
    expect(psychic.usesToKO).toEqual({ kind: "not-estimated", reason: "The attacker's Cud Chew eats its Berry again" });
  });
});

/**
 * What a Berry eaten before the move sets going, against pinned Showdown c23d2e94 (one turn from the set state, or two
 * for the uses: scripts/.cache/calc-audit/target-berry/fix/verify-fix.ts and mirror-uses.ts): a Lansat Berry's
 * focusenergy, a Figy-family Berry's confusion, a foe's Mirror Herb or Opportunist copying the rise, generation 7's
 * turn order, and the first turn's Custap Berry.
 */
describe("what a Berry eaten before the move sets going", () => {
  it("makes every hit critical once a Lansat Berry's +2 brings the critical-hit ratio to +3, as Super Luck and Scope Lens do", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    const weavile = (currentHP: number) => build(sv, "weavile", { abilityId: "pressure", itemId: "lansatberry", currentHP });
    const chomp = build(sv, "garchomp", { abilityId: "sandveil" });
    // Weavile at 36 of 145: Night Slash's +1 and Lansat's +2 crit every roll (Showdown 73–87, -crit, focusenergy).
    const slash = row(matchup(sv, weavile(36), chomp), "nightslash");
    expect(range(slash)).toBe("73–87");
    expect(slash.assumptions).toContain("Every hit is a critical hit (critical-hit ratio +3: Night Slash and the Lansat Berry).");
    expect(eaten(slash)).toEqual(["The attacker Weavile's Lansat Berry was eaten at 36 HP: +2 critical-hit ratio."]);
    expect(slash.afterUse).toMatchObject({ start: 183, low: 110, high: 96, average: 103.5, min: 96, max: 110, koChance: 0 });
    // The volatile stays: every later use crits too (87 x 2 < 183 <= 73 x 3).
    expect(counted(slash.usesToKO)).toMatchObject({ guaranteed: 3, fewest: 3 });
    // One HP above the line it keeps the berry (49–58), and Lansat alone (+2) is no certain crit (Ice Punch 208–252).
    expect(range(row(matchup(sv, weavile(37), chomp), "nightslash"))).toBe("49–58");
    const punch = row(matchup(sv, weavile(36), chomp), "icepunch");
    expect(range(punch)).toBe("208–252");
    expect(punch.assumptions.some((line) => line.startsWith("Every hit is a critical hit"))).toBe(false);
    // Shell Armor stops it (Showdown 28–34, no -crit).
    const armored = row(matchup(sv, weavile(36), build(sv, "cloyster", { abilityId: "shellarmor" })), "nightslash");
    expect(range(armored)).toBe("28–34");
    expect(armored.assumptions).toContain("The target's Shell Armor prevents the critical hit.");
    // Cross Chop's crit knocks out a full-HP Sitrus Snorlax every time (Showdown 282–332, KO 1, nothing healed).
    const chop = row(matchup(sv, build(sv, "hariyama", { abilityId: "thickfat", itemId: "lansatberry", currentHP: 54 }), build(sv, "snorlax", { abilityId: "thickfat", itemId: "sitrusberry" })), "crosschop");
    expect(chop).toMatchObject({ min: 282, max: 332, ohkoChance: 1 });
    expect(chop.afterUse).toMatchObject({ koChance: 1, heals: [] });
    // Without a berry: Super Luck and Scope Lens with Night Slash (Ultra Sun/Moon Absol, Showdown 79–94 -crit); Super Luck alone does not.
    const absol = (itemId: string) => row(matchup(us, build(us, "absol", { abilityId: "superluck", itemId }), build(us, "garchomp", { abilityId: "sandveil" })), "nightslash");
    expect(range(absol("scopelens"))).toBe("79–94");
    expect(absol("scopelens").assumptions).toContain("Every hit is a critical hit (critical-hit ratio +3: Night Slash, Super Luck and Scope Lens).");
    expect(range(absol(""))).toBe("52–63");
  });

  it("confuses the holder of a Figy-family Berry its Nature dislikes, and assumes it does not hit itself", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const chomp = build(sv, "garchomp", { abilityId: "sandveil" });
    // Modest Primarina at 38 of 155: 89 HP and confused (Showdown -start confusion); Moonblast knocks out 31.25% of the
    // time when it moves (confusion's randomChance(33, 100) self-hit is assumed away, as full paralysis is).
    const moonblast = row(matchup(sv, build(sv, "primarina", { abilityId: "torrent", itemId: "figyberry", currentHP: 38, nature: "Modest" }), chomp), "moonblast");
    expect(eaten(moonblast)).toEqual(["The attacker Primarina's Figy Berry was eaten at 38 HP: 89 HP, confused."]);
    expect(moonblast.assumptions).toContain("Assumes the confused attacker does not hit itself.");
    expect(moonblast.ohkoChance).toBeCloseTo(0.3125, 12);
    expect(moonblast.afterUse).toMatchObject({ start: 183, low: 19, high: 0, min: 0, max: 19 });
    expect(moonblast.afterUse!.koChance).toBeCloseTo(0.3125, 12);
    expect(counted(moonblast.usesToKO)).toMatchObject({ notes: expect.arrayContaining(["Assumes the confused attacker does not hit itself."]) });
    // Own Tempo keeps it from confusion (Showdown: no volatile).
    const slowbro = row(matchup(sv, build(sv, "slowbro", { abilityId: "owntempo", itemId: "figyberry", currentHP: 42, nature: "Modest" }), chomp), "psychic");
    expect(eaten(slowbro)).toEqual(["The attacker Slowbro's Figy Berry was eaten at 42 HP: 98 HP."]);
    expect(counted(slowbro.usesToKO)).toMatchObject({ guaranteed: 3, fewest: 3 });
    // A confused target changes nothing the attacker deals (Showdown 100–118 from 136).
    const quake = row(matchup(sv, build(sv, "garchomp", { abilityId: "roughskin" }), build(sv, "snorlax", { abilityId: "thickfat", itemId: "figyberry", currentHP: 58, nature: "Modest" })), "earthquake");
    expect(eaten(quake)).toEqual(["The target Snorlax's Figy Berry was eaten at 58 HP: 136 HP, confused."]);
    expect(quake).toMatchObject({ min: 100, max: 118, ohkoChance: 0 });
    expect(counted(quake.usesToKO)).toMatchObject({ guaranteed: 2, fewest: 2 });
  });

  it("applies a foe's Mirror Herb or Opportunist copy of the rise before this move when the target moves first, and from the next use otherwise", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    const garchomp = (itemId = "mirrorherb") => build(sv, "garchomp", { abilityId: "roughskin", itemId });
    const dragapult = (itemId: string) => build(sv, "dragapult", { abilityId: "clearbody", itemId, currentHP: 40 });
    // The faster Dragapult moves first: Garchomp's herb copies its Liechi's +1 Attack before Earthquake (Showdown 135–159).
    const quake = row(matchup(sv, garchomp(), dragapult("liechiberry")), "earthquake");
    expect(range(quake)).toBe("135–159");
    expect(quake.assumptions).toContain("The attacker Garchomp's Mirror Herb copies the target's +1 Attack before this move (the target moves first: 122 Speed against 162).");
    expect(range(row(matchup(sv, garchomp(""), dragapult("liechiberry")), "earthquake"))).toBe("90–106");
    expect(range(row(matchup(sv, garchomp(), dragapult("petayaberry")), "dracometeor"))).toBe("234–276");
    const espathra = row(matchup(sv, build(sv, "espathra", { abilityId: "opportunist" }), dragapult("petayaberry")), "psychic");
    expect(range(espathra)).toBe("97–115");
    expect(espathra.assumptions).toContain("The attacker Espathra's Opportunist copies the target's +1 Sp. Atk before this move (the target moves first: 125 Speed against 162).");
    // The target's herb copies the attacker's Ganlon: +1 Defense before Body Slam (Showdown 37–45).
    const slam = row(matchup(sv, build(sv, "snorlax", { abilityId: "thickfat", itemId: "ganlonberry", currentHP: 58 }), garchomp()), "bodyslam");
    expect(range(slam)).toBe("37–45");
    expect(slam.assumptions).toContain("The target Garchomp's Mirror Herb copies the attacker's +1 Defense before this move (the target moves first: 50 Speed against 122).");
    // Garchomp moves first into Gluttony Snorlax at 117: Iron Head 54–64 without the copy, then 80–95 at +1 Attack
    // (Showdown's two turns), so two uses always; without the herb 58.59375% within two, three always.
    const snorlax = build(sv, "snorlax", { abilityId: "gluttony", itemId: "liechiberry", currentHP: 117 });
    const head = row(matchup(sv, garchomp(), snorlax), "ironhead");
    expect(range(head)).toBe("54–64");
    expect(head.assumptions).toContain("The attacker Garchomp's Mirror Herb copies the target's +1 Attack after this move (the attacker moves first: 122 Speed against 50).");
    expect(counted(head.usesToKO)).toMatchObject({ guaranteed: 2, fewest: 2, carried: ["The attacker's Mirror Herb copies a rise after the first use."] });
    expect(counted(row(matchup(sv, garchomp(""), snorlax), "ironhead").usesToKO)).toMatchObject({ guaranteed: 3, fewest: 2, fasterChance: 0.5859375 });
  });

  it("orders generation 7's first turn from the Speed before a Salac Berry, and every turn after from the Speed with it", async () => {
    const us = await loadBattleRuntime("ultra_sun_ultra_moon");
    const sv = await loadBattleRuntime("scarlet_violet");
    const thunderbolt = (runtime: BattleRuntime) => row(matchup(runtime, build(runtime, "magnezone", { abilityId: "analytic" }), build(runtime, "blissey", { abilityId: "naturalcure", itemId: "salacberry", currentHP: 82 })), "thunderbolt");
    // Showdown sorts the queue again after the berry only from generation 8: Ultra Sun/Moon 51–60 (Magnezone first), Scarlet/Violet 64–76.
    const usum = thunderbolt(us);
    expect(range(usum)).toBe("51–60");
    expect(usum.assumptions).toContain("The turn order was set before the target's Salac Berry was used (generation 7).");
    expect(usum.assumptions).toContain("Analytic: no boost, moves before the target (80 Speed against 75).");
    expect(counted(usum.usesToKO)).toMatchObject({ guaranteed: 2, fewest: 2, carried: ["The first turn's order comes from the target's Speed before its Salac Berry."] });
    const scarlet = thunderbolt(sv);
    expect(range(scarlet)).toBe("64–76");
    expect(scarlet.assumptions).toContain("Analytic: boosted, moves after the target (80 Speed against 112).");
  });

  it("moves a Custap Berry's holder first on the first turn only", async () => {
    const sv = await loadBattleRuntime("scarlet_violet");
    // Magnezone at 36 of 145: Thunderbolt 69–82 first (Custap), then 90–106 last with Analytic (Showdown's two turns):
    // two uses knock out Gholdengo's 162 HP 96.484375% of the time.
    const bolt = row(matchup(sv, build(sv, "magnezone", { abilityId: "analytic", itemId: "custapberry", currentHP: 36 }), build(sv, "gholdengo", { abilityId: "goodasgold" })), "thunderbolt");
    expect(range(bolt)).toBe("69–82");
    expect(counted(bolt.usesToKO)).toMatchObject({ guaranteed: 3, fewest: 2, fasterChance: 0.96484375, carried: ["The attacker's Custap Berry moves it first on the first turn only."] });
  });
});
