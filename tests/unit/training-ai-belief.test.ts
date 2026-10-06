import { describe, expect, it } from "vitest";
import { pointsKey } from "@/app/(app)/training/ai/battle-facts";
import { abilityPrior, ruleAbilities } from "@/app/(app)/training/ai/belief/abilities";
import { itemPrior, ruleItems } from "@/app/(app)/training/ai/belief/items";
import { damageLikelihood, EPSILON, orderLikelihood } from "@/app/(app)/training/ai/belief/likelihood";
import { createBeliefModel } from "@/app/(app)/training/ai/belief/model";
import { believedMoves } from "@/app/(app)/training/ai/belief/moves";
import { archetypePoints, spreadPrior } from "@/app/(app)/training/ai/belief/prior";
import { prune, PRUNE_LOG } from "@/app/(app)/training/ai/belief/update";
import { usageSource } from "@/app/(app)/training/ai/belief/usage";
import { CLOSED_TEAM_SHEETS, OPEN_TEAM_SHEETS, PERFECT_INFORMATION } from "@/app/(app)/training/model/info";
import { createRandom } from "@/app/(app)/training/model/random";
import { redactSheet } from "@/app/(app)/training/model/sheet";
import { buildFromCandidate } from "@/app/(app)/training/ai/battle-facts";
import { calculateTurnMove, turnSpeed } from "@/app/lib/battle/calculate";
import { createConditions, getBuildStats } from "@/app/lib/battle/model";
import {
  buildOf, fullSheet, makeInputs, observations, points, PROBE_AI, PROBE_PLAYER, publicMon, runtime, usageFixture, type SheetSpec,
} from "../fixtures/training-ai";

const NO_USAGE = { rows: [], abilities: null };
const sheetOf = (team: SheetSpec[], info = OPEN_TEAM_SHEETS) => redactSheet(fullSheet(team), info);
const truthKey = (spec: SheetSpec) => pointsKey(points(spec.points));
const posterior = (logWeights: number[]) => {
  const best = Math.max(...logWeights);
  const masses = logWeights.map((weight) => Math.exp(weight - best));
  const total = masses.reduce((a, b) => a + b, 0);
  return masses.map((mass) => mass / total);
};

