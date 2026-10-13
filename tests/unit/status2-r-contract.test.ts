import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import {
  benchNameParts, doublesBenchNames, doublesNames, sideCanSwitch, startId, turnBenchNames,
  type DoublesBenchPokemon, type DoublesPokemonInput, type DoublesSlotId, type DoublesTurnInput,
} from "@/app/lib/battle/doubles-types";
import { cloneWorld, discreteKey, pointFactor, type MonState, type World } from "@/app/lib/battle/doubles-world";
import { benchedOutcome, betweenActions, hazardFails } from "@/app/lib/battle/doubles-switch";
import type { TurnKernel } from "@/app/lib/battle/doubles-turn";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild } from "@/app/lib/battle/types";

/**
 * status2 Step 2 (scripts/.cache/calc-audit/status2/design SPEC2.md §4.8, guards.md §5.4, inputs.md §3.1 and §5.7,
 * ADDENDUM2.md §8.7 step 1; build/STEP2.md): R's contract. A bench takes canSwitch's place (sideCanSwitch), the bench Pokémon
 * are named after the four slots, the bench, the replacements and the hazards have their input issues, and the World's new
 * fields stay out of today's worlds. Wave 2 (R-E, build/W2-R-E.md): a switch-out with its side's bench given is modelled
 * (tests/unit/doubles-switch.test.ts has the family); the numbers here are pinned Showdown c23d2e94's
 * (status2/build/w2-re/cases-re.ts RE-CONTRACT-champions agrees with the oracle).
 */
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
type P = { id: string; ability?: string; move?: string | null; target?: DoublesSlotId | null; extra?: Partial<DoublesPokemonInput> };
const buildOf = (runtime: BattleRuntime, id: string, ability?: string): BattleBuild => {
  const base = createBuild(id, runtime);
  const abilityId = ability ?? base.abilityId;
  return { ...base, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: "", status: "", currentHP: null } as BattleBuild;
};
function turn(slots: Record<DoublesSlotId, P | null>, extra: Partial<DoublesTurnInput> = {}, runtime: BattleRuntime = championsRuntime): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    return [slot, { build: buildOf(runtime, p.id, p.ability), contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null }, ...p.extra } as DoublesPokemonInput];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon, ...extra };
}
const lax = (extra: Partial<P> = {}): P => ({ id: "snorlax", ability: "thickfat", move: null, ...extra });
const benched = (id: string, species: string, extra: Partial<DoublesBenchPokemon> = {}, runtime: BattleRuntime = championsRuntime): DoublesBenchPokemon =>
  ({ id, build: buildOf(runtime, species), ...extra });
const issuesOf = (input: DoublesTurnInput) => {
  const result = calculateDoublesTurn(input);
  if (result.status !== "issues") throw new Error(`expected issues, got ${result.status}`);
  return result.issues;
};

