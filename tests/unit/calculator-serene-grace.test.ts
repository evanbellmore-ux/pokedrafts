import { describe, expect, it } from "vitest";
import { calculateMatchup } from "@/app/lib/battle/calculate";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { everyUseStatus, statMove } from "@/app/lib/battle/stat-moves";
import type { BattleBuild, BattleConditions, BattleGame, CombatStat, MoveDamageResult } from "@/app/lib/battle/types";

/**
 * Serene Grace doubles every secondary's chance and a self chance (pinned Showdown c23d2e94 data/abilities.ts serenegrace
 * onModifyMove), and an added effect happens when random(100) is below its chance (sim/battle-actions.ts secondaries), so
 * a 50% or 70% one happens on every use, exactly as a 100% one: Rock Smash's Defense drop and Charge Beam's Sp. Atk rise,
 * through Shield Dust, Covert Cloak, Clear Body, Mirror Armor, Contrary, Simple, White Herb, Neutralizing Gas, Trace and
 * Dynamax. One still below 100% doubled (Air Slash's 60% flinch) does not happen. Singles values: the exact Uses oracle
 * scripts/.cache/calc-audit/zmove-status/verify/u-oracle2.ts through zmove-status/verify/run.ts (cases
 * serene-arceus/fix/cases-1v1.json). 2v2 values: the exact oracle scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts, cases
 * SA01-SA04 and SA06-SA08 (serene-arceus/fix/cases-sa.ts). Level 50, 31 IVs, 0 EVs, Serious nature unless set.
 */

type Runtime = Awaited<ReturnType<typeof loadBattleRuntime>>;
type Mon = { id: string; ability: string; item?: string; hp?: number; boosts?: Partial<Record<CombatStat, number>>; evs?: Partial<Record<CombatStat, number>> };
function build(runtime: Runtime, m: Mon, extra: Partial<BattleBuild> = {}): BattleBuild {
  const base = createBuild(m.id, runtime);
  return {
    ...base, nature: "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, ...(m.hp !== undefined ? { currentHP: m.hp } : {}),
    ...(m.evs ? { native: { ...base.native!, evs: { ...base.native!.evs, ...m.evs } } } : {}), ...extra,
  } as BattleBuild;
}
async function row(game: BattleGame, moveId: string, attacker: Mon, defender: Mon, extra: Partial<BattleBuild> = {}): Promise<MoveDamageResult> {
  const runtime = await loadBattleRuntime(game);
  const out = calculateMatchup(build(runtime, attacker, extra), build(runtime, defender), { ...createConditions(), gameType: "Singles" }, {}, runtime);
  expect(out.issues).toEqual({ attacker: [], defender: [], field: [] });
  return out.results.find((result) => result.moveId === moveId)!;
}
const SW: BattleGame = "sword_shield", US: BattleGame = "ultra_sun_ultra_moon", SV: BattleGame = "scarlet_violet";
const blissey: Mon = { id: "blissey", ability: "serenegrace" };
const snorlax: Mon = { id: "snorlax", ability: "thickfat" };
const LOWERS = "Rock Smash lowers the target's Defense each use.";
const RISES = "Charge Beam raises the attacker's Sp. Atk each use.";

describe("Serene Grace's certain added effects (stat-moves.ts SERENE_GRACE_MOVES)", () => {
  it("adds them to the every-use changes only for a Serene Grace user", () => {
    expect(statMove("rocksmash", SW)).toBeUndefined();
    expect(statMove("rocksmash", SW, true)).toEqual({ target: { def: -1 } });
    expect(statMove("chargebeam", US, true)).toEqual({ userSecondary: { spa: 1 } });
    expect(statMove("diamondstorm", SV, true)).toEqual({ self: { def: 2 } });
    // A move with its own every-use change keeps it (Close Combat), with or without Serene Grace.
    expect(statMove("closecombat", SV, true)).toEqual(statMove("closecombat", SV));
    expect(everyUseStatus("sacredfire")).toBeUndefined();
    expect(everyUseStatus("sacredfire", true)).toEqual({ status: "brn", secondary: true });
    expect(everyUseStatus("poisonfang", true)).toEqual({ status: "tox", secondary: true });
    expect(everyUseStatus("nuzzle", true)).toEqual(everyUseStatus("nuzzle"));
  });
});

