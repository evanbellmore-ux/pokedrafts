import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn, DOUBLES_REFERENCE } from "@/app/lib/battle/doubles-turn";
import type {
  DoublesCarried, DoublesHP, DoublesPokemonInput, DoublesResidual, DoublesSlotId, DoublesTurnInput, DoublesTurnResult,
} from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus } from "@/app/lib/battle/types";

/**
 * The 2v2 end of turn (status-eot SPEC §2.3, §4.7, §4.9; ADDENDUM §2.3, C16, C18): one residual phase on every finished
 * world in pinned Showdown c23d2e94's fieldEvent('Residual') order. The numbers were checked against the pinned simulator
 * (scripts/.cache/calc-audit/status-eot/build/trackb-check.ts, cases B01–B39). Level 50, 31 IVs, 0 EVs: maximum HP is
 * base HP + 75, Speed base Speed + 20.
 */
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
type P = {
  id: string; ability?: string; item?: string; status?: BattleStatus; hp?: number; move?: string | null; target?: DoublesSlotId | null; carried?: DoublesCarried;
};
const idle = (id: string, extra: Partial<P> = {}): P => ({ id, move: null, ...extra });
async function turn(game: BattleGame, slots: [P | null, P | null, P | null, P | null], field: Partial<BattleConditions> = {}, extra: Partial<DoublesTurnInput> = {}): Promise<DoublesTurnInput> {
  const runtime: BattleRuntime = await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(SLOTS.map((slot, index) => {
    const p = slots[index];
    if (!p) return [slot, null];
    const base = createBuild(p.id, runtime);
    const abilityId = p.ability ?? base.abilityId;
    const build = { ...base, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "", status: p.status ?? "", currentHP: p.hp ?? null } as BattleBuild;
    const entry: DoublesPokemonInput = { build, contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}) };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon, ...extra };
}
type Ready = Extract<DoublesTurnResult, { status: "ready" }>;
function ready(result: DoublesTurnResult): Ready {
  expect(result.status, JSON.stringify("reason" in result ? result.reason : "")).toBe("ready");
  return result as Ready;
}
function after(result: Ready): Record<DoublesSlotId, DoublesHP | null> {
  expect(result.endOfTurn.status, JSON.stringify(result.endOfTurn)).toBe("ready");
  return (result.endOfTurn as Extract<Ready["endOfTurn"], { status: "ready" }>).hp;
}
function residuals(result: Ready): DoublesResidual[] {
  return result.endOfTurn.status === "ready" ? result.endOfTurn.residuals : [];
}
const find = (result: Ready, slot: DoublesSlotId, effect: string) => residuals(result).filter((entry) => entry.slot === slot && entry.effect === effect);

