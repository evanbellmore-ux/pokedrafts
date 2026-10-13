import { describe, expect, it } from "vitest";
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import type { DoublesOutcome, DoublesSlotId } from "@/app/lib/battle/doubles-types";
import { nextClock } from "@/app/(app)/training/ai/evaluate";
import type { CellActions } from "@/app/(app)/training/model/ai-view";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { bridgeTurn } from "@/app/(app)/training/sim/bridge";
import { PRELUDE_WORLDS_BOUND, runPreludeWorlds } from "@/app/(app)/training/sim/prelude";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { Battle, State } from "@/app/(app)/training/sim/sim";
import { countsOf, createTracker } from "@/app/(app)/training/sim/tracker";
import { emptyClock } from "../fixtures/training-ai";
import { AI, AI_TEAM, memberFromSet, runtime, seatBattle } from "./training-sim-fixtures";

/**
 * status2 Step 1's Training fixes (SPEC2 §8.2 #7, #8; ADDENDUM2 §8.2 #11, #14–#16) on pinned Showdown c23d2e94: the field
 * clock after Rapid Spin and a Safeguard set this turn, accuracy and evasion stages from earlier turns, the earlier-this-turn
 * flags (C19), a Pokémon that switched in, the prelude's ties as weighted worlds (TR04, TR05 of
 * scripts/.cache/calc-audit/status2/design/tier2-eot-training-probes-2.ts), and Cud Chew's Berry carried.
 */
const hex = (n: number) => n.toString(16).padStart(32, "0");
const keyOf = (_side: "p1" | "p2", name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const quiet: CellActions = {
  own: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } },
  opponent: { "opponent-right": { kind: "move", moveId: "protect", target: null }, "opponent-left": { kind: "move", moveId: "protect", target: null } },
};

describe("#7 the field clock after Rapid Spin, Mortal Spin and a Safeguard set this turn", () => {
  const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, faintedThisTurn: 0 };
  const outcome = (own: Partial<DoublesOutcome["sides"]["own"]> = {}): DoublesOutcome => ({
    chance: 1, mons: {}, allFainted: { own: 0, opponent: 0 }, positions: { own: "kept", opponent: "kept" },
    sides: { own: { ...side, ...own }, opponent: { ...side } },
    field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false },
  } as DoublesOutcome);
  const hazarded = () => {
    const clock = emptyClock();
    clock.sides.own = { ...clock.sides.own, stealthRock: true, spikes: 2, toxicSpikes: 1, stickyWeb: true };
    return clock;
  };
  it("clears the side's hazards from before the turn where the outcome's hazardsFrom is null, keeps them otherwise", () => {
    expect(nextClock(hazarded(), outcome({ hazardsFrom: null })).sides.own).toMatchObject({ stealthRock: false, spikes: 0, toxicSpikes: 0, stickyWeb: false });
    expect(nextClock(hazarded(), outcome()).sides.own).toMatchObject({ stealthRock: true, spikes: 2, toxicSpikes: 1, stickyWeb: true });
    // A hazard the cell set after the spin is added to the cleared side.
    expect(nextClock(hazarded(), outcome({ hazardsFrom: null }), { own: ["spikes"] }).sides.own).toMatchObject({ stealthRock: false, spikes: 1 });
  });
  it("gives a Safeguard set this turn its 5 turns less this turn's countdown, and counts down one already up", () => {
    expect(nextClock(emptyClock(), outcome({ safeguard: true })).sides.own.safeguard).toBe(4);
    const up = emptyClock();
    up.sides.own = { ...up.sides.own, safeguard: 3 };
    expect(nextClock(up, outcome({ safeguard: true })).sides.own.safeguard).toBe(2);
    up.sides.own = { ...up.sides.own, safeguard: 1 };
    expect(nextClock(up, outcome({ safeguard: true })).sides.own.safeguard).toBe(0);
    expect(nextClock(emptyClock(), outcome()).sides.own.safeguard).toBe(0);
  });
});

