import { describe, expect, it, vi } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn, DOUBLES_REFERENCE } from "@/app/lib/battle/doubles-turn";
import type {
  DoublesCarried, DoublesHP, DoublesOutcomesResult, DoublesPokemonInput, DoublesResidual, DoublesSlotId, DoublesTurnInput, DoublesTurnResult,
} from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions, BattleGame, BattleStatus, CombatStat } from "@/app/lib/battle/types";

// status2 E1: Harvest and Pickup read the turn's item history, which the kernel keeps only while Track D's tracksItems says
// a reader is in the turn (SPEC2 §4.9; §4.4: a Harvest or Pickup holder is one). D's own rule is kept; this adds the two
// holders so these tests do not depend on that track's progress.
vi.mock("@/app/lib/battle/doubles-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/battle/doubles-guards")>();
  return {
    ...actual,
    tracksItems: (input: DoublesTurnInput) => actual.tracksItems(input)
      || Object.values(input.pokemon).some((entry) => !!entry && (entry.build.abilityId === "harvest" || entry.build.abilityId === "pickup")),
  };
});

/**
 * The 2v2 end of turn (status-eot SPEC §2.3, §4.7, §4.9; ADDENDUM §2.3, C16, C18): one residual phase on every finished
 * world in pinned Showdown c23d2e94's fieldEvent('Residual') order. The numbers were checked against the pinned simulator
 * (scripts/.cache/calc-audit/status-eot/build/trackb-check.ts, cases B01–B39). Level 50, 31 IVs, 0 EVs: maximum HP is
 * base HP + 75, Speed base Speed + 20.
 */
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
type P = {
  id: string; ability?: string; item?: string; status?: BattleStatus; hp?: number; move?: string | null; target?: DoublesSlotId | null; carried?: DoublesCarried;
  // status2: Speed EVs (native games) or Stat Points (Champions), stages, the item used before this turn, earlier this turn, a switch-in.
  spe?: number; boosts?: Partial<Record<CombatStat, number>>; lastItem?: string | null; earlier?: DoublesPokemonInput["earlierThisTurn"]; switchedIn?: true;
  // status2 E2: a nature, Sp. Atk EVs (Stat Points in Champions), and build fields as given (a mechanic, a configuration).
  nature?: string; spa?: number; build?: Partial<BattleBuild>;
};
const idle = (id: string, extra: Partial<P> = {}): P => ({ id, move: null, ...extra });
/** A Pokémon's build for `p` (turn's; also a landing's user not in battle). */
function buildFor(runtime: BattleRuntime, p: P): BattleBuild {
  const base = createBuild(p.id, runtime);
  const abilityId = p.ability ?? base.abilityId;
  const ev = { ...(p.spe !== undefined ? { spe: p.spe } : {}), ...(p.spa !== undefined ? { spa: p.spa } : {}) };
  const stats = !Object.keys(ev).length ? {} : base.game === "champions" ? { points: { ...base.points, ...ev } } : { native: { ...base.native!, evs: { ...base.native!.evs, ...ev } } };
  return {
    ...base, ...stats, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "", status: p.status ?? "", currentHP: p.hp ?? null,
    ...(p.boosts ? { boosts: { ...base.boosts, ...p.boosts } } : {}), ...(p.nature ? { nature: p.nature } : {}), ...p.build,
  } as BattleBuild;
}
async function turn(game: BattleGame, slots: [P | null, P | null, P | null, P | null], field: Partial<BattleConditions> = {}, extra: Partial<DoublesTurnInput> = {}): Promise<DoublesTurnInput> {
  const runtime: BattleRuntime = await loadBattleRuntime(game);
  const pokemon = Object.fromEntries(SLOTS.map((slot, index) => {
    const p = slots[index];
    if (!p) return [slot, null];
    const build = buildFor(runtime, p);
    const entry: DoublesPokemonInput = {
      build, contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}),
      ...(p.lastItem !== undefined ? { lastItem: p.lastItem } : {}), ...(p.earlier ? { earlierThisTurn: p.earlier } : {}), ...(p.switchedIn ? { switchedIn: true } : {}),
    };
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

  it("a landing given as a bare move id; Cud Chew's Berry not given; a Harvest holder with no item (status2 E2: narrow input reasons)", async () => {
    const cases: [P, string][] = [
      // status2 E2 (C33): a bare id names no user; `cudChew: true` names no Berry.
      [idle("snorlax", { hp: 100, carried: { futureMove: "futuresight" } }), "Future Sight landing needs its user."],
      [idle("farigiraf", { ability: "cudchew", hp: 100, carried: { cudChew: true } }), "Cud Chew needs Farigiraf's Berry from the last turn."],
      // status2 E1 (Q4): a Harvest holder with no item, no Berry this turn and its item from an earlier turn not given.
      [idle("exeggutor", { ability: "harvest", hp: 100 }), "Harvest needs Exeggutor's item from an earlier turn."],
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

  it("Harvest and Pickup after a Berry eaten at the weather's Update (EOT-2; status2 E1: modelled)", async () => {
    // RV21: Exeggutor eats its Sitrus at the sand's Update; Harvest (28.2) restores it at 1/2 and the final Update eats it
    // again (pinned: 80 or 122 at 1/2 each).
    const harvest = await turn("scarlet_violet", [
      idle("exeggutor", { ability: "harvest", item: "sitrusberry", hp: 90, status: "psn", carried: { saltCure: true } }), idle("venusaur"), idle("jolteon"), idle("snorlax"),
    ], { weather: "Sand" }, { weatherTurns: 3 });
    const restored = ready(calculateDoublesTurn(harvest));
    expect(after(restored)["own-left"]).toMatchObject({ min: 80, max: 122, average: 101 });
    expect(find(restored, "own-left", "Harvest")).toEqual([{ slot: "own-left", effect: "Harvest", chance: 0.5, min: null, max: null, koChance: 0, facts: [{ text: "Harvest: Sitrus Berry back.", chance: 0.5 }] }]);
    expect(calculateDoublesOutcomes(harvest)).toMatchObject({ status: "ready", endOfTurn: "applied" });
    // RV22: Snorlax eats its Sitrus at the sand's Update; Ambipom (Pickup, no item) takes it at 28.2 and eats it at the final
    // Update (pinned: 75 → 103).
    const pickup = (snorlaxHP: number) => turn("scarlet_violet", [
      idle("snorlax", { hp: snorlaxHP, item: "sitrusberry" }), idle("ambipom", { ability: "pickup", hp: 75 }), idle("jolteon"), idle("garchomp"),
    ], { weather: "Sand" }, { weatherTurns: 3 });
    const picked = ready(calculateDoublesTurn(await pickup(120)));
    expect(after(picked)["own-right"]).toMatchObject({ min: 103, max: 103 });
    expect(find(picked, "own-right", "Pickup")[0]).toMatchObject({ other: "own-left", chance: 1, facts: [{ text: "Pickup: picks up Sitrus Berry.", chance: 1 }] });
    // Snorlax stays above half (no Berry eaten): Pickup finds nothing.
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

  it("Moody: modelled (status2 E2; its tests below), the old fact gone", async () => {
    const input = await turn("scarlet_violet", [idle("glalie", { ability: "moody" }), idle("gengar"), idle("jolteon"), idle("dragapult")]);
    const result = ready(calculateDoublesTurn(input));
    expect(result.endOfTurn.status).toBe("ready");
    expect(result.facts).not.toContain("Moody raises one stat and lowers another.");
    expect(calculateDoublesOutcomes(input)).toMatchObject({ status: "ready", endOfTurn: "applied" });
  });
});

// ------------------------------------------------------------------------------------------------------------------
// status2 Track E1 (SPEC2 §4.6, ADDENDUM2 §4.1 step 8). Every number is pinned Showdown c23d2e94's through the verify
// harness: scripts/.cache/calc-audit/status2/build/e1-probes.ts (its case ids in brackets), e1-probes.out.
// ------------------------------------------------------------------------------------------------------------------

type ReadyOutcomes = Extract<DoublesOutcomesResult, { status: "ready" }>;
function outcomesOf(input: DoublesTurnInput): ReadyOutcomes {
  const outcomes = calculateDoublesOutcomes(input);
  expect(outcomes.status, JSON.stringify(outcomes)).toBe("ready");
  return outcomes as ReadyOutcomes;
}
type OutcomeMon = NonNullable<ReadyOutcomes["outcomes"][number]["mons"][DoublesSlotId]>;
/** The chance over E2's outcomes that `test` holds for `slot`. */
const share = (outcomes: ReadyOutcomes, slot: DoublesSlotId, test: (mon: OutcomeMon) => boolean) =>
  outcomes.outcomes.reduce((sum, outcome) => sum + (outcome.mons[slot] && test(outcome.mons[slot]!) ? outcome.chance : 0), 0);

describe("status2 E1: Nightmare (11)", () => {
  it("takes 1/4 of a sleeping or Comatose Pokémon's base maximum HP; Magic Guard none [E1-NM-01]", async () => {
    const input = await turn("ultra_sun_ultra_moon", [
      idle("snorlax", { spe: 4, status: "slp", carried: { sleep: { attempts: 0, rest: false }, nightmare: true } }), idle("komala", { ability: "comatose", carried: { nightmare: true } }),
      idle("clefable", { ability: "magicguard", status: "slp", carried: { sleep: { attempts: 0, rest: false }, nightmare: true } }), idle("snorlax", { spe: 12 }),
    ]);
    const result = ready(calculateDoublesTurn(input));
    expect([after(result)["own-left"]!.average, after(result)["own-right"]!.average, after(result)["opponent-left"]!.average]).toEqual([177, 105, 170]);
    expect(find(result, "own-left", "Nightmare")[0]).toMatchObject({ chance: 1, min: -58, max: -58 });
    expect(find(result, "own-right", "Nightmare")[0]).toMatchObject({ min: -35 });
    expect(find(result, "opponent-left", "Nightmare")).toEqual([]);
    expect(after(result)["own-left"]!.conditions).toEqual([{ text: "Nightmare.", chance: 1 }]);
    const outcomes = outcomesOf(input);
    for (const slot of ["own-left", "own-right", "opponent-left"] as const) expect(share(outcomes, slot, (mon) => !!mon.volatiles?.includes("nightmare")), slot).toBe(1);
  });

  it("ends with the sleep: Healer's cure at 5.3 (3/10) leaves no Nightmare at 11 (CR11) [E1-NM-02]", async () => {
    const input = await turn("ultra_sun_ultra_moon", [
      idle("snorlax", { spe: 4, status: "slp", carried: { sleep: { attempts: 0, rest: false }, nightmare: true } }), idle("audino", { ability: "healer" }),
      idle("snorlax", { spe: 8 }), idle("snorlax", { spe: 12 }),
    ]);
    const result = ready(calculateDoublesTurn(input));
    expect(after(result)["own-left"]).toMatchObject({ min: 177, max: 235 });
    expect(after(result)["own-left"]!.average).toBeCloseTo(194.4, 9);
    expect(find(result, "own-left", "Nightmare")[0]).toMatchObject({ min: -58 });
    expect(find(result, "own-left", "Nightmare")[0].chance).toBeCloseTo(0.7, 12);
    const outcomes = outcomesOf(input);
    expect(share(outcomes, "own-left", (mon) => !!mon.volatiles?.includes("nightmare"))).toBeCloseTo(0.7, 12);
    expect(share(outcomes, "own-left", (mon) => mon.build.status === "slp")).toBeCloseTo(0.7, 12);
  });
});

describe("status2 E1: Octolock (14)", () => {
  it("lowers Defense and Sp. Def from its source; Defiant +2 per stat; the source's ally's Opportunist copies +4 at 29 (CR05, C9) [E1-OCT-01]", async () => {
    const input = await turn("champions", [idle("grapploct", { ability: "limber" }), idle("espathra", { ability: "opportunist" }), idle("kingambit", { ability: "defiant", carried: { octolock: "own-left" } }), idle("snorlax", { spe: 12 })]);
    const result = ready(calculateDoublesTurn(input));
    expect(find(result, "opponent-left", "Octolock")).toEqual([{
      slot: "opponent-left", effect: "Octolock", other: "own-left", chance: 1, min: null, max: null, koChance: 0,
      facts: [{ text: "Attack +4.", chance: 1 }, { text: "Defense −1.", chance: 1 }, { text: "Sp. Def −1.", chance: 1 }],
    }]);
    expect(find(result, "own-right", "Opportunist")[0].facts).toEqual([{ text: "copies +4 Attack.", chance: 1 }]);
    expect(after(result)["opponent-left"]!.conditions).toEqual([{ text: "Octolock.", chance: 1 }]);
    const [outcome] = outcomesOf(input).outcomes;
    expect(outcome.mons["opponent-left"]!.build.boosts).toMatchObject({ atk: 4, def: -1, spd: -1 });
    expect(outcome.mons["opponent-left"]!.volatiles).toEqual(["octolock"]);
    expect(outcome.mons["own-right"]!.build.boosts.atk).toBe(4);
    expect(outcome.mons["own-right"]!.pendingCopy).toBeUndefined();
  });

  it("Mirror Armor sends the drop back to the source; Clear Body stops it; the lock stays (TV18c) [E1-OCT-02]", async () => {
    const input = await turn("sword_shield", [
      idle("grapploct", { ability: "limber" }), idle("snorlax", { spe: 4 }), idle("corviknight", { ability: "mirrorarmor", carried: { octolock: "own-left" } }),
      idle("metagross", { ability: "clearbody", carried: { octolock: "own-left" } }),
    ]);
    const [outcome] = outcomesOf(input).outcomes;
    expect(outcome.mons["own-left"]!.build.boosts).toMatchObject({ def: -1, spd: -1 });
    expect(outcome.mons["opponent-left"]!.build.boosts).toMatchObject({ def: 0, spd: 0 });
    expect(outcome.mons["opponent-right"]!.build.boosts).toMatchObject({ def: 0, spd: 0 });
    expect(outcome.mons["opponent-right"]!.volatiles).toEqual(["octolock"]);
    const result = ready(calculateDoublesTurn(input));
    expect(find(result, "own-left", "Octolock")[0]).toMatchObject({ other: "opponent-left", facts: [{ text: "Defense −1.", chance: 1 }, { text: "Sp. Def −1.", chance: 1 }] });
  });

  it("ends silently once its source fainted (TV18b); a White Herb restores the drop at 29, not at 14 [E1-OCT-03]", async () => {
    const input = await turn("sword_shield", [
      idle("grapploct", { ability: "limber", hp: 1, spe: 252 }), idle("grapploct", { ability: "limber" }),
      idle("snorlax", { carried: { octolock: "own-left" } }), idle("snorlax", { item: "whiteherb", carried: { octolock: "own-right" } }),
    ], { weather: "Sand" }, { weatherTurns: 3 });
    const result = ready(calculateDoublesTurn(input));
    expect(find(result, "opponent-left", "Octolock")).toEqual([]);
    expect(find(result, "opponent-right", "White Herb")[0].facts).toEqual([{ text: "Restores its lowered stats.", chance: 1 }]);
    const [outcome] = outcomesOf(input).outcomes;
    expect(outcome.mons["opponent-left"]!.volatiles).toBeUndefined();
    expect(outcome.mons["opponent-right"]!.build).toMatchObject({ itemId: "", boosts: { def: 0, spd: 0 } });
  });
});

describe("status2 E1: Telekinesis (19), Heal Block (20), Embargo (21) count down (C3, C4)", () => {
  const sitrus = (game: BattleGame, carried: DoublesCarried, item = "sitrusberry") => turn(game, [
    idle("snorlax", { spe: 4 }), idle("snorlax", { spe: 8 }), idle("snorlax", { spe: 12, hp: 130, item, carried }), idle("snorlax", { spe: 16 }),
  ], { weather: "Sand" }, { weatherTurns: 3 });

  it("Heal Block with 1 turn left ends at 20: the final Update eats a Sitrus Berry (CR01); 2 left: kept, 1 left after; Leftovers (5.4) still none [E1-HB-01..03]", async () => {
    const ends = ready(calculateDoublesTurn(await sitrus("scarlet_violet", { healBlock: 1 })));
    expect(after(ends)["opponent-left"]!.average).toBe(174);
    expect(find(ends, "opponent-left", "Heal Block ends")).toEqual([{ slot: "opponent-left", effect: "Heal Block ends", chance: 1, min: null, max: null, koChance: 0, facts: [] }]);
    expect(find(ends, "opponent-left", "Sitrus Berry")[0]).toMatchObject({ min: 58, max: 58 });
    const stays = await sitrus("scarlet_violet", { healBlock: 2 });
    expect(after(ready(calculateDoublesTurn(stays)))["opponent-left"]!.average).toBe(116);
    const [outcome] = outcomesOf(stays).outcomes;
    expect(outcome.mons["opponent-left"]).toMatchObject({ turnsLeft: { healblock: 1 }, build: { itemId: "sitrusberry" } });
    expect(after(ready(calculateDoublesTurn(await sitrus("scarlet_violet", { healBlock: 1 }, "leftovers"))))["opponent-left"]!.average).toBe(116);
  });

  it("Embargo with 1 turn left ends at 21: its item works again for the final Update (CR02) and the Orbs at 28.3; 2 left: none [E1-EM-01..04]", async () => {
    const ends = ready(calculateDoublesTurn(await sitrus("ultra_sun_ultra_moon", { embargo: 1 })));
    expect(after(ends)["opponent-left"]!.average).toBe(174);
    expect(find(ends, "opponent-left", "Embargo ends").length).toBe(1);
    const stays = await sitrus("ultra_sun_ultra_moon", { embargo: 2 });
    expect(after(ready(calculateDoublesTurn(stays)))["opponent-left"]!.average).toBe(116);
    expect(outcomesOf(stays).outcomes[0].mons["opponent-left"]).toMatchObject({ turnsLeft: { embargo: 1 }, volatiles: ["embargo"], build: { itemId: "sitrusberry", itemSuppressed: true } });
    expect(after(ready(calculateDoublesTurn(await sitrus("ultra_sun_ultra_moon", { embargo: 1 }, "leftovers"))))["opponent-left"]!.average).toBe(116);
    const orbs = await turn("ultra_sun_ultra_moon", [
      idle("snorlax", { spe: 4 }), idle("snorlax", { spe: 8 }), idle("snorlax", { spe: 12, item: "flameorb", carried: { embargo: 1 } }), idle("snorlax", { spe: 16, item: "flameorb", carried: { embargo: 2 } }),
    ]);
    const [orbed] = outcomesOf(orbs).outcomes;
    expect([orbed.mons["opponent-left"]!.build.status, orbed.mons["opponent-right"]!.build.status]).toEqual(["brn", ""]);
    expect(orbed.mons["opponent-left"]!.build.itemSuppressed).toBeUndefined();
  });

  it("Telekinesis with 1 turn left ends at 19: grounded again, Misty Terrain stops its Flame Orb at 28.3; 2 left: floating, burned [E1-TK-01]", async () => {
    const input = await turn("ultra_sun_ultra_moon", [
      idle("snorlax", { spe: 4 }), idle("snorlax", { spe: 8 }), idle("snorlax", { spe: 12, item: "flameorb", carried: { telekinesis: 1 } }),
      idle("snorlax", { spe: 16, item: "flameorb", carried: { telekinesis: 2 } }),
    ], { terrain: "Misty" });
    const result = ready(calculateDoublesTurn(input));
    expect(find(result, "opponent-left", "Telekinesis ends").length).toBe(1);
    expect(find(result, "opponent-left", "Flame Orb")).toEqual([]);
    expect(find(result, "opponent-right", "Flame Orb")[0].facts).toEqual([{ text: "Is burned.", chance: 1 }]);
    expect(result.facts).toContain("Assumes the Misty Terrain does not end this turn.");
    const [outcome] = outcomesOf(input).outcomes;
    expect(outcome.mons["opponent-right"]).toMatchObject({ turnsLeft: { telekinesis: 1 }, volatiles: ["telekinesis"] });
    expect(outcome.mons["opponent-left"]!.turnsLeft).toBeUndefined();
  });

  it("Psychic Noise's Heal Block (duration 2) has 1 turn left after this turn [E1-PN-01]", async () => {
    const input = await turn("scarlet_violet", [{ id: "bronzong", ability: "levitate", move: "psychicnoise", target: "opponent-left" }, idle("snorlax", { spe: 4 }), idle("garchomp", { ability: "roughskin" }), idle("snorlax", { spe: 12 })]);
    for (const outcome of outcomesOf(input).outcomes) expect(outcome.mons["opponent-left"]!.turnsLeft).toEqual({ healblock: 1 });
  });
});

describe("status2 E1: Leech Seed into a heal-blocked seeder with Liquid Ooze (F4 §4.16)", () => {
  // Venusaur (Speed EVs 156: 120; 252: 132) seeded Tentacruel (0 EVs: 120; 252: 152); Heal Block 3 turns on Venusaur.
  const ooze = (oozeSpe: number, seederSpe: number) => turn("ultra_sun_ultra_moon", [
    idle("venusaur", { ability: "overgrow", hp: 60, spe: seederSpe, carried: { healBlock: 3 } }), idle("snorlax", { spe: 4 }),
    idle("tentacruel", { ability: "liquidooze", spe: oozeSpe, carried: { leechSeed: "own-left" } }), idle("snorlax", { spe: 12 }),
  ]);
  it("the faster of Heal Block and Liquid Ooze acts first; at one Speed Heal Block's subOrder (a volatile's 2 before an ability's 7) [E1-LOZ-*]", async () => {
    const faster = ready(calculateDoublesTurn(await ooze(252, 156)));
    expect(after(faster)["own-left"]!.average).toBe(41);
    expect(find(faster, "own-left", "Liquid Ooze")[0]).toMatchObject({ other: "opponent-left", min: -19 });
    for (const [oozeSpe, seederSpe] of [[0, 252], [0, 156]]) {
      const result = ready(calculateDoublesTurn(await ooze(oozeSpe, seederSpe)));
      expect(after(result)["own-left"]!.average, `${oozeSpe}/${seederSpe}`).toBe(60);
      expect(find(result, "opponent-left", "Leech Seed")[0]).toMatchObject({ min: -19 });
      expect(find(result, "own-left", "Liquid Ooze")).toEqual([]);
    }
  });
});

describe("status2 E1: Opportunist and Mirror Herb at 29 (C9)", () => {
  it("Speed Boost (28.2) copied at 29 by a foe's Opportunist; the copy is not copied back by the other side's [E1-OPP-01, E1-OPP-03]", async () => {
    const one = await turn("scarlet_violet", [idle("blaziken", { ability: "speedboost" }), idle("snorlax", { spe: 4 }), idle("espathra", { ability: "opportunist" }), idle("snorlax", { spe: 12 })]);
    const result = ready(calculateDoublesTurn(one));
    expect(find(result, "opponent-left", "Opportunist")).toEqual([{ slot: "opponent-left", effect: "Opportunist", chance: 1, min: null, max: null, koChance: 0, facts: [{ text: "copies +1 Speed.", chance: 1 }] }]);
    expect(outcomesOf(one).outcomes[0].mons["opponent-left"]!.build.boosts.spe).toBe(1);
    const both = outcomesOf(await turn("scarlet_violet", [idle("blaziken", { ability: "speedboost" }), idle("espathra", { ability: "opportunist" }), idle("espathra", { ability: "opportunist" }), idle("snorlax", { spe: 12 })]));
    for (const outcome of both.outcomes) {
      expect(outcome.mons["opponent-left"]!.build.boosts.spe).toBe(1);
      expect(outcome.mons["own-right"]!.build.boosts.spe).toBe(0);
      expect(outcome.mons["own-right"]!.pendingCopy).toBeUndefined();
    }
  });

  it("a rise at the final Update stays pending into the next turn (A11): E2's pendingCopy and the card's condition [E1-OPP-02]", async () => {
    const input = await turn("scarlet_violet", [idle("snorlax", { ability: "thickfat", spe: 4, item: "liechiberry", hp: 70, status: "brn" }), idle("snorlax", { spe: 8 }), idle("espathra", { ability: "opportunist" }), idle("snorlax", { spe: 12 })]);
    const result = ready(calculateDoublesTurn(input));
    expect(find(result, "own-left", "Liechi Berry")[0].facts).toEqual([{ text: "Attack +1.", chance: 1 }]);
    expect(after(result)["opponent-left"]!.conditions).toEqual([{ text: "Opportunist: copies +1 Attack next turn.", chance: 1 }]);
    expect(result.hp["opponent-left"]!.conditions).toBeUndefined();
    const [outcome] = outcomesOf(input).outcomes;
    expect(outcome.mons["opponent-left"]).toMatchObject({ pendingCopy: { atk: 1 }, build: { boosts: { atk: 0 } } });
  });
});

describe("status2 E1: the final Update's Berries (F4 §4.13, §4.14)", () => {
  it("a Starf Berry raises one stat below +6 by 2, one world each, in every walk [E1-STF-01]", async () => {
    const input = await turn("scarlet_violet", [idle("snorlax", { ability: "thickfat", spe: 4, item: "starfberry", hp: 70, status: "brn" }), idle("snorlax", { spe: 8 }), idle("snorlax", { spe: 12 }), idle("snorlax", { spe: 16 })]);
    const result = ready(calculateDoublesTurn(input));
    expect(find(result, "own-left", "Starf Berry")[0].facts.map((fact) => [fact.text, +fact.chance.toFixed(12)])).toEqual([
      ["Attack +2.", 0.2], ["Defense +2.", 0.2], ["Sp. Atk +2.", 0.2], ["Sp. Def +2.", 0.2], ["Speed +2.", 0.2],
    ]);
    const outcomes = outcomesOf(input);
    for (const stat of ["atk", "def", "spa", "spd", "spe"] as const) expect(share(outcomes, "own-left", (mon) => mon.build.boosts[stat] === 2), stat).toBeCloseTo(0.2, 12);
  });

  it("a Lansat Berry sets the Berry's focus (settledFocusEnergy), not the move's", async () => {
    const [outcome] = outcomesOf(await turn("scarlet_violet", [idle("snorlax", { ability: "thickfat", spe: 4, item: "lansatberry", hp: 70, status: "brn" }), idle("snorlax", { spe: 8 }), idle("snorlax", { spe: 12 }), idle("snorlax", { spe: 16 })])).outcomes;
    expect(outcome.mons["own-left"]!.build).toMatchObject({ itemId: "", settledFocusEnergy: true });
    expect(outcome.mons["own-left"]!.build.focusEnergy).toBeUndefined();
  });

  it("White Herb at 29 restores an accuracy stage once Embargo ends at 21 (M1) [E1-WHR-01]", async () => {
    const input = await turn("ultra_sun_ultra_moon", [idle("snorlax", { spe: 4, item: "whiteherb", carried: { embargo: 1, stages: { accuracy: -1 } } }), idle("snorlax", { spe: 8 }), idle("snorlax", { spe: 12 }), idle("snorlax", { spe: 16 })]);
    const result = ready(calculateDoublesTurn(input));
    expect(find(result, "own-left", "White Herb")[0].facts).toEqual([{ text: "Restores its lowered stats.", chance: 1 }]);
    const [outcome] = outcomesOf(input).outcomes;
    expect(outcome.mons["own-left"]!.build.itemId).toBe("");
    expect(outcome.mons["own-left"]!.stages?.accuracy ?? 0).toBe(0);
  });
});

describe("status2 E1: Harvest and Pickup on the item history (28.2, C8)", () => {
  const trevenant = (field: Partial<BattleConditions> = {}, extra: Partial<DoublesTurnInput> = {}, lastItem: string | null | "unknown" = "sitrusberry") => turn("scarlet_violet", [
    idle("trevenant", { ability: "harvest", hp: 70, ...(lastItem !== "unknown" ? { lastItem } : {}) }), idle("snorlax", { spe: 8 }), idle("snorlax", { spe: 12 }), idle("snorlax", { spe: 16 }),
  ], field, extra);

  it("Harvest restores a Berry eaten before the turn at 1/2 outside sun, the final Update eats it when due (C1) [E1-HRV-01]", async () => {
    const input = await trevenant();
    const result = ready(calculateDoublesTurn(input));
    expect(after(result)["own-left"]).toMatchObject({ min: 70, max: 110, average: 90 });
    expect(find(result, "own-left", "Harvest")[0]).toMatchObject({ chance: 0.5, facts: [{ text: "Harvest: Sitrus Berry back.", chance: 0.5 }] });
    expect(find(result, "own-left", "Sitrus Berry")[0]).toMatchObject({ chance: 0.5, min: 40, max: 40 });
    expect(share(outcomesOf(input), "own-left", (mon) => mon.build.itemId === "" && mon.lastItem === "sitrusberry")).toBe(1);
  });

  it("in sun it is certain (C2) [E1-HRV-02]; with the item from an earlier turn None nothing; Unknown: the reason", async () => {
    const sun = ready(calculateDoublesTurn(await trevenant({ weather: "Sun" }, { weatherTurns: 5 })));
    expect(after(sun)["own-left"]).toMatchObject({ min: 110, max: 110 });
    const unsure = ready(calculateDoublesTurn(await trevenant({ weather: "Sun" })));
    expect(unsure.facts).toContain("Assumes the Sun does not end this turn.");
    const none = ready(calculateDoublesTurn(await trevenant({}, {}, null)));
    expect(after(none)["own-left"]!.average).toBe(70);
    expect(find(none, "own-left", "Harvest")).toEqual([]);
    expect(ready(calculateDoublesTurn(await trevenant({}, {}, "unknown"))).endOfTurn).toEqual({ status: "not-estimated", reason: "Harvest needs Trevenant's item from an earlier turn." });
  });

  it("Pickup takes an item a foe used earlier this turn and its Seed starts in its terrain (CQ03c) [E1-PKP-01]; the C19 fact", async () => {
    const seed = (earlier: boolean) => turn("scarlet_violet", [
      idle("pincurchin", { ability: "electricsurge" }), idle("snorlax", { spe: 8, lastItem: "electricseed", boosts: { def: 1 }, ...(earlier ? { earlier: { usedItem: true } } : {}) }),
      idle("ambipom", { ability: "pickup" }), idle("snorlax", { spe: 16 }),
    ], { terrain: "Electric" });
    const input = await seed(true);
    const result = ready(calculateDoublesTurn(input));
    expect(find(result, "opponent-left", "Pickup")).toEqual([{ slot: "opponent-left", effect: "Pickup", other: "own-right", chance: 1, min: null, max: null, koChance: 0, facts: [{ text: "Pickup: picks up Electric Seed.", chance: 1 }] }]);
    expect(find(result, "opponent-left", "Electric Seed")[0].facts).toEqual([{ text: "Defense +1.", chance: 1 }]);
    const [outcome] = outcomesOf(input).outcomes;
    expect(outcome.mons["opponent-left"]).toMatchObject({ build: { itemId: "", boosts: { def: 1 } }, lastItem: "electricseed" });
    expect(outcome.mons["own-right"]!.lastItem).toBeUndefined();
    // Not used earlier this turn: nothing to pick up, and the turn says what it assumed.
    const quiet = ready(calculateDoublesTurn(await seed(false)));
    expect(find(quiet, "opponent-left", "Pickup")).toEqual([]);
    expect(quiet.facts.some((fact) => /^Assumes Snorlax.* used no item earlier this turn\.$/.test(fact))).toBe(true);
  });

  it("a faster Pickup takes the Sitrus Harvest would restore (C8, CR09) [E1-PKP-02]", async () => {
    const input = await turn("scarlet_violet", [idle("trevenant", { ability: "harvest", item: "sitrusberry", hp: 90 }), idle("ambipom", { ability: "pickup", hp: 140 }), idle("snorlax", { spe: 12 }), idle("snorlax", { spe: 16 })], { weather: "Sand" }, { weatherTurns: 3 });
    const result = ready(calculateDoublesTurn(input));
    expect(after(result)["own-left"]!.average).toBe(120);
    expect(find(result, "own-left", "Harvest")).toEqual([]);
    const [outcome] = outcomesOf(input).outcomes;
    expect(outcome.mons["own-right"]!.build.itemId).toBe("sitrusberry");
    expect(outcome.mons["own-left"]!.build.itemId).toBe("");
  });

  it("a picked-up Mental Herb ends its holder's Taunt at the final Update [E1-MH-02]", async () => {
    const input = await turn("scarlet_violet", [
      idle("snorlax", { spe: 4 }), idle("snorlax", { spe: 8, lastItem: "mentalherb", earlier: { usedItem: true } }), idle("ambipom", { ability: "pickup", carried: { taunt: 2 } }), idle("snorlax", { spe: 16 }),
    ]);
    const result = ready(calculateDoublesTurn(input));
    expect(find(result, "opponent-left", "Mental Herb")[0].facts).toEqual([{ text: "Its Taunt ends.", chance: 1 }]);
    const [outcome] = outcomesOf(input).outcomes;
    expect(outcome.mons["opponent-left"]).toMatchObject({ build: { itemId: "" }, lastItem: "mentalherb" });
    expect(outcome.mons["opponent-left"]!.volatiles).toBeUndefined();
    expect(outcome.mons["opponent-left"]!.turnsLeft).toBeUndefined();
  });
});

describe("status2 E1: a Pokémon that switched in this turn", () => {
  it("has no Speed Boost at this end of turn (activeTurns 0) [E1-SPB-01]", async () => {
    const input = await turn("scarlet_violet", [idle("blaziken", { ability: "speedboost", switchedIn: true }), idle("snorlax", { spe: 4 }), idle("snorlax", { spe: 8 }), idle("blaziken", { ability: "speedboost" })]);
    const [outcome] = outcomesOf(input).outcomes;
    expect([outcome.mons["own-left"]!.build.boosts.spe, outcome.mons["opponent-right"]!.build.boosts.spe]).toEqual([0, 1]);
  });

  it("ends an Octolock it set (its source with no active turn: data/moves.ts octolock onResidual)", async () => {
    const input = await turn("champions", [idle("grapploct", { ability: "limber", switchedIn: true }), idle("snorlax", { spe: 4 }), idle("kingambit", { ability: "defiant", carried: { octolock: "own-left" } }), idle("snorlax", { spe: 12 })]);
    const [outcome] = outcomesOf(input).outcomes;
    expect(outcome.mons["opponent-left"]!.build.boosts).toMatchObject({ atk: 0, def: 0, spd: 0 });
    expect(outcome.mons["opponent-left"]!.volatiles).toBeUndefined();
  });
});

describe("status2 E1: the reference mode (every tie permuted, no merges) gives the same end of turn", () => {
  it("Pickup and Harvest at one Speed, two Opportunist copiers at one Speed, Octolock and Syrup Bomb on one holder", async () => {
    const inputs = [
      // Trevenant (0 EVs: 76) and a paralysed Ambipom (132 EVs: 152, halved: 76) tie in the 28.2 group.
      await turn("scarlet_violet", [
        idle("trevenant", { ability: "harvest", item: "sitrusberry", hp: 90 }), idle("ambipom", { ability: "pickup", spe: 132, status: "par", hp: 140 }), idle("snorlax", { spe: 12 }), idle("snorlax", { spe: 16 }),
      ], { weather: "Sand" }, { weatherTurns: 3 }),
      await turn("scarlet_violet", [idle("blaziken", { ability: "speedboost" }), idle("espathra", { ability: "opportunist" }), idle("espathra", { ability: "opportunist" }), idle("blaziken", { ability: "speedboost" })]),
      await turn("champions", [
        idle("grapploct", { ability: "limber" }), idle("snorlax", { spe: 4 }),
        idle("kingambit", { ability: "defiant", carried: { octolock: "own-left", syrupBomb: "own-right" } }), idle("espathra", { ability: "opportunist" }),
      ]),
    ];
    for (const input of inputs) {
      const normal = ready(calculateDoublesTurn(input));
      DOUBLES_REFERENCE.on = true;
      let reference: Ready;
      try { reference = ready(calculateDoublesTurn(input)); } finally { DOUBLES_REFERENCE.on = false; }
      for (const slot of SLOTS) {
        const a = after(normal)[slot]!, b = after(reference)[slot]!;
        expect(Math.abs(a.average - b.average)).toBeLessThan(1e-9);
        expect([a.min, a.max, a.low, a.high]).toEqual([b.min, b.max, b.low, b.high]);
      }
      expect(residuals(normal).map((entry) => [entry.slot, entry.effect, +entry.chance.toFixed(9), entry.min, entry.max])).toEqual(
        residuals(reference).map((entry) => [entry.slot, entry.effect, +entry.chance.toFixed(9), entry.min, entry.max]));
    }
  });
});

describe("status2 E1: Harvest and Pickup at one Speed (C8) [E1-HRV-03]", () => {
  it("each order at 1/2: Pickup first takes the Sitrus; Harvest first restores it at 1/2, and Pickup then has none to take", async () => {
    const input = await turn("scarlet_violet", [
      idle("trevenant", { ability: "harvest", item: "sitrusberry", hp: 90 }), idle("ambipom", { ability: "pickup", spe: 132, status: "par", hp: 140 }), idle("snorlax", { spe: 12 }), idle("snorlax", { spe: 16 }),
    ], { weather: "Sand" }, { weatherTurns: 3 });
    const result = ready(calculateDoublesTurn(input));
    expect(find(result, "own-left", "Harvest")[0].chance).toBeCloseTo(0.25, 12);
    expect(find(result, "own-right", "Pickup")[0].chance).toBeCloseTo(0.75, 12);
    const outcomes = outcomesOf(input);
    expect(share(outcomes, "own-left", (mon) => mon.build.itemId === "sitrusberry")).toBeCloseTo(0.25, 12);
    expect(share(outcomes, "own-right", (mon) => mon.build.itemId === "sitrusberry")).toBeCloseTo(0.75, 12);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// status2 Track E2 (ADDENDUM2 §4.3, T2E §4.1-§4.6, IN §4.3). The numbers are pinned Showdown c23d2e94's through the verify
// harness: V2's cases (their ids in brackets) run by scripts/.cache/calc-audit/status2/build/e2/e2-run.ts, every one agreeing.
// ------------------------------------------------------------------------------------------------------------------

const hatterene = (extra: Partial<P> = {}): P => idle("hatterene", { ability: "magicbounce", nature: "Modest", spa: 252, spe: 4, ...extra });
const lax = (spe: number, extra: Partial<P> = {}): P => idle("snorlax", { ability: "thickfat", spe, ...extra });
const landing = (source: DoublesSlotId): DoublesCarried => ({ futureMove: { move: "futuresight", source } });

describe("status2 E2: Future Sight and Doom Desire landing (3)", () => {
  it("from its active user: the damage, the target's Sitrus at the hit's Update, then its partner's Leftovers (5.4) [T2E-FS01-sv]", async () => {
    const input = await turn("scarlet_violet", [hatterene(), lax(32), lax(96, { item: "leftovers", hp: 150 }), lax(64, { item: "sitrusberry", hp: 150, carried: landing("own-left") })]);
    const result = ready(calculateDoublesTurn(input));
    expect(after(result)["opponent-right"]).toMatchObject({ min: 81, max: 100 });
    expect(after(result)["opponent-right"]!.average).toBeCloseTo(91, 9);
    expect(after(result)["opponent-left"]!.average).toBe(164);
    const lines = find(result, "opponent-right", "Future Sight");
    // The move's line (no HP; the oracle's "-end … move: Future Sight") and the damage alone (the oracle's futuremove line).
    expect(lines.map((line) => [line.other, line.min, line.max, line.chance])).toEqual([["own-left", null, null, 1], ["own-left", -127, -108, 1]]);
    expect(find(result, "opponent-right", "Sitrus Berry")[0]).toMatchObject({ chance: 1, min: 58, max: 58 });
    expect(residuals(result).map((line) => line.effect)).toEqual(["Future Sight", "Future Sight", "Sitrus Berry", "Leftovers"]);
    const outcomes = outcomesOf(input);
    expect(outcomes.endOfTurn).toBe("applied");
    expect(share(outcomes, "opponent-right", (mon) => mon.build.itemId === "")).toBeCloseTo(1, 12);
    expect(share(outcomes, "opponent-right", (mon) => mon.hp.every((each) => each.hp >= 81 && each.hp <= 100))).toBeCloseTo(1, 12);
  });

  it("from a user not in battle: its item, ability and stages do not count (a Choice Specs Hatterene: 108–127) [T2E-FS02-sv]", async () => {
    const runtime = await loadBattleRuntime("scarlet_violet");
    const benched = buildFor(runtime, hatterene({ item: "choicespecs", boosts: { spa: 2 } }));
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [lax(16), lax(32), lax(96), lax(64, { carried: { futureMove: { move: "futuresight", build: benched } } })])));
    expect(after(result)["opponent-right"]).toMatchObject({ min: 108, max: 127 });
    const [line, hit] = find(result, "opponent-right", "Future Sight");
    expect(line.facts).toEqual([{ text: "Hatterene is not in battle: its ability, item and stat changes do not count.", chance: 1 }]);
    expect(hit).toMatchObject({ min: -127, max: -108 });
    expect(line.other).toBeUndefined();
  });

  it("from a Pokémon of the turn that fainted: as one not in battle, with the fainting fact", async () => {
    // Clefable (1 HP) is knocked out by a faster Poison Jab before the residual (T2E-FS04-sv without its Tera).
    const runtime = await loadBattleRuntime("scarlet_violet");
    const clefable = idle("clefable", { ability: "unaware", nature: "Modest", spa: 252, hp: 1 });
    const slots = (carried: DoublesCarried): [P, P, P, P] => [clefable, lax(32), { id: "garchomp", ability: "roughskin", spe: 252, move: "poisonjab", target: "own-left" }, lax(64, { carried })];
    const fainted = ready(calculateDoublesTurn(await turn("scarlet_violet", slots(landing("own-left")))));
    const benched = ready(calculateDoublesTurn(await turn("scarlet_violet", slots({ futureMove: { move: "futuresight", build: buildFor(runtime, clefable) } }))));
    expect(after(fainted)["own-left"]).toMatchObject({ koChance: 1 });
    expect(after(fainted)["opponent-right"]).toEqual(after(benched)["opponent-right"]);
    expect(find(fainted, "opponent-right", "Future Sight")[0].facts).toEqual([{ text: "Clefable has fainted: its ability, item and stat changes do not count.", chance: 1 }]);
  });

  it("nothing when its user stands at the slot (Ally Switch) [T2E-FS07b-sv]; Protect and Endure from this turn are removed [T2E-FS06, -06b]", async () => {
    const own = ready(calculateDoublesTurn(await turn("scarlet_violet", [{ id: "espathra", ability: "frisk", spe: 252, move: "allyswitch" }, lax(32, { carried: landing("own-left") }), lax(64), lax(96)])));
    // The landing at own-right finds Espathra there after its Ally Switch: its own user, no hit.
    expect(find(own, "own-left", "Future Sight")).toEqual([{ slot: "own-left", effect: "Future Sight", chance: 1, min: null, max: null, koChance: 0, facts: [{ text: "Future Sight does not hit: Espathra is its user.", chance: 1 }] }]);
    const protect = ready(calculateDoublesTurn(await turn("scarlet_violet", [hatterene(), lax(32), lax(96), { ...lax(64, { carried: landing("own-left") }), move: "protect" }])));
    expect(after(protect)["opponent-right"]).toMatchObject({ min: 108, max: 127 });
    const endure = ready(calculateDoublesTurn(await turn("scarlet_violet", [hatterene(), lax(32), lax(96), { ...lax(64, { hp: 30, carried: landing("own-left") }), move: "endure" }])));
    expect(after(endure)["opponent-right"]).toMatchObject({ min: 0, max: 0, koChance: 1 });
  });

  it("a Dark type is immune, and an active Life Orb user still loses 1/10 (13 of 132) [T2E-FS05-sv]", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [hatterene({ item: "lifeorb" }), lax(32), lax(96), idle("umbreon", { ability: "synchronize", carried: landing("own-left") })])));
    expect(after(result)["opponent-right"]).toMatchObject({ min: 170, max: 170 });
    expect(after(result)["own-left"]).toMatchObject({ min: 119, max: 119 });
    expect(find(result, "opponent-right", "Future Sight")[0].facts).toEqual([{ text: "Future Sight has no effect on Umbreon.", chance: 1 }]);
    expect(find(result, "own-left", "Life Orb")[0]).toMatchObject({ other: "opponent-right", min: -13, max: -13 });
  });

  it("a Pokémon charging Fly is missed [T2E-FS10-sv]; a Substitute takes the landing of a user not in battle [T2E-FS08b-champions]", async () => {
    const fly = ready(calculateDoublesTurn(await turn("scarlet_violet", [hatterene(), lax(32), lax(96), { id: "corviknight", ability: "pressure", move: "fly", target: "own-left", carried: landing("own-left") }])));
    expect(find(fly, "opponent-right", "Future Sight")[0].facts).toEqual([{ text: "Future Sight misses Corviknight.", chance: 1 }]);
    const runtime = await loadBattleRuntime("champions");
    const meowstic = buildFor(runtime, idle("meowsticf", { ability: "infiltrator", nature: "Modest", spa: 4 }));
    const input = await turn("champions", [lax(2), lax(4), lax(12), lax(8, { carried: { substitute: 40, futureMove: { move: "futuresight", build: meowstic } } })],
      { defenderSide: { ...createConditions().defenderSide, lightScreen: true } });
    const sub = ready(calculateDoublesTurn(input));
    expect(after(sub)["opponent-right"]).toMatchObject({ min: 235, max: 235 });
    expect(share(outcomesOf(input), "opponent-right", (mon) => !mon.substitute)).toBeCloseTo(1, 12);
  });

  it("a user not in battle beside two holders of one partner boost, or with its side unknown where the side counts: narrow reasons", async () => {
    const runtime = await loadBattleRuntime("scarlet_violet");
    const user = buildFor(runtime, hatterene());
    const sided = { futureMove: { move: "futuresight", build: user, side: "own" } } as unknown as DoublesCarried;
    const two = ready(calculateDoublesTurn(await turn("scarlet_violet", [idle("charjabug", { ability: "battery" }), idle("charjabug", { ability: "battery" }), lax(96), lax(64, { carried: sided })])));
    expect(two.endOfTurn).toEqual({ status: "not-estimated", reason: "Future Sight landing with two Battery holders on its user's side is not modelled in 2v2." });
    const unknown = ready(calculateDoublesTurn(await turn("scarlet_violet", [idle("charjabug", { ability: "battery" }), lax(32), lax(96), lax(64, { carried: { futureMove: { move: "futuresight", build: user } } })])));
    expect(unknown.endOfTurn).toEqual({ status: "not-estimated", reason: "Future Sight landing needs its user." });
  });
});

describe("status2 E2: Cud Chew (28.2)", () => {
  const giraf = (extra: Partial<P> = {}) => idle("farigiraf", { ability: "cudchew", ...extra });
  const due: DoublesCarried = { cudChew: "sitrusberry" };
  it("re-eats the Sitrus it ate last turn: +48 [T2E-CC01-sv]; beside a foe's Unnerve too [T2E-CC05-sv]; under Heal Block no HP [T2E-CC06-sv]", async () => {
    const plain = ready(calculateDoublesTurn(await turn("scarlet_violet", [giraf({ hp: 100, carried: due }), lax(8), lax(24), lax(16)])));
    expect(after(plain)["own-left"]).toMatchObject({ min: 148, max: 148 });
    expect(find(plain, "own-left", "Cud Chew")[0].facts).toEqual([{ text: "Eats its Sitrus Berry again.", chance: 1 }]);
    expect(find(plain, "own-left", "Sitrus Berry")[0]).toMatchObject({ min: 48, max: 48 });
    expect(plain.facts).not.toContain("Assumes Farigiraf ate no Berry last turn.");
    const unnerve = ready(calculateDoublesTurn(await turn("scarlet_violet", [giraf({ hp: 100, carried: due }), lax(8), lax(24), idle("tyranitar", { ability: "unnerve" })])));
    expect(after(unnerve)["own-left"]!.average).toBe(148);
    const blocked = ready(calculateDoublesTurn(await turn("scarlet_violet", [giraf({ hp: 100, carried: { ...due, healBlock: 3 } }), lax(8), lax(24), lax(16)])));
    expect(after(blocked)["own-left"]!.average).toBe(100);
    const outcomes = outcomesOf(await turn("scarlet_violet", [giraf({ hp: 100, carried: due }), lax(8), lax(24), lax(16)]));
    expect(share(outcomes, "own-left", (mon) => mon.cudChew === undefined)).toBeCloseTo(1, 12);
  });

  it("a Berry eaten in the moves is due next turn (E2 cudChew) [T2E-CC02-sv]; one eaten at the weather's Update is re-eaten the same turn, summed [T2E-CC03-sv]", async () => {
    const moves = await turn("scarlet_violet", [giraf({ item: "sitrusberry", hp: 150 }), lax(8), lax(24), { id: "garchomp", ability: "roughskin", spe: 252, move: "dragonclaw", target: "own-left" }]);
    expect(share(outcomesOf(moves), "own-left", (mon) => mon.cudChew === "sitrusberry")).toBeCloseTo(1, 12);
    const sand = ready(calculateDoublesTurn(await turn("scarlet_violet", [giraf({ item: "sitrusberry", hp: 105 }), idle("tyranitar", { ability: "sandstream" }), lax(24), lax(16)], { weather: "Sand" })));
    // 105 − 12 (sand) = 93, the Sitrus +48 = 141, Cud Chew's +48 = 189: one Sitrus line per path, as the oracle sums it.
    expect(after(sand)["own-left"]).toMatchObject({ min: 189, max: 189 });
    expect(find(sand, "own-left", "Sitrus Berry")).toEqual([expect.objectContaining({ min: 96, max: 96, chance: 1 })]);
  });

  it("states the default when no Berry is given and none is held (C29)", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [giraf({ hp: 100 }), lax(8), lax(24), lax(16)])));
    expect(result.facts).toContain("Assumes Farigiraf ate no Berry last turn.");
  });
});

