import { beforeAll, describe, expect, it, vi } from "vitest";
import * as positions from "@/app/lib/battle/doubles-positions";
import { calculateDoublesOutcomes, calculateDoublesTurn, type TurnKernel } from "@/app/lib/battle/doubles-turn";
import type { DoublesCarried, DoublesPokemonInput, DoublesSlotId, DoublesTurnInput, DoublesTurnResult } from "@/app/lib/battle/doubles-types";
import { cloneWorld, occupant, pointFactor, positionOf, type PendingAction, type World } from "@/app/lib/battle/doubles-world";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
import { createBuild, createConditions, defaultAbilityActive } from "@/app/lib/battle/model";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleBuild, BattleGame, ChampionsMove } from "@/app/lib/battle/types";

/**
 * Ally Switch and positions in the 2v2 turn (status-eot ADDENDUM §4.11, doubles-positions.ts) against pinned Showdown
 * c23d2e94 (data/moves.ts:302-354, data/mods/gen8/moves.ts:2-6, sim/battle.ts:1588-1607 swapPosition; the design probes
 * addendum-probes-1.out A1-A11 and critic-probes-1.out K4), through Track A's pipeline (doubles-status.ts: the status
 * table's handler key `allySwitch`, PrepareHit then onHit) and the kernel's position plumbing (doubles-turn.ts).
 */

type P = { id: string; ability?: string; item?: string; hp?: number; move?: string | null; target?: DoublesSlotId | null; carried?: DoublesCarried; evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>> };
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const runtimes = {} as Record<BattleGame, BattleRuntime>;
beforeAll(async () => {
  for (const game of ["scarlet_violet", "sword_shield", "ultra_sun_ultra_moon", "champions"] as const) runtimes[game] = await loadBattleRuntime(game);
});
function input(game: BattleGame, slots: Partial<Record<DoublesSlotId, P>>): DoublesTurnInput {
  const runtime = runtimes[game];
  const pokemon = Object.fromEntries(SLOTS.map((slot) => {
    const p = slots[slot];
    if (!p) return [slot, null];
    const base = createBuild(p.id, runtime);
    const abilityId = p.ability ?? base.abilityId;
    const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const trained = base.game === "champions" ? { points: { ...zero, ...p.evs } } : { native: { level: 50, evs: { ...zero, ...p.evs }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } } };
    const build = { ...base, ...trained, nature: "Serious", abilityId, abilityActive: defaultAbilityActive(abilityId), itemId: p.item ?? "", currentHP: p.hp ?? null, status: "" } as BattleBuild;
    const entry: DoublesPokemonInput = { build, contexts: {}, charged: false, action: { moveId: p.move ?? null, target: p.target ?? null }, ...(p.carried ? { carried: p.carried } : {}) };
    return [slot, entry];
  })) as Record<DoublesSlotId, DoublesPokemonInput | null>;
  return { runtime, field: { ...createConditions(), gameType: "Doubles" }, pokemon };
}
const idle = (id: string, extra: Partial<P> = {}): P => ({ id, move: null, ...extra });
function ready(result: DoublesTurnResult): Extract<DoublesTurnResult, { status: "ready" }> {
  if (result.status !== "ready") throw new Error(`not ready: ${JSON.stringify(result).slice(0, 400)}`);
  return result;
}
const facts = (result: Extract<DoublesTurnResult, { status: "ready" }>, slot: DoublesSlotId) => Object.fromEntries(result.steps.find((step) => step.slot === slot)!.facts.map((fact) => [fact.text, fact.chance]));
/** Each game's Ally Switch user and the slow Pokémon that fills a slot. */
const SWITCHER: Record<BattleGame, string> = { scarlet_violet: "reuniclus", champions: "reuniclus", sword_shield: "chansey", ultra_sun_ultra_moon: "chansey" };
const FILLER: Record<BattleGame, string> = { scarlet_violet: "torkoal", champions: "torkoal", sword_shield: "shuckle", ultra_sun_ultra_moon: "shuckle" };