describe("#8 accuracy and evasion stages from earlier turns", () => {
  it("passes the public stages as carried.stages (the belief battle's boosts)", () => {
    const seat = seatBattle([11, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    const inputs = seat.inputs();
    inputs.public.mons["p1:incineroar"].boosts.evasion = 1;
    inputs.public.mons["p2:pelipper"].boosts.accuracy = -1;
    const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
    expect(belief.battle.p1.active[0]!.boosts.evasion).toBe(1);
    const result = bridgeTurn(belief.battle, quiet, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set() });
    if (result.kind !== "engine") throw new Error(result.reasons.join(" "));
    expect(result.input.pokemon["own-left"]!.carried?.stages).toEqual({ evasion: 1 });
    expect(result.input.pokemon["opponent-left"]!.carried?.stages).toEqual({ accuracy: -1 });
    expect(result.input.pokemon["own-right"]!.carried?.stages).toBeUndefined();
  });
});

describe("#11 the earlier-this-turn flags (ADDENDUM2 C19)", () => {
  const START = [
    "|player|p1|You|", "|player|p2|Training|", "|gametype|doubles", "|gen|9", "|teampreview|4", "|start",
    "|switch|p1a: Incineroar|Incineroar, L50, M|100/100", "|switch|p1b: Charizard|Charizard, L50, M|100/100",
    "|switch|p2a: Gyarados|Gyarados, L50, M|172/172", "|switch|p2b: Pelipper|Pelipper, L50, M|167/167",
    "|-ability|p2a: Gyarados|Intimidate|boost", "|-unboost|p1a: Incineroar|atk|1", "|-unboost|p1b: Charizard|atk|1",
    "|turn|1",
  ];
  const tracker = (lines: string[]) => { const t = createTracker("p2", keyOf); t.push(lines); return t.state(); };
  it("the tracker counts the leads' entry lines on turn 1 and clears the flags from turn 2 (pinned nextTurn)", () => {
    const one = tracker(START);
    expect(countsOf(one.mons["p1:incineroar"]).thisTurn).toEqual({ statsLowered: true });
    expect(countsOf(one.mons["p2:gyarados"]).thisTurn).toBeUndefined();
    const two = tracker([...START, "|move|p2b: Pelipper|Protect|p2b: Pelipper", "|", "|upkeep", "|turn|2"]);
    expect(countsOf(two.mons["p1:incineroar"]).thisTurn).toBeUndefined();
  });
  it("counts a stage that changed (not a '-boost … 0'), Belly Drum's rise but not Anger Point's, and an item used or eaten (not a popped Air Balloon)", () => {
    const state = tracker([...START,
      "|move|p2a: Gyarados|Dragon Dance|p2a: Gyarados", "|-boost|p2a: Gyarados|atk|0", "|-boost|p2a: Gyarados|spe|1",
      "|-setboost|p2b: Pelipper|atk|6|[from] move: Belly Drum",
      "|-setboost|p1b: Charizard|atk|6|[from] ability: Anger Point",
      "|-enditem|p1a: Incineroar|Air Balloon",
      "|-enditem|p1b: Charizard|Sitrus Berry|[eat]",
    ]);
    expect(countsOf(state.mons["p2:gyarados"]).thisTurn).toEqual({ statsRaised: true });
    expect(countsOf(state.mons["p2:pelipper"]).thisTurn).toEqual({ statsRaised: true });
    expect(countsOf(state.mons["p1:charizard"]).thisTurn).toEqual({ statsLowered: true, usedItem: true });
    expect(countsOf(state.mons["p1:incineroar"]).thisTurn).toEqual({ statsLowered: true });
  });
  it("Training passes the leads' entry flags on turn 1, none on turn 2", () => {
    const seat = seatBattle([11, 2, 3, 4]);
    seat.step("team 1234", "team 1234");
    const services = createTurnServices(seat.inputs(), [seat.truthWorld()], { runtime, keys: seat.keys, seedBase: hex(1) });
    const worlds = services.engineWorlds(quiet);
    if (worlds.kind !== "engine") throw new Error(worlds.kind);
    // Incineroar's Intimidate on Gyarados and Pelipper, Gyarados's on Incineroar and Charizard (before |turn|1).
    for (const slot of ["own-left", "own-right", "opponent-left", "opponent-right"] as DoublesSlotId[]) expect(worlds.worlds[0].input.pokemon[slot]!.earlierThisTurn, slot).toEqual({ statsLowered: true });
    seat.step("move 4, move 4", "move 4, move 4");
    const later = createTurnServices(seat.inputs(), [seat.truthWorld()], { runtime, keys: seat.keys, seedBase: hex(2) });
    const again = later.engineWorlds(quiet);
    if (again.kind !== "engine") throw new Error(again.kind);
    for (const slot of ["own-left", "own-right", "opponent-left", "opponent-right"] as DoublesSlotId[]) expect(again.worlds[0].input.pokemon[slot]?.earlierThisTurn, slot).toBeUndefined();
  });
});

describe("#11 an item used earlier this turn", () => {
  it("names the item (lastItem) with earlierThisTurn.usedItem: Sneasler's White Herb after the lead Intimidate", () => {
    const seat = seatBattle([11, 2, 3, 4]);
    seat.step("team 1234", "team 3412");
    const services = createTurnServices(seat.inputs(), [seat.truthWorld()], { runtime, keys: seat.keys, seedBase: hex(7) });
    const worlds = services.engineWorlds(quiet);
    if (worlds.kind !== "engine") throw new Error(`${worlds.kind}: ${"reasons" in worlds ? worlds.reasons.join(" ") : ""}`);
    const input = worlds.worlds[0].input;
    const slot = (["opponent-left", "opponent-right"] as DoublesSlotId[]).find((each) => input.pokemon[each]?.build.speciesId === "sneasler")!;
    expect(input.pokemon[slot]).toMatchObject({ earlierThisTurn: { statsLowered: true, usedItem: true }, lastItem: "whiteherb" });
    expect(calculateDoublesOutcomes(input).status).not.toBe("issues");
  });
});

describe("#11 / #14 a switch-in this turn: its Intimidate's flags, and it takes no action", () => {
  it("Gyarados switches in (prelude): the foes' Attack fell earlier this turn; Gyarados is switchedIn with no move", () => {
    const seat = seatBattle([17, 2, 3, 4]);
    seat.step("team 2413", "team 2513");
    const cell: CellActions = {
      own: { "own-left": { kind: "move", moveId: "heatwave", target: null }, "own-right": { kind: "move", moveId: "earthquake", target: null } },
      opponent: { "opponent-right": { kind: "switch", to: "gyarados" }, "opponent-left": { kind: "move", moveId: "protect", target: null } },
    };
    const services = createTurnServices(seat.inputs(), [seat.truthWorld()], { runtime, keys: seat.keys, seedBase: hex(3) });
    const worlds = services.engineWorlds(cell);
    if (worlds.kind !== "engine") throw new Error(`${worlds.kind}: ${"reasons" in worlds ? worlds.reasons.join(" ") : ""}`);
    expect(worlds.source).toBe("prelude");
    const input = worlds.worlds[0].input;
    expect(input.pokemon["own-left"]!.earlierThisTurn).toEqual({ statsLowered: true });
    expect(input.pokemon["own-right"]!.earlierThisTurn).toEqual({ statsLowered: true });
    expect(input.pokemon["opponent-right"]).toMatchObject({ switchedIn: true, action: { moveId: null, target: null } });
    expect(input.pokemon["opponent-left"]!.switchedIn).toBeUndefined();
  });
});

describe("#15 the prelude's ties as weighted worlds", () => {
  const lax = (name: string, spe: number) => ({ name, species: "Snorlax", ability: "Thick Fat", item: "", moves: ["Splash"], nature: "Serious", evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: "M" });
  const tork = { ...lax("Tork", 0), species: "Torkoal", ability: "Drought" };
  const toed = { ...lax("Toed", 0), species: "Politoed", ability: "Drizzle" };
  function battleOf(p1: object[], p2: object[], setup?: (b: Battle) => void) {
    const b = new Battle({ formatid: "gen9championsvgc2026regmc", seed: [1, 2, 3, 4] });
    b.setPlayer("p1", { team: p1 as never });
    b.setPlayer("p2", { team: p2 as never });
    const order = (n: number) => `team ${Array.from({ length: n }, (_, i) => i + 1).join("")}`;
    if (b.requestState === "teampreview") b.makeChoices(order(p1.length), order(p2.length));
    setup?.(b);
    return JSON.stringify(State.serializeBattle(b));
  }
  const weathers = (result: ReturnType<typeof runPreludeWorlds>) => {
    if (result.kind !== "stopped") throw new Error(result.reasons.join(" "));
    return result.worlds.map((world) => [world.battle.field.weather, world.weight]).sort();
  };
  it("TR04: two switches at one Speed into Drought and Drizzle: rain and sun at 1/2 each (the later entry's weather)", () => {
    const json = battleOf([lax("OutA", 3), lax("Lax1", 1), tork], [lax("OutB", 3), lax("Lax2", 2), toed]);
    expect(weathers(runPreludeWorlds(json, { p1: "switch 3, move 1", p2: "switch 3, move 1" }, hex(4)))).toEqual([["raindance", 0.5], ["sunnyday", 0.5]]);
  });
  it("TR05: two Mega Evolutions at one Speed (Charizard Y, Tyranitar): sand and sun at 1/2 each", () => {
    const zard = { ...lax("Zard", 0), species: "Charizard", ability: "Blaze", item: "Charizardite Y" };
    const ttar = { ...lax("Ttar", 0), species: "Tyranitar", ability: "Sand Stream", item: "Tyranitarite" };
    const json = battleOf([zard, lax("Lax1", 1)], [ttar, lax("Lax2", 2)], (b) => {
      for (const p of [b.p1.active[0], b.p2.active[0]]) { const mon = p as unknown as { storedStats: { spe: number }; speed: number }; mon.storedStats.spe = 120; mon.speed = 120; }
    });
    expect(weathers(runPreludeWorlds(json, { p1: "move 1 mega, move 1", p2: "move 1 mega, move 1" }, hex(5)))).toEqual([["sandstorm", 0.5], ["sunnyday", 0.5]]);
  });
  it(`four switches at one Speed: above the bound (${PRELUDE_WORLDS_BOUND} worlds), a rollout`, () => {
    const json = battleOf([lax("OutA", 3), lax("OutC", 3), tork, lax("BenchA", 0)], [lax("OutB", 3), lax("OutD", 3), toed, lax("BenchB", 0)]);
    expect(runPreludeWorlds(json, { p1: "switch 3, switch 4", p2: "switch 3, switch 4" }, hex(6))).toEqual({ kind: "rollout", reasons: ["Speed tie between switches with an entry effect."] });
  });
});

describe("#16 Cud Chew's Berry carried", () => {
  const LEAD = [
    "|player|p1|You|", "|player|p2|Training|", "|gametype|doubles", "|gen|9", "|teampreview|4", "|start",
    "|switch|p1a: Incineroar|Incineroar, L50, M|100/100", "|switch|p1b: Charizard|Charizard, L50, M|100/100",
    "|switch|p2a: Farigiraf|Farigiraf, L50, M|195/195", "|switch|p2b: Pelipper|Pelipper, L50, M|167/167", "|turn|1",
  ];
  const tracker = (lines: string[]) => { const t = createTracker("p2", keyOf); t.push(lines); return t.state(); };
  const ate = ["|move|p1a: Incineroar|Flare Blitz|p2a: Farigiraf", "|-damage|p2a: Farigiraf|90/195", "|-enditem|p2a: Farigiraf|Sitrus Berry|[eat]", "|-heal|p2a: Farigiraf|138/195|[from] item: Sitrus Berry"];
  it("the tracker keeps the Berry eaten this stint until Cud Chew re-eats it (its -activate, then the re-eat's -enditem)", () => {
    expect(countsOf(tracker([...LEAD, ...ate]).mons["p2:farigiraf"]).cudChew).toEqual({ berry: "sitrusberry", turn: 1 });
    const next = tracker([...LEAD, ...ate, "|", "|upkeep", "|turn|2"]);
    expect(countsOf(next.mons["p2:farigiraf"]).cudChew).toEqual({ berry: "sitrusberry", turn: 1 });
    const reEaten = tracker([...LEAD, ...ate, "|", "|upkeep", "|turn|2", "|move|p2b: Pelipper|Protect|p2b: Pelipper",
      "|-activate|p2a: Farigiraf|ability: Cud Chew", "|-enditem|p2a: Farigiraf|Sitrus Berry|[eat]", "|-heal|p2a: Farigiraf|195/195|[from] item: Sitrus Berry"]);
    expect(countsOf(reEaten.mons["p2:farigiraf"]).cudChew).toBeUndefined();
    // The re-eat is no eatItem: no usedItemThisTurn.
    expect(countsOf(reEaten.mons["p2:farigiraf"]).thisTurn).toBeUndefined();
    // A stolen Berry (Bug Bite, Pluck: [from] stealeat) is not Cud Chew's.
    const stolen = tracker([...LEAD, "|-enditem|p2a: Farigiraf|Sitrus Berry|[from] stealeat|[move] Bug Bite|[of] p1a: Incineroar"]);
    expect(countsOf(stolen.mons["p2:farigiraf"]).cudChew).toBeUndefined();
  });
  it("the belief battle restores the Berry (counter 1) and the bridge carries cudChew", () => {
    const members = AI_TEAM.members.map((member) => (member.speciesId === "farigiraf" ? memberFromSet({ ...AI.find((set) => set.species === "Farigiraf")!, ability: "Cud Chew" }) : member));
    const seat = seatBattle([5, 2, 3, 4], { opponent: toShowdownTeam(members, runtime) });
    seat.step("team 1234", "team 5213");
    const inputs = seat.inputs();
    Object.assign(inputs.public.mons["p2:farigiraf"], { cudChew: { berry: "sitrusberry", turn: 1 } });
    const belief = buildBeliefBattle(inputs, seat.truthWorld(), runtime);
    const farigiraf = belief.battle.p2.active.find((mon) => mon?.species.id === "farigiraf")!;
    const state = farigiraf.abilityState as unknown as { berry?: { id: string }; counter?: number };
    expect([state.berry?.id, state.counter]).toEqual(["sitrusberry", 1]);
    const publicOf = (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
    const result = bridgeTurn(belief.battle, quiet, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf });
    if (result.kind !== "engine") throw new Error(result.reasons.join(" "));
    const slot = (["opponent-left", "opponent-right"] as DoublesSlotId[]).find((each) => result.input.pokemon[each]?.build.speciesId === "farigiraf")!;
    // status2 T2 (T2E §4.2.3): the Berry by its id.
    expect(result.input.pokemon[slot]!.carried?.cudChew).toBe("sitrusberry");
    // Without the record: nothing carried.
    const plain = buildBeliefBattle(seat.inputs(), seat.truthWorld(), runtime);
    const none = bridgeTurn(plain.battle, quiet, { runtime, keys: plain.keys, aiSide: "p2", switched: new Set() });
    if (none.kind !== "engine") throw new Error(none.reasons.join(" "));
    expect(none.input.pokemon[slot]!.carried?.cudChew).toBeUndefined();
  });
});