describe("SPEC 10.1.1 priors", () => {
  it("ranks the probe teams' true spreads as spec/prior-probe.ts measured (natures open, no usage)", () => {
    const ranks: number[] = [];
    for (const team of [PROBE_PLAYER, PROBE_AI]) {
      const sheet = sheetOf(team);
      const trickRoom = team.some((spec) => spec.moves.includes("trickroom"));
      for (const member of sheet.members) {
        const spec = team.find((each) => each.key === member.key)!;
        const list = spreadPrior(member, spec.moves, trickRoom, NO_USAGE, runtime);
        ranks.push(list.findIndex((option) => pointsKey(option.points) === truthKey(spec)) + 1);
      }
    }
    // 8 of 12 first, 3 second; the custom 32/2/16/0/16/0 Incineroar is in no candidate.
    expect(ranks.filter((rank) => rank === 1)).toHaveLength(8);
    expect(ranks.filter((rank) => rank === 2)).toHaveLength(3);
    expect(ranks[0]).toBe(0);
  });

  it("applies the table's multipliers", () => {
    const garchomp = archetypePoints("garchomp", ["earthquake", "dragonclaw"], null, false, runtime);
    const fast = garchomp.find((entry) => entry.archetypes.some((part) => part.id === "fast-attacker"))!;
    const bulky = garchomp.find((entry) => entry.archetypes.some((part) => part.id === "bulky-attacker"))!;
    // Base Spe 102 ≥ 90: fast-attacker × 1.5 (0.45 vs 0.25 before normalising).
    expect(fast.weight / bulky.weight).toBeCloseTo(0.45 / (0.25 + 0.07), 6);
    expect(fast.points).toEqual(points({ hp: 2, atk: 32, spe: 32 }));
    // A neutral open nature: uninvested × 20 makes Hardy 0 SP the top candidate (the app's suggested sets).
    const hardy = archetypePoints("garchomp", ["earthquake"], "Hardy", false, runtime);
    expect(hardy[0].points).toEqual(points({}));
    // Base Spe ≤ 50 with a −Spe nature: trick-room first.
    const quiet = archetypePoints("farigiraf", ["psychic", "hypervoice", "trickroom"], "Quiet", true, runtime);
    expect(quiet[0].archetypes.map((part) => part.id)).toContain("trick-room");
    // No damaging move: the attackers × 0.2; two support moves favour walls.
    const support = archetypePoints("whimsicott", ["tailwind", "encore", "helpinghand"], null, false, runtime);
    expect(support[0].archetypes.some((part) => part.id.endsWith("attacker"))).toBe(false);
  });

  it("puts usage spreads first (A1.4) and keeps the archetypes for the uncovered share", () => {
    const sheet = sheetOf(PROBE_PLAYER, CLOSED_TEAM_SHEETS);
    const garchomp = sheet.members.find((member) => member.key === "garchomp")!;
    const source = usageSource("garchomp", { usage: usageFixture }, runtime);
    const list = spreadPrior(garchomp, ["earthquake", "dragonclaw", "rockslide", "protect"], false, source, runtime);
    expect(list[0]).toMatchObject({ source: "usage", nature: "Jolly", points: points({ hp: 2, atk: 32, spe: 32 }) });
    const archetypeMass = list.filter((option) => option.source !== "usage").reduce((sum, option) => sum + option.weight, 0);
    expect(archetypeMass).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(list.reduce((sum, option) => sum + option.weight, 0)).toBeCloseTo(1, 9);
    // With the nature open, only that nature's usage spreads stay.
    const open = sheetOf(PROBE_PLAYER).members.find((member) => member.key === "garchomp")!;
    const jolly = spreadPrior(open, ["earthquake"], false, source, runtime);
    expect(jolly.every((option) => option.nature === "Jolly")).toBe(true);
    expect(jolly[0].source).toBe("usage");
  });

  it("reads a base species' sets from its own and its Mega forms' usage rows, by their set counts", () => {
    const source = usageSource("charizard", { usage: usageFixture }, runtime);
    expect(source.rows.map((row) => row.stone).sort()).toEqual([null, "charizarditex", "charizarditey"].sort());
    const megaY = source.rows.find((row) => row.stone === "charizarditey")!;
    expect(megaY.share).toBeGreaterThan(0.9);
    // The ability comes from the base row: a Mega row's is the Mega form's (Drought).
    expect(source.abilities!.map((entry) => entry.id)).toContain("solarpower");
  });

  it("item prior: usage first, the role table for the rest, Item Clause", () => {
    const closed = sheetOf(PROBE_PLAYER, CLOSED_TEAM_SHEETS).members;
    const charizard = closed.find((member) => member.key === "charizard")!;
    const rules = ruleItems("charizard", ["heatwave", "airslash", "solarbeam", "protect"], runtime);
    // Its two stones share 3.0, the most of any row of the table.
    expect(rules.slice(0, 2).map((item) => item.id).sort()).toEqual(["charizarditex", "charizarditey"]);
    const items = itemPrior(charizard, ["heatwave", "protect"], usageSource("charizard", { usage: usageFixture }, runtime), new Set(), runtime);
    expect(items[0].id).toBe("charizarditey");
    expect(items[0].weight).toBeGreaterThan(0.8);
    const incineroar = closed.find((member) => member.key === "incineroar")!;
    const free = itemPrior(incineroar, ["fakeout"], usageSource("incineroar", { usage: usageFixture }, runtime), new Set(), runtime);
    expect(free[0].id).toBe("sitrusberry");
    const taken = itemPrior(incineroar, ["fakeout"], usageSource("incineroar", { usage: usageFixture }, runtime), new Set(["sitrusberry"]), runtime);
    expect(taken.some((item) => item.id === "sitrusberry")).toBe(false);
    expect(taken.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 9);
  });

  it("ability prior: usualAbility 0.7 without usage; usage abilities with 0.9 of the mass", () => {
    const rule = ruleAbilities("garchomp", runtime);
    expect(rule).toEqual([{ id: "roughskin", weight: 0.7 }, { id: "sandveil", weight: 0.3 }]);
    const closed = sheetOf(PROBE_PLAYER, CLOSED_TEAM_SHEETS).members.find((member) => member.key === "incineroar")!;
    const prior = abilityPrior(closed, usageSource("incineroar", { usage: usageFixture }, runtime), runtime);
    expect(prior[0].id).toBe("intimidate");
    expect(prior[0].weight).toBeGreaterThan(0.85);
    expect(prior.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 9);
    const open = sheetOf(PROBE_PLAYER).members.find((member) => member.key === "incineroar")!;
    expect(abilityPrior(open, NO_USAGE, runtime)).toEqual([{ id: "intimidate", weight: 1 }]);
  });

  it("moves: usage moves of every category (A1.4), seen moves first, Protect in the fallback", () => {
    const closed = sheetOf(PROBE_PLAYER, CLOSED_TEAM_SHEETS).members.find((member) => member.key === "incineroar")!;
    const source = usageSource("incineroar", { usage: usageFixture }, runtime);
    expect(believedMoves(closed, [], source, runtime)).toEqual(["fakeout", "partingshot", "flareblitz", "throatchop"]);
    // A newly seen move replaces the lowest-ranked filler.
    expect(believedMoves(closed, ["protect"], source, runtime)).toEqual(["protect", "fakeout", "partingshot", "flareblitz"]);
    const fallback = believedMoves(closed, [], NO_USAGE, runtime);
    expect(fallback[0]).toBe("protect");
    expect(fallback).toHaveLength(4);
    const open = sheetOf(PROBE_PLAYER).members.find((member) => member.key === "incineroar")!;
    expect(believedMoves(open, ["closecombat"], source, runtime)).toEqual(["fakeout", "flareblitz", "partingshot", "protect"]);
  });
});