describe("positionOf and occupant", () => {
  it("map a Pokémon to where it stands and back, each side apart", () => {
    const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, wideGuard: false, quickGuard: false, faintedThisTurn: 0, safeguard: false, hazards: [] };
    const w = {
      mass: 1, mons: {}, sides: { own: side, opponent: side }, field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false },
      remaining: [], executed: 0, factors: [pointFactor("own-left", 1)],
    } as unknown as World;
    for (const slot of SLOTS) expect([positionOf(w, slot), occupant(w, slot)]).toEqual([slot, slot]);
    const swapped = cloneWorld(w);
    swapped.swapped = { opponent: true };
    expect(positionOf(swapped, "opponent-left")).toBe("opponent-right");
    expect(occupant(swapped, "opponent-left")).toBe("opponent-right");
    expect(positionOf(swapped, "own-left")).toBe("own-left");
  });
});

describe("a move aimed at a position hits its occupant (A1, A1b)", () => {
  it("+2 in every game: Aqua Jet aimed at the switcher's old position hits the Pokémon now there", () => {
    for (const game of ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"] as const) {
      const turn = input(game, {
        "own-left": idle("garchomp"), "own-right": { id: SWITCHER[game], move: "allyswitch" },
        "opponent-right": { id: "azumarill", move: "aquajet", target: "own-left" }, "opponent-left": idle(FILLER[game]),
      });
      const result = ready(calculateDoublesTurn(turn));
      expect(result.steps[0].slot, game).toBe("own-right");
      expect(result.swapped, game).toEqual({ own: 1 });
      const jet = result.steps.find((step) => step.slot === "opponent-right")!;
      expect(jet.hits.map((hit) => hit.slot), game).toEqual(["own-right"]);
      expect(facts(result, "opponent-right"), game).toEqual({ [`Ally Switch: Aqua Jet hits ${result.steps[0].slot === "own-right" ? turn.runtime.speciesById.get(SWITCHER[game])!.name : ""} in Garchomp's place.`]: 1 });
      expect(facts(result, "own-right")).toEqual({ [`Ally Switch: ${turn.runtime.speciesById.get(SWITCHER[game])!.name} and Garchomp swap places.`]: 1 });
      expect(result.hp["own-left"]!.max).toBe(result.hp["own-left"]!.start);
      expect(result.hp["own-right"]!.max).toBeLessThan(result.hp["own-right"]!.start);
      expect(result.hp["own-right"]!.conditions).toEqual([{ text: "Swapped places with Garchomp.", chance: 1 }]);
      const out = calculateDoublesOutcomes(turn);
      if (out.status !== "ready") throw new Error(out.status);
      expect(out.outcomes.every((outcome) => outcome.positions.own === "swapped" && outcome.positions.opponent === "kept")).toBe(true);
      // The counter after a first use: Scarlet/Violet and Champions only.
      const counter = out.outcomes[0].mons["own-right"]!;
      if (game === "scarlet_violet" || game === "champions") expect(counter).toMatchObject({ allySwitch: 3, volatiles: ["allyswitch"] });
      else expect(counter.allySwitch).toBeUndefined();
    }
  });
  it("Fake Out (+3) first: the switcher flinches, no swap (A1b)", () => {
    const result = ready(calculateDoublesTurn(input("scarlet_violet", {
      "own-left": idle("garchomp"), "own-right": { id: "reuniclus", move: "allyswitch" }, "opponent-right": { id: "incineroar", move: "fakeout", target: "own-right" }, "opponent-left": idle("torkoal"),
    })));
    expect(result.swapped).toBeUndefined();
    expect(result.steps.find((step) => step.slot === "own-right")!.moves).toBe(0);
  });
});

