import { describe, expect, it } from "vitest";
import { calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { cloneWorld, discreteKey, pointFactor, withSpecies, type MonState, type World } from "@/app/lib/battle/doubles-world";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleConditions } from "@/app/lib/battle/types";

/**
 * status2 Step 0a's kernel plumbing (scripts/.cache/calc-audit/status2/design ADDENDUM2.md §3.5, tier2-eot-training.md §3.5,
 * §4.7): a Pokémon that switched in this turn (no action; Payback not doubled into it, Analytic not waiting for it), Struggle
 * as a legal action with its recoil, the conditional turn facts, the new input issues, and the World helpers (withSpecies,
 * discreteKey with no new field set). The numbers are pinned Showdown's (tier2-eot-training-probes-2.out TR06a, TR09,
 * TR09b, TR09c, TR10a); TR10a's Speed 1 is Trick Room here.
 */
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
type P = { id: string; ability?: string; move?: string | null; target?: DoublesSlotId | null; extra?: Partial<DoublesPokemonInput> };
function turn(slots: Record<DoublesSlotId, P | null>, field: Partial<BattleConditions> = {}): DoublesTurnInput {
  const runtime = championsRuntime;
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const base = createBuild(p.id, runtime);
    const abilityId = p.ability ?? base.abilityId;
    const build = { ...base, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: "", status: "", currentHP: null } as BattleBuild;
    return [slot, { build, contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null }, ...p.extra } as DoublesPokemonInput];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles", ...field }, pokemon };
}
const lax = (extra: Partial<P> = {}): P => ({ id: "snorlax", ability: "thickfat", move: null, ...extra });
function ready(input: DoublesTurnInput) {
  const result = calculateDoublesTurn(input);
  if (result.status !== "ready") throw new Error(`expected a ready turn, got ${result.status}: ${JSON.stringify(result)}`);
  return result;
}
const hit = (result: ReturnType<typeof ready>, slot: DoublesSlotId, target: DoublesSlotId) => result.steps.find((step) => step.slot === slot)!.hits.find((each) => each.slot === target)!;

describe("a Pokémon that switched in this turn (T2E §4.7.4)", () => {
  it("takes no action and is not doubled into by Payback (TR06a: 51)", () => {
    const result = ready(turn({
      "own-left": { id: "tyranitar", ability: "unnerve", move: "payback", target: "opponent-left" }, "own-right": lax(),
      "opponent-left": lax({ extra: { switchedIn: true } }), "opponent-right": lax(),
    }));
    expect(hit(result, "own-left", "opponent-left")).toMatchObject({ min: 51, max: 61 });
    expect(result.steps.map((step) => step.slot)).not.toContain("opponent-left");
    expect(result.facts).toContain("Snorlax (opponent's, 1) switched in this turn and takes no action.");
  });
  it("leaves Analytic waiting for no one (TR10a)", () => {
    const into = (switchedIn: boolean) => hit(ready(turn({
      "own-left": { id: "starmie", ability: "analytic", move: "hydropump", target: "opponent-left" }, "own-right": lax(),
      "opponent-left": { id: "jolteon", ability: "voltabsorb", move: null, ...(switchedIn ? { extra: { switchedIn: true } } : {}) }, "opponent-right": lax(),
    }, { trickRoom: true })), "own-left", "opponent-left");
    // Under Trick Room the faster Jolteon moves after Starmie unless it switched in (no action): Analytic's 1.3x then.
    expect(into(false)).toMatchObject({ min: 66, max: 78 });
    expect(into(true)).toMatchObject({ min: 84, max: 100 });
  });
  it("is an input issue with a move action", () => {
    const result = calculateDoublesTurn(turn({ "own-left": lax({ move: "bodyslam", target: "opponent-left", extra: { switchedIn: true } }), "own-right": lax(), "opponent-left": lax(), "opponent-right": lax() }));
    expect(result.status).toBe("issues");
    if (result.status === "issues") expect(result.issues.pokemon["own-left"]?.map((issue) => issue.message)).toContain("A Pokémon that switched in this turn takes no move.");
  });
});