describe("status2 E2: Moody (28.2)", () => {
  it("E2: one outcome per (raised, lowered) pair, 1/20 each; the calculator's walk records each stage fact at 1/5 without splitting [T2E-MO01-sv]", async () => {
    const input = await turn("scarlet_violet", [idle("glalie", { ability: "moody" }), lax(8), lax(24), lax(16)]);
    const outcomes = outcomesOf(input);
    expect(outcomes.outcomes.length).toBe(20);
    for (const stat of ["atk", "def", "spa", "spd", "spe"] as const) {
      expect(share(outcomes, "own-left", (mon) => mon.build.boosts[stat] === 2)).toBeCloseTo(0.2, 12);
      expect(share(outcomes, "own-left", (mon) => mon.build.boosts[stat] === -1)).toBeCloseTo(0.2, 12);
    }
    const result = ready(calculateDoublesTurn(input));
    const [line] = find(result, "own-left", "Moody");
    expect(line.chance).toBeCloseTo(1, 12);
    expect(line.facts.length).toBe(10);
    for (const fact of line.facts) expect(fact.chance).toBeCloseTo(0.2, 12);
  });

  it("generation 7 counts accuracy and evasion: 42 pairs [T2E-MO02-usum]; its own White Herb restores the drop at 29 [T2E-MO04-sv]", async () => {
    const usum = outcomesOf(await turn("ultra_sun_ultra_moon", [idle("octillery", { ability: "moody" }), lax(8), lax(24), lax(16)]));
    expect(usum.outcomes.length).toBe(42);
    const herb = await turn("scarlet_violet", [idle("glalie", { ability: "moody", item: "whiteherb" }), lax(8), lax(24), lax(16)]);
    const outcomes = outcomesOf(herb);
    expect(share(outcomes, "own-left", (mon) => mon.build.itemId === "")).toBeCloseTo(1, 12);
    expect(share(outcomes, "own-left", (mon) => Object.values(mon.build.boosts).every((stage) => (stage ?? 0) >= 0))).toBeCloseTo(1, 12);
    // A reader (its White Herb) in the calculator's walk: the worlds split there too.
    expect(find(ready(calculateDoublesTurn(herb)), "own-left", "White Herb")[0].chance).toBeCloseTo(1, 12);
  });
});