describe("the end of turn's result (SPEC §4.9)", () => {
  it("equals the HP after the moves when nothing acts, with no residuals and no end-of-turn fact", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [idle("snorlax", { hp: 100 }), idle("gengar"), idle("jolteon"), idle("dragapult")])));
    expect(after(result)).toEqual(result.hp);
    expect(residuals(result)).toEqual([]);
    expect(result.facts).not.toContain("End-of-turn effects are not applied.");
  });

  it("sand in Speed order, then the Update after the weather (a Sitrus), then Leftovers; immunities", async () => {
    // B02: Snorlax 120/235 loses 14 to 106 (≤ half: Sitrus +58 = 164), Gengar 100/135 −8 then Leftovers +8.
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      idle("snorlax", { hp: 120, item: "sitrusberry" }), idle("gengar", { hp: 100, item: "leftovers" }), idle("jolteon", { hp: 100, item: "safetygoggles" }), idle("tyranitar", { hp: 100 }),
    ], { weather: "Sand" })));
    const hp = after(result);
    expect([hp["own-left"]!.average, hp["own-right"]!.average, hp["opponent-left"]!.average, hp["opponent-right"]!.average]).toEqual([164, 100, 100, 100]);
    expect(residuals(result).map((entry) => [entry.slot, entry.effect, entry.min])).toEqual([
      ["own-right", "Sandstorm", -8], ["own-left", "Sandstorm", -14], ["own-left", "Sitrus Berry", 58], ["own-right", "Leftovers", 8],
    ]);
    expect(result.facts).toContain("Assumes the Sandstorm does not end this turn.");
    // The HP after the moves is unchanged.
    expect(result.hp["own-left"]!.average).toBe(120);
  });

  it("a weather with one turn left ends at the residual without acting", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [idle("snorlax", { hp: 100 }), idle("gengar", { hp: 100 }), idle("jolteon"), idle("dragapult")], { weather: "Sand" }, { weatherTurns: 1 })));
    expect(after(result)["own-left"]!.average).toBe(100);
    expect(result.endOfTurn).toMatchObject({ status: "ready", residuals: [], facts: ["Sandstorm ends."] });
    expect(result.facts.some((fact) => fact.includes("does not end"))).toBe(false);
  });

  it("a hit's KO chance and the residuals' add up to the KO chance after the turn", async () => {
    // B33: Dragon Claw into Dragapult at 60 HP (Sitrus), then sand.
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      { id: "garchomp", move: "dragonclaw", target: "opponent-right", item: "leftovers" }, idle("gengar", { hp: 100 }), idle("jolteon", { hp: 100 }), idle("dragapult", { hp: 30 }),
    ], { weather: "Sand" })));
    const hit = result.steps[0].hits.find((each) => each.slot === "opponent-right")!;
    const residualKO = residuals(result).filter((entry) => entry.slot === "opponent-right").reduce((sum, entry) => sum + entry.koChance, 0);
    expect(Math.abs(hit.koChance + residualKO - after(result)["opponent-right"]!.koChance)).toBeLessThan(1e-12);
  });

  it("E2: the outcomes after the turn are endOfTurn.hp's mixture; endOfTurn applied", async () => {
    const input = await turn("scarlet_violet", [
      { id: "garchomp", move: "dragonclaw", target: "opponent-right", item: "leftovers" }, idle("gengar", { hp: 100, status: "tox", carried: { toxic: 2 } }),
      idle("jolteon", { hp: 100, item: "blacksludge" }), idle("dragapult", { hp: 120, item: "sitrusberry" }),
    ], { weather: "Sand" });
    const result = ready(calculateDoublesTurn(input));
    const outcomes = calculateDoublesOutcomes(input);
    expect(outcomes.status).toBe("ready");
    if (outcomes.status !== "ready") return;
    expect(outcomes.endOfTurn).toBe("applied");
    for (const slot of SLOTS) {
      let average = 0, ko = 0;
      for (const outcome of outcomes.outcomes) for (const entry of outcome.mons[slot]!.hp) { average += outcome.chance * entry.chance * entry.hp; if (entry.hp <= 0) ko += outcome.chance * entry.chance; }
      expect(Math.abs(average - after(result)[slot]!.average)).toBeLessThan(1e-9);
      expect(Math.abs(ko - after(result)[slot]!.koChance)).toBeLessThan(1e-9);
    }
  });

  it("the reference mode (every tie permuted, no merges) gives the same end of turn", async () => {
    const inputs = [
      await turn("scarlet_violet", [idle("snorlax", { hp: 100, status: "brn" }), idle("gengar", { hp: 100 }), idle("snorlax", { ability: "immunity", hp: 100, status: "brn" }), idle("dragapult", { hp: 100 })]),
      await turn("scarlet_violet", [idle("venusaur", { hp: 10, carried: { leechSeed: "opponent-left" } }), idle("gengar", { hp: 100 }), idle("venusaur", { ability: "chlorophyll", hp: 100, carried: { leechSeed: "own-left" } }), idle("dragapult")]),
      await turn("champions", [idle("audino", { ability: "healer", hp: 100 }), idle("gengar", { hp: 100, status: "tox" }), idle("arbok", { ability: "shedskin", hp: 100, status: "brn" }), idle("dragapult", { hp: 100 })], { weather: "Sand" }),
    ];
    for (const input of inputs) {
      const normal = ready(calculateDoublesTurn(input));
      DOUBLES_REFERENCE.on = true;
      let reference: Ready;
      try { reference = ready(calculateDoublesTurn(input)); } finally { DOUBLES_REFERENCE.on = false; }
      for (const slot of SLOTS) {
        const a = after(normal)[slot]!, b = after(reference)[slot]!;
        expect(Math.abs(a.average - b.average)).toBeLessThan(1e-9);
        expect(Math.abs(a.koChance - b.koChance)).toBeLessThan(1e-12);
        expect([a.min, a.max, a.low, a.high]).toEqual([b.min, b.max, b.low, b.high]);
      }
    }
  });
});

describe("ties (C9)", () => {
  it("mutual Leech Seed at equal Speed: each order is its own world", async () => {
    // B22: Venusaur at 10 HP first faints (the other ends at 110); the other first: 100 and 10.
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      idle("venusaur", { hp: 10, carried: { leechSeed: "opponent-left" } }), idle("gengar", { hp: 100 }),
      idle("venusaur", { ability: "chlorophyll", hp: 100, carried: { leechSeed: "own-left" } }), idle("dragapult", { hp: 100 }),
    ])));
    const hp = after(result);
    expect(hp["own-left"]).toMatchObject({ min: 0, max: 10, average: 5, koChance: 0.5 });
    expect(hp["opponent-left"]).toMatchObject({ min: 100, max: 110, average: 105 });
    // The drain and the heal on one Pokémon from one other are two entries.
    expect(find(result, "own-left", "Leech Seed").map((entry) => [entry.other, entry.min, entry.max, entry.koChance])).toEqual([["opponent-left", -19, -10, 0.5], ["opponent-left", 19, 19, 0]]);
  });

  it("two burned at equal Speed commute: one order", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      idle("snorlax", { hp: 100, status: "brn" }), idle("gengar", { hp: 100 }), idle("snorlax", { ability: "immunity", hp: 100, status: "brn" }), idle("dragapult", { hp: 100 }),
    ])));
    expect([after(result)["own-left"]!.average, after(result)["opponent-left"]!.average]).toEqual([86, 86]);
  });
});

