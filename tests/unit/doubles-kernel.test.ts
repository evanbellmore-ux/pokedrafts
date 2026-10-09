import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import {
  cloneWorld, discreteKey, endTrap, lossDist, mapJoint, marginal, occupant, pointFactor, positionOf, type MonState, type World,
} from "@/app/lib/battle/doubles-world";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleStatus } from "@/app/lib/battle/types";

/**
 * Step 0 of the 2v2 status moves and end of turn (scripts/.cache/calc-audit/status-eot/design SPEC.md §3, ADDENDUM.md §3):
 * the world helpers for positions, losses and joint maps; the contract's input checks; and the stubs' behaviour (the end
 * of turn not applied, a hit into a Substitute not estimated, the outcomes' new fields).
 */
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
type P = { id: string; ability?: string; item?: string; status?: BattleStatus; move?: string | null; target?: DoublesSlotId | null; carried?: DoublesCarried; lastMove?: string | null; moves?: string[] };
function turn(runtime: BattleRuntime, slots: Record<DoublesSlotId, P | null>): DoublesTurnInput {
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const base = createBuild(p.id, runtime);
    const abilityId = p.ability ?? base.abilityId;
    const build = { ...base, abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "", status: p.status ?? "", currentHP: null } as BattleBuild;
    const entry: DoublesPokemonInput = {
      build, contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null },
      ...(p.carried ? { carried: p.carried } : {}), ...(p.lastMove !== undefined ? { lastMove: p.lastMove } : {}), ...(p.moves ? { moves: p.moves } : {}),
    };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon };
}
const idle = (id: string, extra: Partial<P> = {}): P => ({ id, move: null, ...extra });

function mon(): MonState {
  return {
    build: createBuild("garchomp"), fainted: false, moved: false, flinched: null, focusLost: false, charged: false, protect: null, centre: null, helpingHand: 0,
    hurt: false, damagedBy: [], timesAttacked: 0, statsLowered: false, statsRaised: false, vol: {}, eot: {},
  };
}
function world(): World {
  const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, wideGuard: false, quickGuard: false, faintedThisTurn: 0, safeguard: false, hazards: [] };
  return {
    mass: 1, mons: { "own-left": mon(), "own-right": mon(), "opponent-left": mon(), "opponent-right": mon() }, sides: { own: { ...side }, opponent: { ...side } },
    field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false }, remaining: [], executed: 0,
    factors: [pointFactor("own-left", 100), { slots: ["own-right"], table: new Map([[50, 0.5], [80, 0.5]]) }, pointFactor("opponent-left", 60), pointFactor("opponent-right", 10)],
  };
}

describe("positions (ADDENDUM §3.4)", () => {
  it("without an Ally Switch every Pokémon stands in its own slot; after one its side's two stand swapped", () => {
    const w = world();
    for (const slot of SLOTS) { expect(positionOf(w, slot)).toBe(slot); expect(occupant(w, slot)).toBe(slot); }
    w.swapped = { own: true };
    expect(positionOf(w, "own-left")).toBe("own-right");
    expect(occupant(w, "own-right")).toBe("own-left");
    expect(positionOf(w, "opponent-left")).toBe("opponent-left");
    for (const slot of SLOTS) expect(occupant(w, positionOf(w, slot))).toBe(slot);
  });

  it("endTrap ends a partial trap; cloneWorld copies the new world state; discreteKey reads it", () => {
    const w = world();
    w.mons["own-left"]!.eot = { trap: { source: "opponent-left", divisor: 8 }, saltCure: true };
    endTrap(w, "own-left");
    expect(w.mons["own-left"]!.eot.trap).toBeUndefined();
    expect(w.mons["own-left"]!.eot.saltCure).toBe(true);
    w.swapped = { opponent: true }; w.itemsMoved = ["own-left"]; w.leaving = ["own-right"]; w.endGuard = "Attract is not modelled.";
    const copy = cloneWorld(w, 0.5);
    expect(copy).toMatchObject({ mass: 0.5, swapped: { opponent: true }, itemsMoved: ["own-left"], leaving: ["own-right"], endGuard: "Attract is not modelled." });
    copy.mons["own-left"]!.vol.substitute = 30;
    expect(w.mons["own-left"]!.vol.substitute).toBeUndefined();
    const plain = world();
    expect(discreteKey(cloneWorld(plain))).toBe(discreteKey(plain));
    for (const change of [(x: World) => { x.swapped = { own: true }; }, (x: World) => { x.endGuard = "x"; }, (x: World) => { x.leaving = ["own-left"]; }]) {
      const other = cloneWorld(plain);
      change(other);
      expect(discreteKey(other)).not.toBe(discreteKey(plain));
    }
  });
});

