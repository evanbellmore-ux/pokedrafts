import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import { doublesTargetRule } from "@/app/lib/battle/doubles-targets";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus } from "@/app/lib/battle/types";

/**
 * status2 Track A2 (design SPEC2.md §2.2's A2 rows and §4.3, ADDENDUM2 §4.2, types-volatiles.md = F2): the family's 22 status
 * moves and the type guards they replace, each on a turn pinned Showdown c23d2e94 played the same way. The turns are Track
 * A2's scratch cases (scripts/.cache/calc-audit/status2/build/a2/cases-a2.ts, run by a2/run.ts through the verify harness's
 * oracle and compareCase): the slots below are those cases verbatim, built as the harness's app-turn.ts builds them; every
 * number is the oracle's, every text the app's fact. Level 50, 31 IVs, Serious, 0 EVs (Champions: Stat Points) unless set.
 * The last block needs the integrator's changes to frozen files (build/W1A-A2.md P1–P11) and Track A3's
 * Gravity start (doubles-field.ts), and fails until they land.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type CaseMon = {
  species: string; ability: string; item?: string; nature?: string; evs?: Partial<Record<Stat, number>>; ivs?: Partial<Record<Stat, number>>;
  hp?: number; status?: BattleStatus; gender?: "M" | "F"; teraType?: string; choice?: "terastallize"; types?: string[]; addedType?: string;
  carried?: DoublesCarried; moves?: string[]; lastMove?: string | null; build?: Partial<BattleBuild>;
};
type Slot = CaseMon & { action: { move: string | null; target?: DoublesSlotId } };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const OL: DoublesSlotId = "own-left", OR: DoublesSlotId = "own-right", PL: DoublesSlotId = "opponent-left", PR: DoublesSlotId = "opponent-right";
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));
const SV = "scarlet_violet", SWSH = "sword_shield", USUM = "ultra_sun_ultra_moon", CHAMPIONS = "champions";
const toID = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

// cases-a2.ts' helpers.
const mon = (species: string, ability: string, extra: Partial<CaseMon> = {}): CaseMon => ({ species, ability, ...extra });
const act = (m: CaseMon, move: string | null, target?: DoublesSlotId): Slot => ({ ...m, action: { move, ...(target ? { target } : {}) } });
const idle = (m: CaseMon): Slot => act(m, null);
const fast = { evs: { spe: 252 } };
const slow = { ivs: { spe: 0 }, nature: "Brave" };
const fastC = { evs: { spe: 32 } };
const g = (gender: "M" | "F", extra: Partial<CaseMon> = {}): Partial<CaseMon> => ({ gender, ...extra, build: { ...extra.build, configuration: { gender } } });

/** app-turn.ts caseBuild. */
function buildOf(runtime: BattleRuntime, m: CaseMon): BattleBuild {
  const base = createBuild(toID(m.species), runtime);
  const abilityId = toID(m.ability);
  const shared = {
    nature: m.nature ?? "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: toID(m.item ?? ""),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, currentHP: m.hp ?? null, status: m.status ?? "",
  };
  const configuration = { ...base.configuration, ...(m.teraType ? { teraType: m.teraType } : {}), ...(m.gender ? { gender: m.gender } : {}) };
  const mechanic = m.choice === "terastallize" ? { mechanic: "tera" as const } : {};
  const build = base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: { ...IV31, ...m.ivs } } };
  const typed = { ...(m.types ? { types: [...m.types] } : {}), ...(m.addedType ? { addedType: m.addedType } : {}) };
  return { ...build, ...(Object.keys(configuration).length ? { configuration } : {}), ...mechanic, ...typed, ...m.build } as BattleBuild;
}
/** app-turn.ts caseInput: the action's move first in `moves`; no chosen target for a move that takes none. */
function turn(runtime: BattleRuntime, slots: Slot[], field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = slots[i];
    const moveId = m.action.move === null ? null : toID(m.action.move);
    const entry: DoublesPokemonInput = {
      build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId, target: m.action.target ?? null },
      ...(m.carried ? { carried: m.carried } : {}),
      ...(m.lastMove !== undefined ? { lastMove: m.lastMove === null ? null : toID(m.lastMove) } : {}),
      ...(m.moves ? { moves: [...new Set([...(moveId ? [moveId] : []), ...m.moves.map(toID)])] } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  const input: DoublesTurnInput = {
    runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide(), ...field }, pokemon, canSwitch: { own: true, opponent: true },
  };
  for (const slot of SLOTS) {
    const entry = pokemon[slot];
    if (entry.action.moveId && entry.action.target && doublesTargetRule(input, slot, entry.action.moveId).kind !== "choose") entry.action = { ...entry.action, target: null };
  }
  return input;
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(result: DoublesTurnResult): Ready {
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : JSON.stringify(result)}`);
  return result;
}
const run = async (id: BattleGame, slots: Slot[], field: Partial<BattleConditions> = {}) => ready(calculateDoublesTurn(turn(await game(id), slots, field)));
const stepOf = (result: Ready, slot: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!;
const hitOf = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => stepOf(result, slot).hits.find((hit) => hit.slot === target)!;
const range = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => { const hit = hitOf(result, slot, target); return [hit.min, hit.max]; };
const texts = (facts: { text: string }[] | undefined) => (facts ?? []).map((fact) => fact.text);
const hitTexts = (result: Ready, slot: DoublesSlotId, target: DoublesSlotId) => texts(hitOf(result, slot, target).facts);
const stepTexts = (result: Ready, slot: DoublesSlotId) => texts(stepOf(result, slot).facts);
const skipped = (result: Ready, slot: DoublesSlotId) => stepOf(result, slot).skipped.map((fact) => [fact.text, fact.chance]);
const hpOf = (result: Ready, slot: DoublesSlotId) => result.hp[slot]!;
const facts = (list: { text: string; chance: number }[]) => list.map((fact) => [fact.text, +fact.chance.toFixed(6)]);

describe("status2 A2: Soak, Magic Powder, Forest's Curse, Trick-or-Treat, Reflect Type", () => {
  it("A2-SK1-sv (TV01): Soak Gyarados: Water, Thunderbolt 2x (60–72), the partner's Earthquake hits it (18–22) on Grassy Terrain", async () => {
    const result = await run(SV, [act(mon("Azumarill", "Huge Power", fast), "Soak", PL), act(mon("Lapras", "Water Absorb"), "Thunderbolt", PL), idle(mon("Gyarados", "Moxie")), act(mon("Snorlax", "Thick Fat"), "Earthquake")], { terrain: "Grassy" });
    expect(hitOf(result, OL, PL)).toMatchObject({ kind: "effect" });
    expect(hitTexts(result, OL, PL)).toEqual(["Becomes Water type."]);
    expect(range(result, OR, PL)).toEqual([60, 72]);
    expect(range(result, PR, PL)).toEqual([18, 22]);
    expect(hpOf(result, PL)).toMatchObject({ start: 170, min: 76, max: 92 });
  });

  it("A2-SK2-sv, A2-SK4-sv (TV01c, TV01d): Soak fails on a Terastallized target and on Arceus; Thunderbolt then 34–41 and 26–31", async () => {
    const tera = await run(SV, [act(mon("Azumarill", "Huge Power", fast), "Soak", PL), act(mon("Lapras", "Water Absorb"), "Thunderbolt", PL), idle(mon("Garchomp", "Rough Skin", { teraType: "Steel", choice: "terastallize" })), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(tera, OL, PL)).toEqual(["Soak fails: Garchomp is Terastallized."]);
    expect(range(tera, OR, PL)).toEqual([34, 41]);
    const arceus = await run(SV, [act(mon("Azumarill", "Huge Power", fast), "Soak", PL), act(mon("Lapras", "Water Absorb"), "Thunderbolt", PL), idle(mon("Arceus", "Multitype")), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(arceus, OL, PL)).toEqual(["Soak fails: Arceus's type cannot change."]);
    expect(range(arceus, OR, PL)).toEqual([26, 31]);
  });

  it("A2-SK3-sv: Soak into Water Absorb: absorbed (+51 HP), no type change; Thunderbolt first (116–138)", async () => {
    const result = await run(SV, [act(mon("Azumarill", "Huge Power", fast), "Soak", PL), act(mon("Jolteon", "Volt Absorb"), "Thunderbolt", PL), idle(mon("Lapras", "Water Absorb", { hp: 150 })), idle(mon("Snorlax", "Thick Fat"))]);
    expect(range(result, OR, PL)).toEqual([116, 138]);
    expect(hitOf(result, OL, PL)).toMatchObject({ kind: "blocked", change: { min: 51, max: 51 } });
    expect(hitTexts(result, OL, PL)).toEqual(["Water Absorb: Soak has no effect, and it regains HP."]);
    expect(hpOf(result, PL)).toMatchObject({ min: 63, max: 85, heals: ["Water Absorb: +51 HP."] });
  });

  it("A2-MP1-sv, A2-MP2a-sv (TV02, TV02b): Magic Powder Gengar: Psychic, Close Combat 0.5x (59–70); a Grass type is immune (Psychic 102–122)", async () => {
    const gengar = await run(SV, [act(mon("Hatterene", "Magic Bounce", fast), "Magic Powder", PL), act(mon("Hariyama", "Thick Fat"), "Close Combat", PL), idle(mon("Gengar", "Cursed Body")), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(gengar, OL, PL)).toEqual(["Becomes Psychic type."]);
    expect(range(gengar, OR, PL)).toEqual([59, 70]);
    const grass = await run(SV, [act(mon("Hatterene", "Healer", fast), "Magic Powder", PL), act(mon("Slowbro", "Oblivious"), "Psychic", PL), idle(mon("Venusaur", "Overgrow")), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitOf(grass, OL, PL).kind).toBe("no-damage");
    expect(hitTexts(grass, OL, PL)).toEqual(["Venusaur is immune."]);
    expect(range(grass, OR, PL)).toEqual([102, 122]);
  });

  it("A2-MP2b-sv (TW09): Magic Powder into Magic Bounce: Hatterene becomes Psychic itself", async () => {
    const result = await run(SV, [act(mon("Hatterene", "Healer", fast), "Magic Powder", PR), idle(mon("Snorlax", "Thick Fat")), act(mon("Annihilape", "Defiant"), "Close Combat", OL), idle(mon("Espeon", "Magic Bounce", slow))]);
    expect(range(result, PL, OL)).toEqual([19, 23]);
    expect(hitTexts(result, OL, PR)).toEqual(["Magic Bounce: Magic Powder goes back to Hatterene."]);
    expect(hitTexts(result, OL, OL)).toEqual(["Becomes Psychic type."]);
  });

  it("A2-FC1-sv, A2-FC2-sv (K2, TV03): Forest's Curse: a third type (Ice Beam 2x, 90–108); the target's own Grass move gets STAB (116–140)", async () => {
    const third = await run(SV, [act(mon("Trevenant", "Natural Cure", fast), "Forest's Curse", PL), act(mon("Lapras", "Water Absorb"), "Ice Beam", PL), idle(mon("Gyarados", "Moxie")), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(third, OL, PL)).toEqual(["Grass type added."]);
    expect(range(third, OR, PL)).toEqual([90, 108]);
    const stab = await run(SV, [act(mon("Trevenant", "Natural Cure", fast), "Forest's Curse", PL), idle(mon("Lapras", "Water Absorb")), act(mon("Snorlax", "Thick Fat"), "Seed Bomb", OR), idle(mon("Blissey", "Natural Cure"))]);
    expect(range(stab, PL, OR)).toEqual([116, 140]);
  });

  it("A2-FC3-sv, A2-FC4-sv: an added type from an earlier turn counts in Electro Drift's super-effective check (132–156 neutral; 354–416 without it)", async () => {
    const field = { terrain: "Electric" as const };
    const added = await run(SV, [act(mon("Miraidon", "Hadron Engine"), "Electro Drift", PL), idle(mon("Blissey", "Natural Cure")), idle(mon("Lapras", "Water Absorb", { addedType: "Grass" })), idle(mon("Snorlax", "Thick Fat"))], field);
    expect(range(added, OL, PL)).toEqual([132, 156]);
    const plain = await run(SV, [act(mon("Miraidon", "Hadron Engine"), "Electro Drift", PL), idle(mon("Blissey", "Natural Cure")), idle(mon("Lapras", "Water Absorb")), idle(mon("Snorlax", "Thick Fat"))], field);
    expect(range(plain, OL, PL)).toEqual([354, 416]);
  });

  it("A2-TT1-swsh (TV04): Trick-or-Treat Lucario: Ghost added, Shadow Ball 2x (152–180, a KO)", async () => {
    const result = await run(SWSH, [act(mon("Gourgeist", "Pickup", fast), "Trick-or-Treat", PL), act(mon("Gengar", "Cursed Body"), "Shadow Ball", PL), idle(mon("Lucario", "Inner Focus")), act(mon("Snorlax", "Thick Fat"), "Body Slam", PL)]);
    expect(hitTexts(result, OL, PL)).toEqual(["Ghost type added."]);
    expect(hitOf(result, OR, PL)).toMatchObject({ min: 152, max: 180, koChance: 1 });
  });

  it("A2-TT2-usum (TW05): Trick-or-Treat into a queued non-Ghost Curse at Showdown position 1 in generation 7: its ally is cursed", async () => {
    const result = await run(USUM, [act(mon("Gourgeist", "Pickup", fast), "Trick-or-Treat", PL), idle(mon("Chansey", "Natural Cure")), act(mon("Snorlax", "Thick Fat"), "Curse"), idle(mon("Shuckle", "Sturdy"))]);
    expect(hitOf(result, PL, PR)).toMatchObject({ kind: "effect", reached: 1 });
    expect(hitTexts(result, PL, PR)).toEqual(["Is cursed."]);
    expect(texts(hpOf(result, PL).losses)).toEqual(["Snorlax loses 117 HP (Curse)."]);
    if (result.endOfTurn.status !== "ready") throw new Error(result.endOfTurn.reason);
    expect(result.endOfTurn.residuals.find((r) => r.slot === PR && r.effect === "Curse")).toMatchObject({ min: -23, max: -23, chance: 1 });
  });

  it("A2-TT3-swsh, A2-TT4-usum, A2-TT6-champions (TV04c, TV04d): otherwise the Ghost Curse goes to a random foe, 1/2 each", async () => {
    const reached = (result: Ready, user: DoublesSlotId) => [hitOf(result, user, OL).reached, hitOf(result, user, OR).reached];
    const swsh = await run(SWSH, [act(mon("Gourgeist", "Pickup", fast), "Trick-or-Treat", PL), idle(mon("Chansey", "Natural Cure")), act(mon("Snorlax", "Thick Fat"), "Curse"), idle(mon("Shuckle", "Sturdy"))]);
    expect(reached(swsh, PL)).toEqual([0.5, 0.5]);
    const position0 = await run(USUM, [act(mon("Gourgeist", "Pickup", fast), "Trick-or-Treat", PR), idle(mon("Chansey", "Natural Cure")), idle(mon("Shuckle", "Sturdy")), act(mon("Snorlax", "Thick Fat"), "Curse")]);
    expect(reached(position0, PR)).toEqual([0.5, 0.5]);
    const champions = await run(CHAMPIONS, [act(mon("Gourgeist", "Frisk", fastC), "Trick-or-Treat", PL), idle(mon("Kingambit", "Defiant")), act(mon("Snorlax", "Thick Fat"), "Curse"), idle(mon("Garchomp", "Rough Skin"))]);
    expect(reached(champions, PL)).toEqual([0.5, 0.5]);
    expect(facts(hpOf(champions, OR).conditions ?? [])).toEqual([["Cursed.", 0.5]]);
  });

  it("A2-RT1-sv, A2-RT2-sv (TV05, TV05b): Reflect Type copies the base and added types (Ice Beam 114–134), a Terastallized target's Tera type alone", async () => {
    const copied = await run(SV, [act(mon("Trevenant", "Natural Cure", fast), "Forest's Curse", PL), act(mon("Gengar", "Cursed Body", slow), "Reflect Type", PL), idle(mon("Gyarados", "Moxie")), act(mon("Lapras", "Water Absorb"), "Ice Beam", OR)]);
    expect(hitTexts(copied, OR, PL)).toEqual(["Gengar becomes Water/Flying/Grass type."]);
    expect(range(copied, PR, OR)).toEqual([114, 134]);
    const tera = await run(SV, [act(mon("Gengar", "Cursed Body"), "Reflect Type", PL), idle(mon("Blissey", "Natural Cure")), idle(mon("Garchomp", "Rough Skin", { teraType: "Water", choice: "terastallize" })), act(mon("Raichu", "Static"), "Thunderbolt", OL)]);
    expect(hitTexts(tera, OL, PL)).toEqual(["Gengar becomes Water type."]);
    expect(hitOf(tera, PR, OL)).toMatchObject({ min: 58, max: 140 });
  });

  it("A2-RT3-champions (TV05c): Burn Up leaves Arcanine ??? alone; Reflect Type on it fails", async () => {
    const result = await run(CHAMPIONS, [act(mon("Arcanine", "Intimidate", fastC), "Burn Up", PL), act(mon("Gengar", "Cursed Body"), "Reflect Type", OL), idle(mon("Snorlax", "Thick Fat")), idle(mon("Kingambit", "Defiant"))]);
    expect(stepTexts(result, OL)).toEqual(["Burn Up: Arcanine becomes ??? type."]);
    expect(range(result, OL, PL)).toEqual([34, 42]);
    expect(hitTexts(result, OR, OL)).toEqual(["Reflect Type fails: Arcanine has no type to copy."]);
  });
});

describe("status2 A2: Camouflage, Conversion, Conversion 2", () => {
  it("A2-CM1-usum, A2-CM2-usum (TV06): Camouflage: Grass on Grassy Terrain (Flamethrower 62–74), Normal with none (Close Combat 204–242)", async () => {
    const grassy = await run(USUM, [act(mon("Azumarill", "Thick Fat", fast), "Camouflage"), idle(mon("Chansey", "Natural Cure")), act(mon("Arcanine", "Intimidate", slow), "Flamethrower", OL), idle(mon("Snorlax", "Thick Fat"))], { terrain: "Grassy" });
    expect(hitTexts(grassy, OL, OL)).toEqual(["Becomes Grass type."]);
    expect(range(grassy, PL, OL)).toEqual([62, 74]);
    const none = await run(USUM, [act(mon("Azumarill", "Thick Fat", fast), "Camouflage"), idle(mon("Chansey", "Natural Cure")), act(mon("Machamp", "Guts"), "Close Combat", OL), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(none, OL, OL)).toEqual(["Becomes Normal type."]);
    expect(hitOf(none, PL, OL)).toMatchObject({ min: 204, max: 242, koChance: 1 });
  });

  it("A2-CV1-sv, A2-CV2-sv (TV08): Conversion takes its first move's type: a Water-typed Porygon2 becomes Normal (Close Combat 188–224); a Normal one fails", async () => {
    const water = await run(SV, [act(mon("Porygon2", "Download", { types: ["Water"], moves: ["Tri Attack"] }), "Conversion"), idle(mon("Chansey", "Natural Cure")), act(mon("Hariyama", "Thick Fat", slow), "Close Combat", OL), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(water, OL, OL)).toEqual(["Becomes Normal type."]);
    expect(range(water, PL, OL)).toEqual([188, 224]);
    expect(water.facts).toContain("Assumes Conversion is Porygon2's first move.");
    const normal = await run(SV, [act(mon("Porygon2", "Download", { moves: ["Tri Attack"] }), "Conversion"), idle(mon("Chansey", "Natural Cure")), act(mon("Hariyama", "Thick Fat", slow), "Close Combat", OL), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(normal, OL, OL)).toEqual(["Conversion fails: Porygon2 is already Normal type."]);
    expect(range(normal, PL, OL)).toEqual([188, 224]);
  });

  it("A2-C21-sv (TV07): Conversion 2 after a Pixilate Hyper Voice (Fairy): Fire, Poison or Steel, 1/3 each; Psychic into it 33–156", async () => {
    const result = await run(SV, [act(mon("Porygon-Z", "Adaptability", slow), "Conversion 2", PL), idle(mon("Chansey", "Natural Cure")), act(mon("Sylveon", "Pixilate", fast), "Hyper Voice"), act(mon("Slowbro", "Oblivious"), "Psychic", OL)]);
    expect(range(result, PL, OL)).toEqual([63, 75]);
    expect(facts(hitOf(result, OL, PL).facts)).toEqual([["Porygon-Z becomes Fire type.", 0.333333], ["Porygon-Z becomes Poison type.", 0.333333], ["Porygon-Z becomes Steel type.", 0.333333]]);
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 33, max: 156 });
    expect(hitOf(result, PR, OL).koChance).toBeCloseTo(1 / 3, 9);
  });
});

describe("status2 A2: Electrify, Ion Deluge", () => {
  it("A2-EL1-swsh (K32): Electrify Snorlax: its Body Slam into Garchomp has no effect", async () => {
    const result = await run(SWSH, [act(mon("Heliolisk", "Dry Skin", fast), "Electrify", PL), idle(mon("Garchomp", "Rough Skin")), act(mon("Snorlax", "Thick Fat"), "Body Slam", OR), idle(mon("Chansey", "Natural Cure"))]);
    expect(hitTexts(result, OL, PL)).toEqual(["Electrify: its move is Electric type this turn."]);
    expect(hitOf(result, PL, OR).kind).toBe("no-damage");
    expect(hitTexts(result, PL, OR)).toEqual(["Body Slam has no effect on Garchomp."]);
  });

  it("A2-EL3-swsh, A2-EL6-usum (TV09b, TV09f): an Electrified -ate move keeps its 1.2x (17–21, 136–160); a Normalize Thunderbolt Electric with it (104–124)", async () => {
    const pixilate = await run(SWSH, [act(mon("Heliolisk", "Dry Skin", fast), "Electrify", PL), idle(mon("Gyarados", "Moxie")), act(mon("Sylveon", "Pixilate"), "Hyper Voice"), idle(mon("Chansey", "Natural Cure"))]);
    expect(range(pixilate, PL, OL)).toEqual([17, 21]);
    expect(range(pixilate, PL, OR)).toEqual([136, 160]);
    const normalize = await run(USUM, [act(mon("Heliolisk", "Dry Skin", fast), "Electrify", PL), idle(mon("Gyarados", "Moxie")), act(mon("Delcatty", "Normalize"), "Thunderbolt", OR), idle(mon("Chansey", "Natural Cure"))]);
    expect(range(normalize, PL, OR)).toEqual([104, 124]);
  });

  it("A2-EL4-swsh, A2-ID2-usum (TV09c, TV10b): an Electrified or Ion Deluge status move into Volt Absorb is absorbed (+35 HP)", async () => {
    const electrify = await run(SWSH, [act(mon("Heliolisk", "Dry Skin", fast), "Electrify", PL), idle(mon("Jolteon", "Volt Absorb", { hp: 100 })), act(mon("Snorlax", "Thick Fat"), "Yawn", OR), idle(mon("Chansey", "Natural Cure"))]);
    expect(hitOf(electrify, PL, OR)).toMatchObject({ kind: "blocked", change: { min: 35, max: 35 } });
    expect(hitTexts(electrify, PL, OR)).toEqual(["Volt Absorb: Yawn has no effect, and it regains HP."]);
    const deluge = await run(USUM, [act(mon("Lanturn", "Water Absorb"), "Ion Deluge"), idle(mon("Jolteon", "Volt Absorb", { hp: 100 })), act(mon("Snorlax", "Thick Fat"), "Yawn", OR), idle(mon("Chansey", "Natural Cure"))]);
    expect(stepTexts(deluge, OL)).toEqual(["Ion Deluge: Normal moves are Electric type this turn."]);
    expect(hitTexts(deluge, PL, OR)).toEqual(["Volt Absorb: Yawn has no effect, and it regains HP."]);
    expect(hpOf(deluge, OR).heals).toEqual(["Volt Absorb: +35 HP."]);
  });

  it("A2-EL5-swsh (TV09g): Electrify on a target that has moved fails", async () => {
    const result = await run(SWSH, [act(mon("Heliolisk", "Dry Skin", slow), "Electrify", PL), idle(mon("Snorlax", "Thick Fat")), act(mon("Garchomp", "Rough Skin"), "Dragon Claw", OR), idle(mon("Chansey", "Natural Cure"))]);
    expect(range(result, PL, OR)).toEqual([81, 96]);
    expect(hitTexts(result, OL, PL)).toEqual(["Electrify fails: Garchomp has already moved."]);
  });

  it("A2-EL2-swsh, A2-EL7-swsh (TW01): Electrify itself goes to the Lightning Rod Raichu; the Body Slam and Yawn stay Normal", async () => {
    const slam = await run(SWSH, [act(mon("Heliolisk", "Dry Skin", fast), "Electrify", PL), idle(mon("Raichu", "Lightning Rod")), act(mon("Snorlax", "Thick Fat"), "Body Slam", OL), idle(mon("Chansey", "Natural Cure"))]);
    expect(stepTexts(slam, OL)).toEqual(["Lightning Rod: Raichu takes Electrify."]);
    expect(range(slam, PL, OL)).toEqual([87, 103]);
    const yawn = await run(SWSH, [act(mon("Heliolisk", "Dry Skin", fast), "Electrify", PL), idle(mon("Raichu", "Lightning Rod")), act(mon("Snorlax", "Thick Fat"), "Yawn", OL), idle(mon("Chansey", "Natural Cure"))]);
    expect(hitTexts(yawn, PL, OL)).toEqual(["Becomes drowsy."]);
  });
});

describe("status2 A2: Tar Shot, Foresight, Odor Sleuth, Miracle Eye, Telekinesis", () => {
  it("A2-TS1-swsh, A2-TS2-swsh (TV11, TV11b): Tar Shot: −1 Speed and Fire 2x (Flamethrower 320–384 into Ferrothorn); a second only lowers Speed", async () => {
    const once = await run(SWSH, [act(mon("Coalossal", "Flash Fire", fast), "Tar Shot", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Ferrothorn", "Iron Barbs")), act(mon("Torkoal", "White Smoke"), "Flamethrower", PL)]);
    expect(hitTexts(once, OL, PL)).toEqual(["−1 Speed.", "Tar Shot: Fire is twice as effective against it."]);
    expect(range(once, PR, PL)).toEqual([320, 384]);
    const twice = await run(SWSH, [act(mon("Coalossal", "Flash Fire", fast), "Tar Shot", PL), act(mon("Coalossal", "Flash Fire"), "Tar Shot", PL), idle(mon("Ferrothorn", "Iron Barbs")), act(mon("Torkoal", "White Smoke"), "Flamethrower", PL)]);
    expect(hitTexts(twice, OR, PL)).toEqual(["−1 Speed."]);
    expect(range(twice, PR, PL)).toEqual([320, 384]);
  });

  it("A2-TS3-sv (TV11c): a carried Tar Shot on a Grass-Terastallized Garchomp: Flamethrower 4x (204–244)", async () => {
    const result = await run(SV, [idle(mon("Blissey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")), idle(mon("Garchomp", "Rough Skin", { teraType: "Grass", choice: "terastallize", carried: { tarShot: true } })), act(mon("Torkoal", "White Smoke"), "Flamethrower", PL)]);
    expect(range(result, PR, PL)).toEqual([204, 244]);
  });

  it("A2-FS1-usum, A2-OS1-usum (TV12, TV12c): Foresight and Odor Sleuth let Close Combat hit Gengar (63–75)", async () => {
    const foresight = await run(USUM, [act(mon("Hitmonchan", "Iron Fist", fast), "Foresight", PL), act(mon("Machamp", "Guts"), "Close Combat", PL), idle(mon("Gengar", "Cursed Body")), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(foresight, OL, PL)).toEqual(["Foresight: Normal and Fighting moves can hit it."]);
    expect(range(foresight, OR, PL)).toEqual([63, 75]);
    const sleuth = await run(USUM, [act(mon("Arcanine", "Intimidate", fast), "Odor Sleuth", PL), act(mon("Machamp", "Guts"), "Close Combat", PL), idle(mon("Gengar", "Cursed Body")), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(sleuth, OL, PL)).toEqual(["Odor Sleuth: Normal and Fighting moves can hit it."]);
    expect(range(sleuth, OR, PL)).toEqual([63, 75]);
  });

  it("A2-FS2-usum: a carried Foresight: Body Slam hits Gengar (78–93); Foresight again fails", async () => {
    const result = await run(USUM, [act(mon("Snorlax", "Thick Fat"), "Body Slam", PL), act(mon("Hitmonchan", "Iron Fist"), "Foresight", PL), idle(mon("Gengar", "Cursed Body", { carried: { foresight: true } })), idle(mon("Shuckle", "Sturdy"))]);
    expect(hitTexts(result, OR, PL)).toEqual(["Foresight fails: it is already up on Gengar."]);
    expect(range(result, OL, PL)).toEqual([78, 93]);
  });

  it("A2-ME1-usum, A2-ME2-usum (TV13): Miracle Eye lets Psychic hit Bisharp (0.5x, 33–40); a carried one, Umbreon (52–63)", async () => {
    const eye = await run(USUM, [act(mon("Xatu", "Synchronize"), "Miracle Eye", PL), act(mon("Slowbro", "Oblivious"), "Psychic", PL), idle(mon("Bisharp", "Defiant")), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(eye, OL, PL)).toEqual(["Miracle Eye: Psychic moves can hit it."]);
    expect(range(eye, OR, PL)).toEqual([33, 40]);
    const carried = await run(USUM, [act(mon("Alakazam", "Synchronize"), "Psychic", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Umbreon", "Synchronize", { carried: { miracleEye: true } })), idle(mon("Shuckle", "Sturdy"))]);
    expect(range(carried, OL, PL)).toEqual([52, 63]);
  });

  it("A2-TK1-usum (K37, TV14b): Telekinesis: Earthquake misses Snorlax and Grassy Terrain no longer heals it", async () => {
    const result = await run(USUM, [act(mon("Alakazam", "Synchronize"), "Telekinesis", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat", { hp: 150 })), act(mon("Garchomp", "Rough Skin"), "Earthquake")], { terrain: "Grassy" });
    expect(hitTexts(result, OL, PL)).toEqual(["Telekinesis: Snorlax floats."]);
    expect(hitOf(result, PR, PL).kind).toBe("no-damage");
    expect(range(result, PR, OL)).toEqual([49, 58]);
    if (result.endOfTurn.status !== "ready") throw new Error(result.endOfTurn.reason);
    expect(result.endOfTurn.residuals.filter((r) => r.slot === PL)).toEqual([]);
  });

  it("A2-TK2-usum, A2-TK3-usum (TV14c, TW06): Diglett is immune; a carried Telekinesis lets a priority move through Psychic Terrain (27–33)", async () => {
    const diglett = await run(USUM, [act(mon("Alakazam", "Synchronize"), "Telekinesis", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Diglett", "Sand Veil")), act(mon("Garchomp", "Rough Skin"), "Earthquake")]);
    expect(hitTexts(diglett, OL, PL)).toEqual(["Diglett is immune."]);
    expect(hitOf(diglett, PR, PL)).toMatchObject({ min: 141, max: 166, koChance: 1 });
    const carried = await run(USUM, [act(mon("Raticate", "Guts"), "Quick Attack", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat", { carried: { telekinesis: 2 } })), act(mon("Garchomp", "Rough Skin"), "Earthquake")], { terrain: "Psychic" });
    expect(range(carried, OL, PL)).toEqual([27, 33]);
    expect(hitOf(carried, PR, PL).kind).toBe("no-damage");
  });
});

describe("status2 A2: Embargo, Heal Block, Psychic Noise, Nightmare, Octolock", () => {
  it("A2-EM1-usum, A2-EM2-usum (K26, TV15): Embargo: no Sitrus Berry (Close Combat 240–284); an Air Balloon no longer lifts Heatran", async () => {
    const sitrus = await run(USUM, [act(mon("Bisharp", "Defiant", fast), "Embargo", PL), act(mon("Machamp", "Guts"), "Close Combat", PL), idle(mon("Snorlax", "Thick Fat", { item: "Sitrus Berry" })), idle(mon("Chansey", "Natural Cure"))]);
    expect(hitTexts(sitrus, OL, PL)).toEqual(["Embargo: its item has no effect."]);
    expect(hitOf(sitrus, OR, PL)).toMatchObject({ min: 240, max: 284, koChance: 1 });
    expect(hpOf(sitrus, PL).heals).toEqual([]);
    const balloon = await run(USUM, [act(mon("Bisharp", "Defiant", fast), "Embargo", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Heatran", "Flash Fire", { item: "Air Balloon" })), act(mon("Garchomp", "Rough Skin"), "Earthquake")]);
    expect(hitOf(balloon, PR, PL)).toMatchObject({ min: 204, max: 240, koChance: 0.5 });
    expect(facts(hitOf(balloon, PR, PL).facts)).toEqual([["Earthquake has no effect on Heatran.", 0.5]]);
  });

  it("A2-EM3-usum, A2-EM4-usum (TV15c): an Embargoed Life Orb: no boost, no recoil (810–954); a carried Embargo the same (240–284)", async () => {
    const orb = await run(USUM, [act(mon("Bisharp", "Defiant", fast), "Embargo", PL), idle(mon("Chansey", "Natural Cure")), act(mon("Machamp", "Guts", { item: "Life Orb" }), "Close Combat", OR), idle(mon("Snorlax", "Thick Fat"))]);
    expect(range(orb, PL, OR)).toEqual([810, 954]);
    expect(hpOf(orb, PL)).toMatchObject({ start: 165, min: 165, max: 165 });
    expect(stepTexts(orb, PL)).toEqual([]);
    const carried = await run(USUM, [idle(mon("Chansey", "Natural Cure")), act(mon("Machamp", "Guts", { item: "Life Orb", carried: { embargo: 3 } }), "Close Combat", PL), idle(mon("Snorlax", "Thick Fat")), idle(mon("Shuckle", "Sturdy"))]);
    expect(range(carried, OR, PL)).toEqual([240, 284]);
    expect(hpOf(carried, OR)).toMatchObject({ min: 165, max: 165 });
  });

  it("A2-HB1-usum (K35, TV16): Heal Block on both foes: Slack Off cannot be used; Volt Absorb heals nothing", async () => {
    const result = await run(USUM, [act(mon("Bronzong", "Levitate", fast), "Heal Block"), act(mon("Ampharos", "Static"), "Thunderbolt", PR), act(mon("Slowbro", "Oblivious", { hp: 100 }), "Slack Off"), idle(mon("Jolteon", "Volt Absorb", { hp: 100 }))]);
    expect(hitTexts(result, OL, PL)).toEqual(["Heal Block: it cannot heal."]);
    expect(hitTexts(result, OL, PR)).toEqual(["Heal Block: it cannot heal."]);
    expect(skipped(result, PL)).toEqual([["Heal Block: Slack Off cannot be used.", 1]]);
    expect(hitTexts(result, OR, PR)).toEqual(["Volt Absorb: no damage."]);
    expect(hpOf(result, PR)).toMatchObject({ min: 100, max: 100, heals: [] });
  });

  it("A2-HB2-usum, A2-HB4-usum (TV16b, CR01): Heal Block, or a carried one: the Sitrus Berry heals nothing (Close Combat 240–284)", async () => {
    const fresh = await run(USUM, [act(mon("Bronzong", "Levitate", fast), "Heal Block"), act(mon("Machamp", "Guts"), "Close Combat", PL), idle(mon("Snorlax", "Thick Fat", { item: "Sitrus Berry" })), idle(mon("Chansey", "Natural Cure"))]);
    expect(hitOf(fresh, OR, PL)).toMatchObject({ min: 240, max: 284, koChance: 1 });
    expect(hpOf(fresh, PL).heals).toEqual([]);
    const carried = await run(USUM, [idle(mon("Chansey", "Natural Cure")), act(mon("Machamp", "Guts"), "Close Combat", PL), idle(mon("Snorlax", "Thick Fat", { item: "Sitrus Berry", carried: { healBlock: 2 } })), idle(mon("Shuckle", "Sturdy"))]);
    expect(hitOf(carried, OR, PL)).toMatchObject({ min: 240, max: 284, koChance: 1 });
    expect(hpOf(carried, PL).heals).toEqual([]);
  });

  it("A2-HB3-usum, A2-HB5-usum (TV16c, TV16d): Aroma Veil stops Heal Block on its side; a Mental Herb cures it before Slack Off (+70)", async () => {
    const veil = await run(USUM, [act(mon("Bronzong", "Levitate", fast), "Heal Block"), idle(mon("Chansey", "Natural Cure")), act(mon("Slowbro", "Oblivious", { hp: 100, item: "Mental Herb" }), "Slack Off"), idle(mon("Aromatisse", "Aroma Veil"))]);
    expect(hitTexts(veil, OL, PL)).toEqual(["Aroma Veil: Slowbro is not affected."]);
    expect(hitTexts(veil, OL, PR)).toEqual(["Aroma Veil: Aromatisse is not affected."]);
    expect(hpOf(veil, PL).heals).toEqual(["Slack Off: +70 HP."]);
    const herb = await run(USUM, [act(mon("Bronzong", "Levitate", fast), "Heal Block"), idle(mon("Chansey", "Natural Cure")), act(mon("Slowbro", "Oblivious", { hp: 100, item: "Mental Herb" }), "Slack Off"), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(herb, OL, PL)).toEqual(["Heal Block: it cannot heal."]);
    expect(skipped(herb, PL)).toEqual([]);
    expect(hpOf(herb, PL)).toMatchObject({ min: 170, max: 170, heals: ["Slack Off: +70 HP."] });
    expect(texts(hpOf(herb, PL).conditions)).toEqual(["Holds no item."]);
  });

  it("A2-PN1-sv, A2-PN2-sv (F2-PN1): Psychic Noise's Heal Block in later moves: the Sitrus Berry heals nothing (216–254); Slack Off stopped", async () => {
    const sitrus = await run(SV, [act(mon("Delphox", "Blaze", fast), "Psychic Noise", PL), act(mon("Annihilape", "Defiant"), "Close Combat", PL), idle(mon("Snorlax", "Thick Fat", { item: "Sitrus Berry" })), idle(mon("Blissey", "Natural Cure"))]);
    expect(range(sitrus, OL, PL)).toEqual([45, 54]);
    expect(hitOf(sitrus, OR, PL)).toMatchObject({ min: 216, max: 254, koChance: 1 });
    expect(hpOf(sitrus, PL).heals).toEqual([]);
    const slackOff = await run(SV, [act(mon("Delphox", "Blaze", fast), "Psychic Noise", PL), idle(mon("Blissey", "Natural Cure")), act(mon("Slowbro", "Oblivious", { hp: 150 }), "Slack Off"), idle(mon("Snorlax", "Thick Fat"))]);
    expect(range(slackOff, OL, PL)).toEqual([29, 34]);
    expect(skipped(slackOff, PL)).toEqual([["Heal Block: Slack Off cannot be used.", 1]]);
    expect(texts(hpOf(slackOff, PL).conditions)).toEqual(["Heal Block."]);
  });

  it("A2-NM1-usum, A2-NM2-usum (K36, TV17): Nightmare starts on a sleeping Snorlax (−58 at the end of the turn); on an awake one it fails", async () => {
    const asleep = await run(USUM, [act(mon("Gengar", "Cursed Body"), "Nightmare", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat", { status: "slp", carried: { sleep: { attempts: 0, rest: true } } })), idle(mon("Shuckle", "Sturdy"))]);
    expect(hitTexts(asleep, OL, PL)).toEqual(["Nightmare starts."]);
    expect(texts(hpOf(asleep, PL).conditions)).toEqual(["Nightmare."]);
    if (asleep.endOfTurn.status !== "ready") throw new Error(asleep.endOfTurn.reason);
    expect(asleep.endOfTurn.residuals.find((r) => r.slot === PL)).toMatchObject({ effect: "Nightmare", min: -58, max: -58, chance: 1 });
    const awake = await run(USUM, [act(mon("Gengar", "Cursed Body"), "Nightmare", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")), idle(mon("Shuckle", "Sturdy"))]);
    expect(hitTexts(awake, OL, PL)).toEqual(["Nightmare fails: Snorlax is awake."]);
  });

  it("A2-OL1-swsh (TV18): Octolock on a Ghost type: immune", async () => {
    const result = await run(SWSH, [act(mon("Grapploct", "Limber"), "Octolock", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Gengar", "Cursed Body")), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitOf(result, OL, PL).kind).toBe("no-damage");
    expect(hitTexts(result, OL, PL)).toEqual(["Gengar is immune."]);
  });
});

describe("status2 A2: Attract, Captivate, Powder", () => {
  const snorlaxM = (extra: Partial<CaseMon> = {}) => mon("Snorlax", "Thick Fat", g("M", extra));
  const milotic = (extra: Partial<CaseMon> = {}) => act(mon("Milotic", "Competitive", g("F", { ...fast, ...extra })), "Attract", PL);

  it("A2-AT1-sv, A2-AT8-sv (TV19c, F2-AT4): an infatuated Snorlax: its Body Slam 1/2 stopped (64–76), fresh or carried", async () => {
    const fresh = await run(SV, [milotic(), idle(mon("Blissey", "Natural Cure")), act(snorlaxM(), "Body Slam", OL), idle(mon("Hippowdon", "Sand Force"))]);
    expect(hitTexts(fresh, OL, PL)).toEqual(["Becomes infatuated."]);
    expect(skipped(fresh, PL)).toEqual([["Infatuated.", 0.5]]);
    expect(hitOf(fresh, PL, OL)).toMatchObject({ min: 64, max: 76, reached: 0.5 });
    const carried = await run(SV, [idle(mon("Milotic", "Competitive", g("F"))), idle(mon("Blissey", "Natural Cure")), act(snorlaxM({ carried: { attract: OL } }), "Body Slam", OL), idle(mon("Hippowdon", "Sand Force"))]);
    expect(skipped(carried, PL)).toEqual([["Infatuated.", 0.5]]);
    expect(hitOf(carried, PL, OL)).toMatchObject({ min: 64, max: 76, reached: 0.5 });
  });

  it("A2-AT2-sv (TV19, TV19b): Attract into Oblivious is blocked; into a genderless Pokémon, immune", async () => {
    const result = await run(SV, [milotic(), act(mon("Illumise", "Tinted Lens"), "Attract", PR), act(mon("Slowbro", "Oblivious", g("M")), "Scald", OL), act(mon("Magnezone", "Sturdy"), "Flash Cannon", OR)]);
    expect(hitOf(result, OL, PL)).toMatchObject({ kind: "blocked" });
    expect(hitTexts(result, OL, PL)).toEqual(["Oblivious: Slowbro is not affected."]);
    expect(hitOf(result, OR, PR)).toMatchObject({ kind: "no-damage" });
    expect(hitTexts(result, OR, PR)).toEqual(["Magnezone is immune."]);
    expect(range(result, PL, OL)).toEqual([19, 23]);
  });

  it("A2-AT3-sv (TV19b): a Destiny Knot holder infatuates Milotic too", async () => {
    const result = await run(SV, [milotic(), idle(mon("Blissey", "Natural Cure")), act(snorlaxM({ item: "Destiny Knot" }), "Body Slam", OL), idle(mon("Hippowdon", "Sand Force"))]);
    expect(hitTexts(result, OL, PL)).toEqual(["Becomes infatuated.", "Destiny Knot: Milotic becomes infatuated too."]);
    expect(skipped(result, PL)).toEqual([["Infatuated.", 0.5]]);
  });

  it("A2-AT5-sv, A2-AT6-sv, A2-AT7-sv (TV19e, K40, TV19d): Aroma Veil blocks it; a Mental Herb cures it; its source fainted: no roll", async () => {
    const veil = await run(SV, [milotic(), idle(mon("Blissey", "Natural Cure")), act(snorlaxM(), "Body Slam", OL), idle(mon("Alcremie", "Aroma Veil"))]);
    expect(hitTexts(veil, OL, PL)).toEqual(["Aroma Veil: Snorlax is not affected."]);
    expect(skipped(veil, PL)).toEqual([]);
    const herb = await run(SV, [milotic(), idle(mon("Blissey", "Natural Cure")), act(snorlaxM({ item: "Mental Herb" }), "Body Slam", OL), idle(mon("Hippowdon", "Sand Force"))]);
    expect(hitTexts(herb, OL, PL)).toEqual(["Becomes infatuated."]);
    expect(skipped(herb, PL)).toEqual([]);
    expect(texts(hpOf(herb, PL).conditions)).toEqual(["Holds no item."]);
    const fainted = await run(SV, [milotic({ hp: 1 }), act(mon("Annihilape", "Defiant", g("M")), "Close Combat", OL), act(snorlaxM(), "Body Slam", OR), idle(mon("Blissey", "Natural Cure"))]);
    expect(hitOf(fainted, OR, OL)).toMatchObject({ koChance: 1 });
    expect(skipped(fainted, PL)).toEqual([]);
    expect(hitTexts(fainted, PL, OR)).toEqual(["Body Slam has no effect on Annihilape."]);
  });

  it("A2-CP1-usum (K20, TV20): Captivate: the male foe −2 Sp. Atk, the genderless one immune; Flash Cannon 55–66", async () => {
    const result = await run(USUM, [act(mon("Clefable", "Magic Guard", g("F", fast)), "Captivate"), idle(mon("Chansey", "Natural Cure")), act(mon("Alakazam", "Synchronize", g("M")), "Psychic", OR), act(mon("Magnezone", "Sturdy"), "Flash Cannon", OR)]);
    expect(range(result, PL, OR)).toEqual([64, 76]);
    expect(hitTexts(result, OL, PL)).toEqual(["−2 Sp. Atk."]);
    expect(hitTexts(result, OL, PR)).toEqual(["Magnezone is immune."]);
    expect(range(result, PR, OR)).toEqual([55, 66]);
  });

  it("A2-PW1-usum, A2-PW2-usum (K34, TV21): Powder: a Fire move (Flare Blitz, Will-O-Wisp) fails and costs a quarter (41 HP)", async () => {
    for (const move of ["Flare Blitz", "Will-O-Wisp"]) {
      const result = await run(USUM, [act(mon("Vivillon", "Shield Dust"), "Powder", PL), idle(mon("Chansey", "Natural Cure")), act(mon("Arcanine", "Intimidate"), move, OR), idle(mon("Snorlax", "Thick Fat"))]);
      expect(hitTexts(result, OL, PL)).toEqual(["Powder: its Fire move fails this turn."]);
      expect(stepTexts(result, PL)).toEqual([`Powder: ${move} fails.`]);
      expect(stepOf(result, PL).hits).toEqual([]);
      expect(hpOf(result, PL)).toMatchObject({ start: 165, min: 124, max: 124 });
      expect(texts(hpOf(result, PL).losses)).toEqual(["Arcanine loses 41 HP (Powder)."]);
    }
  });

  it("A2-PW3-usum, A2-PW5-usum (TV21b): Powder into a Grass type: immune (Giga Drain 42–49); a Magic Guard user loses nothing", async () => {
    const grass = await run(USUM, [act(mon("Vivillon", "Shield Dust"), "Powder", PL), idle(mon("Chansey", "Natural Cure")), act(mon("Venusaur", "Overgrow"), "Giga Drain", OR), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitTexts(grass, OL, PL)).toEqual(["Venusaur is immune."]);
    expect(range(grass, PL, OR)).toEqual([42, 49]);
    const guard = await run(USUM, [act(mon("Vivillon", "Shield Dust"), "Powder", PL), idle(mon("Chansey", "Natural Cure")), act(mon("Clefable", "Magic Guard"), "Flamethrower", OR), idle(mon("Snorlax", "Thick Fat"))]);
    expect(stepTexts(guard, PL)).toEqual(["Powder: Flamethrower fails."]);
    expect(hpOf(guard, PL)).toMatchObject({ start: 170, min: 170, max: 170 });
    expect(hpOf(guard, PL).losses).toBeUndefined();
  });
});

describe("status2 A2: the type guards that go (SPEC2 §2.4: typeChange, groundingChange, Smack Down's later action)", () => {
  it("A2-PR1-sv, A2-PR3-sv (TV22, TV22b): Protean Greninja becomes Ice (Flamethrower 134–162) or Dark (67–81)", async () => {
    const ice = await run(SV, [act(mon("Greninja", "Protean"), "Ice Beam", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")), act(mon("Arcanine", "Intimidate"), "Flamethrower", OL)]);
    expect(range(ice, OL, PL)).toEqual([25, 30]);
    expect(range(ice, PR, OL)).toEqual([134, 162]);
    const dark = await run(SV, [act(mon("Greninja", "Protean"), "Dark Pulse", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")), act(mon("Arcanine", "Intimidate"), "Flamethrower", OL)]);
    expect(range(dark, OL, PL)).toEqual([43, 52]);
    expect(range(dark, PR, OL)).toEqual([67, 81]);
  });

  it("A2-SN1-usum: a snatched move does not trigger Protean (sourceEffect snatch): Greninja's stolen Bulk Up changes nothing (Close Combat 2x, 162–192)", async () => {
    const result = await run(USUM, [act(mon("Greninja", "Protean"), "Snatch"), idle(mon("Chansey", "Natural Cure")), act(mon("Machamp", "Guts"), "Bulk Up"), act(mon("Hariyama", "Thick Fat", slow), "Close Combat", OL)]);
    expect(stepTexts(result, PL)).toEqual(["Snatch: Greninja takes Bulk Up."]);
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 162, max: 192, koChance: 1 });
  });

  it("A2-PR2-swsh (TW19): Libero Cinderace becomes Fighting after High Jump Kick (Psychic 132–156)", async () => {
    const result = await run(SWSH, [act(mon("Cinderace", "Libero"), "High Jump Kick", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")), act(mon("Slowbro", "Oblivious"), "Psychic", OL)]);
    expect(hitOf(result, OL, PL)).toMatchObject({ min: 236, max: 278 });
    expect(range(result, PR, OL)).toEqual([132, 156]);
  });

  it("A2-RO1-sv, A2-RO2-sv (TV23, TV23b): a roosted Dragonite is Dragon (Ice Beam 90–108); a roosted Corviknight is hit by Earthquake (58–70)", async () => {
    const dragonite = await run(SV, [act(mon("Dragonite", "Inner Focus", { hp: 100 }), "Roost"), idle(mon("Blissey", "Natural Cure")), act(mon("Lapras", "Water Absorb"), "Ice Beam", OL), idle(mon("Snorlax", "Thick Fat"))]);
    expect(hitOf(dragonite, OL, OL).change).toEqual({ min: 66, max: 66 });
    expect(range(dragonite, PL, OL)).toEqual([90, 108]);
    const corviknight = await run(SV, [act(mon("Corviknight", "Pressure", { hp: 100 }), "Roost"), idle(mon("Chansey", "Natural Cure")), idle(mon("Blissey", "Natural Cure")), act(mon("Snorlax", "Thick Fat"), "Earthquake")]);
    expect(range(corviknight, PR, OL)).toEqual([58, 70]);
  });

  it("A2-BU1-champions, A2-DS1-sv (TV24, TV24b): Burn Up leaves ??? (Scald 55–66); Double Shock ???/Fighting (Earthquake 41–49)", async () => {
    const burnUp = await run(CHAMPIONS, [act(mon("Arcanine", "Intimidate"), "Burn Up", PL), idle(mon("Kingambit", "Defiant")), idle(mon("Snorlax", "Thick Fat")), act(mon("Slowbro", "Oblivious"), "Scald", OL)]);
    expect(stepTexts(burnUp, OL)).toEqual(["Burn Up: Arcanine becomes ??? type."]);
    expect(range(burnUp, PR, OL)).toEqual([55, 66]);
    const doubleShock = await run(SV, [act(mon("Pawmot", "Volt Absorb"), "Double Shock", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Blissey", "Natural Cure")), act(mon("Snorlax", "Thick Fat"), "Earthquake")]);
    expect(stepTexts(doubleShock, OL)).toEqual(["Double Shock: Pawmot becomes ???/Fighting type."]);
    expect(range(doubleShock, PR, OL)).toEqual([41, 49]);
  });

  it("A2-CR7a-sv, A2-CR7b-sv, A2-CR7c-usum (CR07): Smack Down then Earthquake 2x (46–56); Magnet Rise: no effect; a Levitate Ingrain user is hit (20–24)", async () => {
    const smacked = await run(SV, [act(mon("Tyranitar", "Unnerve"), "Smack Down", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Skarmory", "Sturdy")), act(mon("Snorlax", "Thick Fat"), "Earthquake")]);
    expect(range(smacked, OL, PL)).toEqual([28, 34]);
    expect(range(smacked, PR, PL)).toEqual([46, 56]);
    const rise = await run(SV, [act(mon("Magnezone", "Sturdy", { evs: { spe: 252 } }), "Magnet Rise"), idle(mon("Chansey", "Natural Cure")), idle(mon("Blissey", "Natural Cure")), act(mon("Snorlax", "Thick Fat"), "Earthquake")]);
    expect(hitTexts(rise, OL, OL)).toEqual(["Magnet Rise: Magnezone floats."]);
    expect(hitTexts(rise, PR, OL)).toEqual(["Earthquake has no effect on Magnezone."]);
    const ingrain = await run(USUM, [act(mon("Carnivine", "Levitate"), "Ingrain"), idle(mon("Chansey", "Natural Cure")), idle(mon("Shuckle", "Sturdy")), act(mon("Snorlax", "Thick Fat"), "Earthquake")]);
    expect(hitTexts(ingrain, OL, OL)).toEqual(["Ingrain starts."]);
    expect(range(ingrain, PR, OL)).toEqual([20, 24]);
  });

  it("A2-TY1-sv (TV26): a Water-typed Garchomp (Soak last turn) Terastallizes Steel: Thunderbolt neutral (54–64), Surf 39–46", async () => {
    const result = await run(SV, [act(mon("Garchomp", "Rough Skin", { types: ["Water"], teraType: "Steel", choice: "terastallize" }), "Surf"), idle(mon("Blissey", "Natural Cure")), act(mon("Raichu", "Static"), "Thunderbolt", OL), idle(mon("Snorlax", "Thick Fat"))]);
    expect(range(result, PL, OL)).toEqual([54, 64]);
    expect(range(result, OL, PL)).toEqual([39, 46]);
    expect(range(result, OL, OR)).toEqual([25, 30]);
  });
});

describe("status2 A2: the type markers in uses-to-ko.ts turnEffectiveness (Weakness Policy)", () => {
  const policy = async (id: BattleGame, slots: Slot[]) => {
    const input = turn(await game(id), slots);
    const out = calculateDoublesOutcomes(input);
    if (out.status !== "ready") throw new Error(out.status);
    const share = (test: (build: BattleBuild) => boolean) => out.outcomes.reduce((sum, o) => sum + (o.mons[PL] && test(o.mons[PL]!.build) ? o.chance : 0), 0);
    return { result: ready(calculateDoublesTurn(input)), used: share((build) => build.itemId === "" && build.boosts.atk === 2 && build.boosts.spa === 2) };
  };

  it("A2-TS4-sv: a carried Tar Shot makes Flamethrower 2x into Snorlax (42–50): the Policy activates", async () => {
    const { result, used } = await policy(SV, [idle(mon("Blissey", "Natural Cure")), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat", { item: "Weakness Policy", carried: { tarShot: true } })), act(mon("Torkoal", "White Smoke"), "Flamethrower", PL)]);
    expect(range(result, PR, PL)).toEqual([42, 50]);
    expect(texts(hpOf(result, PL).conditions)).toContain("Holds no item.");
    expect(used).toBeCloseTo(1, 9);
  });

  it("A2-ME4-usum: a carried Miracle Eye on Scrafty: Psychic 2x through its Fighting type (92–110): the Policy activates", async () => {
    const { result, used } = await policy(USUM, [act(mon("Slowbro", "Oblivious"), "Psychic", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Scrafty", "Shed Skin", { item: "Weakness Policy", carried: { miracleEye: true } })), idle(mon("Shuckle", "Sturdy"))]);
    expect(range(result, OL, PL)).toEqual([92, 110]);
    expect(texts(hpOf(result, PL).conditions)).toContain("Holds no item.");
    expect(used).toBeCloseTo(1, 9);
  });

  it("A2-FC5-sv, A2-FC6-sv: Thunderbolt into a Lapras with an added Grass type is neutral (49–58): no Policy; without it 2x (98–116): the Policy activates", async () => {
    const added = await policy(SV, [act(mon("Raichu", "Static"), "Thunderbolt", PL), idle(mon("Blissey", "Natural Cure")), idle(mon("Lapras", "Water Absorb", { item: "Weakness Policy", addedType: "Grass" })), idle(mon("Snorlax", "Thick Fat"))]);
    expect(range(added.result, OL, PL)).toEqual([49, 58]);
    expect(texts(hpOf(added.result, PL).conditions)).not.toContain("Holds no item.");
    expect(added.used).toBe(0);
    const plain = await policy(SV, [act(mon("Raichu", "Static"), "Thunderbolt", PL), idle(mon("Blissey", "Natural Cure")), idle(mon("Lapras", "Water Absorb", { item: "Weakness Policy" })), idle(mon("Snorlax", "Thick Fat"))]);
    expect(range(plain.result, OL, PL)).toEqual([98, 116]);
    expect(plain.used).toBeCloseTo(1, 9);
  });
});

describe("status2 A2 after the integrator's changes to frozen files (build/W1A-A2.md P1–P11) and A3's Gravity start (these fail until they land)", () => {
  it("P1, A2-ID1-usum (TV10, K56): Ion Deluge: a Normalize Thunderbolt Electric (104–124); a Pixilate Hyper Voice stays Fairy (61–73, 51–60)", async () => {
    const result = await run(USUM, [act(mon("Lanturn", "Volt Absorb"), "Ion Deluge"), idle(mon("Gyarados", "Moxie")), act(mon("Delcatty", "Normalize"), "Thunderbolt", OR), act(mon("Sylveon", "Pixilate"), "Hyper Voice")]);
    expect(range(result, PL, OR)).toEqual([104, 124]);
    expect(range(result, PR, OL)).toEqual([61, 73]);
    expect(range(result, PR, OR)).toEqual([51, 60]);
  });

  it("P1, A2-ID3-usum (TW11): Ion Deluge: Body Slam at Lanturn goes to the Lightning Rod Raichu", async () => {
    const result = await run(USUM, [act(mon("Lanturn", "Illuminate"), "Ion Deluge"), idle(mon("Raichu", "Lightning Rod")), act(mon("Snorlax", "Thick Fat"), "Body Slam", OL), idle(mon("Chansey", "Natural Cure"))]);
    expect(stepTexts(result, PL)).toEqual(["Lightning Rod: Raichu takes Body Slam."]);
    expect(hitTexts(result, PL, OR)).toEqual(["Lightning Rod: +1 Sp. Atk."]);
  });

  it("P1, A2-EL8-swsh (TV09d): an Electrified Body Slam into a Volt Absorb Jolteon is absorbed", async () => {
    const result = await run(SWSH, [act(mon("Heliolisk", "Dry Skin", fast), "Electrify", PL), idle(mon("Jolteon", "Volt Absorb", { hp: 100 })), act(mon("Snorlax", "Thick Fat"), "Body Slam", OR), idle(mon("Chansey", "Natural Cure"))]);
    expect(hitOf(result, PL, OR).kind).toBe("blocked");
    expect(hitTexts(result, PL, OR)).toEqual(["Volt Absorb: no damage, and it regains HP."]);
  });

  it("P2, A2-ATE1-usum (census ate-redirect): a Galvanize Swagger at Lanturn goes to the Lightning Rod Raichu", async () => {
    const result = await run(USUM, [idle(mon("Lanturn", "Illuminate")), idle(mon("Raichu", "Lightning Rod")), act(mon("Golem-Alola", "Galvanize"), "Swagger", OL), idle(mon("Chansey", "Natural Cure"))]);
    expect(stepTexts(result, PL)).toEqual(["Lightning Rod: Raichu takes Swagger."]);
    expect(hitTexts(result, PL, OR)).toEqual(["Lightning Rod: +1 Sp. Atk."]);
  });

  it("P3, A2-C22-sv: Protect, then Conversion 2 on its user (Rock, Steel or Ghost); Close Combat 222–264, no effect on the Ghost", async () => {
    const result = await run(SV, [act(mon("Porygon-Z", "Adaptability"), "Conversion 2", PL), idle(mon("Blissey", "Natural Cure")), act(mon("Snorlax", "Thick Fat"), "Protect"), act(mon("Annihilape", "Defiant", slow), "Close Combat", OL)]);
    expect(facts(hitOf(result, OL, PL).facts)).toEqual([["Porygon-Z becomes Ghost type.", 0.333333], ["Porygon-Z becomes Rock type.", 0.333333], ["Porygon-Z becomes Steel type.", 0.333333]]);
    expect(hitOf(result, PR, OL)).toMatchObject({ min: 222, max: 264 });
    expect(hitOf(result, PR, OL).koChance).toBeCloseTo(2 / 3, 9);
  });

  it("P4: the card's conditions: Type (A2-C22-sv: Ghost, 1/3; A2-PR3-sv: Dark) and Infatuated (A2-AT3-sv, both)", async () => {
    const c22 = await run(SV, [act(mon("Porygon-Z", "Adaptability"), "Conversion 2", PL), idle(mon("Blissey", "Natural Cure")), act(mon("Snorlax", "Thick Fat"), "Protect"), act(mon("Annihilape", "Defiant", slow), "Close Combat", OL)]);
    expect(facts(hpOf(c22, OL).conditions ?? [])).toEqual([["Type: Ghost.", 0.333333]]);
    const dark = await run(SV, [act(mon("Greninja", "Protean"), "Dark Pulse", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")), act(mon("Arcanine", "Intimidate"), "Flamethrower", OL)]);
    expect(texts(hpOf(dark, OL).conditions)).toEqual(["Type: Dark."]);
    const knot = await run(SV, [act(mon("Milotic", "Competitive", g("F", fast)), "Attract", PL), idle(mon("Blissey", "Natural Cure")), act(mon("Snorlax", "Thick Fat", g("M", { item: "Destiny Knot" })), "Body Slam", OL), idle(mon("Hippowdon", "Sand Force"))]);
    expect(texts(hpOf(knot, OL).conditions)).toEqual(["Infatuated."]);
    expect(texts(hpOf(knot, PL).conditions)).toEqual(["Infatuated."]);
  });

  it("P5, A2-AT3-sv (E2): attract on both after Destiny Knot", async () => {
    const runtime = await game(SV);
    const out = calculateDoublesOutcomes(turn(runtime, [act(mon("Milotic", "Competitive", g("F", fast)), "Attract", PL), idle(mon("Blissey", "Natural Cure")),
      act(mon("Snorlax", "Thick Fat", g("M", { item: "Destiny Knot" })), "Body Slam", OL), idle(mon("Hippowdon", "Sand Force"))]));
    if (out.status !== "ready") throw new Error(out.status);
    const chance = (slot: DoublesSlotId) => out.outcomes.reduce((sum, o) => sum + (o.mons[slot]?.volatiles?.includes("attract") ? o.chance : 0), 0);
    expect(chance(OL)).toBeCloseTo(1, 9);
    expect(chance(PL)).toBeCloseTo(1, 9);
  });

  it("P6, A2-PW4-usum: Powder against Sunny Day: it fails and costs a quarter (41 HP)", async () => {
    const result = await run(USUM, [act(mon("Vivillon", "Shield Dust"), "Powder", PL), idle(mon("Chansey", "Natural Cure")), act(mon("Arcanine", "Flash Fire"), "Sunny Day"), idle(mon("Snorlax", "Thick Fat"))]);
    expect(stepTexts(result, PL)).toEqual(["Powder: Sunny Day fails."]);
    expect(hpOf(result, PL)).toMatchObject({ start: 165, min: 124, max: 124 });
  });

  it("P9, A2-EM5-usum: an Embargoed Red Card does nothing (Rock Smash 84–98; Machamp stays in)", async () => {
    const result = await run(USUM, [act(mon("Bisharp", "Defiant", fast), "Embargo", PL), act(mon("Machamp", "Guts"), "Rock Smash", PL), idle(mon("Snorlax", "Thick Fat", { item: "Red Card" })), idle(mon("Chansey", "Natural Cure"))]);
    expect(range(result, OR, PL)).toEqual([84, 98]);
    expect(stepTexts(result, OR)).toEqual([]);
  });

  it("P9, A2-EM7-usum: a carried Embargo on a Quick Claw Snorlax: no Quick Claw, it moves after Machamp", async () => {
    const result = await run(USUM, [act(mon("Snorlax", "Thick Fat", { item: "Quick Claw", carried: { embargo: 3 } }), "Body Slam", PL), idle(mon("Chansey", "Natural Cure")), act(mon("Machamp", "Guts"), "Rock Smash", OL), idle(mon("Shuckle", "Sturdy"))]);
    expect(stepOf(result, OL).order).toEqual([{ position: 2, chance: 1 }]);
    expect(stepTexts(result, OL)).toEqual([]);
  });

  it("P10 (doubles-turn.ts validate lets a used Protean through), generation 9: a used Protean (abilityActive false, Ice from an earlier turn) leaves Dark Pulse's user Ice (A2-PR1-sv's 134–162)", async () => {
    const result = await run(SV, [act(mon("Greninja", "Protean", { types: ["Ice"], build: { abilityActive: false } }), "Dark Pulse", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")),
      act(mon("Arcanine", "Intimidate"), "Flamethrower", OL)]);
    expect(range(result, PR, OL)).toEqual([134, 162]);
  });

  it("P10, generation 8: Libero acts on every move: one used earlier (Ice from then) becomes Fighting after High Jump Kick (A2-PR2-swsh's Psychic 132–156)", async () => {
    const result = await run(SWSH, [act(mon("Cinderace", "Libero", { types: ["Ice"], build: { abilityActive: false } }), "High Jump Kick", PL), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat")),
      act(mon("Slowbro", "Oblivious"), "Psychic", OL)]);
    expect(range(result, PR, OL)).toEqual([132, 156]);
  });

  it("P10, P11 (engine-corrections.cjs getStabMod, calculate.ts engineMarks), F2-PR2-champions: a used Protean Greninja (Water from an earlier turn): Ice Beam without STAB (21–25), still Water (Flamethrower 33–40)", async () => {
    const result = await run(CHAMPIONS, [act(mon("Greninja", "Protean", { evs: { spe: 32 }, types: ["Water"], build: { abilityActive: false } }), "Ice Beam", PR), idle(mon("Snorlax", "Thick Fat", { evs: { spe: 0 } })),
      idle(mon("Snorlax", "Thick Fat", { evs: { spe: 2 } })), act(mon("Arcanine", "Intimidate"), "Flamethrower", OL)]);
    expect(range(result, OL, PR)).toEqual([21, 25]);
    expect(range(result, PR, OL)).toEqual([33, 40]);
  });

  it("A3's Gravity start (doubles-field.ts: typing.gravityGrounds for each active Pokémon), A2-GR1-usum: a carried Telekinesis ends", async () => {
    const input = turn(await game(USUM), [act(mon("Clefable", "Magic Guard"), "Gravity"), idle(mon("Chansey", "Natural Cure")), idle(mon("Snorlax", "Thick Fat", { carried: { telekinesis: 2 } })), idle(mon("Shuckle", "Sturdy"))]);
    expect(texts(hpOf(ready(calculateDoublesTurn(input)), PL).conditions)).not.toContain("Telekinesis.");
    const out = calculateDoublesOutcomes(input);
    if (out.status !== "ready") throw new Error(out.status);
    expect(out.outcomes.some((o) => o.mons[PL]?.volatiles?.includes("telekinesis"))).toBe(false);
  });

  it("P7, A2-HB1-usum: Volt Absorb under Heal Block is Showdown's -immune: the hit's kind is no-damage", async () => {
    const result = await run(USUM, [act(mon("Bronzong", "Levitate", fast), "Heal Block"), act(mon("Ampharos", "Static"), "Thunderbolt", PR), act(mon("Slowbro", "Oblivious", { hp: 100 }), "Slack Off"), idle(mon("Jolteon", "Volt Absorb", { hp: 100 }))]);
    expect(hitOf(result, OR, PR).kind).toBe("no-damage");
  });
});