describe("status2 E2: Taunt, Encore, Disable count down (15, 16, 17)", () => {
  it("Taunt with 1 turn left ends; with 2 left E2 keeps it for 1 [IN-TNT-01]; Disable with 1 left ends [IN-TNT-03-champions]", async () => {
    for (const [left, kept] of [[1, undefined], [2, 1]] as const) {
      const input = await turn("scarlet_violet", [idle("grimmsnarl"), lax(32), lax(8), lax(16, { carried: { taunt: left } })]);
      expect(find(ready(calculateDoublesTurn(input)), "opponent-right", "Taunt ends").length, `${left}`).toBe(left === 1 ? 1 : 0);
      expect(share(outcomesOf(input), "opponent-right", (mon) => mon.turnsLeft?.taunt === kept && (kept === undefined) !== !!mon.volatiles?.includes("taunt"))).toBeCloseTo(1, 12);
    }
    const disable = await turn("champions", [lax(3), lax(4), lax(1), { ...lax(2, { carried: { disable: { move: "bodyslam", turns: 1 } } }), move: "protect" }]);
    expect(find(ready(calculateDoublesTurn(disable)), "opponent-right", "Disable ends").length).toBe(1);
    expect(share(outcomesOf(disable), "opponent-right", (mon) => !mon.volatiles?.includes("disable"))).toBeCloseTo(1, 12);
  });
});