describe("a move its user aims at its own ally after the ally's Ally Switch (A2, K4)", () => {
  const atAlly = (attacker: P) => calculateDoublesTurn(input("scarlet_violet", {
    "own-left": { target: "own-right", ...attacker }, "own-right": { id: "reuniclus", move: "allyswitch" }, "opponent-right": idle("hatterene"), "opponent-left": idle("torkoal"),
  }));
  it("a plain move fails: the user stands at the aimed position", () => {
    const result = ready(atAlly({ id: "snorlax", move: "bodyslam" }));
    expect(facts(result, "own-left")).toEqual({ "Body Slam fails: after Ally Switch, Snorlax stands in Reuniclus's place.": 1 });
    expect(result.steps.find((step) => step.slot === "own-left")!.hits).toEqual([]);
  });
  it("Dragon Darts there is not followed", () => {
    expect(atAlly({ id: "dragapult", move: "dragondarts" })).toMatchObject({ status: "not-estimated", reason: "Dragon Darts aimed where its user now stands is not modelled in 2v2." });
  });
  it("Snipe Shot and a Stalwart user keep the ally chosen at queue time and hit it (K4)", () => {
    for (const attacker of [{ id: "inteleon", move: "snipeshot" }, { id: "duraludon", ability: "stalwart", move: "flashcannon" }]) {
      const result = ready(atAlly(attacker));
      expect(result.steps.find((step) => step.slot === "own-left")!.hits.map((hit) => hit.slot)).toEqual(["own-right"]);
      expect(result.hp["own-right"]!.max).toBeLessThan(result.hp["own-right"]!.start);
    }
  });
});

describe("tracking, redirection, spread order (A3, A4, A5)", () => {
  const foeSwap = (attacker: P, extra: Partial<Record<DoublesSlotId, P>> = {}) => calculateDoublesTurn(input("scarlet_violet", {
    "own-left": attacker, "own-right": idle("blissey"), "opponent-right": idle("snorlax"), "opponent-left": { id: "farigiraf", move: "allyswitch" }, ...extra,
  }));
  it("a plain move aimed at a position hits the new occupant; Stalwart and Snipe Shot keep the Pokémon (A4)", () => {
    const plain = ready(foeSwap({ id: "garchomp", move: "dragonclaw", target: "opponent-right" }));
    expect(plain.steps.find((step) => step.slot === "own-left")!.hits.map((hit) => hit.slot)).toEqual(["opponent-left"]);
    for (const attacker of [{ id: "inteleon", move: "snipeshot", target: "opponent-right" as const }, { id: "duraludon", ability: "stalwart", move: "flashcannon", target: "opponent-right" as const }]) {
      const kept = ready(foeSwap(attacker));
      expect(kept.steps.find((step) => step.slot === "own-left")!.hits.map((hit) => hit.slot)).toEqual(["opponent-right"]);
    }
  });
  it("Follow Me follows the Pokémon to its new position (A3)", () => {
    const result = ready(calculateDoublesTurn(input("scarlet_violet", {
      "own-left": { id: "snorlax", move: "bodyslam", target: "opponent-right" }, "own-right": idle("blissey"),
      "opponent-right": { id: "clefable", move: "followme" }, "opponent-left": { id: "farigiraf", move: "allyswitch" },
    })));
    expect(result.steps.find((step) => step.slot === "own-left")!.hits.map((hit) => hit.slot)).toEqual(["opponent-right"]);
  });
  it("Sucker Punch reads the queued move of the Pokémon now at the aimed position (E12)", () => {
    const punch = (switcher: string | null) => ready(calculateDoublesTurn(input("scarlet_violet", {
      "own-left": { id: "kingambit", move: "suckerpunch", target: "opponent-right" }, "own-right": idle("blissey"),
      "opponent-right": { id: "snorlax", move: "bodyslam", target: "own-right" }, "opponent-left": { id: "reuniclus", move: switcher },
    })));
    expect(punch(null).steps.find((step) => step.slot === "own-left")!.hits.map((hit) => hit.slot)).toEqual(["opponent-right"]);
    // Reuniclus (not Farigiraf: its Armor Tail stops priority moves), its move used, now stands there: Sucker Punch fails on it.
    // The move fails at TryMove, so no "hits Reuniclus in Snorlax's place" fact (it hits no one).
    expect(facts(punch("allyswitch"), "own-left")).toEqual({ "Sucker Punch fails: Reuniclus has no attacking move.": 1 });
  });
  it("a spread move hits the foes in their new position order (A5)", () => {
    const before = ready(foeSwap({ id: "garchomp", move: "rockslide" }, { "opponent-left": idle("farigiraf") }));
    const after = ready(foeSwap({ id: "garchomp", move: "rockslide" }));
    const order = (result: typeof before) => result.steps.find((step) => step.slot === "own-left")!.hits.map((hit) => hit.slot);
    expect(order(before)).toEqual(["opponent-right", "opponent-left"]);
    expect(order(after)).toEqual(["opponent-left", "opponent-right"]);
  });
});

