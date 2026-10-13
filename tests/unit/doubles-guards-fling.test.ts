import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, createSide, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame, BattleStatus, CombatStat } from "@/app/lib/battle/types";

/**
 * status2 wave 1a, Track D (SPEC2 §4.5 "Fling in 2v2"; guards.md §4.5; PS/data/moves.ts:5734-5787): Fling throws its user's
 * item. The pair's step calculates the hit with the item held (Life Orb's boost); the thrown item's effect on the target the
 * hit reached (a Berry eaten, a status or flinch as a certain secondary, White Herb, Mental Herb), then the `fling` volatile
 * takes the item at the hit's Update (no Life Orb recoil), or at the action's Update when nothing was hit (Protect). Every
 * number is the pinned Showdown oracle's (scripts/.cache/calc-audit/status2/build/w1a-d-cases.ts D-FLG-…, run by
 * w1a-d-run.ts). Level 50, 31 IVs, Serious, 0 EVs (Stat Points in Champions) unless set.
 */
type Stat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
type Mon = {
  species: string; ability: string; item?: string; hp?: number; evs?: Partial<Record<Stat, number>>; boosts?: Partial<Record<CombatStat, number>>;
  nature?: string; status?: BattleStatus; gender?: "M" | "F"; carried?: DoublesCarried; move: string | null; target?: DoublesSlotId;
};
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const ZERO = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IV31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const runtimes: Partial<Record<BattleGame, BattleRuntime>> = {};
const game = async (id: BattleGame) => (runtimes[id] ??= await loadBattleRuntime(id));

function buildOf(runtime: BattleRuntime, m: Mon): BattleBuild {
  const base = createBuild(m.species, runtime);
  const shared = {
    nature: m.nature ?? "Serious", abilityId: m.ability, abilityActive: defaultAbilityActive(m.ability), itemId: m.item ?? "",
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...m.boosts }, currentHP: m.hp ?? null, status: m.status ?? "",
    ...(m.gender ? { configuration: { ...base.configuration, gender: m.gender } } : {}),
  };
  return (base.game === "champions" ? { ...base, ...shared, points: { ...ZERO, ...m.evs } } : { ...base, ...shared, native: { level: 50, evs: { ...ZERO, ...m.evs }, ivs: IV31 } }) as BattleBuild;
}
function turn(runtime: BattleRuntime, mons: Mon[]): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot, i) => {
    const m = mons[i];
    const entry: DoublesPokemonInput = { build: buildOf(runtime, m), contexts: {}, charged: false, action: { moveId: m.move, target: m.target ?? null }, ...(m.carried ? { carried: m.carried } : {}) };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", attackerSide: createSide(), defenderSide: createSide() }, pokemon, canSwitch: { own: true, opponent: true } };
}
const lax = (spe: number, extra: Partial<Mon> = {}): Mon => ({ species: "snorlax", ability: "thickfat", evs: { spe }, move: null, ...extra });
const sneasler = (item: string, move: { target: DoublesSlotId }, extra: Partial<Mon> = {}): Mon => ({ species: "sneasler", ability: "pressure", item, evs: { spe: 252 }, move: "fling", ...move, ...extra });
const ready = (input: DoublesTurnInput) => {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(result.status === "not-estimated" ? result.reason : result.status);
  return result;
};
const range = (hp: { min: number; max: number }) => [hp.min, hp.max];
const flingFacts = (input: DoublesTurnInput, target: DoublesSlotId) => ready(input).steps.find((step) => step.moveId === "fling")!.hits.find((hit) => hit.slot === target)!.facts.map((fact) => fact.text);
/** E2: the chance that `slot`'s build after the turn meets `test`. */
const outcomeChance = (input: DoublesTurnInput, slot: DoublesSlotId, test: (build: BattleBuild) => boolean) => {
  const out = calculateDoublesOutcomes(input);
  if (out.status !== "ready") throw new Error(out.status === "not-estimated" ? out.reason : out.status);
  return out.outcomes.reduce((sum, o) => sum + (test(o.mons[slot]!.build) ? o.chance : 0), 0);
};