describe("Struggle (T2E §4.7.2)", () => {
  it("is legal for any Pokémon, hits a random foe and recoils a quarter of its base maximum HP (TR09: 176 of 235)", () => {
    const result = ready(turn({ "own-left": lax({ move: "struggle" }), "own-right": lax(), "opponent-left": { id: "gengar", ability: "cursedbody", move: null }, "opponent-right": lax() }));
    expect(hit(result, "own-left", "opponent-left")).toMatchObject({ reached: 0.5, min: 31, max: 37 });
    expect(hit(result, "own-left", "opponent-right")).toMatchObject({ reached: 0.5, min: 29, max: 35 });
    expect(result.hp["own-left"]).toMatchObject({ min: 176, max: 176 });
  });
  it("recoils after a hit into a Substitute (TR09b) and not into Protect (TR09c)", () => {
    const sub = ready(turn({ "own-left": lax({ move: "struggle" }), "own-right": lax(), "opponent-left": lax({ extra: { carried: { substitute: 40 } } }), "opponent-right": null }));
    expect(sub.hp["own-left"]).toMatchObject({ min: 176, max: 176 });
    const protect = ready(turn({ "own-left": lax({ move: "struggle" }), "own-right": lax(), "opponent-left": lax({ move: "protect" }), "opponent-right": null }));
    expect(protect.hp["own-left"]).toMatchObject({ min: 235, max: 235 });
  });
});

describe("the conditional turn facts (T2E §3.5, IN §6)", () => {
  it("a carried stall counter assumes nothing about last turn; must recharge is stated", () => {
    const protect = (stall?: 1) => ready(turn({ "own-left": lax({ move: "protect", ...(stall ? { extra: { carried: { stall } } } : {}) }), "own-right": lax(), "opponent-left": lax(), "opponent-right": lax() })).facts;
    expect(protect()).toContain("Assumes no protecting move was used last turn.");
    expect(protect(1)).not.toContain("Assumes no protecting move was used last turn.");
    const recharge = ready(turn({ "own-left": lax({ extra: { carried: { mustRecharge: true } } }), "own-right": lax(), "opponent-left": lax(), "opponent-right": lax() }));
    expect(recharge.facts).toContain("Snorlax (yours, 1) must recharge.");
  });
});

describe("the World helpers (SPEC2 §3.3)", () => {
  const mon = (build: BattleBuild): MonState => ({
    build, fainted: false, moved: false, flinched: null, focusLost: false, charged: false, protect: null, centre: null, helpingHand: 0,
    hurt: false, damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false, vol: {}, eot: {},
  });
  it("withSpecies drops the world types, stored stats and weight, keeping the build's key order", () => {
    const build = createBuild("aegislash", championsRuntime);
    const changed = withSpecies({ ...build, types: ["Ghost"], addedType: "Grass", storedStats: { atk: 1, def: 2, spa: 3, spd: 4, spe: 5 }, weighthg: 10 }, "aegislashblade");
    expect(changed).toEqual({ ...build, speciesId: "aegislashblade" });
    expect(Object.keys(changed)).toEqual(Object.keys(build));
  });
  it("discreteKey is today's while no new World field is set, and cloneWorld copies them only when set", () => {
    const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, wideGuard: false, quickGuard: false, faintedThisTurn: 0, safeguard: false, hazards: [] };
    const w: World = {
      mass: 1, mons: { "own-left": mon(createBuild("garchomp", championsRuntime)) }, sides: { own: { ...side }, opponent: { ...side } },
      field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false }, remaining: [], executed: 0, factors: [pointFactor("own-left", 100)],
    };
    // Today's key (doubles-world.ts at 4008ee8): eleven entries, no status2 entry.
    expect(discreteKey(w)).toBe(JSON.stringify([w.mons, w.sides, w.field, w.remaining, w.executed, null, ["own-left"], null, null, null, null]));
    expect(Object.keys(cloneWorld(w)).sort()).toEqual(Object.keys(w).sort());
    const set = cloneWorld(Object.assign(cloneWorld(w), { lastMove: "tackle", didSomething: true as const }));
    expect(set.lastMove).toBe("tackle");
    expect(discreteKey(set)).not.toBe(discreteKey(w));
  });
});