describe("the repeat counter (A8, A9, A11)", () => {
  const field = (game: BattleGame, carried?: DoublesCarried, partner: P | null = idle("garchomp")) => input(game, {
    ...(partner ? { "own-left": partner } : {}), "own-right": { id: SWITCHER[game], move: "allyswitch", ...(carried ? { carried } : {}) },
    "opponent-right": idle("snorlax"), "opponent-left": idle(FILLER[game]),
  });
  it("Scarlet/Violet and Champions: a use the turn after works 1/3, the counter then 9; the fact without a carried counter", () => {
    for (const game of ["scarlet_violet", "champions"] as const) {
      const result = ready(calculateDoublesTurn(field(game, { allySwitch: 3 })));
      expect(result.swapped?.own).toBeCloseTo(1 / 3, 12);
      expect(facts(result, "own-right")["Ally Switch fails: it was used last turn."]).toBeCloseTo(2 / 3, 12);
      expect(result.facts).not.toContain(`Assumes Reuniclus did not use Ally Switch last turn.`);
      const out = calculateDoublesOutcomes(field(game, { allySwitch: 3 }));
      if (out.status !== "ready") throw new Error(out.status);
      const counters = out.outcomes.map((outcome) => [outcome.positions.own, outcome.mons["own-right"]!.allySwitch ?? null, outcome.chance]);
      expect(counters.sort()).toEqual([["kept", null, expect.closeTo(2 / 3, 12)], ["swapped", 9, expect.closeTo(1 / 3, 12)]].sort());
      expect(ready(calculateDoublesTurn(field(game))).facts).toContain("Assumes Reuniclus did not use Ally Switch last turn.");
      // ×3 per use, at most 729.
      const top = calculateDoublesOutcomes(field(game, { allySwitch: 729 }));
      if (top.status !== "ready") throw new Error(top.status);
      expect(top.outcomes.find((outcome) => outcome.positions.own === "swapped")!.mons["own-right"]!.allySwitch).toBe(729);
    }
  });
  it("Sword/Shield and Ultra Sun/Ultra Moon: no counter, every use works, no fact", () => {
    for (const game of ["sword_shield", "ultra_sun_ultra_moon"] as const) {
      const result = ready(calculateDoublesTurn(field(game)));
      expect(result.swapped).toEqual({ own: 1 });
      expect(result.facts.some((fact) => fact.includes("Ally Switch"))).toBe(false);
    }
  });
  it("fails with its ally's slot empty or its ally fainted; the counter still rolls first (A9, A11)", () => {
    const empty = ready(calculateDoublesTurn(field("scarlet_violet", undefined, null)));
    expect(empty.swapped).toBeUndefined();
    expect(facts(empty, "own-right")).toEqual({ "Ally Switch fails: its ally has fainted.": 1 });
    // Its ally knocked out first by a faster foe; with a carried counter the roll comes before the failure.
    const knocked = input("scarlet_violet", {
      "own-left": idle("garchomp", { hp: 1 }), "own-right": { id: "reuniclus", move: "allyswitch", carried: { allySwitch: 3 } },
      "opponent-right": { id: "dragonite", move: "extremespeed", target: "own-left" }, "opponent-left": idle("torkoal"),
    });
    const result = ready(calculateDoublesTurn(knocked));
    expect(result.swapped).toBeUndefined();
    expect(facts(result, "own-right")["Ally Switch fails: Garchomp has fainted."]).toBeCloseTo(1 / 3, 12);
    expect(facts(result, "own-right")["Ally Switch fails: it was used last turn."]).toBeCloseTo(2 / 3, 12);
    const out = calculateDoublesOutcomes(knocked);
    if (out.status !== "ready") throw new Error(out.status);
    expect(out.outcomes.map((outcome) => outcome.mons["own-right"]!.allySwitch ?? null).sort()).toEqual([9, null].sort());
  });
});