describe("status2 D: Fling's item, user side (guards.md §4.5)", () => {
  it("D-FLG-02-sv: a flung Life Orb boosts the hit, then is gone with no recoil: Unburden on (62–77 after Body Slam)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "sneasler", ability: "unburden", item: "lifeorb", move: "fling", target: "opponent-left" }, lax(0), lax(4, { move: "bodyslam", target: "own-left" }), lax(8),
    ]);
    const result = ready(input);
    expect(range(result.hp["own-left"]!)).toEqual([62, 77]);
    expect(result.hp["own-left"]!.average).toBeCloseTo(69.9375, 9);
    expect(range(result.hp["opponent-left"]!)).toEqual([203, 208]);
    expect(outcomeChance(input, "own-left", (build) => build.itemId === "" && build.abilityActive === true)).toBeCloseTo(1, 9);
  });

  it("D-FLG-12-sv: Fling into Protect: the fling volatile still takes the Life Orb at the action's Update, no recoil", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [{ species: "sneasler", ability: "unburden", item: "lifeorb", move: "fling", target: "opponent-left" }, lax(0), lax(4, { move: "protect" }), lax(8)]);
    const result = ready(input);
    expect(range(result.hp["own-left"]!)).toEqual([155, 155]);
    expect(outcomeChance(input, "own-left", (build) => build.itemId === "" && build.abilityActive === true)).toBeCloseTo(1, 9);
  });

  it("a flung Shell Bell heals nothing: the item is gone before its AfterMoveSecondarySelf (integration 1b, D's ask 2; INT-FLG-01)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("shellbell", { target: "opponent-left" }, { hp: 100 }), lax(0), lax(4), lax(8)]);
    expect(range(ready(input).hp["own-left"]!)).toEqual([100, 100]);
    expect(outcomeChance(input, "own-left", (build) => build.itemId === "")).toBeCloseTo(1, 9);
  });
});