describe("handlers (SPEC §2.3)", () => {
  it("Healer cures the ally before its poison acts (Champions 1/2); Shed Skin 33/100", async () => {
    const result = ready(calculateDoublesTurn(await turn("champions", [
      idle("audino", { ability: "healer", hp: 100 }), idle("gengar", { hp: 100, status: "tox" }), idle("arbok", { ability: "shedskin", hp: 100, status: "brn" }), idle("dragapult", { hp: 100 }),
    ])));
    expect(find(result, "own-right", "Healer")).toEqual([{ slot: "own-right", effect: "Healer", other: "own-left", chance: 0.5, min: null, max: null, koChance: 0, facts: [{ text: "Cures its bad poison.", chance: 0.5 }] }]);
    expect(find(result, "own-right", "Bad poison")[0]).toMatchObject({ chance: 0.5, min: -8, max: -8 });
    expect(find(result, "opponent-left", "Shed Skin")[0]).toMatchObject({ chance: 0.33, facts: [{ text: "Cures its burn.", chance: 0.33 }] });
    expect(after(result)["opponent-left"]!.average).toBeCloseTo(100 - 0.67 * 8, 9);
    expect(result.facts).toContain("Assumes this is Gengar's first turn of bad poison damage.");
  });

  it("Leech Seed: Big Root on the gainer, Liquid Ooze on the seeded, Magic Guard", async () => {
    // B08: Venusaur (Big Root) gains bigRoot(20) = 26 from Dragapult; Tentacruel's Liquid Ooze deals 19 to Gengar.
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      idle("venusaur", { hp: 100, item: "bigroot" }), idle("gengar", { hp: 100 }),
      idle("tentacruel", { ability: "liquidooze", hp: 150, carried: { leechSeed: "own-right" } }), idle("dragapult", { hp: 100, carried: { leechSeed: "own-left" } }),
    ])));
    const hp = after(result);
    expect([hp["own-left"]!.average, hp["own-right"]!.average, hp["opponent-left"]!.average, hp["opponent-right"]!.average]).toEqual([126, 81, 131, 80]);
    expect(find(result, "own-right", "Liquid Ooze")[0]).toMatchObject({ other: "opponent-left", min: -19 });
    expect(find(result, "own-left", "Leech Seed")[0]).toMatchObject({ other: "opponent-right", min: 26 });
  });

  it("a partial trap ends when its source has fainted (a trapper fainting to sand first)", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      idle("charizard", { hp: 100, item: "bindingband" }), idle("gengar", { hp: 1 }),
      idle("jolteon", { hp: 100, carried: { trap: { source: "own-left", bindingBand: true } } }), idle("dragapult", { hp: 100, carried: { trap: { source: "own-right", bindingBand: false } } }),
    ], { weather: "Sand" })));
    // Jolteon 140: sand 8, then 1/6 = 23; Dragapult: sand 10 only.
    expect([after(result)["opponent-left"]!.average, after(result)["opponent-right"]!.average]).toEqual([69, 90]);
    expect(find(result, "opponent-left", "Partial trap")[0]).toMatchObject({ other: "own-left", min: -23 });
    // A carried trap with its move: the residual and the condition name the move.
    const named = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      idle("charizard", { hp: 100 }), idle("gengar", { hp: 100 }),
      idle("jolteon", { hp: 100, carried: { trap: { source: "own-left", bindingBand: false, move: "firespin" } } }), idle("dragapult", { hp: 100 }),
    ])));
    expect(find(named, "opponent-left", "Fire Spin")[0]).toMatchObject({ other: "own-left", min: -17 });
    expect(named.hp["opponent-left"]!.conditions).toEqual([{ text: "Trapped by Fire Spin.", chance: 1 }]);
  });

  it("Yawn from last turn: sleep at 23, Bad Dreams at 28.2; a Lum Berry is eaten as the sleep starts", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      idle("snorlax", { hp: 200, carried: { yawn: true } }), idle("gengar", { hp: 100, item: "lumberry", carried: { yawn: true } }), idle("darkrai", { hp: 100 }), idle("dragapult", { hp: 100 }),
    ])));
    expect(after(result)["own-left"]!.average).toBe(171);
    expect(after(result)["own-right"]!.average).toBe(100);
    expect(find(result, "own-left", "Yawn")[0].facts).toEqual([{ text: "Falls asleep.", chance: 1 }]);
    expect(find(result, "own-right", "Lum Berry")[0].facts).toEqual([{ text: "Cures its sleep.", chance: 1 }]);
    expect(find(result, "own-left", "Bad Dreams")[0]).toMatchObject({ other: "opponent-left", min: -29 });
  });

  it("perish: 1 faints after Leftovers, 3 counts down; Wish; E2 perish counts and volatiles", async () => {
    const input = await turn("scarlet_violet", [
      idle("snorlax", { hp: 200, item: "leftovers", carried: { perish: 1 } }), idle("gengar", { hp: 100, carried: { perish: 3, wish: 60 } }),
      idle("jolteon", { hp: 100, carried: { saltCure: true, aquaRing: true } }), idle("dragapult", { hp: 100 }),
    ]);
    const result = ready(calculateDoublesTurn(input));
    expect(after(result)["own-left"]).toMatchObject({ average: 0, koChance: 1 });
    expect(find(result, "own-left", "Perish Song")[0]).toMatchObject({ min: -214, max: -214, koChance: 1 });
    expect(find(result, "own-right", "Perish Song")[0].facts).toEqual([{ text: "Perish count 2.", chance: 1 }]);
    expect(after(result)["own-right"]!.average).toBe(135);
    expect(result.hp["own-right"]!.conditions).toEqual([{ text: "Perish count 3.", chance: 1 }]);
    expect(after(result)["own-right"]!.conditions).toEqual([{ text: "Perish count 2.", chance: 1 }]);
    expect(after(result)["opponent-left"]!.conditions).toEqual([{ text: "Salt Cure.", chance: 1 }, { text: "Aqua Ring.", chance: 1 }]);
    const outcomes = calculateDoublesOutcomes(input);
    if (outcomes.status !== "ready") throw new Error(outcomes.status);
    const [outcome] = outcomes.outcomes;
    expect(outcome.mons["own-right"]).toMatchObject({ volatiles: ["perishsong"], perishCount: 2 });
    expect(outcome.mons["opponent-left"]!.volatiles).toEqual(["aquaring", "saltcure"]);
    expect(outcome.mons["own-left"]!.volatiles).toBeUndefined();
  });

  it("after an Ally Switch, Leech Seed and Wish heal whoever stands at their position (ADDENDUM A6, A7)", async () => {
    // B40, B41: Farigiraf (195 HP) swaps into Venusaur's place and takes the seed's 22 HP, then the Wish's 77.
    const seeded = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      idle("venusaur", { hp: 100 }), { id: "farigiraf", ability: "armortail", move: "allyswitch", hp: 100 },
      idle("garchomp", { hp: 150, carried: { leechSeed: "own-left" } }), idle("jolteon", { hp: 100 }),
    ])));
    expect([after(seeded)["own-left"]!.average, after(seeded)["own-right"]!.average, after(seeded)["opponent-left"]!.average]).toEqual([100, 122, 128]);
    expect(find(seeded, "own-right", "Leech Seed")[0]).toMatchObject({ other: "opponent-left", min: 22 });
    const wished = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      idle("venusaur", { hp: 100, carried: { wish: 77 } }), { id: "farigiraf", ability: "armortail", move: "allyswitch", hp: 100 },
      idle("garchomp", { hp: 150 }), idle("jolteon", { hp: 100 }),
    ])));
    expect([after(wished)["own-left"]!.average, after(wished)["own-right"]!.average]).toEqual([100, 177]);
  });

  it("Micle Berry after every ordered residual: a Cheek Pouch holder heals (C18)", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [idle("dedenne", { ability: "cheekpouch", hp: 30, item: "micleberry" }), idle("gengar"), idle("jolteon"), idle("dragapult")])));
    expect(after(result)["own-left"]!.average).toBe(77);
    expect(residuals(result).map((entry) => [entry.effect, entry.min, entry.facts.map((fact) => fact.text)])).toEqual([["Micle Berry", null, ["Micle Berry: eaten."]], ["Cheek Pouch", 47, []]]);
  });

  it("Emergency Exit after a residual takes it to half: a fact", async () => {
    const result = ready(calculateDoublesTurn(await turn("ultra_sun_ultra_moon", [idle("golisopod", { ability: "emergencyexit", hp: 80, status: "brn" }), idle("gengar"), idle("jolteon"), idle("garchomp")])));
    expect(find(result, "own-left", "Emergency Exit")[0]).toMatchObject({ chance: 1, min: null, facts: [{ text: "Switches out after the turn.", chance: 1 }] });
  });

  it("Speed Boost and the Orbs: stages and statuses for the next turn, no damage this turn", async () => {
    const input = await turn("scarlet_violet", [idle("gliscor", { ability: "poisonheal", hp: 100, item: "toxicorb" }), idle("ursaring", { ability: "guts", hp: 100, item: "flameorb" }), idle("blaziken", { ability: "speedboost", hp: 100 }), idle("dragapult", { hp: 100 })]);
    const result = ready(calculateDoublesTurn(input));
    expect([after(result)["own-left"]!.average, after(result)["own-right"]!.average]).toEqual([100, 100]);
    expect(find(result, "own-left", "Toxic Orb")[0].facts).toEqual([{ text: "Is badly poisoned.", chance: 1 }]);
    expect(find(result, "opponent-left", "Speed Boost")[0].facts).toEqual([{ text: "Speed +1.", chance: 1 }]);
    const outcomes = calculateDoublesOutcomes(input);
    if (outcomes.status !== "ready") throw new Error(outcomes.status);
    expect(outcomes.outcomes[0].mons["own-left"]!.build.status).toBe("tox");
    expect(outcomes.outcomes[0].mons["opponent-left"]!.build.boosts.spe).toBe(1);
  });
});