describe("lossDist and mapJoint (SPEC §3.4)", () => {
  it("lossDist convolves a loss distribution into the slot's factor, one world per tag", () => {
    const w = world();
    const out = lossDist(w, "own-right", new Map([[10, 0.25], [60, 0.75]]), (hp, loss) => {
      const left = Math.max(0, hp - loss);
      return { hp: left, tag: left <= 0 ? "fainted" : "in" };
    });
    const byTag = Object.fromEntries(out.map(({ world: each, tag }) => [tag, { mass: each.mass, hp: [...marginal(each, "own-right")].sort((a, b) => a[0] - b[0]) }]));
    // 50 → 40 (1/8), 80 → 70 (1/8), 80 → 20 (3/8); 50 → 0 (3/8).
    expect(byTag.fainted.mass).toBeCloseTo(0.375, 12);
    expect(byTag.fainted.hp).toEqual([[0, 1]]);
    expect(byTag.in.mass).toBeCloseTo(0.625, 12);
    expect(byTag.in.hp.map(([hp, mass]) => [hp, Number(mass.toFixed(12))])).toEqual([[20, 0.6], [40, 0.2], [70, 0.2]]);
    expect(marginal(w, "own-right").size).toBe(2);
  });

  it("mapJoint rewrites two Pokémon's HPs together (Pain Split) and splits them again where they are independent", () => {
    const w = world();
    const [only] = mapJoint(w, ["own-right", "opponent-left"], (a, b) => { const each = Math.floor((a + b) / 2) || 1; return { hp: [each, each], tag: "" }; });
    expect(only.world.mass).toBe(1);
    expect([...marginal(only.world, "own-right")].sort((x, y) => x[0] - y[0])).toEqual([[55, 0.5], [70, 0.5]]);
    expect([...marginal(only.world, "opponent-left")].sort((x, y) => x[0] - y[0])).toEqual([[55, 0.5], [70, 0.5]]);
    // The two HPs are equal in every entry: one joint factor.
    expect(only.world.factors.some((factor) => factor.slots.length === 2)).toBe(true);
    const [same] = mapJoint(w, ["own-left", "opponent-right"], (a, b) => ({ hp: [a - 1, b + 1], tag: "" }));
    expect(same.world.factors.every((factor) => factor.slots.length === 1)).toBe(true);
    expect([...marginal(same.world, "own-left")]).toEqual([[99, 1]]);
  });
});