describe("status2 E2: field effects from before the turn ending with one turn left (27.2, 27.6, 27.7)", () => {
  it("Misty Terrain ends at 27.7: a Flame Orb then burns at 28.3 [IN-FLD-01]; with 2 turns left it lasts, and nothing is assumed", async () => {
    const orb: [P, P, P, P] = [lax(32), lax(48), lax(64), lax(96, { item: "flameorb" })];
    const ends = ready(calculateDoublesTurn(await turn("scarlet_violet", orb, { terrain: "Misty" }, { fieldTurns: { terrain: 1 } })));
    expect(ends.endOfTurn).toMatchObject({ status: "ready", facts: ["Misty Terrain ends."] });
    expect(find(ends, "opponent-right", "Flame Orb")[0].facts).toEqual([{ text: "Is burned.", chance: 1 }]);
    expect(ends.facts.some((fact) => fact.includes("does not end"))).toBe(false);
    const lasts = ready(calculateDoublesTurn(await turn("scarlet_violet", orb, { terrain: "Misty" }, { fieldTurns: { terrain: 2 } })));
    expect(find(lasts, "opponent-right", "Flame Orb")).toEqual([]);
    expect(lasts.facts.some((fact) => fact.includes("does not end"))).toBe(false);
    const outcomes = outcomesOf(await turn("scarlet_violet", orb, { terrain: "Misty" }, { fieldTurns: { terrain: 1 } }));
    expect(outcomes.outcomes.every((outcome) => outcome.field.terrain === "")).toBe(true);
  });

  it("Magic Room ends at 27.6: a due Sitrus at the final Update [IN-FLD-02]; Gravity at 27.2: a Flying Flame Orb holder in Misty Terrain is burned [IN-FLD-03]", async () => {
    const room = ready(calculateDoublesTurn(await turn("scarlet_violet", [lax(32), lax(48), lax(64, { item: "sitrusberry", hp: 100 }), lax(96)], { magicRoom: true }, { fieldTurns: { magicRoom: 1 } })));
    expect(room.endOfTurn).toMatchObject({ status: "ready", facts: ["Magic Room ends."] });
    expect(after(room)["opponent-left"]).toMatchObject({ min: 158, max: 158 });
    expect(room.facts).not.toContain("Assumes Magic Room does not end this turn.");
    const gravity = ready(calculateDoublesTurn(await turn("scarlet_violet", [lax(32), lax(48), lax(64), idle("corviknight", { item: "flameorb" })], { terrain: "Misty", gravity: true }, { fieldTurns: { gravity: 1 } })));
    expect(find(gravity, "opponent-right", "Flame Orb")[0].facts).toEqual([{ text: "Is burned.", chance: 1 }]);
    expect(gravity.facts).not.toContain("Assumes Gravity does not end this turn.");
  });

  it("a terrain this turn could have set again after ending it keeps the reason", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [
      { id: "smeargle", ability: "owntempo", spe: 252, move: "steelroller", target: "opponent-left" }, { id: "rillaboom", move: "grassyterrain" }, lax(64), lax(96),
    ], { terrain: "Grassy" }, { fieldTurns: { terrain: 1 } })));
    expect(result.endOfTurn).toEqual({ status: "not-estimated", reason: "Grassy Terrain ending is not modelled in 2v2." });
  });
});

