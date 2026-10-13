import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes, calculateDoublesTurn } from "@/app/lib/battle/doubles-turn";
import type { DoublesOutcome, DoublesOutcomeMon, DoublesSlotId, DoublesStart, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { getBuildStats } from "@/app/lib/battle/model";
import { inputKey, postFromOutcome } from "@/app/(app)/training/ai/evaluate";
import type { CellActions, EngineWorld } from "@/app/(app)/training/model/ai-view";
import type { SlotAction } from "@/app/(app)/training/model/view-types";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { bridgeTurn } from "@/app/(app)/training/sim/bridge";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { splitWorlds } from "@/app/(app)/training/sim/splits";
import { PRNG, State, type Pokemon } from "@/app/(app)/training/sim/sim";
import { countsOf, createTracker } from "@/app/(app)/training/sim/tracker";
import { makeView, postOf } from "../fixtures/training-ai";
import { memberFromSet, runtime, seatBattle } from "./training-sim-fixtures";

/**
 * status2 Track T2 (ADDENDUM2 §6's T2 rows) on pinned Showdown c23d2e94: the states from earlier turns Training now passes
 * from public lines, and the rollout reasons that went with them. Each case plays a real Champions battle from the AI's seat
 * (p2), rebuilds its belief battle on the truth world (perfect information) and bridges a cell: what the bridge passes is the
 * real battle's own state (the stall counter, the recharge, Struggle, Fake Out's first turn, a charged two-turn move and its
 * target, Lock-On, Destiny Bond, Taunt / Encore / Disable / Uproar with their turns, a landing Future Sight's user, the field's
 * turns left, Safeguard, the entry order, the battle's last move, the last target, the once-a-battle effects, Cud Chew's Berry
 * and an ally's Leech Seed).
 */
const sp = (hp = 0, atk = 0, def = 0, spa = 0, spd = 0, spe = 0) => ({ hp, atk, def, spa, spd, spe });
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const set = (species: string, item: string, ability: string, moves: string[], extra: Record<string, unknown> = {}) =>
  ({ name: species, species, item, ability, moves, nature: "Serious", evs: sp(), ivs: IV, level: 50, gender: "M", ...extra });
type Set = ReturnType<typeof set>;
const team = (sets: Set[]) => toShowdownTeam(sets.map((each) => {
  const member = memberFromSet(each as never);
  return { ...member, build: { ...member.build, configuration: { ...member.build.configuration, gender: each.gender as "M" | "F" } } };
}), runtime);
const keyOf = (_side: "p1" | "p2", name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const SLOTS: DoublesSlotId[] = ["own-left", "own-right", "opponent-left", "opponent-right"];
const move = (moveId: string, target: DoublesSlotId | null = null): SlotAction => ({ kind: "move", moveId, target });
/** A cell: own-left is p1a, own-right p1b, opponent-right p2a, opponent-left p2b (model/positions.ts). */
const cellOf = (p1a: SlotAction, p1b: SlotAction, p2a: SlotAction, p2b: SlotAction): CellActions => ({
  own: { "own-left": p1a, "own-right": p1b }, opponent: { "opponent-right": p2a, "opponent-left": p2b },
});
const quiet = cellOf(move("protect"), move("protect"), move("protect"), move("protect"));
/** An idle Pokémon (Rest fails at full HP): Snorlax, or Corviknight for a second one on a side (the Species Clause). */
const lax = (name: string, moves = ["Rest", "Protect"]) => /2$|Bench/.test(name) ? set("Corviknight", "", "Pressure", moves) : set("Snorlax", "", "Thick Fat", moves);

/** A real Champions battle from the AI's seat (p2), its belief battle on the truth world, and the bridge of `cell`. */
function play(p1: Set[], p2: Set[], turns: [string, string][], cell: CellActions = quiet, seed = [1, 2, 3, 4]) {
  const seat = seatBattle(seed, { own: team(p1), opponent: team(p2) });
  seat.step(`team ${p1.map((_, i) => i + 1).join("")}`, `team ${p2.map((_, i) => i + 1).join("")}`);
  for (const [a, b] of turns) seat.step(a, b);
  const inputs = seat.inputs();
  const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
  const publicOf = (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
  const bridge = (actions: CellActions = cell, battle = belief.battle) => bridgeTurn(battle, actions, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf });
  const bridged = bridge();
  const real = (species: string) => [...seat.battle.p1.active, ...seat.battle.p2.active].find((each) => each?.species.id === species || each?.baseSpecies.id === species) as Pokemon;
  const believed = (species: string) => [...belief.battle.p1.active, ...belief.battle.p2.active].find((each) => each?.species.id === species || each?.baseSpecies.id === species) as Pokemon;
  const input = (): DoublesTurnInput => {
    if (bridged.kind !== "engine") throw new Error(bridged.reasons.join(" "));
    return bridged.input;
  };
  const slotOf = (species: string) => SLOTS.find((slot) => input().pokemon[slot]?.build.speciesId === species)!;
  const entry = (species: string) => input().pokemon[slotOf(species)]!;
  return { seat, inputs, belief, bridge, bridged, real, believed, input, slotOf, entry, publicOf };
}
const effect = (mon: Pokemon, id: string) => (mon.volatiles as Record<string, Record<string, unknown> | undefined>)[id];
const ready = (input: DoublesTurnInput) => calculateDoublesOutcomes(input).status;

describe("the stall counter (ADDENDUM2 §6 stall; splits.ts no longer forks a Protect)", () => {
  it("passes 3^streak with a protecting move (the real battle's stall counter), 1 for none, nothing with another move; splitWorlds is the identity", () => {
    const cell = cellOf(move("protect"), move("rest"), move("protect"), move("protect"));
    const run = play([lax("Lax"), lax("Lax2")], [set("Gyarados", "", "Intimidate", ["Protect", "Waterfall"]), lax("Foe")], [["move 1, move 1", "move 1, move 2"]], cell);
    expect(Number(effect(run.real("gyarados"), "stall")?.counter)).toBe(3);
    expect(run.entry("gyarados").carried?.stall).toBe(3);
    expect(run.entry("snorlax").carried?.stall).toBe(1);
    expect(run.entry("corviknight").carried?.stall).toBeUndefined();
    const split = splitWorlds(run.input(), { runtime, slotKeys: {} as never, publicOf: () => null });
    expect(split).toEqual({ kind: "worlds", worlds: [{ weight: 1, input: run.input(), notes: [] }] });
    expect(ready(run.input())).not.toBe("issues");
  });
});

describe("the recharge, Struggle and Fake Out's first turn (T2E §4.7)", () => {
  it("a recharge turn: carried.mustRecharge and No move, confused too (the rollout went)", () => {
    const cell = cellOf(move("recharge"), move("protect"), move("protect"), move("protect"));
    const run = play([set("Snorlax", "", "Thick Fat", ["Hyper Beam", "Protect"]), lax("Lax2")], [lax("Foe"), lax("Foe2")], [["move 1 1, move 2", "move 1, move 1"]], cell);
    expect(effect(run.real("snorlax"), "mustrecharge")).toBeDefined();
    expect(run.entry("snorlax")).toMatchObject({ carried: { mustRecharge: true }, action: { moveId: null, target: null } });
    expect(ready(run.input())).not.toBe("issues");
    run.inputs.public.mons["p1:snorlax"].volatiles.push({ id: "confusion", since: run.inputs.public.turn, elapsed: 0 });
    const confused = buildBeliefBattle(run.inputs, run.seat.truthWorld(), runtime);
    const bridged = run.bridge(cell, confused.battle);
    expect(bridged.kind).toBe("engine");
  });
  it("Struggle (a taunted Pokémon with only status moves): the engine's action, with Taunt's turns left", () => {
    const cell = cellOf(move("struggle"), move("protect"), move("protect"), move("protect"));
    const run = play([lax("Lax"), lax("Lax2")], [set("Aerodactyl", "", "Pressure", ["Taunt", "Protect"], { evs: sp(0, 0, 0, 0, 0, 32) }), lax("Foe2")], [["move 1, move 1", "move 1 1, move 2"]], cell);
    const request = run.seat.battle.p1.activeRequest as { active: { moves: { id: string }[] }[] };
    expect(request.active[0].moves.map((each) => each.id)).toEqual(["struggle"]);
    const real = Number(effect(run.real("snorlax"), "taunt")?.duration);
    expect(real).toBe(2);
    expect(run.entry("snorlax")).toMatchObject({ action: { moveId: "struggle", target: null }, carried: { taunt: real } });
    expect(ready(run.input())).not.toBe("issues");
  });
  it("Fake Out: firstTurn true on its first action since it came in, false after (the real battle's activeMoveActions)", () => {
    const fake = (turns: [string, string][]) => play([set("Incineroar", "", "Blaze", ["Fake Out", "Protect"]), lax("Lax2")], [lax("Foe"), lax("Foe2")], turns,
      cellOf(move("fakeout", "opponent-right"), move("protect"), move("protect"), move("protect")));
    const first = fake([]);
    expect(first.real("incineroar").activeMoveActions).toBe(0);
    expect(first.entry("incineroar")).toMatchObject({ firstTurn: true, action: { moveId: "fakeout" } });
    const later = fake([["move 1 1, move 2", "move 2, move 2"]]);
    expect(later.real("incineroar").activeMoveActions).toBe(1);
    expect(later.entry("incineroar")).toMatchObject({ firstTurn: false, action: { moveId: "fakeout", target: "opponent-right" } });
    expect(ready(later.input())).not.toBe("issues");
  });
});

describe("a two-turn move charged last turn and Lock-On (H's states)", () => {
  it("carried.charging, released at the target it was charged at (the belief world's: the charge turn's line hides it), whichever target the cell names", () => {
    const cell = cellOf(move("solarbeam", "opponent-left"), move("protect"), move("fly", "own-left"), move("protect"));
    const run = play([set("Aggron", "", "Sturdy", ["Solar Beam", "Protect"]), lax("Lax2")], [set("Aerodactyl", "", "Pressure", ["Fly", "Protect"]), lax("Foe")],
      [["move 1 1, move 2", "move 1 2, move 2"]], cell);
    const aggron = run.real("aggron"), corviknight = run.real("aerodactyl");
    expect([effect(aggron, "twoturnmove")?.move, effect(aggron, "solarbeam")?.targetLoc]).toEqual(["solarbeam", 1]);
    expect([effect(corviknight, "twoturnmove")?.move, effect(corviknight, "fly")?.targetLoc]).toEqual(["fly", 2]);
    // The charge turn's move line names no target ("|move|p1a: Aggron|Solar Beam||[still]"): the belief world draws it.
    expect(run.seat.battle.log.some((line) => line.startsWith("|move|p1a: Aggron|Solar Beam||[still]"))).toBe(true);
    const slotOfLoc = (loc: number, user: "p1" | "p2"): DoublesSlotId => (loc > 0 ? (user === "p1" ? ["opponent-right", "opponent-left"] : ["own-left", "own-right"]) : (user === "p1" ? ["own-left", "own-right"] : ["opponent-right", "opponent-left"]))[Math.abs(loc) - 1] as DoublesSlotId;
    const aimed = { aggron: slotOfLoc(Number(effect(run.believed("aggron"), "solarbeam")?.targetLoc), "p1"), corviknight: slotOfLoc(Number(effect(run.believed("aerodactyl"), "fly")?.targetLoc), "p2") };
    expect(run.entry("aggron")).toMatchObject({ carried: { charging: "solarbeam" }, action: { moveId: "solarbeam", target: aimed.aggron } });
    expect(run.entry("aerodactyl")).toMatchObject({ carried: { charging: "fly" }, action: { moveId: "fly", target: aimed.corviknight } });
    expect(ready(run.input())).not.toBe("issues");
    // A cell with another move is not one of this request (it offers only the charged move).
    expect(run.bridge(cellOf(move("protect"), move("protect"), move("fly"), move("protect")))).toMatchObject({ kind: "rollout", reasons: ["Aggron is locked into Solar Beam."] });
  });
  it("a charged move Disable forbids (Disable after the charge): a rollout, as Disable stops it at BeforeMove", () => {
    const run = play([set("Aggron", "", "Sturdy", ["Solar Beam", "Protect"]), lax("Lax2")], [set("Cofagrigus", "", "Mummy", ["Protect", "Disable"]), lax("Foe")],
      [["move 1 1, move 2", "move 2 1, move 1"]],
      cellOf(move("solarbeam"), move("protect"), move("protect"), move("protect")));
    expect(effect(run.real("aggron"), "twoturnmove")?.move).toBe("solarbeam");
    expect(effect(run.real("aggron"), "disable")?.move).toBe("solarbeam");
    expect(run.bridged).toMatchObject({ kind: "rollout", reasons: ["Aggron: the Solar Beam it is locked into is disabled."] });
  });
  it("Lock-On: the tracker's volatile (its [of] target) for two end-of-turn countdowns, carried as the target's slot", () => {
    const run = play([lax("Lax"), lax("Lax2")], [set("Dragapult", "", "Infiltrator", ["Lock-On", "Protect"]), lax("Foe")], [["move 1, move 1", "move 1 1, move 2"]]);
    expect(effect(run.real("dragapult"), "lockon")?.source).toBe(run.real("snorlax"));
    expect(run.inputs.public.mons["p2:dragapult"].volatiles.find((each) => each.id === "lockon")).toMatchObject({ sourceKey: "p1:snorlax" });
    expect(run.entry("dragapult").carried?.lockOn).toBe("own-left");
    expect(ready(run.input())).not.toBe("issues");
    const later = play([lax("Lax"), lax("Lax2")], [set("Dragapult", "", "Infiltrator", ["Lock-On", "Protect"]), lax("Foe")], [["move 1, move 1", "move 1 1, move 2"], ["move 1, move 1", "move 2, move 2"]]);
    expect(effect(later.real("dragapult"), "lockon")).toBeUndefined();
    expect(later.inputs.public.mons["p2:dragapult"].volatiles.some((each) => each.id === "lockon")).toBe(false);
    expect(later.entry("dragapult").carried?.lockOn).toBeUndefined();
  });
});

describe("Destiny Bond, Taunt, Encore, Disable and Uproar from earlier turns (N's and CL's states)", () => {
  it("Destiny Bond still up: carried.destinyBond", () => {
    const run = play([lax("Lax"), lax("Lax2")], [set("Banette", "", "Insomnia", ["Destiny Bond", "Protect"]), lax("Foe")], [["move 1, move 1", "move 1, move 2"]]);
    expect(effect(run.real("banette"), "destinybond")).toBeDefined();
    expect(run.entry("banette").carried?.destinyBond).toBe(true);
    expect(ready(run.input())).not.toBe("issues");
  });
  it("Taunt after its target moved (4 turns) and before (3), Encore, Disable: the real battle's durations", () => {
    // A slow Taunt (Aggron) after its fast target moved; a fast one (Aerodactyl) before its target.
    const taunts = play([set("Aerodactyl", "", "Pressure", ["Protect", "Rest"], { evs: sp(0, 0, 0, 0, 0, 32) }), lax("Lax2")],
      [set("Aggron", "", "Sturdy", ["Taunt", "Protect"]), lax("Foe")], [["move 2, move 1", "move 1 1, move 2"]],
      cellOf(move("protect"), move("protect"), move("protect"), move("protect")));
    const late = Number(effect(taunts.real("aerodactyl"), "taunt")?.duration);
    expect(late).toBe(3);
    expect(taunts.entry("aerodactyl").carried?.taunt).toBe(late);
    // Alakazam (fast) Encores Snorlax's Rest from the last turn before Snorlax moves; Banette Disables Corviknight's Rest after it moved.
    const locks = play([lax("Lax"), lax("Lax2")], [set("Alakazam", "", "Inner Focus", ["Encore", "Protect"], { evs: sp(0, 0, 0, 0, 0, 32) }), set("Banette", "", "Insomnia", ["Disable", "Protect"])],
      [["move 1, move 1", "move 2, move 2"], ["move 1, move 1", "move 1 1, move 1 2"]],
      cellOf(move("rest"), move("protect"), move("protect"), move("protect")));
    const snorlax = locks.real("snorlax"), corviknight = locks.real("corviknight");
    expect(effect(snorlax, "encore")).toMatchObject({ move: "rest" });
    expect(locks.entry("snorlax").carried?.encore).toEqual({ move: "rest", turns: Number(effect(snorlax, "encore")!.duration) });
    expect(locks.entry("corviknight").carried?.disable).toEqual({ move: "rest", turns: Number(effect(corviknight, "disable")!.duration) });
    expect(ready(locks.input())).not.toBe("issues");
    // The Encore's move only: another is not a cell of this request.
    expect(locks.bridge(quiet)).toMatchObject({ kind: "rollout", reasons: ["Snorlax is locked into Rest."] });
  });
  it("Uproar from an earlier turn: its turns left (the real battle's duration) and its action", () => {
    const cell = cellOf(move("uproar"), move("protect"), move("protect"), move("protect"));
    const run = play([set("Snorlax", "", "Thick Fat", ["Uproar", "Protect"]), lax("Lax2")], [lax("Foe"), lax("Foe2")], [["move 1, move 2", "move 1, move 1"]], cell);
    const duration = Number(effect(run.real("snorlax"), "uproar")?.duration);
    expect(duration).toBe(2);
    expect(run.entry("snorlax")).toMatchObject({ carried: { uproar: duration }, action: { moveId: "uproar", target: null } });
    expect(ready(run.input())).not.toBe("issues");
  });
  it("a belief world's working Mental Herb beside a Taunt it would have cured: a rollout", () => {
    const run = play([set("Aerodactyl", "", "Pressure", ["Protect", "Rest"], { evs: sp(0, 0, 0, 0, 0, 32) }), lax("Lax2")],
      [set("Aggron", "", "Sturdy", ["Taunt", "Protect"]), lax("Foe")], [["move 2, move 1", "move 1 1, move 2"]]);
    const aerodactyl = run.believed("aerodactyl") as unknown as { item: string };
    aerodactyl.item = "mentalherb";
    expect(run.bridge()).toMatchObject({ kind: "rollout", reasons: ["Aerodactyl: Mental Herb would have cured its Taunt."] });
  });
});

describe("a landing Future Sight's user (C33) and the field's turns left", () => {
  const sets = () => ({
    p1: [lax("Lax"), lax("Lax2")],
    p2: [set("Farigiraf", "", "Armor Tail", ["Future Sight", "Protect", "Gravity", "Magic Room"]), set("Alakazam", "", "Inner Focus", ["Psychic Terrain", "Protect", "Safeguard"]), lax("Bench")],
  });
  it("its user in battle: { move, source }; out of battle: { move, build } as it is now", () => {
    const { p1, p2 } = sets();
    const turns: [string, string][] = [["move 2, move 2", "move 1 1, move 2"], ["move 2, move 2", "move 2, move 2"]];
    const run = play(p1, p2, turns);
    expect(run.entry("snorlax").carried?.futureMove).toEqual({ move: "futuresight", source: "opponent-right" });
    const away = play(p1, p2, [turns[0], ["move 2, move 2", "switch 3, move 2"]]);
    const future = away.entry("snorlax").carried?.futureMove as { move: string; build: { speciesId: string; currentHP: number | null } };
    expect(future).toMatchObject({ move: "futuresight", build: { speciesId: "farigiraf", currentHP: null } });
    const farigiraf = away.seat.battle.p2.pokemon.find((each) => each.species.id === "farigiraf")!;
    expect(getBuildStats(future.build as never, runtime)!.spa).toBe(farigiraf.storedStats.spa);
  });
  it("Gravity, Magic Room, Psychic Terrain and Safeguard from earlier turns: fieldTurns are the real battle's durations", () => {
    const { p1, p2 } = sets();
    const run = play(p1, p2, [["move 2, move 2", "move 3, move 1"], ["move 2, move 2", "move 4, move 3"]]);
    const real = run.seat.battle.field;
    const duration = (state: unknown) => Number((state as { duration?: number }).duration);
    expect(run.input().fieldTurns).toEqual({ terrain: duration(real.terrainState), gravity: duration(real.pseudoWeather.gravity), magicRoom: duration(real.pseudoWeather.magicroom) });
    expect(run.input().fieldTurns).toEqual({ terrain: 3, gravity: 3, magicRoom: 4 });
    expect(run.input().field.defenderSide.safeguard).toBe(true);
    expect(run.input().field.attackerSide.safeguard).toBeUndefined();
    expect(ready(run.input())).not.toBe("issues");
    // Mist and Lucky Chant (no move sets them in Champions): their side conditions map the same way.
    run.inputs.public.sides.p1.conditions.push({ id: "mist", since: 2, layers: 1, setterKey: null }, { id: "luckychant", since: 2, layers: 1, setterKey: null });
    const sided = run.bridge(quiet, buildBeliefBattle(run.inputs, run.seat.truthWorld(), runtime).battle);
    expect(sided.kind === "engine" ? sided.input.field.attackerSide : sided.reasons).toMatchObject({ mist: true, luckyChant: true });
  });
});

describe("the entry order, the battle's last move and the last target (N's and CL's turn inputs)", () => {
  /** The real battle's actives by their ability states' effectOrder, as slots. */
  const AT: Record<DoublesSlotId, ["p1" | "p2", 0 | 1]> = { "own-left": ["p1", 0], "own-right": ["p1", 1], "opponent-right": ["p2", 0], "opponent-left": ["p2", 1] };
  const orderIn = (battle: ReturnType<typeof play>["seat"]["battle"] | ReturnType<typeof play>["belief"]["battle"]) => SLOTS
    .map((slot) => ({ slot, mon: battle[AT[slot][0]].active[AT[slot][1]] })).filter(({ mon }) => !!mon)
    .map(({ slot, mon }) => ({ slot, order: Number(mon!.abilityState.effectOrder) })).sort((a, b) => a.order - b.order).map((each) => each.slot);
  const realOrder = (run: ReturnType<typeof play>) => orderIn(run.seat.battle);
  const ranks = (run: ReturnType<typeof play>) => Object.entries(run.input().entryOrder ?? {}).sort((a, b) => a[1]! - b[1]!).map(([slot]) => slot);
  it("the leads in p1a, p1b, p2a, p2b order; a Skill Swap gives its user, then its target, the newest states", () => {
    const leads = play([lax("Lax"), lax("Lax2")], [lax("Foe"), lax("Foe2")], []);
    expect(ranks(leads)).toEqual(["own-left", "own-right", "opponent-right", "opponent-left"]);
    expect(ranks(leads)).toEqual(realOrder(leads));
    const swapped = play([set("Alakazam", "", "Inner Focus", ["Skill Swap", "Protect"]), lax("Lax2")], [lax("Foe"), lax("Foe2")], [["move 1 2, move 2", "move 1, move 1"]]);
    expect(ranks(swapped)).toEqual(["own-right", "opponent-right", "own-left", "opponent-left"]);
    expect(ranks(swapped)).toEqual(realOrder(swapped));
    // The belief battle's states keep that order for its rollouts.
    expect(orderIn(swapped.belief.battle)).toEqual(realOrder(swapped));
  });
  it("a switch-in this turn (the prelude) is the newest; the side's faint last turn is passed", () => {
    const seat = seatBattle([1, 2, 3, 4], { own: team([lax("Lax"), lax("Lax2")]), opponent: team([lax("Foe"), lax("Foe2"), set("Garchomp", "", "Rough Skin", ["Protect", "Dragon Claw"])]) });
    seat.step("team 12", "team 123");
    const cell = cellOf(move("protect"), move("protect"), { kind: "switch", to: "garchomp" }, move("protect"));
    const inputs = seat.inputs();
    inputs.public.sides.p2.faintedLastTurn = "p2:corviknight";
    const services = createTurnServices(inputs, [seat.truthWorld()], { runtime, keys: seat.keys, seedBase: "0".repeat(31) + "7" });
    const worlds = services.engineWorlds(cell);
    if (worlds.kind !== "engine") throw new Error(`${worlds.kind}: ${"reasons" in worlds ? worlds.reasons.join(" ") : ""}`);
    const input = worlds.worlds[0].input;
    expect(input.pokemon["opponent-right"]!.build.speciesId).toBe("garchomp");
    expect(Object.entries(input.entryOrder ?? {}).sort((a, b) => a[1]! - b[1]!).map(([slot]) => slot)).toEqual(["own-left", "own-right", "opponent-left", "opponent-right"]);
    expect(input.faintedLastTurn).toEqual({ own: false, opponent: true });
  });
  it("battleLastMove is the real battle's lastMove; lastMoveTarget the chosen target (null for a spread move, absent after a redirection)", () => {
    const run = play([set("Garchomp", "", "Rough Skin", ["Dragon Claw", "Earthquake", "Protect"]), lax("Lax2")], [lax("Foe"), lax("Foe2")],
      [["move 1 2, move 2", "move 2, move 1"]]);
    expect(run.input().battleLastMove).toBe((run.seat.battle as unknown as { lastMove: { id: string } }).lastMove.id);
    expect(run.input().faintedLastTurn).toEqual({ own: false, opponent: false });
    expect(run.real("garchomp").lastMoveTargetLoc).toBe(2);
    expect(run.entry("garchomp").lastMoveTarget).toBe("opponent-left");
    expect(run.entry("corviknight").lastMoveTarget).toBeNull();
    const spread = play([set("Garchomp", "", "Rough Skin", ["Dragon Claw", "Earthquake", "Protect"]), lax("Lax2")], [lax("Foe"), lax("Foe2")], [["move 2, move 2", "move 2, move 2"]]);
    expect(spread.entry("garchomp").lastMoveTarget).toBeNull();
    // Follow Me on the target's side: the line's target may not be the chosen one.
    const redirected = play([set("Garchomp", "", "Rough Skin", ["Dragon Claw", "Protect"], { evs: sp(0, 0, 0, 0, 0, 0) }), lax("Lax2")],
      [set("Clefable", "", "Magic Guard", ["Follow Me", "Protect"]), lax("Foe2")], [["move 1 2, move 2", "move 1, move 2"]]);
    expect(countsOf(redirected.inputs.public.mons["p1:garchomp"]).lastTargetUnknown).toBe(true);
    expect("lastMoveTarget" in redirected.entry("garchomp")).toBe(false);
  });
});

describe("the once-a-battle effects, Cud Chew's Berry and an ally's Leech Seed", () => {
  it("Supersweet Syrup's line marks it (onceUsed): the belief battle's flags are the real battle's, and the bridge carries them", () => {
    const run = play([lax("Lax"), lax("Lax2")], [set("Hydrapple", "", "Supersweet Syrup", ["Protect", "Rest"]), lax("Foe")], []);
    const real = run.real("hydrapple") as unknown as { syrupTriggered: boolean };
    expect(real.syrupTriggered).toBe(true);
    expect(countsOf(run.inputs.public.mons["p2:hydrapple"]).onceUsed).toEqual(["supersweetsyrup"]);
    for (const species of ["hydrapple", "snorlax", "corviknight"]) {
      expect((run.believed(species) as unknown as { syrupTriggered: boolean }).syrupTriggered, species).toBe((run.real(species) as unknown as { syrupTriggered: boolean }).syrupTriggered);
    }
    expect(run.entry("hydrapple").carried?.onceUsed).toEqual(["supersweetsyrup"]);
    expect(run.entry("snorlax").carried?.onceUsed).toBeUndefined();
  });
  it("Cud Chew's Berry due at this end of turn: carried by its id", () => {
    const run = play([set("Incineroar", "", "Blaze", ["Flare Blitz", "Protect"], { evs: sp(0, 32, 0, 0, 0, 0) }), lax("Lax2"), lax("Lax")],
      [set("Farigiraf", "Sitrus Berry", "Cud Chew", ["Protect", "Psychic"], { evs: sp(0, 0, 0, 0, 0, 0) }), lax("Foe")], [["move 1 1, move 2", "move 2 1, move 2"]]);
    const state = run.real("farigiraf").abilityState as unknown as { berry?: { id: string }; counter?: number };
    expect([state.berry?.id, state.counter]).toEqual(["sitrusberry", 1]);
    expect(run.entry("farigiraf").carried?.cudChew).toBe("sitrusberry");
    // A prelude's copy (a switch this turn) keeps the Berry in its ability state.
    const cell = cellOf({ kind: "switch", to: "snorlax" }, move("protect"), move("protect"), move("protect"));
    const services = createTurnServices(run.inputs, [run.seat.truthWorld()], { runtime, keys: run.seat.keys, seedBase: "0".repeat(31) + "9" });
    const worlds = services.engineWorlds(cell);
    if (worlds.kind !== "engine") throw new Error(`${worlds.kind}: ${"reasons" in worlds ? worlds.reasons.join(" ") : ""}`);
    expect(worlds.source).toBe("prelude");
    const slot = SLOTS.find((each) => worlds.worlds[0].input.pokemon[each]?.build.speciesId === "farigiraf")!;
    expect(worlds.worlds[0].input.pokemon[slot]!.carried?.cudChew).toBe("sitrusberry");
  });
  it("Leech Seed from an ally: carried as the ally's slot (C32), not a rollout", () => {
    const run = play([set("Venusaur", "", "Overgrow", ["Leech Seed", "Protect"]), set("Garchomp", "", "Rough Skin", ["Protect", "Dragon Claw"])], [lax("Foe"), lax("Foe2")],
      [["move 1 -2, move 2 1", "move 1, move 1"]]);
    expect(effect(run.real("garchomp"), "leechseed")).toBeDefined();
    expect(run.entry("garchomp").carried?.leechSeed).toBe("own-left");
    expect(ready(run.input())).not.toBe("issues");
  });
});

describe("a Trace holder's copied Intimidate (conformance 4b, V10 against V06)", () => {
  it("is stored (it acted as it was copied): the start settle does not apply it again, and E2's hit is Showdown's", () => {
    const run = play([set("Incineroar", "", "Intimidate", ["Flare Blitz", "Protect"]), lax("Lax2")], [set("Gardevoir", "", "Trace", ["Protect", "Psychic"], { gender: "F" }), lax("Foe")], [],
      cellOf(move("flareblitz", "opponent-right"), move("protect"), move("psychic", "own-left"), move("rest")));
    expect(run.seat.battle.log.some((line) => line.startsWith("|-ability|p2a: Gardevoir|Intimidate|") && line.includes("[from] ability: Trace"))).toBe(true);
    expect(run.entry("gardevoir").build).toMatchObject({ abilityId: "trace", tracedAbility: "intimidate", copiedIntimidateStored: "incineroar,corviknight" });
    expect(run.entry("incineroar").build.boosts.atk).toBe(-1);
    const turn = calculateDoublesTurn(run.input()) as unknown as { steps: { slot: string; hits: { slot: string; min: number | null; max: number | null }[] }[] };
    const hit = turn.steps.find((step) => step.slot === "own-left")!.hits.find((each) => each.slot === "opponent-right")!;
    // Showdown on the belief battle: Flare Blitz's damage into Gardevoir over 300 seeds (no crit).
    const seen = new Set<number>();
    for (let n = 0; n < 300; n++) {
      const battle = State.deserializeBattle(run.belief.json);
      battle.restart(() => {});
      battle.prng = new PRNG(`sodium,${n.toString(16).padStart(32, "0")}` as never);
      const before = battle.log.length;
      battle.makeChoices("move 1 1, move 2", "move 2 1, move 1");
      const lines = battle.log.slice(before);
      if (lines.some((line) => line.startsWith("|-crit|"))) continue;
      const damage = lines.map((line) => /^\|-damage\|p2a: Gardevoir\|(\d+)\/(\d+)$/.exec(line)).find(Boolean);
      if (damage) seen.add(Number(damage[2]) - Number(damage[1]));
    }
    expect([hit.min, hit.max]).toEqual([Math.min(...seen), Math.max(...seen)]);
  });
});

describe("the tracker's new records (lines)", () => {
  const LEAD = ["|switch|p1a: Cofagrigus|Cofagrigus, L50, M|100/100", "|switch|p1b: Raichu|Raichu, L50, M|100/100",
    "|switch|p2a: Garchomp|Garchomp, L50, M|183/183", "|switch|p2b: Clefable|Clefable, L50, F|170/170", "|turn|1"];
  const state = (lines: string[]) => { const t = createTracker("p2", keyOf); t.push([...LEAD, ...lines]); return t.state(); };
  it("entry: the switch-ins in order, Mummy's new ability state, a switch clearing it", () => {
    const leads = state([]);
    expect(["p1:cofagrigus", "p1:raichu", "p2:garchomp", "p2:clefable"].map((key) => countsOf(leads.mons[key]).entry)).toEqual([1, 2, 3, 4]);
    const mummy = state(["|move|p2a: Garchomp|Dragon Claw|p1a: Cofagrigus", "|-damage|p1a: Cofagrigus|60/100", "|-activate|p1a: Cofagrigus|ability: Mummy|p2a: Garchomp|[ability] Rough Skin"]);
    expect(countsOf(mummy.mons["p2:garchomp"]).entry).toBe(5);
    expect(mummy.mons["p2:garchomp"].ability).toEqual({ abilityId: "mummy", how: "changed" });
    const out = state(["|switch|p2a: Snorlax|Snorlax, L50, M|100/100"]);
    expect([countsOf(out.mons["p2:garchomp"]).entry, countsOf(out.mons["p2:snorlax"]).entry]).toEqual([undefined, 5]);
  });
  it("lastTargetUnknown: a Lightning Rod's redirection, a Follow Me up, an Ally Switch, a faint on the target's side this turn", () => {
    const rod = state(["|move|p2a: Garchomp|Thunder Fang|p1a: Cofagrigus", "|-activate|p1b: Raichu|ability: Lightning Rod", "|-immune|p1b: Raichu|[from] ability: Lightning Rod"]);
    expect(countsOf(rod.mons["p2:garchomp"]).lastTargetUnknown).toBe(true);
    const plain = state(["|move|p2a: Garchomp|Dragon Claw|p1a: Cofagrigus", "|-damage|p1a: Cofagrigus|60/100"]);
    expect(countsOf(plain.mons["p2:garchomp"]).lastTargetUnknown).toBeUndefined();
    const follow = state(["|move|p1a: Cofagrigus|Protect|p1a: Cofagrigus", "|-singleturn|p1b: Raichu|move: Follow Me", "|move|p2a: Garchomp|Dragon Claw|p1b: Raichu"]);
    expect(countsOf(follow.mons["p2:garchomp"]).lastTargetUnknown).toBe(true);
    const swap = state(["|move|p1b: Raichu|Ally Switch|p1b: Raichu", "|swap|p1b: Raichu|0|[from] move: Ally Switch", "|move|p2a: Garchomp|Dragon Claw|p1a: Raichu"]);
    expect(countsOf(swap.mons["p2:garchomp"]).lastTargetUnknown).toBe(true);
    const faint = state(["|move|p2b: Clefable|Moonblast|p1b: Raichu", "|-damage|p1b: Raichu|0 fnt", "|faint|p1b: Raichu", "|move|p2a: Garchomp|Dragon Claw|p1a: Cofagrigus"]);
    expect(countsOf(faint.mons["p2:garchomp"]).lastTargetUnknown).toBe(true);
    // The next turn starts clean.
    const next = state(["|move|p1b: Raichu|Ally Switch|p1b: Raichu", "|swap|p1b: Raichu|0|[from] move: Ally Switch", "|", "|upkeep", "|turn|2", "|move|p2a: Garchomp|Dragon Claw|p1a: Raichu"]);
    expect(countsOf(next.mons["p2:garchomp"]).lastTargetUnknown).toBeUndefined();
  });
  it("the stall streak: a broken protection (Phantom Force, Feint) and a failed stall roll end it; a second Protect this turn starts fresh", () => {
    const protect = ["|move|p1a: Cofagrigus|Protect|p1a: Cofagrigus", "|-singleturn|p1a: Cofagrigus|Protect"];
    const next = ["|", "|upkeep", "|turn|2"];
    expect(state([...protect, ...next]).mons["p1:cofagrigus"].protectStreak).toBe(1);
    expect(state([...protect, "|move|p2a: Garchomp|Phantom Force|p1a: Cofagrigus|[from] lockedmove", "|-activate|p1a: Cofagrigus|move: Phantom Force|[broken]", ...next]).mons["p1:cofagrigus"].protectStreak).toBe(0);
    expect(state([...protect, "|move|p2a: Garchomp|Feint|p1a: Cofagrigus", "|-activate|p1a: Cofagrigus|move: Feint", ...next]).mons["p1:cofagrigus"].protectStreak).toBe(0);
    // Turn 2: the roll fails (its counter deleted), then Oranguru's Instruct: the second Protect works from a fresh counter.
    const twice = state([...protect, ...next, "|move|p1a: Cofagrigus|Protect||[still]", "|-fail|p1a: Cofagrigus",
      "|move|p2b: Clefable|Instruct|p1a: Cofagrigus", "|-singleturn|p1a: Cofagrigus|move: Instruct|[of] p2b: Clefable", ...protect, "|", "|upkeep", "|turn|3"]);
    expect(twice.mons["p1:cofagrigus"].protectStreak).toBe(1);
  });
  it("a charge ends with Gravity or Smack Down (Fly, Bounce), with another move; a Cud Chew record ends with a new ability state", () => {
    const fly = ["|move|p2a: Garchomp|Fly||[still]", "|-prepare|p2a: Garchomp|Fly"];
    const charging = (lines: string[]) => state([...fly, ...lines]).mons["p2:garchomp"].volatiles.some((each) => each.id === "twoturnmove");
    expect(charging([])).toBe(true);
    expect(charging(["|move|p2b: Clefable|Gravity|p2b: Clefable", "|-fieldstart|move: Gravity", "|-activate|p2a: Garchomp|move: Gravity"])).toBe(false);
    expect(charging(["|move|p1b: Raichu|Smack Down|p2a: Garchomp", "|-damage|p2a: Garchomp|150/183", "|-start|p2a: Garchomp|Smack Down"])).toBe(false);
    expect(charging(["|", "|upkeep", "|turn|2", "|move|p2a: Garchomp|Dragon Claw|p1a: Cofagrigus"])).toBe(false);
    const solar = state(["|move|p1b: Raichu|Solar Beam||[still]", "|-prepare|p1b: Raichu|Solar Beam", "|move|p2b: Clefable|Gravity|p2b: Clefable", "|-fieldstart|move: Gravity"]);
    expect(solar.mons["p1:raichu"].volatiles.some((each) => each.id === "twoturnmove")).toBe(true);
    const ate = ["|-enditem|p2a: Garchomp|Sitrus Berry|[eat]"];
    expect(countsOf(state(ate).mons["p2:garchomp"]).cudChew).toEqual({ berry: "sitrusberry", turn: 1 });
    expect(countsOf(state([...ate, "|move|p1b: Raichu|Skill Swap|p2a: Garchomp", "|-activate|p1b: Raichu|Skill Swap|Rough Skin|Lightning Rod|[of] p2a: Garchomp"]).mons["p2:garchomp"]).cudChew).toBeUndefined();
  });
  it("onceUsed is the Pokémon's (kept across switches); Lock-On ends after two countdowns", () => {
    const lines = ["|switch|p2a: Hydrapple|Hydrapple, L50, M|200/200", "|-ability|p2a: Hydrapple|Supersweet Syrup", "|switch|p2a: Garchomp|Garchomp, L50, M|183/183"];
    expect(countsOf(state(lines).mons["p2:hydrapple"]).onceUsed).toEqual(["supersweetsyrup"]);
    const lock = ["|move|p1b: Raichu|Lock-On|p2a: Garchomp", "|-activate|p1b: Raichu|move: Lock-On|[of] p2a: Garchomp"];
    expect(state([...lock, "|", "|upkeep", "|turn|2"]).mons["p1:raichu"].volatiles.find((each) => each.id === "lockon")).toMatchObject({ sourceKey: "p2:garchomp", since: 1 });
    expect(state([...lock, "|", "|upkeep", "|turn|2", "|", "|upkeep", "|turn|3"]).mons["p1:raichu"].volatiles.some((each) => each.id === "lockon")).toBe(false);
  });
});

describe("evaluate.ts", () => {
  it("the engine memo's key holds the turn-level inputs (two prelude worlds may differ only in their entry ranks)", () => {
    const run = play([lax("Lax"), lax("Lax2")], [lax("Foe"), lax("Foe2")], []);
    const input = run.input();
    expect(inputKey({ ...input, entryOrder: { "own-left": 1, "own-right": 0 } })).not.toBe(inputKey(input));
    expect(inputKey({ ...input, fieldTurns: { gravity: 1 } })).not.toBe(inputKey(input));
    expect(inputKey({ ...input, battleLastMove: "protect" })).not.toBe(inputKey({ ...input, battleLastMove: null }));
    expect(inputKey({ ...input })).toBe(inputKey(input));
  });
  it("postFromOutcome keeps the outcome's charged move, once-a-battle effects and Cud Chew's Berry on the Pokémon (no value term reads them)", () => {
    const view = makeView([
      { side: "opponent", species: "farigiraf", slot: "opponent-left", moves: ["protect"], ability: "cudchew", item: "", nature: "Calm", points: {} },
      { side: "own", species: "incineroar", slot: "own-left", moves: ["protect"], ability: "intimidate", item: "", nature: "Careful", points: {} },
    ] as never);
    const base = postOf(view);
    const mons: Partial<Record<DoublesSlotId, DoublesOutcomeMon>> = {};
    const start = {} as DoublesStart;
    for (const mon of view.mons.filter((each) => each.slot)) {
      mons[mon.slot!] = { hp: [{ hp: mon.hp, chance: 1 }], build: mon.build, protected: false, moved: true, ...(mon.slot === "opponent-left" ? { charging: "solarbeam", onceUsed: ["supersweetsyrup"], cudChew: "sitrusberry", turnsLeft: { taunt: 2 } } : {}) };
      (start as Record<string, unknown>)[mon.slot!] = { maximum: mon.maxHp };
    }
    const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, faintedThisTurn: 0 };
    const outcome = { chance: 1, mons, allFainted: { own: 0, opponent: 0 }, positions: { own: "kept", opponent: "kept" }, sides: { own: side, opponent: side },
      field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false } } as DoublesOutcome;
    const world: EngineWorld = { weight: 1, input: null as never, keys: Object.fromEntries(view.mons.filter((each) => each.slot).map((each) => [each.slot, each.key])) as EngineWorld["keys"], notes: [] };
    const post = postFromOutcome({ view, base, residual: {}, outcome, start, world, cell: quiet, endOfTurn: "applied" });
    expect(post.mons.find((each) => each.build.speciesId === "farigiraf")!.carried).toEqual({ charging: "solarbeam", onceUsed: ["supersweetsyrup"], cudChew: "sitrusberry", turnsLeft: { taunt: 2 } });
  });
});