describe("SPEC 10.1.2 updates", () => {
  const ai = PROBE_AI;

  it("reveals are hard; Item Clause applies across members; a reveal never empties a member", () => {
    const belief = createBeliefModel(CLOSED_TEAM_SHEETS, { usage: usageFixture });
    const inputs = makeInputs({ player: PROBE_PLAYER, ai, info: CLOSED_TEAM_SHEETS });
    belief.start(inputs.sheet, runtime);
    const before = belief.snapshot();
    expect(before.members.garchomp.candidates.some((candidate) => candidate.itemId === "lifeorb")).toBe(true);
    expect(before.members.kingambit.candidates.some((candidate) => candidate.itemId === "lifeorb")).toBe(true);
    const mons = [publicMon("p1", "garchomp", "garchomp", 0, { item: { state: "held", itemId: "lifeorb" } }), publicMon("p1", "kingambit", "kingambit", 1)];
    belief.observe(makeInputs({ player: PROBE_PLAYER, ai, info: CLOSED_TEAM_SHEETS, mons }), runtime);
    const after = belief.snapshot();
    expect(after.members.garchomp.candidates.every((candidate) => candidate.itemId === "lifeorb")).toBe(true);
    expect(after.members.kingambit.candidates.some((candidate) => candidate.itemId === "lifeorb")).toBe(false);
    expect(after.members.kingambit.candidates.length).toBeGreaterThan(0);
    // An item no candidate had: copies of the top candidates with it.
    const odd = [publicMon("p1", "whimsicott", "whimsicott", 0, { item: { state: "held", itemId: "shellbell" } })];
    belief.observe(makeInputs({ player: PROBE_PLAYER, ai, info: CLOSED_TEAM_SHEETS, mons: odd }), runtime);
    const whimsicott = belief.snapshot().members.whimsicott.candidates;
    expect(whimsicott.length).toBeGreaterThan(0);
    expect(whimsicott.every((candidate) => candidate.itemId === "shellbell")).toBe(true);
  });

  it("a Mega Evolution reveals the stone; an announced ability is hard; a Mega form's ability is not the set's", () => {
    const belief = createBeliefModel(CLOSED_TEAM_SHEETS, { usage: usageFixture });
    belief.start(makeInputs({ player: PROBE_PLAYER, ai, info: CLOSED_TEAM_SHEETS }).sheet, runtime);
    const mons = [
      publicMon("p1", "charizard", "charizardmegay", 0, { mega: true, ability: { abilityId: "drought", how: "announced" } }),
      publicMon("p1", "incineroar", "incineroar", 1, { ability: { abilityId: "intimidate", how: "announced" } }),
    ];
    belief.observe(makeInputs({ player: PROBE_PLAYER, ai, info: CLOSED_TEAM_SHEETS, mons }), runtime);
    const snapshot = belief.snapshot();
    expect(snapshot.members.charizard.candidates.every((candidate) => candidate.itemId === "charizarditey")).toBe(true);
    expect(snapshot.members.charizard.candidates.some((candidate) => candidate.abilityId === "drought")).toBe(false);
    expect(snapshot.members.incineroar.candidates.every((candidate) => candidate.abilityId === "intimidate")).toBe(true);
  });

  it("entry silence weighs down abilities that announce on entry", () => {
    const team: SheetSpec[] = [{ key: "gyarados", species: "gyarados", item: "sitrusberry", ability: "moxie", moves: ["waterfall", "protect"], nature: "Adamant", points: { atk: 32, spe: 32, hp: 2 } }, ...PROBE_PLAYER.slice(1)];
    const belief = createBeliefModel(CLOSED_TEAM_SHEETS, { usage: usageFixture });
    belief.start(makeInputs({ player: team, ai, info: CLOSED_TEAM_SHEETS }).sheet, runtime);
    const share = () => {
      const candidates = belief.snapshot().members.gyarados.candidates;
      const masses = posterior(candidates.map((candidate) => candidate.logWeight));
      return candidates.reduce((sum, candidate, i) => sum + (candidate.abilityId === "intimidate" ? masses[i] : 0), 0);
    };
    const prior = share();
    expect(prior).toBeGreaterThan(0.5);
    const record = observations(1, { entries: [{ key: "p1:gyarados", announced: [] }] });
    belief.observe(makeInputs({ player: team, ai, info: CLOSED_TEAM_SHEETS, mons: [publicMon("p1", "gyarados", "gyarados", 0)], observations: [record] }), runtime);
    expect(share()).toBeLessThan(prior);
  });

  it("speed order narrows the Speed belief", () => {
    // Garchomp moved before the AI's Jolly 32 Spe Dragonite (no Tailwind, no priority): only a Garchomp at least as fast fits.
    const dragonite = buildOf({ species: "dragonite", nature: "Jolly", points: { atk: 32, spe: 32, hp: 2 }, ability: "multiscale" });
    const conditions = { first: { key: "p1:garchomp", moveId: "dragonclaw", speStage: 0, status: "" as const, tailwind: false, quickClaw: false }, second: { key: "p2:dragonite", moveId: "extremespeed", speStage: 0, status: "" as const, tailwind: false, quickClaw: false }, trickRoom: false, weather: "", terrain: "" };
    // Extreme Speed is +2: the order disagrees with any Speed, so every candidate gets ε… a +0 move instead:
    const order = { ...conditions, second: { ...conditions.second, moveId: "dragonclaw" } };
    const fast = buildOf({ species: "garchomp", nature: "Jolly", points: { atk: 32, spe: 32, hp: 2 } });
    const slow = buildOf({ species: "garchomp", nature: "Brave", points: { hp: 32, atk: 32 } });
    expect(orderLikelihood(order, fast, dragonite, runtime)).toBeCloseTo(1, 12);
    expect(orderLikelihood(order, slow, dragonite, runtime)).toBeCloseTo(EPSILON, 12);
    expect(orderLikelihood(conditions, fast, dragonite, runtime)).toBeCloseTo(EPSILON, 12);
    expect(orderLikelihood({ ...order, first: { ...order.first, quickClaw: true } }, fast, dragonite, runtime)).toBeNull();
    // In a model: Garchomp's Speed belief moves toward 32 Spe.
    const team = PROBE_PLAYER;
    const aiTeam: SheetSpec[] = [{ key: "dragonite", species: "dragonite", item: "lumberry", ability: "multiscale", moves: ["dragonclaw", "protect"], nature: "Jolly", points: { atk: 32, spe: 32, hp: 2 } }, ...ai.filter((spec) => spec.key !== "dragonite")];
    const belief = createBeliefModel(CLOSED_TEAM_SHEETS);
    const mons = [publicMon("p1", "garchomp", "garchomp", 0), publicMon("p2", "dragonite", "dragonite", 0)];
    belief.observe(makeInputs({ player: team, ai: aiTeam, info: CLOSED_TEAM_SHEETS, mons }), runtime);
    const field = { ...createConditions(), gameType: "Doubles" as const };
    const dragoniteSpeed = turnSpeed(dragonite, false, field, runtime);
    /** The posterior mass of Garchomp sets faster than the Dragonite (by turnSpeed, Choice Scarf included). */
    const faster = () => {
      const candidates = belief.snapshot().members.garchomp.candidates;
      const masses = posterior(candidates.map((candidate) => candidate.logWeight));
      return candidates.reduce((sum, candidate, i) => sum + (turnSpeed(buildFromCandidate("garchomp", candidate, runtime), false, field, runtime) > dragoniteSpeed ? masses[i] : 0), 0);
    };
    const before = faster();
    expect(before).toBeLessThan(0.9);
    belief.observe(makeInputs({ player: team, ai: aiTeam, info: CLOSED_TEAM_SHEETS, mons, observations: [observations(1, { order: [order] })] }), runtime);
    expect(faster()).toBeGreaterThan(0.95);
  });

  it("damage narrows the belief and the ε floor keeps the truth", () => {
    // Garchomp (true: Jolly 32 Atk, Life Orb) hits the AI's Gyarados with Dragon Claw for an exact amount.
    const truth = buildOf({ species: "garchomp", nature: "Jolly", points: { atk: 32, spe: 32, hp: 2 }, item: "lifeorb", ability: "roughskin" });
    const gyarados = buildOf({ species: "gyarados", nature: "Adamant", points: { atk: 32, spe: 32, hp: 2 }, item: "sitrusberry", ability: "intimidate" });
    const maxhp = getBuildStats(gyarados, runtime)!.hp;
    const row = calculateTurnMove(runtime.movesById.get("dragonclaw")!, truth, gyarados, { ...createConditions(), gameType: "Doubles", multipleTargets: false }, undefined, runtime);
    const rolls = row.rolls as number[];
    const dealt = rolls[8];
    const zero = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };
    const observation = {
      moveId: "dragonclaw", attacker: { key: "p1:garchomp", speciesId: "garchomp", boosts: zero, status: "" as const, hp: { percent: 100, color: null } },
      defender: { key: "p2:gyarados", speciesId: "gyarados", boosts: zero, status: "" as const, hp: { hp: maxhp, maxhp } }, after: { hp: maxhp - dealt, maxhp },
      crit: false, spread: false, helpingHand: false, censored: null, weather: "", terrain: "", defenderScreens: { reflect: false, lightScreen: false, auroraVeil: false },
      gravity: false, magicRoom: false, wonderRoom: false,
    };
    const memo = new Map();
    const share = rolls.filter((roll) => roll === dealt).length / rolls.length;
    expect(damageLikelihood(observation, truth, gyarados, runtime, memo)).toBeCloseTo((1 - EPSILON) * share + EPSILON, 12);
    const weak = buildOf({ species: "garchomp", nature: "Timid", points: { hp: 32, spe: 32 }, item: "leftovers", ability: "roughskin" });
    expect(damageLikelihood(observation, weak, gyarados, runtime, memo)).toBeCloseTo(EPSILON, 12);
    // The AI's hit into the player's shown HP: averaged over the band.
    const reverse = {
      ...observation, moveId: "waterfall",
      attacker: { ...observation.defender, key: "p2:gyarados" }, defender: { ...observation.attacker, key: "p1:garchomp", hp: { percent: 100, color: null } },
      after: { percent: 70, color: null },
    };
    const likelihood = damageLikelihood(reverse, gyarados, truth, runtime, memo);
    expect(likelihood).not.toBeNull();
    expect(likelihood!).toBeGreaterThanOrEqual(EPSILON);
  });

  it("prunes candidates more than ln(10⁴) below the best and keeps one", () => {
    const base = { archetype: "usage" as const, points: points({}), nature: "Hardy", itemId: "", abilityId: "" };
    const kept = prune([{ ...base, id: "a", logWeight: 0 }, { ...base, id: "b", logWeight: -PRUNE_LOG + 0.01 }, { ...base, id: "c", logWeight: -PRUNE_LOG - 0.01 }]);
    expect(kept.map((candidate) => candidate.id)).toEqual(["a", "b"]);
    expect(prune([{ ...base, id: "x", logWeight: -1e9 }])).toHaveLength(1);
  });
});