describe("status2 E2: G-Max damage over time (5.1) and traps (13), Sword/Shield", () => {
  const gmax = (id: string, extra: Partial<P> = {}): P => ({ id, spe: 252, build: { mechanic: "gigantamax", configuration: { dynamaxLevel: 10, gigantamax: true } } as Partial<BattleBuild>, ...extra });
  it("G-Max Wildfire: 1/6 to each non-Fire foe at 5.1, before Grassy Terrain (5.2) and Leftovers (5.4) [T2E-GX01-swsh]", async () => {
    const input = await turn("sword_shield", [{ ...gmax("charizard", { ability: "blaze" }), move: "flamethrower", target: "opponent-right" }, lax(8), lax(24), lax(16, { item: "leftovers" })], { terrain: "Grassy" });
    const result = ready(calculateDoublesTurn(input));
    expect(after(result)["opponent-left"]).toMatchObject({ min: 210, max: 210 });
    expect(find(result, "opponent-left", "G-Max Wildfire")[0]).toMatchObject({ min: -39, max: -39 });
    expect(find(result, "opponent-right", "G-Max Wildfire")[0]).toMatchObject({ min: -39, max: -39 });
    expect(outcomesOf(input).outcomes.every((outcome) => outcome.sides.opponent.gmax?.includes("gmaxwildfire"))).toBe(true);
  });

  it("one from an earlier turn on the side (SideConditions.gmaxResidual): a Grass type takes none [T2E-GX04-swsh]", async () => {
    const result = ready(calculateDoublesTurn(await turn("sword_shield", [lax(8), lax(32), lax(24), idle("venusaur", { ability: "overgrow" })],
      { defenderSide: { ...createConditions().defenderSide, gmaxResidual: ["gmaxvinelash"] } })));
    expect(find(result, "opponent-left", "G-Max Vine Lash")[0]).toMatchObject({ min: -39, max: -39 });
    expect(find(result, "opponent-right", "G-Max Vine Lash")).toEqual([]);
  });

  it("G-Max Centiferno traps both foes and its traps go on after Centiskorch faints [T2E-GX03-swsh]", async () => {
    const result = ready(calculateDoublesTurn(await turn("sword_shield", [
      { ...gmax("centiskorch", { ability: "flashfire", hp: 30 }), move: "firelash", target: "opponent-right" }, lax(8),
      { id: "garchomp", ability: "roughskin", nature: "Brave", move: "stoneedge", target: "own-left", build: { native: { level: 50, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 0 } } } as Partial<BattleBuild> }, lax(16),
    ])));
    expect(after(result)["own-left"]).toMatchObject({ koChance: 1 });
    expect(find(result, "opponent-left", "G-Max Centiferno")[0]).toMatchObject({ min: -22, max: -22 });
    expect(find(result, "opponent-right", "G-Max Centiferno")[0]).toMatchObject({ min: -29, max: -29 });
  });
});