describe("status2 D: Fling's item, target side (guards.md §4.5)", () => {
  it("D-FLG-03-sv: a flung Flame Orb burns the target (its Body Slam halved, 1/16 at the end of turn); the thrower keeps no Orb", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("flameorb", { target: "opponent-left" }), lax(0), lax(4, { move: "bodyslam", target: "own-left" }), lax(8)]);
    const result = ready(input);
    expect(flingFacts(input, "opponent-left")).toContain("Flame Orb: Snorlax (opponent's, 1) is burned.");
    expect(range(result.hp["own-left"]!)).toEqual([109, 116]);
    expect(result.endOfTurn.status === "ready" && range(result.endOfTurn.hp["opponent-left"]!)).toEqual([196, 200]);
    expect(outcomeChance(input, "own-left", (build) => build.status === "" && build.itemId === "")).toBeCloseTo(1, 9);
  });

  it("D-FLG-14-sv: Sheer Force does not remove Fling's status secondary (E9)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "feraligatr", ability: "sheerforce", item: "flameorb", evs: { spe: 252 }, move: "fling", target: "opponent-left" }, lax(0), lax(4, { move: "bodyslam", target: "own-left" }), lax(8),
    ]);
    const result = ready(input);
    expect(range(result.hp["own-left"]!)).toEqual([129, 134]);
    expect(result.endOfTurn.status === "ready" && range(result.endOfTurn.hp["opponent-left"]!)).toEqual([200, 204]);
  });

  it("D-FLG-09-sv: a flung Toxic Orb badly poisons a Synchronize Umbreon, which passes it back", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      { species: "ambipom", ability: "skilllink", item: "toxicorb", evs: { spe: 252 }, move: "fling", target: "opponent-left" }, lax(0), { species: "umbreon", ability: "synchronize", move: null }, lax(8),
    ]);
    const result = ready(input);
    expect(result.endOfTurn.status === "ready" && range(result.endOfTurn.hp["own-left"]!)).toEqual([141, 141]);
    expect(result.endOfTurn.status === "ready" && range(result.endOfTurn.hp["opponent-left"]!)).toEqual([153, 155]);
    expect(outcomeChance(input, "own-left", (build) => build.status === "tox")).toBeCloseTo(1, 9);
  });

  it("D-FLG-07-champions: a flung Poison Barb poisons the target (1/8 at the end of turn)", async () => {
    const runtime = await game("champions");
    const input = turn(runtime, [sneasler("poisonbarb", { target: "opponent-left" }, { evs: { spe: 32 } }), lax(0), lax(4, { move: "bodyslam", target: "own-left" }), lax(8)]);
    const result = ready(input);
    expect(result.endOfTurn.status === "ready" && range(result.endOfTurn.hp["opponent-left"]!)).toEqual([150, 159]);
    expect(result.endOfTurn.status === "ready" && result.endOfTurn.hp["opponent-left"]!.average).toBeCloseTo(154.6875, 9);
  });

  it("D-FLG-05-sv: a flung King's Rock flinches a slower target: its Body Slam is lost", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("kingsrock", { target: "opponent-left" }), lax(0), lax(4, { move: "bodyslam", target: "own-left" }), lax(8)]);
    const result = ready(input);
    expect(range(result.hp["own-left"]!)).toEqual([155, 155]);
    expect(flingFacts(input, "opponent-left")).toContain("King's Rock: Snorlax (opponent's, 1) flinches if it has not moved.");
  });

  it("D-FLG-17-sv: Inner Focus stops a flung Razor Fang's flinch (82–93)", async () => {
    const runtime = await game("scarlet_violet");
    const result = ready(turn(runtime, [sneasler("razorfang", { target: "opponent-left" }), lax(0), { species: "dragonite", ability: "innerfocus", move: "bodyslam", target: "own-left" }, lax(8)]));
    expect(range(result.hp["own-left"]!)).toEqual([82, 93]);
  });

  it("D-FLG-04-sv: a flung Sitrus Berry is eaten by the ally it hits (109–111)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("sitrusberry", { target: "own-right" }), lax(0, { hp: 60 }), lax(4), lax(8)]);
    const result = ready(input);
    expect(range(result.hp["own-right"]!)).toEqual([109, 111]);
    expect(result.hp["own-right"]!.average).toBeCloseTo(110.1875, 9);
    expect(flingFacts(input, "own-right")).toContain("Sitrus Berry: Snorlax (yours) eats it.");
  });

  it("D-FLG-19-sv: the ally's own Sitrus stays held above its line (179–181)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("sitrusberry", { target: "own-right" }), lax(0, { hp: 130, item: "sitrusberry" }), lax(4), lax(8)]);
    expect(range(ready(input).hp["own-right"]!)).toEqual([179, 181]);
    expect(outcomeChance(input, "own-right", (build) => build.itemId === "sitrusberry")).toBeCloseTo(1, 9);
  });

  it("D-FLG-16-sv: the flung heal before the hit's Update would stop the ally's own Liechi the step ate: not followed", async () => {
    const runtime = await game("scarlet_violet");
    const result = calculateDoublesTurn(turn(runtime, [sneasler("sitrusberry", { target: "own-right" }), lax(0, { hp: 62, item: "liechiberry" }), lax(4), lax(8)]));
    expect(result.status === "not-estimated" && result.reason).toBe("Fling with Sitrus Berry is not modelled in 2v2.");
  });

  it("D-FLG-08-sv: a flung Liechi Berry raises the ally's Attack through boost() (Body Slam 105–126 left)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("liechiberry", { target: "own-right" }), lax(0, { move: "bodyslam", target: "opponent-left" }), lax(4), lax(8)]);
    const result = ready(input);
    expect(range(result.hp["opponent-left"]!)).toEqual([105, 126]);
    expect(result.hp["opponent-left"]!.average).toBeCloseTo(115.25, 9);
    expect(flingFacts(input, "own-right")).toContain("Liechi Berry: +1 Attack.");
  });

  it("D-FLG-15-sv: a flung Starf Berry raises a random stat by 2 (61–160 left by the Body Slam)", async () => {
    const runtime = await game("scarlet_violet");
    const result = ready(turn(runtime, [sneasler("starfberry", { target: "own-right" }), lax(0, { move: "bodyslam", target: "opponent-left" }), lax(4), lax(8)]));
    expect(range(result.hp["opponent-left"]!)).toEqual([61, 160]);
    expect(result.hp["opponent-left"]!.average).toBeCloseTo(138.25, 6);
  });

  it("D-FLG-13-sv: a flung Figy Berry heals and confuses a Modest ally (its Body Slam 1/3 a self-hit)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("figyberry", { target: "own-right" }), lax(0, { hp: 60, nature: "Modest", move: "bodyslam", target: "opponent-left" }), lax(4), lax(8)]);
    const result = ready(input);
    expect(range(result.hp["own-right"]!)).toEqual([103, 131]);
    expect(result.hp["own-right"]!.average).toBeCloseTo(122.411875, 6);
    expect(range(result.hp["opponent-left"]!)).toEqual([156, 235]);
    expect(result.hp["opponent-left"]!.average).toBeCloseTo(186.383125, 6);
    expect(flingFacts(input, "own-right")).toContain("Figy Berry: it becomes confused.");
  });

  it("D-FLG-10-sv: a flung Lum Berry cures the burned ally before its Body Slam (147–160 left)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("lumberry", { target: "own-right" }), lax(0, { status: "brn", move: "bodyslam", target: "opponent-left" }), lax(4), lax(8)]);
    const result = ready(input);
    expect(range(result.hp["opponent-left"]!)).toEqual([147, 160]);
    expect(result.endOfTurn.status === "ready" && range(result.endOfTurn.hp["own-right"]!)).toEqual([226, 228]);
    expect(flingFacts(input, "own-right")).toContain("Its burn is cured.");
  });

  it("D-FLG-06-sv: a flung White Herb restores the ally's lowered Attack (Body Slam 147–160 left)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("whiteherb", { target: "own-right" }), lax(0, { boosts: { atk: -2 }, move: "bodyslam", target: "opponent-left" }), lax(4), lax(8)]);
    const result = ready(input);
    expect(range(result.hp["opponent-left"]!)).toEqual([147, 160]);
    expect(result.hp["opponent-left"]!.average).toBeCloseTo(154.0625, 9);
    expect(flingFacts(input, "own-right")).toContain("White Herb: Snorlax (yours)'s lowered stats are restored.");
  });

  it("D-FLG-11-sv: a flung Mental Herb ends the ally's attraction: its Body Slam always goes (147–160 left)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [
      sneasler("mentalherb", { target: "own-right" }), lax(0, { gender: "M", carried: { attract: "opponent-left" }, move: "bodyslam", target: "opponent-left" }), lax(4, { gender: "F" }), lax(8),
    ]);
    const result = ready(input);
    expect(range(result.hp["opponent-left"]!)).toEqual([147, 160]);
    expect(result.hp["opponent-left"]!.average).toBeCloseTo(154.0625, 9);
  });

  it("review 2 R3-5 (RD-FLING-CUSTAP-sv): a flung Custap Berry has no effect (custapberry onEat is empty): the target's later Body Slam runs as queued (75–88)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("custapberry", { target: "opponent-left" }), lax(8), lax(16, { move: "bodyslam", target: "own-right" }), lax(24)]);
    const result = ready(input);
    expect(flingFacts(input, "opponent-left")).toContain("Custap Berry: Snorlax (opponent's, 1) eats it.");
    const slam = result.steps.find((step) => step.moveId === "bodyslam")!.hits[0];
    expect([slam.min, slam.max]).toEqual([75, 88]);
    // A Cheek Pouch target heals a third as it eats it, idle or with a later action (V5-CUSTAP-POUCH).
    expect(ready(turn(runtime, [sneasler("custapberry", { target: "opponent-left" }), lax(8), { species: "greedent", ability: "cheekpouch", hp: 100, move: "bodyslam", target: "own-right" }, lax(24)])).status).toBe("ready");
  });

  it("D-FLG-18-sv: a flung Berry eaten by a Cud Chew holder counts for its Cud Chew (due at the next end of turn: status2 E2)", async () => {
    const runtime = await game("scarlet_violet");
    const input = turn(runtime, [sneasler("sitrusberry", { target: "own-right" }), { species: "farigiraf", ability: "cudchew", hp: 60, move: null }, lax(4), lax(8)]);
    expect(ready(input).endOfTurn.status).toBe("ready");
    const out = calculateDoublesOutcomes(input);
    expect(out.status === "ready" && out.outcomes.every((o) => o.mons["own-right"]!.cudChew === "sitrusberry")).toBe(true);
  });
});