describe("a bench takes canSwitch's place (sideCanSwitch)", () => {
  it("reads the bench where given, else canSwitch", () => {
    const one = [benched("b1", "garchomp")];
    expect(sideCanSwitch({ bench: { own: one }, canSwitch: { own: false } }, "own")).toBe(true);
    expect(sideCanSwitch({ bench: { own: [] }, canSwitch: { own: true } }, "own")).toBe(false);
    expect(sideCanSwitch({ bench: { own: one } }, "opponent")).toBeUndefined();
    expect(sideCanSwitch({ canSwitch: { opponent: false } }, "opponent")).toBe(false);
    expect(startId("own-left")).toBe("slot:own-left");
  });
  it("gives the turn canSwitch's results: a bench as true, an empty bench as false (Healing Wish)", () => {
    const slots = { "own-left": { id: "gardevoir", ability: "trace", move: "healingwish" }, "own-right": lax(), "opponent-left": lax(), "opponent-right": lax() };
    const known = calculateDoublesTurn(turn(slots, { canSwitch: { own: true } }));
    const withBench = calculateDoublesTurn(turn(slots, { bench: { own: [benched("b1", "garchomp")] } }));
    expect(JSON.stringify(withBench)).toBe(JSON.stringify(known));
    const none = calculateDoublesTurn(turn(slots, { canSwitch: { own: false } }));
    expect(JSON.stringify(calculateDoublesTurn(turn(slots, { bench: { own: [] } })))).toBe(JSON.stringify(none));
    expect(JSON.stringify(known)).not.toBe(JSON.stringify(none));
    // Neither given: the turn assumes a Pokémon is left, as before.
    const assumed = calculateDoublesTurn(turn(slots));
    expect(assumed.status !== "issues" && assumed.facts).toContain("Assumes your side has a Pokémon left to switch in.");
    expect(withBench.status !== "issues" && withBench.facts).not.toContain("Assumes your side has a Pokémon left to switch in.");
    expect(JSON.stringify(calculateDoublesOutcomes(turn(slots, { bench: { own: [benched("b1", "garchomp")] } }))))
      .toBe(JSON.stringify(calculateDoublesOutcomes(turn(slots, { canSwitch: { own: true } }))));
  });
  it("models the switch with the side's bench: the chosen replacement comes in and meets the later Body Slam (R-E)", () => {
    // Snorlax at 1, 2 and 3 Speed points (no tie); Garchomp's Rough Skin (its first ability) takes 1/8 from the Body Slam's user.
    const at = (spe: number, extra: Partial<P> = {}): P => lax({ ...extra, extra: { build: { ...buildOf(championsRuntime, "snorlax", "thickfat"), points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe } } as BattleBuild } });
    const slots = { "own-left": { id: "corviknight", ability: "pressure", move: "uturn", target: "opponent-left" as DoublesSlotId }, "own-right": at(1), "opponent-left": at(2), "opponent-right": at(3, { move: "bodyslam", target: "own-left" }) };
    const result = calculateDoublesTurn(turn(slots, { bench: { own: [benched("b1", "garchomp")] }, replacement: { "own-left": "b1" } }));
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.status}`);
    expect(result.steps.map((step) => [step.slot, step.moveId, step.facts.map((fact) => fact.text)])).toEqual([
      ["own-left", "uturn", ["Corviknight switches out; Garchomp comes in."]], ["opponent-right", "bodyslam", []],
    ]);
    const hit = result.steps[1].hits.find((each) => each.slot === "own-left");
    expect([hit?.id, hit?.min, hit?.max]).toEqual(["b1", 55, 66]);
    expect(result.replaced?.["own-left"]?.entered).toEqual([{ id: "b1", chance: 1 }]);
    expect([result.hpEntered?.["own-left"]?.b1.min, result.hpEntered?.["own-left"]?.b1.max]).toEqual([117, 128]);
    expect([result.hp["own-left"]!.min, result.hp["opponent-right"]!.min, result.hp["opponent-left"]!.min, result.hp["opponent-left"]!.max]).toEqual([173, 206, 195, 201]);
    // A chosen replacement: no turn fact about it. Without a bench the replacement is not known (REASONS.switchesOut, kept).
    expect(result.facts.some((fact) => fact.includes("comes in for"))).toBe(false);
    expect(calculateDoublesTurn(turn(slots, { canSwitch: { own: true } }))).toMatchObject({ status: "not-estimated", reason: "Corviknight switches out: the replacement is not known." });
  });
});

describe("the bench Pokémon's names (IN §5.7)", () => {
  it("follow the four slots' names, which the bench does not change", () => {
    const base = { "own-left": "Garchomp", "own-right": "Venusaur", "opponent-left": "Tyranitar", "opponent-right": "Snorlax" } as Record<DoublesSlotId, string>;
    const parts = benchNameParts(base, {
      own: [{ id: "a", base: "Tyranitar" }, { id: "b", base: "Garchomp" }, { id: "c", base: "Gengar" }, { id: "d", base: "Garchomp" }],
      opponent: [{ id: "e", base: "Gengar" }, { id: "f", base: "Incineroar" }],
    });
    expect(parts).toEqual({
      a: { base: "Tyranitar", side: "yours", number: null },
      b: { base: "Garchomp", side: null, number: 2 },
      c: { base: "Gengar", side: "yours", number: null },
      d: { base: "Garchomp", side: null, number: 3 },
      e: { base: "Gengar", side: "opponent's", number: null },
      f: { base: "Incineroar", side: null, number: null },
    });
  });
  it("by species name over the input (turnBenchNames; empty without a bench)", () => {
    const input = turn({ "own-left": { id: "garchomp" }, "own-right": lax(), "opponent-left": { id: "tyranitar" }, "opponent-right": lax() },
      { bench: { own: [benched("t", "tyranitar"), benched("g", "gengar")], opponent: [benched("g2", "gengar")] } });
    expect(turnBenchNames(input)).toEqual({ t: "Tyranitar (yours)", g: "Gengar (yours)", g2: "Gengar (opponent's)" });
    expect(doublesBenchNames(input.pokemon, input.bench!, championsRuntime)).toEqual(turnBenchNames(input));
    expect(turnBenchNames(turn({ "own-left": lax(), "own-right": null, "opponent-left": lax(), "opponent-right": null }))).toEqual({});
    // The slots keep their names (doublesNames) with a bench.
    expect(doublesNames(input.pokemon, championsRuntime)).toEqual({ "own-left": "Garchomp", "own-right": "Snorlax (yours)", "opponent-left": "Tyranitar", "opponent-right": "Snorlax (opponent's)" });
  });
});

describe("the bench, replacement and hazard issues (IN §5.7)", () => {
  const four = () => ({ "own-left": lax({ move: "bodyslam", target: "opponent-left" as DoublesSlotId }), "own-right": lax(), "opponent-left": lax(), "opponent-right": lax() });
  it("a bench of at most four, ids of its own, valid builds", () => {
    const five = ["garchomp", "venusaur", "gengar", "tyranitar", "incineroar"].map((species, index) => benched(`b${index}`, species));
    expect(issuesOf(turn(four(), { bench: { own: five } })).field).toContainEqual({ field: "bench.own", message: "A bench holds at most four Pokémon." });
    const field = issuesOf(turn(four(), { bench: { own: [benched("slot:own-left", "garchomp"), benched("x", "gengar"), benched("x", "venusaur")] } })).field;
    expect(field).toContainEqual({ field: "bench.own.0", message: "Garchomp is already in play." });
    expect(field).toContainEqual({ field: "bench.own.2", message: "Two bench Pokémon have the same id." });
    const fainted = benched("f", "gengar");
    fainted.build = { ...fainted.build, currentHP: 0 };
    expect(issuesOf(turn(four(), { bench: { opponent: [fainted] } })).field.map((issue) => issue.message)).toContainEqual(expect.stringMatching(/^Bench Gengar: Current HP must be a whole number from 1 to \d+\.$/));
  });
  it("the counters a bench Pokémon keeps, as carriedIssues reads them", () => {
    const sleeper = benched("s", "gengar", { carried: { sleep: { attempts: 1, rest: false } } });
    expect(issuesOf(turn(four(), { bench: { own: [sleeper] } })).field).toContainEqual({ field: "bench.own.0", message: "Bench Gengar: turns lost to sleep need the Asleep status." });
    const frozen = benched("z", "gengar", { carried: { freeze: { attempts: 1 } } });
    expect(issuesOf(turn(four(), { bench: { own: [frozen] } })).field).toContainEqual({ field: "bench.own.0", message: "Bench Gengar: turns lost to freeze need the Frozen status." });
    const bond = benched("o", "gengar", { carried: { onceUsed: ["battlebond"] } });
    expect(issuesOf(turn(four(), { bench: { own: [bond] } })).field).toContainEqual({ field: "bench.own.0", message: "Bench Gengar: Battle Bond counts once a battle in Scarlet/Violet only." });
    const twice = benched("m", "gengar", { moves: ["shadowball", "shadowball"] });
    expect(issuesOf(turn(four(), { bench: { own: [twice] } })).field).toContainEqual({ field: "bench.own.0", message: "Bench Gengar: its moves list a move twice." });
  });
  it("a replacement on its side's bench", () => {
    const pokemon = issuesOf(turn(four(), { bench: { own: [benched("b1", "garchomp")], opponent: [benched("b2", "gengar")] }, replacement: { "own-left": "b2" } })).pokemon;
    expect(pokemon["own-left"]).toContainEqual({ field: "replacement", message: "Its replacement is not on its side's bench." });
    expect(calculateDoublesTurn(turn(four(), { bench: { own: [benched("b1", "garchomp")] }, replacement: { "own-left": "b1" } })).status).toBe("ready");
  });
  it("hazard layers, and G-Max Steelsurge in SwSh only", async () => {
    const field = issuesOf(turn(four(), { hazards: { own: { spikes: 4 as 3 }, opponent: { toxicSpikes: 3 as 2, steelsurge: true } } })).field;
    expect(field).toContainEqual({ field: "hazards.own.spikes", message: "Spikes have 1 to 3 layers." });
    expect(field).toContainEqual({ field: "hazards.opponent.toxicSpikes", message: "Toxic Spikes have 1 or 2 layers." });
    expect(field).toContainEqual({ field: "hazards.opponent.steelsurge", message: "G-Max Steelsurge is not in this game." });
    const swsh = await loadBattleRuntime("sword_shield");
    const ok = turn({ "own-left": { id: "snorlax", move: "bodyslam", target: "opponent-left" }, "own-right": { id: "snorlax" }, "opponent-left": { id: "snorlax" }, "opponent-right": { id: "snorlax" } },
      { hazards: { opponent: { steelsurge: true, stealthRock: true, spikes: 3, toxicSpikes: 2, stickyWeb: true } } }, swsh);
    expect(calculateDoublesTurn(ok).status).toBe("ready");
  });
});

describe("the World's R fields (doubles-world.ts; absent in today's worlds)", () => {
  const mon = (build: BattleBuild): MonState => ({
    build, fainted: false, moved: false, flinched: null, focusLost: false, charged: false, protect: null, centre: null, helpingHand: 0,
    hurt: false, damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false, vol: {}, eot: {},
  });
  const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, wideGuard: false, quickGuard: false, faintedThisTurn: 0, safeguard: false, hazards: [] };
  const world = (): World => ({
    mass: 1, mons: { "own-left": mon(createBuild("garchomp", championsRuntime)) }, sides: { own: { ...side }, opponent: { ...side } },
    field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false }, remaining: [], executed: 0, factors: [pointFactor("own-left", 100)],
  });
  it("discreteKey and cloneWorld are today's with none set, and carry them once set", () => {
    const w = world();
    expect(discreteKey(w)).toBe(JSON.stringify([w.mons, w.sides, w.field, w.remaining, w.executed, null, ["own-left"], null, null, null, null]));
    expect(Object.keys(cloneWorld(w)).sort()).toEqual(Object.keys(w).sort());
    const leaver = { id: startId("own-left"), slot: "own-left" as DoublesSlotId, mon: mon(createBuild("garchomp", championsRuntime)), hp: [[100, 1]] as const };
    const set = Object.assign(world(), { benched: { own: [leaver] }, bench: { own: ["b2"] }, switching: [{ slot: "own-left" as DoublesSlotId, how: "selfswitch" as const, moveId: "uturn" }] });
    set.mons["own-left"]!.id = "b1";
    const copy = cloneWorld(set);
    expect(copy.benched).toEqual(set.benched);
    expect(copy.bench).toEqual(set.bench);
    expect(copy.switching).toEqual(set.switching);
    expect(copy.mons["own-left"]!.id).toBe("b1");
    expect(discreteKey(copy)).toBe(discreteKey(set));
    expect(discreteKey(set)).not.toBe(discreteKey(w));
  });
  it("betweenActions keeps a world with no switch set, a hazard lands where none is up, benchedOutcome reports a leaver as E2 lists it", () => {
    const w = world();
    const kernel = {} as TurnKernel;
    expect(betweenActions(kernel, w)).toBeNull();
    expect(hazardFails(kernel, w, "opponent", "stealthrock")).toBeNull();
    // R-E: the side's hazards from before the turn (DoublesTurnInput.hazards) and this turn's: Stealth Rock up, three Spikes layers.
    const named = { baseInput: { hazards: { opponent: { stealthRock: true, spikes: 2 } } }, moveName: (id: string) => ({ stealthrock: "Stealth Rock", spikes: "Spikes" })[id] ?? id } as unknown as TurnKernel;
    expect(hazardFails(named, w, "opponent", "stealthrock")).toBe("Stealth Rock fails: it is already up on the opponent's side.");
    expect(hazardFails(named, w, "opponent", "spikes")).toBeNull();
    const third = { ...w, sides: { ...w.sides, opponent: { ...w.sides.opponent, hazards: ["spikes"] } } };
    expect(hazardFails(named, third, "opponent", "spikes")).toBe("Spikes fails: three layers are already up on the opponent's side.");
    expect(hazardFails(named, w, "own", "stealthrock")).toBeNull();
    const build = createBuild("garchomp", championsRuntime);
    const leaver = { id: "slot:own-left", slot: "own-left" as DoublesSlotId, mon: { ...mon(build), moved: true }, hp: [[50, 0.25], [80, 0.75]] as const };
    expect(benchedOutcome(kernel, w, leaver)).toEqual({ id: "slot:own-left", slot: "own-left", hp: [{ hp: 50, chance: 0.25 }, { hp: 80, chance: 0.75 }], build, protected: false, moved: true });
  });
});