describe("status2 E2: forms at 29", () => {
  it("Zen Mode at half or less: E2 Darmanitan-Zen, its HP unchanged; the calculator's walk states it with the flipping share [T2E-FC01-usum]", async () => {
    const input = await turn("ultra_sun_ultra_moon", [idle("darmanitan", { ability: "zenmode", status: "psn", hp: 95 }), lax(8), lax(24), lax(16)]);
    expect(share(outcomesOf(input), "own-left", (mon) => mon.build.speciesId === "darmanitanzen" && mon.hp.every((each) => each.hp === 73))).toBeCloseTo(1, 12);
    const result = ready(calculateDoublesTurn(input));
    expect(after(result)["own-left"]).toMatchObject({ min: 73, max: 73 });
    expect(find(result, "own-left", "Zen Mode")[0].facts).toEqual([{ text: "Becomes Darmanitan-Zen.", chance: 1 }]);
  });

  it("Shields Down back to its Core below half [T2E-FC03-sv]; Power Construct keeps its reason [T2E-FC05]", async () => {
    const minior = outcomesOf(await turn("scarlet_violet", [idle("miniormeteor", { ability: "shieldsdown", hp: 70, carried: { leechSeed: "opponent-right" } }), lax(8), lax(24), lax(16)]));
    expect(share(minior, "own-left", (mon) => mon.build.speciesId === "minior")).toBeCloseTo(1, 12);
    const zygarde = ready(calculateDoublesTurn(await turn("ultra_sun_ultra_moon", [idle("zygarde", { ability: "powerconstruct", status: "psn", hp: 100 }), lax(8), lax(24), lax(16)])));
    expect(zygarde.endOfTurn).toEqual({ status: "not-estimated", reason: "Power Construct changing Zygarde's form is not modelled in 2v2." });
  });
});

