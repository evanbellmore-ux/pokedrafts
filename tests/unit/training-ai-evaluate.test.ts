import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import type { DoublesOutcome } from "@/app/lib/battle/doubles-types";
import { createCellEvaluator, nextClock, postFromOutcome } from "@/app/(app)/training/ai/evaluate";
import { megaOutlook } from "@/app/(app)/training/ai/mega";
import { damageRows, worthOf } from "@/app/(app)/training/ai/rows";
import { replacePolicy } from "@/app/(app)/training/ai/switches";
import { stateValue, valueWeights } from "@/app/(app)/training/ai/value";
import type { CellActions, EngineWorld } from "@/app/(app)/training/model/ai-view";
import { DEFAULT_BUDGET, type WorkBudget } from "@/app/(app)/training/model/decision";
import { emptyClock, makeView, postOf, runtime, type MonSpec } from "../fixtures/training-ai";
import { fakeServices } from "../fixtures/training-ai-services";

/** SPEC 10.5 cell evaluation over TurnServices (here the fake services of tests/fixtures/training-ai-services.ts). */
const garchomp: MonSpec = { side: "opponent", species: "garchomp", slot: "opponent-left", moves: ["earthquake", "dragonclaw", "rockslide", "protect"], ability: "roughskin", item: "lifeorb", nature: "Jolly", points: { hp: 2, atk: 32, spe: 32 } };
const charizard: MonSpec = { side: "opponent", species: "charizard", slot: "opponent-right", moves: ["heatwave", "airslash", "solarbeam", "protect"], ability: "blaze", item: "charizarditey", nature: "Modest", points: { hp: 2, spa: 32, spe: 32 }, canMega: true };
const kingambit: MonSpec = { side: "opponent", species: "kingambit", slot: null, moves: ["kowtowcleave", "suckerpunch", "ironhead", "protect"], ability: "defiant", item: "blackglasses", nature: "Adamant", points: { hp: 32, atk: 32 } };
const venusaur: MonSpec = { side: "own", species: "venusaur", slot: "own-left", moves: ["gigadrain", "sludgebomb", "sleeppowder", "protect"], ability: "chlorophyll", item: "", nature: "Modest", points: { hp: 32, spa: 32 } };
const rotom: MonSpec = { side: "own", species: "rotomwash", slot: "own-right", moves: ["hydropump", "thunderbolt", "willowisp", "protect"], ability: "levitate", item: "sitrusberry", nature: "Modest", points: { hp: 32, spa: 32 } };

function setup(specs: MonSpec[], budget: WorkBudget = DEFAULT_BUDGET, options: Parameters<typeof makeView>[1] = {}) {
  const view = makeView(specs, options);
  const rows = damageRows(view, runtime);
  const worth = worthOf(view, rows, runtime);
  const mega = megaOutlook(view, rows, runtime);
  const services = fakeServices(view);
  const weights = valueWeights();
  const evaluator = createCellEvaluator({ services, runtime, weights, worth, rows, replace: replacePolicy(view, rows, worth, runtime), budget, mega });
  const valueOf = (outcome: DoublesOutcome, start: Parameters<typeof postFromOutcome>[0]["start"], world: EngineWorld, cell: CellActions) =>
    stateValue(postFromOutcome({ view, base: postOf(view), residual: {}, outcome, start, world, cell }), { weights, worth, runtime, field: view.field, rows, particles: view.particles, view, mega });
  return { view, rows, worth, mega, services, evaluator, valueOf };
}