describe("what the moves leave for the end of turn (SPEC §2.3, ADDENDUM §6.0)", () => {
  it("Fire Spin this turn traps and damages at this end of turn", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [{ id: "charizard", move: "firespin", target: "opponent-left" }, idle("gengar", { hp: 100 }), idle("snorlax"), idle("dragapult", { hp: 100 })])));
    expect(find(result, "opponent-left", "Fire Spin")[0]).toMatchObject({ other: "own-left", min: -29, max: -29 });
  });

  it("Psychic Noise as the last move: no Leftovers or Grassy Terrain heal; a Mental Herb holder uses the herb", async () => {
    const blocked = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      { id: "bronzong", move: "psychicnoise", target: "opponent-left" }, idle("gengar", { hp: 100 }), idle("garchomp", { item: "leftovers" }), idle("dragapult", { hp: 100 }),
    ], { terrain: "Grassy" })));
    expect(find(blocked, "opponent-left", "Leftovers")).toEqual([]);
    expect(find(blocked, "opponent-left", "Grassy Terrain")).toEqual([]);
    expect(after(blocked)["opponent-left"]!.conditions).toEqual([{ text: "Heal Block.", chance: 1 }]);
    const herb = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      { id: "bronzong", move: "psychicnoise", target: "opponent-left" }, idle("gengar", { hp: 100 }), idle("garchomp", { item: "mentalherb" }), idle("dragapult", { hp: 100 }),
    ], { terrain: "Grassy" })));
    expect(find(herb, "opponent-left", "Grassy Terrain").length).toBe(1);
  });

  it("Psychic Noise and a Sitrus Berry: Heal Block stops it at the hit's Update (pinned: the secondary comes first; ER21c)", async () => {
    const lowInput = await turn("scarlet_violet", [
      { id: "bronzong", move: "psychicnoise", target: "opponent-left" }, idle("gengar", { hp: 100 }), idle("garchomp", { item: "sitrusberry", hp: 100 }), idle("dragapult", { hp: 100 }),
    ]);
    const low = ready(calculateDoublesTurn(lowInput));
    expect(low.hp["opponent-left"]!.heals).toEqual([]);
    expect(low.hp["opponent-left"]!.max).toBeLessThan(100);
    expect(after(low)["opponent-left"]!.conditions).toEqual([{ text: "Heal Block.", chance: 1 }]);
    expect(find(low, "opponent-left", "Sitrus Berry")).toEqual([]);
    const lowOutcomes = calculateDoublesOutcomes(lowInput);
    if (lowOutcomes.status !== "ready") throw new Error(lowOutcomes.status);
    for (const outcome of lowOutcomes.outcomes) expect(outcome.mons["opponent-left"]!.build.itemId).toBe("sitrusberry");
    // Well above half after the hit: the Berry stays, and Heal Block keeps it from the final Update.
    const high = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      { id: "bronzong", move: "psychicnoise", target: "opponent-left" }, idle("gengar", { hp: 100 }), idle("garchomp", { item: "sitrusberry" }), idle("dragapult", { hp: 100 }),
    ])));
    expect(after(high)["opponent-left"]!.conditions).toEqual([{ text: "Heal Block.", chance: 1 }]);
    expect(find(high, "opponent-left", "Sitrus Berry")).toEqual([]);
  });

  it("a side with no Pokémon left to switch in wiped out during the moves ends the battle: no later action runs (checkWin)", async () => {
    const slots: [P, P, P, P] = [
      { id: "garchomp", move: "rockslide" }, { id: "snorlax", move: "earthquake" }, idle("gengar", { hp: 1 }), idle("jolteon", { hp: 1 }),
    ];
    const ended = ready(calculateDoublesTurn(await turn("scarlet_violet", slots, {}, { canSwitch: { own: true, opponent: false } })));
    const quake = ended.steps.find((step) => step.slot === "own-right")!;
    expect(quake.skipped).toEqual([{ text: "The battle ends before it moves.", chance: 1 }]);
    expect(ended.hp["own-left"]!.max).toBe(ended.hp["own-left"]!.start);
    // With a Pokémon left to send in, the battle goes on and Earthquake hits Garchomp.
    const goesOn = ready(calculateDoublesTurn(await turn("scarlet_violet", slots, {}, { canSwitch: { own: true, opponent: true } })));
    expect(goesOn.hp["own-left"]!.max).toBeLessThan(goesOn.hp["own-left"]!.start);
  });

  it("Rapid Spin ends its user's Leech Seed (C16)", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      idle("venusaur", { hp: 100 }), idle("gengar", { hp: 100 }), idle("jolteon", { hp: 100 }), { id: "forretress", move: "rapidspin", target: "own-left", hp: 100, carried: { leechSeed: "own-left" } },
    ])));
    expect(find(result, "opponent-right", "Leech Seed")).toEqual([]);
  });

  it("Ceaseless Edge as the last move: Spikes on the foes' side in E2", async () => {
    const input = await turn("scarlet_violet", [idle("snorlax"), idle("gengar"), idle("jolteon"), { id: "samurotthisui", move: "ceaselessedge", target: "own-left" }]);
    const outcomes = calculateDoublesOutcomes(input);
    if (outcomes.status !== "ready") throw new Error(outcomes.status);
    for (const outcome of outcomes.outcomes) expect(outcome.sides.own.hazards).toEqual(["spikes"]);
  });

  it("Dig as the last move: no sand underground, no Grassy heal; Fly takes the sand", async () => {
    const dig = ready(calculateDoublesTurn(await turn("scarlet_violet", [{ id: "ariados", move: "dig", target: "opponent-left", hp: 100 }, idle("gengar"), idle("jolteon"), idle("dragapult")], { weather: "Sand", terrain: "Grassy" })));
    expect(find(dig, "own-left", "Sandstorm")).toEqual([]);
    expect(find(dig, "own-left", "Grassy Terrain")).toEqual([]);
    const fly = ready(calculateDoublesTurn(await turn("scarlet_violet", [{ id: "charizard", move: "fly", target: "opponent-left", hp: 100 }, idle("gengar"), idle("jolteon"), idle("dragapult")], { weather: "Sand" })));
    expect(find(fly, "own-left", "Sandstorm")[0]).toMatchObject({ min: -9 });
  });
});