describe("status2 E2: Uproar's upkeep (28.1) and Yawn under it", () => {
  it("a carried Uproar with 1 turn left ends after this turn; with 2, one is left; a drowsy Pokémon does not fall asleep", async () => {
    for (const [left, kept] of [[1, undefined], [2, 1]] as const) {
      const input = await turn("scarlet_violet", [{ ...lax(32, { carried: { uproar: left } }), move: "uproar" }, lax(48, { carried: { yawn: true } }), lax(64), lax(96)]);
      // Uproar the move is CL's (doubles-calling.ts); until it lands, its presence guard stands for the turn.
      const pending = calculateDoublesOutcomes(input);
      if (pending.status === "not-estimated" && pending.reason === "Uproar is not modelled in 2v2.") continue;
      const outcomes = outcomesOf(input);
      expect(share(outcomes, "own-left", (mon) => mon.turnsLeft?.uproar === kept), `${left}`).toBeCloseTo(1, 12);
      expect(share(outcomes, "own-right", (mon) => mon.build.status === ""), `${left}`).toBeCloseTo(1, 12);
      expect(find(ready(calculateDoublesTurn(input)), "own-right", "Yawn")[0].facts).toEqual([{ text: "Cannot fall asleep: Uproar.", chance: 1 }]);
    }
  });
});