describe("cell evaluation", () => {
  it("values an engine cell as E[V] over E2's outcomes, with the first-order accuracy correction for a 90% Rock Slide", () => {
    const { evaluator, services, valueOf } = setup([garchomp, charizard, kingambit, venusaur, rotom]);
    const cell: CellActions = {
      opponent: { "opponent-left": { kind: "move", moveId: "rockslide", target: null }, "opponent-right": { kind: "move", moveId: "protect", target: null } },
      own: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "thunderbolt", target: "opponent-left" } },
    };
    const value = evaluator.evaluate(cell, "A")!;
    expect(value.method).toBe("engine");
    const worlds = services.engineWorlds(cell);
    if (worlds.kind !== "engine") throw new Error("expected engine worlds");
    const world = worlds.worlds[0];
    const expected = (input: typeof world.input) => {
      const result = calculateDoublesOutcomes(input);
      if (result.status !== "ready") throw new Error(result.status);
      return result.outcomes.reduce((sum, outcome) => sum + outcome.chance * valueOf(outcome, result.start, { ...world, input }, cell), 0);
    };
    const all = expected(world.input);
    const missed = expected({ ...world.input, pokemon: { ...world.input.pokemon, "opponent-left": { ...world.input.pokemon["opponent-left"]!, action: { moveId: null, target: null } } } });
    // Rock Slide 90% (PS/data/moves.ts rockslide accuracy 90); Thunderbolt 100.
    expect(value.value).toBeCloseTo(all + 0.1 * (missed - all), 9);
    expect(evaluator.used.engineCalls).toBe(2);
  });

  it("runs a Mega option through the prelude: the Mega form's Drought before the moves, megaUsed set, the lasting term counted", () => {
    const { evaluator, services } = setup([garchomp, charizard, kingambit, venusaur, rotom]);
    const cell: CellActions = {
      opponent: { "opponent-left": { kind: "move", moveId: "protect", target: null }, "opponent-right": { kind: "move", moveId: "heatwave", target: null, mega: "megay" } },
      own: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } },
    };
    const value = evaluator.evaluate(cell, "A")!;
    expect(value.method).toBe("prelude");
    const worlds = services.engineWorlds(cell);
    if (worlds.kind !== "engine") throw new Error("expected engine worlds");
    expect(worlds.worlds[0].input.field.weather).toBe("Sun");
    expect(worlds.worlds[0].input.pokemon["opponent-right"]!.build.speciesId).toBe("charizardmegay");
    expect(value.mega.lasting).not.toBe(0);
    expect(value.mega.keep).toBe(0);
    const plain = evaluator.evaluate({ ...cell, opponent: { ...cell.opponent, "opponent-right": { kind: "move", moveId: "heatwave", target: null } } }, "A")!;
    expect(plain.mega.lasting).toBe(0);
    expect(plain.mega.keep).toBeGreaterThan(0);
  });

  it("rolls out an unmodelled status move: stageASamples in stage A, topped up to stageBSamples in stage B, within the budget", () => {
    const budget = { ...DEFAULT_BUDGET, rolloutSamples: 9 };
    const { evaluator } = setup([garchomp, charizard, kingambit, venusaur, rotom], budget);
    const cell: CellActions = {
      opponent: { "opponent-left": { kind: "move", moveId: "dragonclaw", target: "own-right" }, "opponent-right": { kind: "move", moveId: "airslash", target: "own-left" } },
      own: { "own-left": { kind: "move", moveId: "sleeppowder", target: "opponent-left" }, "own-right": { kind: "move", moveId: "willowisp", target: "opponent-left" } },
    };
    const first = evaluator.evaluate(cell, "A")!;
    expect(first.method).toBe("rollout");
    expect(first.samples).toBe(DEFAULT_BUDGET.stageASamples);
    const topped = evaluator.evaluate(cell, "B")!;
    expect(topped.samples).toBe(DEFAULT_BUDGET.stageBSamples);
    const other = evaluator.evaluate({ ...cell, own: { ...cell.own, "own-left": { kind: "move", moveId: "gigadrain", target: "opponent-left" } } }, "A")!;
    expect(other.samples).toBe(1);
    expect(evaluator.used.rolloutSamples).toBe(9);
    expect(evaluator.evaluate({ ...cell, own: { ...cell.own, "own-left": { kind: "move", moveId: "sludgebomb", target: "opponent-left" } } }, "A")).toBeNull();
  });

  it("drops a cell world 0 rejects and returns null once the budget is spent", () => {
    const view = makeView([garchomp, charizard, kingambit, venusaur, rotom]);
    const rows = damageRows(view, runtime);
    const worth = worthOf(view, rows, runtime);
    const services = fakeServices(view, { skip: (cell) => cell.own["own-left"]?.kind === "switch" || cell.opponent["opponent-left"]?.kind === "pass" });
    const evaluator = createCellEvaluator({ services, runtime, weights: valueWeights(), worth, rows, replace: replacePolicy(view, rows, worth), budget: { ...DEFAULT_BUDGET, engineCalls: 1, rolloutSamples: 0 } });
    expect(evaluator.evaluate({ opponent: { "opponent-left": { kind: "pass" } }, own: {} }, "A")).toBeNull();
    const hit = (moveId: string): CellActions => ({ opponent: { "opponent-left": { kind: "move", moveId, target: "own-left" }, "opponent-right": { kind: "move", moveId: "protect", target: null } }, own: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } } });
    expect(evaluator.evaluate(hit("dragonclaw"), "A")?.method).toBe("engine");
    expect(evaluator.canEvaluate()).toBe(false);
    expect(evaluator.evaluate({ ...hit("dragonclaw"), own: { "own-left": { kind: "move", moveId: "gigadrain", target: "opponent-left" }, "own-right": { kind: "move", moveId: "protect", target: null } } }, "A")).toBeNull();
    expect(evaluator.used.engineCalls).toBeLessThanOrEqual(1);
  });
});

describe("the field clock after a turn", () => {
  const outcome = (changes: Partial<DoublesOutcome> = {}): DoublesOutcome => ({
    chance: 1, mons: {}, allFainted: { own: 0, opponent: 0 },
    sides: { own: { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, faintedThisTurn: 0 }, opponent: { reflect: false, lightScreen: false, auroraVeil: false, tailwind: true, faintedThisTurn: 0 } },
    field: { weather: "Sun", terrain: "", gravity: false, trickRoom: true, wonderRoom: false, magicRoom: false }, ...changes,
  });
  it("leaves 3 Tailwind and 4 Trick Room or weather turns when set this turn, counts down effects already up, and ends what the turn ended", () => {
    const set = nextClock(emptyClock(), outcome());
    expect(set.sides.opponent.tailwind).toBe(3);
    expect(set.rooms.trickRoom).toBe(4);
    expect(set.weather).toEqual({ id: "Sun", turns: 4 });
    const clock = { ...emptyClock(), weather: { id: "Sun" as const, turns: 2 }, rooms: { trickRoom: 1, gravity: 0, magicRoom: 0, wonderRoom: 0 } };
    clock.sides = { ...clock.sides, opponent: { ...clock.sides.opponent, tailwind: 2 } };
    const later = nextClock(clock, outcome());
    expect(later.sides.opponent.tailwind).toBe(1);
    expect(later.rooms.trickRoom).toBe(0);
    expect(later.weather).toEqual({ id: "Sun", turns: 1 });
    const ended = nextClock(clock, outcome({ field: { weather: "Rain", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false } }));
    expect(ended.weather).toEqual({ id: "Rain", turns: 4 });
    expect(ended.rooms.trickRoom).toBe(0);
    expect(nextClock(emptyClock(), outcome(), { own: ["stealthrock", "spikes"] }).sides.own).toMatchObject({ stealthRock: true, spikes: 1 });
  });
});