describe("Serene Grace in 1v1 Uses to KO", () => {
  it("lowers the target's Defense with every Rock Smash: 8 uses, not 20 (Sword/Shield and Ultra Sun/Ultra Moon)", async () => {
    // sw|blissey|rocksmash|snorlax: Showdown out within 7 uses at 0.0000397..., within 8 always.
    for (const game of [SW, US]) {
      const smash = await row(game, "rocksmash", blissey, snorlax);
      expect(smash).toMatchObject({ min: 12, max: 16 });
      expect(smash.usesToKO).toMatchObject({ kind: "uses", guaranteed: 8, fewest: 7, carried: [LOWERS] });
      expect((smash.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.00003975629806518555, 15);
      expect(smash.afterUse).toMatchObject({ start: 235, low: 223, high: 219, min: 219, max: 223, average: 221.25, koChance: 0 });
    }
    // Natural Cure Blissey: the 50% drop stays below 100%.
    const plain = await row(SW, "rocksmash", { id: "blissey", ability: "naturalcure" }, snorlax);
    expect(plain.usesToKO).toMatchObject({ kind: "uses", guaranteed: 20, fewest: 15, carried: [] });
  });

  it("starts the drops once Dynamax ends", async () => {
    // sw|blissey|rocksmash|snorlax-max: Max Knuckle for 3 turns, then Rock Smash: out within 6 at 0.2578..., within 7.
    const max = await row(SW, "rocksmash", blissey, snorlax, { mechanic: "dynamax" });
    expect(max).toMatchObject({ effectiveName: "Max Knuckle", min: 20, max: 24 });
    expect(max.usesToKO).toMatchObject({
      kind: "uses", guaranteed: 7, fewest: 6,
      carried: ["After Dynamax ends, Rock Smash lowers the target's Defense each use.", "Max Knuckle changes a stat each use.", "Dynamax ends after 3 turns."],
    });
    expect((max.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.2578447461128235, 15);
  });

  it("meets the target's guards and reactions as a 100% drop does", async () => {
    // Shield Dust filters the secondary: out at the earliest in 19 uses, none guaranteed within the PP (Showdown alike).
    const dust = await row(SW, "rocksmash", blissey, { id: "frosmoth", ability: "shielddust" });
    expect(dust.usesToKO).toMatchObject({ kind: "uses", guaranteed: null, fewest: 19, carried: [] });
    expect((await row(SW, "rocksmash", blissey, { id: "metagross", ability: "clearbody" })).usesToKO).toMatchObject({ guaranteed: null, fewest: null, carried: [] });
    // Mirror Armor turns the drop on Blissey, whose Defense Rock Smash does not read.
    expect((await row(SW, "rocksmash", blissey, { id: "corviknight", ability: "mirrorarmor" })).usesToKO).toMatchObject({ guaranteed: null, fewest: null, carried: [] });
    expect((await row(SW, "rocksmash", blissey, { id: "shuckle", ability: "contrary" })).usesToKO)
      .toMatchObject({ guaranteed: null, fewest: null, carried: ["Rock Smash raises the target's Defense each use."] });
    // Simple doubles each drop (us|sawsbuck|rocksmash|bibarel-simple): out within 2 at 0.30859375, within 3.
    const simple = await row(US, "rocksmash", { id: "sawsbuck", ability: "serenegrace" }, { id: "bibarel", ability: "simple" });
    expect(simple.usesToKO).toMatchObject({ kind: "uses", guaranteed: 3, fewest: 2, fasterChance: 0.30859375, carried: [LOWERS] });
    // White Herb restores the first drop: within 8 at 0.2115..., within 9.
    const herb = await row(SW, "rocksmash", blissey, { ...snorlax, item: "whiteherb" });
    expect(herb.usesToKO).toMatchObject({ kind: "uses", guaranteed: 9, fewest: 8, carried: [LOWERS, "The target's White Herb restores its stats once."] });
    expect((herb.usesToKO as { fasterChance: number }).fasterChance).toBeCloseTo(0.21155256312340498, 15);
    // The target's Neutralizing Gas suppresses Serene Grace: nothing doubles.
    expect((await row(SW, "rocksmash", blissey, { id: "weezinggalar", ability: "neutralizinggas" })).usesToKO).toMatchObject({ carried: [] });
  });

  it("raises the attacker's Sp. Atk with every Charge Beam, Covert Cloak and a traced Serene Grace included", async () => {
    expect((await row(SW, "chargebeam", blissey, snorlax)).usesToKO).toMatchObject({ kind: "uses", guaranteed: 7, fewest: 7, carried: [RISES] });
    // Covert Cloak keeps a secondary's self effect (data/items.ts covertcloak onModifySecondaries).
    expect((await row(SV, "chargebeam", { id: "jirachi", ability: "serenegrace" }, { ...snorlax, item: "covertcloak" })).usesToKO)
      .toMatchObject({ kind: "uses", guaranteed: 6, fewest: 6, carried: [RISES] });
    // Porygon2's Trace copies Blissey's Serene Grace: out in 8; into Thick Fat Snorlax, 70% stays below 100%: 11 to 13.
    const traced = await row(SW, "chargebeam", { id: "porygon2", ability: "trace", item: "eviolite" }, blissey);
    expect(traced.usesToKO).toMatchObject({ kind: "uses", guaranteed: 8, fewest: 8, carried: [RISES] });
    const untraced = await row(SW, "chargebeam", { id: "porygon2", ability: "trace", item: "eviolite" }, snorlax);
    expect(untraced.usesToKO).toMatchObject({ kind: "uses", guaranteed: 13, fewest: 11, carried: [] });
    const gardevoir = await row(SV, "chargebeam", { id: "gardevoir", ability: "trace" }, { id: "jirachi", ability: "serenegrace" });
    expect(gardevoir.usesToKO).toMatchObject({ kind: "uses", guaranteed: 5, fewest: 4, fasterChance: 0.587249755859375, carried: [RISES] });
  });
});

type Slot = Mon & { move?: string; target?: DoublesSlotId };
async function turn(game: BattleGame, slots: Record<DoublesSlotId, Slot>, field: Partial<BattleConditions> = {}) {
  const runtime = await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(Object.entries(slots).map(([slot, m]) => [slot, {
    build: build(runtime, m), contexts: {}, charged: false, action: { moveId: m.move ?? null, target: m.target ?? null },
  } satisfies DoublesPokemonInput])) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  const input: DoublesTurnInput = { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
  return calculateDoublesTurn(input);
}
async function ready(game: BattleGame, slots: Record<DoublesSlotId, Slot>) {
  const result = await turn(game, slots);
  if (result.status !== "ready") throw new Error(`${result.status}: ${"reason" in result ? result.reason : ""}`);
  return result;
}
type Ready = Awaited<ReturnType<typeof ready>>;
const hit = (result: Ready, from: DoublesSlotId, to: DoublesSlotId) => result.steps.find((step) => step.slot === from)?.hits.find((each) => each.slot === to);
const venusaur: Slot = { id: "venusaur", ability: "overgrow", evs: { spe: 4 } };
const foeSnorlax: Slot = { ...snorlax, evs: { spe: 4 } };
const conkeldurr = (target: DoublesSlotId): Slot => ({ id: "conkeldurr", ability: "guts", move: "hammerarm", target });
const smash = (m: Mon = blissey): Slot => ({ ...m, move: "rocksmash", target: "opponent-left" });

describe("Serene Grace in the 2v2 turn (oracle cases SA01-SA04, SA06-SA08)", () => {
  it("lowers the target's Defense before the slower partner's hit (Sword/Shield)", async () => {
    // SA01: Hammer Arm 320-380 into Snorlax at -1 Defense: out. SA02 (Natural Cure): 212-252, out at 0.73828125.
    const graced = await ready(SW, { "own-left": smash(), "own-right": conkeldurr("opponent-left"), "opponent-left": foeSnorlax, "opponent-right": venusaur });
    expect(hit(graced, "own-right", "opponent-left")).toMatchObject({ min: 320, max: 380, koChance: 1 });
    expect(graced.hp["opponent-left"]).toMatchObject({ start: 235, low: 0, high: 0, average: 0, koChance: 1 });
    const plain = await ready(SW, { "own-left": smash({ id: "blissey", ability: "naturalcure" }), "own-right": conkeldurr("opponent-left"), "opponent-left": foeSnorlax, "opponent-right": venusaur });
    expect(hit(plain, "own-right", "opponent-left")).toMatchObject({ min: 212, max: 252, koChance: 0.73828125 });
    expect(plain.hp["opponent-left"]).toMatchObject({ start: 235, low: 11, high: 0, average: 1.32421875, koChance: 0.73828125 });
  });

  it("stops at Shield Dust and Clear Body, and Mirror Armor turns it on Blissey", async () => {
    // SA03: Frosmoth's Shield Dust: Hammer Arm 114-135 at its full Defense.
    const dust = await ready(SW, { "own-left": smash(), "own-right": conkeldurr("opponent-left"), "opponent-left": { id: "frosmoth", ability: "shielddust" }, "opponent-right": venusaur });
    expect(hit(dust, "own-right", "opponent-left")).toMatchObject({ min: 114, max: 135 });
    expect(dust.hp["opponent-left"]).toMatchObject({ start: 145, low: 25, high: 2, average: 14.0625, koChance: 0 });
    // SA04: Corviknight's Mirror Armor: the slower Snorlax's Body Slam 312-367 into Blissey at -1 Defense, out at 0.6875.
    const armor = await ready(SW, {
      "own-left": smash(), "own-right": { id: "conkeldurr", ability: "guts" }, "opponent-left": { id: "corviknight", ability: "mirrorarmor" },
      "opponent-right": { ...foeSnorlax, move: "bodyslam", target: "own-left" },
    });
    expect(hit(armor, "opponent-right", "own-left")).toMatchObject({ min: 312, max: 367, koChance: 0.6875 });
    expect(armor.hp["own-left"]).toMatchObject({ start: 330, low: 18, high: 0, average: 3.4375, koChance: 0.6875 });
    // SA08 (Ultra Sun/Ultra Moon): Metagross's Clear Body: Body Slam 21-25.
    const body = await ready(US, {
      "own-left": smash(), "own-right": { ...snorlax, move: "bodyslam", target: "opponent-left" }, "opponent-left": { id: "metagross", ability: "clearbody" }, "opponent-right": venusaur,
    });
    expect(hit(body, "own-right", "opponent-left")).toMatchObject({ min: 21, max: 25 });
    expect(body.hp["opponent-left"]).toMatchObject({ start: 155, low: 130, high: 125, average: 128.1875 });
  });

  it("lands through an intact Ice Face (Sword/Shield)", async () => {
    // SA13 (cases-sa.ts SA_FACE_CASES): Ice Face takes Rock Smash, Eiscue-Noice keeps the -1 Defense, Hammer Arm 302-356: out.
    const face = await ready(SW, { "own-left": smash(), "own-right": conkeldurr("opponent-left"), "opponent-left": { id: "eiscue", ability: "iceface" }, "opponent-right": venusaur });
    expect(hit(face, "own-right", "opponent-left")).toMatchObject({ min: 302, max: 356, koChance: 1 });
    expect(face.hp["opponent-left"]).toMatchObject({ start: 150, low: 0, high: 0, average: 0, koChance: 1 });
  });

  it("happens at exactly 100%, not at a doubled 60% flinch (Ultra Sun/Ultra Moon)", async () => {
    // SA06: Togekiss's Rock Smash, then its partner's Body Slam 111-132 into Snorlax at -1 Defense.
    const drop = await ready(US, {
      "own-left": smash({ id: "togekiss", ability: "serenegrace" }), "own-right": { ...snorlax, move: "bodyslam", target: "opponent-left" }, "opponent-left": foeSnorlax, "opponent-right": venusaur,
    });
    expect(hit(drop, "own-right", "opponent-left")).toMatchObject({ min: 111, max: 132 });
    expect(drop.hp["opponent-left"]).toMatchObject({ start: 235, low: 98, high: 71, average: 85.1875 });
    // SA07: Air Slash's 30% flinch doubled to 60%: the slower Snorlax still Body Slams Togekiss (55-66).
    const flinch = await ready(US, {
      "own-left": { id: "togekiss", ability: "serenegrace", move: "airslash", target: "opponent-left" }, "own-right": venusaur,
      "opponent-left": { ...foeSnorlax, move: "bodyslam", target: "own-left" }, "opponent-right": { id: "lapras", ability: "shellarmor" },
    });
    expect(hit(flinch, "opponent-left", "own-left")).toMatchObject({ min: 55, max: 66, reached: 1 });
    expect(flinch.hp["own-left"]).toMatchObject({ start: 160, low: 105, high: 94, average: 99.875 });
  });

  it("doubles nothing under a foe's Neutralizing Gas", async () => {
    // ngas-pp NG30 (Showdown): the gas suppresses Serene Grace from the turn's start, so Rock Smash's 50% drop does not
    // happen: Hammer Arm 212-252 into Snorlax at 0 Defense, out at 0.73828125 (SA02's numbers).
    const gas = await turn(SW, { "own-left": smash(), "own-right": conkeldurr("opponent-left"), "opponent-left": foeSnorlax, "opponent-right": { id: "weezinggalar", ability: "neutralizinggas" } });
    expect(gas.status).toBe("ready");
    if (gas.status !== "ready") return;
    expect(gas.hp["opponent-left"]).toMatchObject({ start: 235, low: 11, high: 0, min: 0, max: 11 });
    expect(gas.hp["opponent-left"]!.koChance).toBeCloseTo(0.73828125, 12);
    expect(gas.hp["opponent-left"]!.average).toBeCloseTo(1.32421875, 12);
    expect(gas.steps.find((step) => step.slot === "own-right")!.hits[0]).toMatchObject({ min: 212, max: 252 });
  });
});

describe("Serene Grace's certain drop meets the target's reactions in the 2v2 turn (verifier cases VS01-VS08)", () => {
  // Pinned Showdown c23d2e94 through scripts/.cache/calc-audit/2v2/verify/sim-dfs.ts, cases
  // scripts/.cache/calc-audit/serene-arceus/verify/cases-2v2.ts. Secondaries come before DamagingHit
  // (sim/battle-actions.ts spreadMoveHit), so Stamina and Weak Armor act after the drop.
  const plainVenusaur: Slot = { id: "venusaur", ability: "overgrow" };
  it("sets off Defiant and Competitive before the target's own move", async () => {
    // VS01 (Sword/Shield): Bisharp at +2 Attack: Iron Head 228-270 knocks Togekiss out.
    const defiant = await ready(SW, {
      "own-left": smash({ id: "togekiss", ability: "serenegrace" }), "own-right": snorlax,
      "opponent-left": { id: "bisharp", ability: "defiant", move: "ironhead", target: "own-left" }, "opponent-right": plainVenusaur,
    });
    expect(hit(defiant, "own-left", "opponent-left")).toMatchObject({ min: 40, max: 48 });
    expect(hit(defiant, "opponent-left", "own-left")).toMatchObject({ min: 228, max: 270, koChance: 1 });
    expect(defiant.hp["opponent-left"]).toMatchObject({ start: 140, low: 100, high: 92, average: 97.5 });
    // VS02 (Ultra Sun/Ultra Moon): the faster Blissey's drop gives Milotic +2 Sp. Atk: Hydro Pump 96-114.
    const competitive = await ready(US, {
      "own-left": smash({ ...blissey, evs: { spe: 252 } }), "own-right": snorlax,
      "opponent-left": { id: "milotic", ability: "competitive", move: "hydropump", target: "own-left" }, "opponent-right": plainVenusaur,
    });
    expect(hit(competitive, "opponent-left", "own-left")).toMatchObject({ min: 96, max: 114 });
    expect(competitive.hp["own-left"]).toMatchObject({ start: 330, low: 234, high: 216, average: 225.5 });
  });

  it("follows Contrary, Stamina and Weak Armor for the partner's hit", async () => {
    const bodySlam: Slot = { ...snorlax, move: "bodyslam", target: "opponent-left" };
    // VS05 (Ultra Sun/Ultra Moon): Contrary Shuckle at +1 Defense: Body Slam 8-10.
    const contrary = await ready(US, { "own-left": smash(), "own-right": bodySlam, "opponent-left": { id: "shuckle", ability: "contrary" }, "opponent-right": plainVenusaur });
    expect(hit(contrary, "own-right", "opponent-left")).toMatchObject({ min: 8, max: 10 });
    expect(contrary.hp["opponent-left"]).toMatchObject({ start: 95, low: 84, high: 81, average: 82.9375 });
    // VS07 (Ultra Sun/Ultra Moon): the drop, then Stamina's rise: Mudsdale at 0 for Body Slam 52-63.
    const stamina = await ready(US, { "own-left": smash(), "own-right": bodySlam, "opponent-left": { id: "mudsdale", ability: "stamina" }, "opponent-right": plainVenusaur });
    expect(hit(stamina, "own-right", "opponent-left")).toMatchObject({ min: 52, max: 63 });
    expect(stamina.hp["opponent-left"]).toMatchObject({ start: 175, low: 118, high: 106, average: 112.625 });
    // VS08 (Sword/Shield): the drop and Weak Armor's: Skarmory at -2 for Body Slam 39-46.
    const armor = await ready(SW, { "own-left": smash(), "own-right": bodySlam, "opponent-left": { id: "skarmory", ability: "weakarmor" }, "opponent-right": plainVenusaur });
    expect(hit(armor, "own-right", "opponent-left")).toMatchObject({ min: 39, max: 46 });
    expect(armor.hp["opponent-left"]).toMatchObject({ start: 140, low: 97, high: 89, average: 93.6875 });
  });
});