// status2 E2's asks of the integrator (status2/build/W1B-E2.md, "For the integrator"): each test fails until its kernel lines
// land (it.fails), then flips to it(). Numbers: E2's own oracle cases (status2/build/e2/e2-extra-cases.ts), pinned Showdown.
describe("status2 E2: the integrator's kernel lines", () => {
  it.fails("a landing whose user's search would follow its HP (Life Orb): ×1.3, then −1/10 (doubles-turn.ts searchFor with attackerBuild unfollowed) [E2X-FS-LO-sv, T2E-FS14]", async () => {
    const result = ready(calculateDoublesTurn(await turn("scarlet_violet", [hatterene({ item: "lifeorb" }), lax(32), lax(96), lax(64, { carried: landing("own-left") })])));
    expect(after(result)["opponent-right"]).toMatchObject({ min: 70, max: 95 });
    expect(after(result)["own-left"]).toMatchObject({ min: 119, max: 119 });
  });

  it.fails("Taunt, Encore and Disable used this turn get their fresh duration (doubles-status.ts: tauntLeft, encoreLeft, disableLeft) [E2X-TNT-new-sv, -late, E2X-DIS-late-sv, E2X-ENC-late-sv, G4-LMV, G4-ENC-01]", async () => {
    const left = async (user: P, move: string, fast: boolean, key: "taunt" | "encore" | "disable") => {
      const input = await turn("scarlet_violet", [{ ...user, move, target: "opponent-right" }, lax(32), lax(8), { ...lax(fast ? 252 : 16), move: "bodyslam", target: "own-left" }]);
      return outcomesOf(input).outcomes.map((outcome) => outcome.mons["opponent-right"]!.turnsLeft?.[key]);
    };
    expect(await left(idle("grimmsnarl", { ability: "prankster" }), "taunt", false, "taunt")).toEqual([2]);
    expect(await left(idle("crawdaunt", { ability: "hypercutter" }), "taunt", true, "taunt")).toEqual([3]);
    expect(await left(idle("dusknoir", { ability: "pressure" }), "disable", true, "disable")).toEqual([4]);
    expect(await left(idle("azumarill", { ability: "thickfat" }), "encore", true, "encore")).toEqual([3]);
  });
});