describe("end of turn not estimated: the moves stay estimated (SPEC §2.3)", () => {
  it("a switch-out as the last action", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [{ id: "spidops", move: "uturn", target: "opponent-left" }, idle("gengar"), idle("garchomp"), idle("jolteon")])));
    expect(result.endOfTurn).toEqual({ status: "not-estimated", reason: "Spidops switches out: the replacement is not known." });
    expect(result.steps[0].hits[0].kind).toBe("calculated");
    const outcomes = calculateDoublesOutcomes(await turn("scarlet_violet", [{ id: "spidops", move: "uturn", target: "opponent-left" }, idle("gengar"), idle("garchomp"), idle("jolteon")]));
    expect(outcomes).toMatchObject({ status: "ready", endOfTurn: { notEstimated: "Spidops switches out: the replacement is not known." } });
  });

  it("carried Future Sight and Cud Chew; a Harvest holder with no item; a form line", async () => {
    const cases: [P, string][] = [
      [idle("snorlax", { hp: 100, carried: { futureMove: "futuresight" } }), "Future Sight landing is not modelled in 2v2."],
      [idle("farigiraf", { ability: "cudchew", hp: 100, carried: { cudChew: true } }), "Cud Chew is not modelled in 2v2."],
      [idle("exeggutor", { ability: "harvest", hp: 100 }), "Harvest is not modelled in 2v2."],
      // Minior's Meteor Form above half; Leech Seed takes it to half or below, where it would become its Core at order 29.
      [idle("minior", { ability: "shieldsdown", hp: 70, carried: { leechSeed: "opponent-left" } }), "Shields Down changing Minior's form is not modelled in 2v2."],
    ];
    for (const [mon, reason] of cases) {
      const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [mon, idle("gengar"), idle("jolteon"), idle("dragapult")])));
      expect(result.endOfTurn, mon.id).toEqual({ status: "not-estimated", reason });
    }
  });

  it("a weather from before with one turn left that the moves set again after another goes on with its new duration (EOT-1)", async () => {
    // RV01: Sunny Day replaces the rain, then Rain Dance sets a new one (duration 5: pinned Showdown counts it to 4 and Rain
    // Dish heals Tentacruel 155/16 = 9, 100 → 109). World.weatherSet records that the moves set it.
    const slots = (left: string | null, right: string | null, extra: Partial<P> = {}): [P, P, P, P] => [
      { id: "charizard", move: left, ...extra }, { id: "pelipper", ability: "keeneye", move: right }, idle("tentacruel", { ability: "raindish", hp: 100 }), idle("snorlax", { hp: 150 }),
    ];
    const both = await turn("scarlet_violet", slots("sunnyday", "raindance"), { weather: "Rain" }, { weatherTurns: 1 });
    const result = ready(calculateDoublesTurn(both));
    expect(result.endOfTurn).toMatchObject({ status: "ready", facts: [] });
    expect(after(result)["opponent-left"]).toMatchObject({ min: 109, max: 109 });
    expect(result.facts.some((fact) => fact.includes("does not end"))).toBe(false);
    const outcomes = calculateDoublesOutcomes(both);
    expect(outcomes).toMatchObject({ status: "ready", endOfTurn: "applied" });
    expect(outcomes.status === "ready" ? outcomes.outcomes.map((outcome) => outcome.field.weather) : outcomes).toEqual(["Rain"]);
    // VE04: Charizard asleep never uses Sunny Day, so Rain Dance fails and the rain from before ends (no Rain Dish).
    const asleep = ready(calculateDoublesTurn(await turn("scarlet_violet", slots("sunnyday", "raindance", { status: "slp", carried: { sleep: { attempts: 0, rest: true } } }), { weather: "Rain" }, { weatherTurns: 1 })));
    expect(asleep.endOfTurn).toMatchObject({ status: "ready", facts: ["Rain ends."] });
    expect(after(asleep)["opponent-left"]!.average).toBe(100);
    // Rain Dance alone fails (the rain is up): the rain from before ends, no Rain Dish.
    const alone = ready(calculateDoublesTurn(await turn("scarlet_violet", slots(null, "raindance"), { weather: "Rain" }, { weatherTurns: 1 })));
    expect(alone.endOfTurn).toMatchObject({ status: "ready", facts: ["Rain ends."] });
    expect(after(alone)["opponent-left"]!.average).toBe(100);
    // Sunny Day alone: a new sun (duration 5) goes on; nothing to state.
    const sun = ready(calculateDoublesTurn(await turn("scarlet_violet", slots("sunnyday", null), { weather: "Rain" }, { weatherTurns: 1 })));
    expect(sun.endOfTurn).toMatchObject({ status: "ready", facts: [] });
    expect(sun.facts.some((fact) => fact.includes("does not end"))).toBe(false);
  });

  it("Harvest and Pickup after a Berry eaten at the weather's Update (EOT-2)", async () => {
    // RV21: Exeggutor eats its Sitrus at the sand's Update; Harvest (28.2) may restore it (pinned: 80 or 122 at 1/2 each).
    const harvest = await turn("scarlet_violet", [
      idle("exeggutor", { ability: "harvest", item: "sitrusberry", hp: 90, status: "psn", carried: { saltCure: true } }), idle("venusaur"), idle("jolteon"), idle("snorlax"),
    ], { weather: "Sand" }, { weatherTurns: 3 });
    expect(ready(calculateDoublesTurn(harvest)).endOfTurn).toEqual({ status: "not-estimated", reason: "Harvest is not modelled in 2v2." });
    expect(calculateDoublesOutcomes(harvest)).toMatchObject({ status: "ready", endOfTurn: { notEstimated: "Harvest is not modelled in 2v2." } });
    // RV22: Snorlax eats its Sitrus at the sand's Update; Ambipom (Pickup, no item) takes it at 28.2 (pinned: 75 → 103).
    const pickup = (snorlaxHP: number) => turn("scarlet_violet", [
      idle("snorlax", { hp: snorlaxHP, item: "sitrusberry" }), idle("ambipom", { ability: "pickup", hp: 75 }), idle("jolteon"), idle("garchomp"),
    ], { weather: "Sand" }, { weatherTurns: 3 });
    expect(ready(calculateDoublesTurn(await pickup(120))).endOfTurn).toEqual({ status: "not-estimated", reason: "Pickup is not modelled in 2v2." });
    // Snorlax stays above half (no Berry eaten): Pickup finds nothing, the end of turn is applied.
    const kept = ready(calculateDoublesTurn(await pickup(200)));
    expect(after(kept)["own-right"]!.average).toBe(75 - 9);
  });

  it("states that the weather from before goes on when Hydration's cure or Leaf Guard rely on it (EOT-3)", async () => {
    const fact = (weather: "Rain" | "Sun") => `Assumes the ${weather} does not end this turn.`;
    const cases: [P, "Rain" | "Sun"][] = [
      // RT01: Hydration cures the burn in the rain (with the rain ending at order 1 it would keep it and lose 12).
      [idle("vaporeon", { ability: "hydration", status: "brn", hp: 150 }), "Rain"],
      // RT02, RT04: Leaf Guard in the sun stops a carried Yawn's sleep, a Flame Orb's burn.
      [idle("leafeon", { ability: "leafguard", carried: { yawn: true } }), "Sun"],
      [idle("leafeon", { ability: "leafguard", item: "flameorb" }), "Sun"],
    ];
    for (const [mon, weather] of cases) {
      const others: [P, P, P] = [idle("venusaur"), idle("jolteon"), idle("snorlax")];
      const open = ready(calculateDoublesTurn(await turn("scarlet_violet", [mon, ...others], { weather })));
      expect(open.facts, mon.id).toContain(fact(weather));
      expect(after(open)["own-left"]!.average, mon.id).toBe(mon.hp ?? 140);
      // With its turns given there is nothing to assume.
      const given = ready(calculateDoublesTurn(await turn("scarlet_violet", [mon, ...others], { weather }, { weatherTurns: 3 })));
      expect(given.facts, mon.id).not.toContain(fact(weather));
    }
    // Leaf Guard in the sun with no status to stop: no fact.
    const quiet = ready(calculateDoublesTurn(await turn("scarlet_violet", [idle("leafeon", { ability: "leafguard" }), idle("venusaur"), idle("jolteon"), idle("snorlax")], { weather: "Sun" })));
    expect(quiet.facts).not.toContain(fact("Sun"));
  });

  it("Roost's volatile ends at order 25: a Flame or Toxic Orb under Misty Terrain at 28.3 finds its holder ungrounded", async () => {
    // FX01, FX02 (pinned: brn, tox at 100%): grounded by Roost for Grassy Terrain at 5.2 (RV09), not for the Orbs.
    for (const [id, item, hp, status] of [["corviknight", "flameorb", 100, "brn"], ["talonflame", "toxicorb", 80, "tox"]] as const) {
      const input = await turn("scarlet_violet", [{ id, item, hp, move: "roost" }, idle("venusaur"), idle("jolteon"), idle("snorlax")], { terrain: "Misty" });
      const result = ready(calculateDoublesTurn(input));
      expect(find(result, "own-left", id === "corviknight" ? "Flame Orb" : "Toxic Orb").map((entry) => entry.facts.map((fact) => fact.text)), id).toEqual([[status === "brn" ? "Is burned." : "Is badly poisoned."]]);
      const outcomes = calculateDoublesOutcomes(input);
      expect(outcomes.status === "ready" ? outcomes.outcomes.map((outcome) => outcome.mons["own-left"]!.build.status) : outcomes, id).toEqual([status]);
    }
  });

  it("states that Misty Terrain and Gravity from before go on when they stop an Orb's status (order 27, before 28.3)", async () => {
    // Pinned (build/fix-eot-misty-probe.ts): Misty Terrain with one turn left ends at 27 and Snorlax is burned at 28.3;
    // Gravity with one turn left ends at 27 and Corviknight, ungrounded, is burned in Misty Terrain.
    const misty = ready(calculateDoublesTurn(await turn("scarlet_violet", [idle("snorlax", { item: "flameorb" }), idle("venusaur"), idle("jolteon"), idle("garchomp")], { terrain: "Misty" })));
    expect(misty.facts).toContain("Assumes the Misty Terrain does not end this turn.");
    expect(find(misty, "own-left", "Flame Orb")).toEqual([]);
    const gravity = ready(calculateDoublesTurn(await turn("scarlet_violet", [idle("corviknight", { item: "flameorb" }), idle("venusaur"), idle("jolteon"), idle("garchomp")], { terrain: "Misty", gravity: true })));
    expect(gravity.facts).toEqual(expect.arrayContaining(["Assumes the Misty Terrain does not end this turn.", "Assumes Gravity does not end this turn."]));
    // Misty Terrain set this turn lasts five turns: nothing to assume.
    const set = ready(calculateDoublesTurn(await turn("scarlet_violet", [idle("snorlax", { item: "flameorb" }), idle("venusaur"), { id: "sylveon", move: "mistyterrain" }, idle("garchomp")])));
    expect(set.facts.some((fact) => fact.includes("does not end"))).toBe(false);
    expect(find(set, "own-left", "Flame Orb")).toEqual([]);
  });

  it("states that Magic Room from before goes on when an item would act after its countdown (order 27.6)", async () => {
    // Pinned (build/verify-eot-probes/field-end-probe.ts, every game): with one turn left the room ends at 27.6, then a
    // Flame Orb burns and Sticky Barb hurts (28.3), White Herb restores (29), and the final Update eats a due Sitrus or a
    // curing Lum Berry. With five left none of them acts, as the app shows.
    const fact = "Assumes Magic Room does not end this turn.";
    const others: [P, P, P] = [idle("venusaur"), idle("jolteon"), idle("garchomp")];
    for (const mon of [idle("snorlax", { item: "flameorb" }), idle("snorlax", { item: "stickybarb", hp: 200 }), idle("snorlax", { item: "sitrusberry", hp: 100 }),
      idle("snorlax", { item: "lumberry", status: "brn", hp: 200 })]) {
      const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [mon, ...others], { magicRoom: true })));
      expect(result.facts, mon.item).toContain(fact);
      expect(result.endOfTurn.status, mon.item).toBe("ready");
    }
    // Champions: a Sitrus at its line.
    const champions = ready(calculateDoublesTurn(await turn("champions", [idle("snorlax", { item: "sitrusberry", hp: 100 }), idle("venusaur"), idle("garchomp"), idle("charizard")], { magicRoom: true })));
    expect(champions.facts).toContain(fact);
    // Leftovers (5.4, before the countdown) and a Sitrus above its line: nothing after 27.6 reads an item.
    for (const mon of [idle("snorlax", { item: "leftovers", hp: 100 }), idle("snorlax", { item: "sitrusberry", hp: 200 })]) {
      const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [mon, ...others], { magicRoom: true })));
      expect(result.facts, mon.item).not.toContain(fact);
    }
    // No Magic Room: the items act, nothing to assume.
    const open = ready(calculateDoublesTurn(await turn("scarlet_violet", [idle("snorlax", { item: "flameorb" }), ...others])));
    expect(open.facts).not.toContain(fact);
    expect(find(open, "own-left", "Flame Orb").length).toBe(1);
  });

  it("Moody: a fact in the calculator, not estimated in E2", async () => {
    const input = await turn("scarlet_violet", [idle("glalie", { ability: "moody" }), idle("gengar"), idle("jolteon"), idle("dragapult")]);
    const result = ready(calculateDoublesTurn(input));
    expect(result.endOfTurn.status).toBe("ready");
    expect(result.facts).toContain("Moody raises one stat and lowers another.");
    expect(calculateDoublesOutcomes(input)).toMatchObject({ status: "ready", endOfTurn: { notEstimated: "Moody is not modelled in 2v2." } });
  });
});