describe("the contract's input checks (SPEC §3.1, ADDENDUM §3.1)", () => {
  const issues = (slot: P) => {
    const result = calculateDoublesTurn(turn(championsRuntime, { "own-left": slot, "own-right": idle("venusaur"), "opponent-left": idle("blastoise"), "opponent-right": idle("pikachu") }));
    return result.status === "issues" ? (result.issues.pokemon["own-left"] ?? []).map((issue) => issue.message) : [];
  };
  it("reports each impossible state from earlier turns on its slot", () => {
    expect(issues(idle("garchomp", { carried: { sleep: { attempts: 1, rest: false } } }))).toEqual(["turns lost to sleep need the Asleep status."]);
    expect(issues(idle("garchomp", { status: "slp", carried: { sleep: { attempts: 3, rest: false } } }))).toEqual(["it cannot have lost 3 turns to sleep."]);
    expect(issues(idle("garchomp", { status: "slp", carried: { sleep: { attempts: 2, rest: false } } }))).toEqual([]);
    expect(issues(idle("garchomp", { carried: { freeze: { attempts: 1 } } }))).toEqual(["turns lost to freeze need the Frozen status."]);
    expect(issues(idle("garchomp", { status: "frz", carried: { freeze: { attempts: 3 } } }))).toEqual(["it cannot have lost 3 turns to freeze."]);
    expect(issues(idle("garchomp", { carried: { confusion: { attempts: 5 } } }))).toEqual(["confusion turns so far are 0 to 4."]);
    expect(issues(idle("garchomp", { carried: { toxic: 2 } }))).toEqual(["bad poison turns need the Badly poisoned status."]);
    expect(issues(idle("garchomp", { status: "tox", carried: { toxic: 16 } }))).toEqual(["bad poison turns are 0 to 15."]);
    expect(issues(idle("garchomp", { carried: { leechSeed: "own-right" } }))).toEqual(["Leech Seed's seeder is not a foe in the turn."]);
    expect(issues(idle("garchomp", { carried: { trap: { source: "opponent-left", bindingBand: false }, syrupBomb: "own-left" } }))).toEqual(["Syrup Bomb's source is not a foe in the turn."]);
    expect(issues(idle("garchomp", { carried: { perish: 4 as 3 } }))).toEqual(["the perish count is 1, 2 or 3."]);
    expect(issues(idle("garchomp", { carried: { wish: 0, substitute: 0 } }))).toEqual(["a Wish restores at least 1 HP.", "a Substitute has at least 1 HP."]);
    expect(issues(idle("garchomp", { carried: { allySwitch: 4 as 3 } }))).toEqual(["Ally Switch's counter is 3, 9, 27, 81, 243 or 729 (Scarlet/Violet and Champions)."]);
    expect(issues(idle("garchomp", { lastMove: "notamove", moves: ["earthquake", "earthquake"] }))).toEqual(["its last move is not in this game.", "its moves list a move twice."]);
    expect(issues(idle("garchomp", { lastMove: null, moves: ["earthquake", "protect"], carried: { substitute: 44, allySwitch: 9, wish: 300 } }))).toEqual([]);
  });
});

describe("the hooks as the tracks filled Step 0's stubs", () => {
  const field = (own: P) => turn(championsRuntime, { "own-left": own, "own-right": idle("venusaur"), "opponent-left": idle("blastoise", { carried: { substitute: 40 } }), "opponent-right": idle("pikachu") });
  it("the end of turn is applied, in the turn and in its outcomes", () => {
    const result = calculateDoublesTurn(field(idle("garchomp")));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.endOfTurn.status).toBe("ready");
    expect(result.facts).not.toContain("End-of-turn effects are not applied.");
    expect(result.swapped).toBeUndefined();
    const outcomes = calculateDoublesOutcomes(field(idle("garchomp")));
    expect(outcomes.status).toBe("ready");
    if (outcomes.status !== "ready") return;
    expect(outcomes.endOfTurn).toBe("applied");
    expect(outcomes.outcomes.map((outcome) => outcome.positions)).toEqual([{ own: "kept", opponent: "kept" }]);
    // A Substitute from an earlier turn stands after the turn.
    expect(outcomes.outcomes[0].mons["opponent-left"]).toMatchObject({ volatiles: ["substitute"], substitute: [{ hp: 40, chance: 1 }] });
    expect(outcomes.outcomes[0].mons["opponent-right"]!.volatiles).toBeUndefined();
  });

  it("a damaging hit into a Substitute meets it; a sound move passes it", () => {
    const hit = calculateDoublesTurn(field({ id: "garchomp", move: "dragonclaw", target: "opponent-left" }));
    expect(hit.status).toBe("ready");
    if (hit.status !== "ready") return;
    expect(hit.steps[0].hits[0]).toMatchObject({ kind: "substitute" });
    // Hyper Voice (sound: bypasssub) hits Blastoise itself.
    const sound = calculateDoublesTurn(field({ id: "sylveon", move: "hypervoice", target: null }));
    expect(sound.status).toBe("ready");
    if (sound.status !== "ready") return;
    expect(sound.steps[0].hits.find((each) => each.slot === "opponent-left")).toMatchObject({ kind: "calculated" });
  });
});