describe("start rows for this turn's Ally Switch (ADDENDUM §4.11.7)", () => {
  it("a move aimed at a Pokémon whose partner chose Ally Switch: a conditional row into the partner", () => {
    const result = calculateDoublesTurn(input("scarlet_violet", {
      "own-left": { id: "garchomp", move: "dragonclaw", target: "opponent-right" }, "own-right": idle("blissey"),
      "opponent-right": idle("snorlax"), "opponent-left": { id: "farigiraf", move: "allyswitch" },
    }));
    const rows = ready(result).startRows.filter((row) => row.slot === "own-left");
    expect(rows.map((row) => [row.target, row.fact ?? null])).toEqual([
      ["opponent-right", null], ["opponent-left", "Ally Switch: Farigiraf takes Dragon Claw if Ally Switch comes first."],
    ]);
  });
  it("none when the attacker always moves first (Fake Out's +3 over +2)", () => {
    const rows = ready(calculateDoublesTurn(input("scarlet_violet", {
      "own-left": { id: "incineroar", move: "fakeout", target: "opponent-right" }, "own-right": idle("blissey"),
      "opponent-right": idle("snorlax"), "opponent-left": { id: "farigiraf", move: "allyswitch" },
    }))).startRows.filter((row) => row.slot === "own-left");
    expect(rows.map((row) => row.target)).toEqual(["opponent-right"]);
  });
  it("a move aimed at the attacker's own ally that chose Ally Switch: the row says it fails", () => {
    const result = ready(calculateDoublesTurn(input("scarlet_violet", {
      "own-left": { id: "snorlax", move: "bodyslam", target: "own-right" }, "own-right": { id: "reuniclus", move: "allyswitch" },
      "opponent-right": idle("hatterene"), "opponent-left": idle("torkoal"),
    })));
    const rows = result.startRows.filter((row) => row.slot === "own-left");
    expect(rows.map((row) => [row.target, row.row.kind, row.row.reason])).toEqual([
      ["own-right", "calculated", null], ["own-right", "unsupported", "Body Slam fails if Reuniclus's Ally Switch comes first."],
    ]);
  });
});

describe("the handlers on a world (kernel fixture)", () => {
  it("allySwitchHit passes a world whose PrepareHit failed through unchanged", () => {
    const kernel = { champions: false, runtime: runtimes.scarlet_violet, names: { "own-left": "A", "own-right": "B", "opponent-left": "C", "opponent-right": "D" }, stepFact: vi.fn() } as unknown as TurnKernel;
    const mon = { vol: {}, fainted: false } as unknown as World["mons"]["own-left"];
    const w = { mons: { "own-left": mon, "own-right": { ...mon } }, mass: 1 } as unknown as World;
    const action = { index: 0, slot: "own-right", moveId: "allyswitch", target: null, fractional: 0 } as PendingAction;
    expect(positions.allySwitchStopped(kernel, w, "own-right")).toBe(true);
    expect(positions.allySwitchHit(kernel, w, action, { id: "allyswitch" } as ChampionsMove)).toEqual([w]);
    expect(w.swapped).toBeUndefined();
    expect(kernel.stepFact).not.toHaveBeenCalled();
  });
});