describe("SPEC 10.1.3 worlds", () => {
  const ai = PROBE_AI;
  const mons = [publicMon("p1", "garchomp", "garchomp", 1), publicMon("p1", "whimsicott", "whimsicott", 0)];

  it("world 0 is the MAP; worlds are deterministic per seed; revealed members always brought, actives first", () => {
    const make = () => {
      const belief = createBeliefModel(CLOSED_TEAM_SHEETS, { usage: usageFixture });
      const inputs = makeInputs({ player: PROBE_PLAYER, ai, info: CLOSED_TEAM_SHEETS, mons });
      belief.start(inputs.sheet, runtime);
      belief.setBring({ incineroar: 0.9, charizard: 0.8, whimsicott: 0.5, garchomp: 0.5, rotomwash: 0.2, kingambit: 0.1 });
      belief.observe(inputs, runtime);
      return { belief, inputs };
    };
    const { belief, inputs } = make();
    const worlds = belief.worlds(4, inputs, createRandom("seed", 1), "0".repeat(32));
    const again = make();
    expect(again.belief.worlds(4, again.inputs, createRandom("seed", 1), "0".repeat(32))).toEqual(worlds);
    expect(worlds).toHaveLength(4);
    expect(worlds.map((world) => world.weight)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(worlds[0].hp).toBe("midpoint");
    expect(worlds.slice(1).every((world) => world.hp === "sample")).toBe(true);
    expect(new Set(worlds.map((world) => world.seed)).size).toBe(4);
    for (const world of worlds) {
      expect(world.brought).toHaveLength(4);
      expect(world.brought.slice(0, 2)).toEqual(["whimsicott", "garchomp"]);
      const items = Object.values(world.sets).map((set) => set.item).filter(Boolean);
      expect(new Set(items).size).toBe(items.length);
      for (const set of Object.values(world.sets)) {
        expect(set.gender).toMatch(/^[MFN]$/);
        expect(set.level).toBe(50);
        expect(Object.values(set.ivs).every((iv) => iv === 31)).toBe(true);
        expect(Object.values(set.evs).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(66);
      }
    }
    // World 0: the highest bring chances fill the rest; each set the heaviest candidate.
    expect(worlds[0].brought.slice(2)).toEqual(["incineroar", "charizard"]);
    const snapshot = belief.snapshot();
    const top = snapshot.members.garchomp.candidates[0];
    expect(worlds[0].sets.garchomp.evs).toEqual(top.points);
    expect(worlds[0].sets.garchomp.nature).toBe(top.nature);
    // A different seed draws different worlds 1..k-1 but the same world 0.
    const other = belief.worlds(4, inputs, createRandom("seed", 2), "1".repeat(32));
    expect(other[0].sets).toEqual(worlds[0].sets);
  });

  it("open categories are copied from the sheet; TestReveals.brought makes the bring exact", () => {
    const belief = createBeliefModel(PERFECT_INFORMATION);
    const inputs = makeInputs({ player: PROBE_PLAYER, ai, info: PERFECT_INFORMATION, mons, reveals: { exactHP: null, brought: ["garchomp", "whimsicott", "rotomwash", "kingambit"] } });
    belief.observe(inputs, runtime);
    const [world] = belief.worlds(1, inputs, createRandom("x"), "0".repeat(32));
    expect([...world.brought].sort()).toEqual(["garchomp", "kingambit", "rotomwash", "whimsicott"]);
    expect(world.sets.garchomp).toMatchObject({ species: "Garchomp", item: "Life Orb", ability: "Rough Skin", nature: "Jolly", evs: points({ hp: 2, atk: 32, spe: 32 }) });
    expect(world.sets.garchomp.moves).toEqual(["Earthquake", "Dragon Claw", "Rock Slide", "Protect"]);
  });

  it("reports the MAP spread of the player's actives while Stat Points are closed", () => {
    const belief = createBeliefModel(OPEN_TEAM_SHEETS, { usage: usageFixture });
    const inputs = makeInputs({ player: PROBE_PLAYER, ai, info: OPEN_TEAM_SHEETS, mons });
    belief.observe(inputs, runtime);
    const assumed = belief.assumed(inputs, runtime);
    expect(assumed).toHaveLength(2);
    expect(assumed[0]).toMatch(/^Whimsicott: 2 HP \/ 32 SpA \/ 32 Spe · Timid \(\d+%\)$/);
    expect(assumed[1]).toMatch(/^Garchomp: 2 HP \/ 32 Atk \/ 32 Spe · Jolly \(\d+%\)$/);
    expect(createBeliefModel(PERFECT_INFORMATION).assumed(inputs, runtime)).toEqual([]);
  });

  it("reads only AiInputs: the same inputs give the same belief, and nothing in them is changed", () => {
    const deepFreeze = <T,>(value: T): T => {
      if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
      return value;
    };
    const record = observations(1, { reveals: [{ key: "p1:garchomp", kind: "move", id: "earthquake" }] });
    const inputs = deepFreeze(makeInputs({ player: PROBE_PLAYER, ai, info: CLOSED_TEAM_SHEETS, mons, observations: [record] }));
    const a = createBeliefModel(CLOSED_TEAM_SHEETS, { usage: usageFixture });
    const b = createBeliefModel(CLOSED_TEAM_SHEETS, { usage: usageFixture });
    a.observe(inputs, runtime);
    b.observe(structuredClone(inputs), runtime);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.snapshot().members.garchomp.moves[0]).toBe("earthquake");
    expect(a.snapshot().seenTurns).toBe(1);
    // A record already applied is not applied again.
    a.observe(inputs, runtime);
    expect(a.snapshot().seenTurns).toBe(1);
  });
});
