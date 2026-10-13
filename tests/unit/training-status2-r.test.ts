import { describe, expect, it } from "vitest";
import type { DoublesOutcome, DoublesOutcomeMon, DoublesSlotId, DoublesStart, DoublesTurnInput } from "@/app/lib/battle/doubles-types";
import { startId } from "@/app/lib/battle/doubles-types";
import { calculateDoublesOutcomes } from "@/app/lib/battle/doubles-turn";
import { engineIdKey, inputKey, postFromOutcome } from "@/app/(app)/training/ai/evaluate";
import type { CellActions, EngineWorld, MonKey, ReplacePolicy } from "@/app/(app)/training/model/ai-view";
import type { PublicMon } from "@/app/(app)/training/model/public-state";
import type { SlotAction } from "@/app/(app)/training/model/view-types";
import { buildBeliefBattle } from "@/app/(app)/training/sim/belief-battle";
import { benchOf, bridgeTurn, hazardsOf, liveBuild } from "@/app/(app)/training/sim/bridge";
import { runPreludeWorlds } from "@/app/(app)/training/sim/prelude";
import { replacementChoice } from "@/app/(app)/training/sim/rollout";
import { createTurnServices } from "@/app/(app)/training/sim/services";
import { toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { Battle, State, type Pokemon } from "@/app/(app)/training/sim/sim";
import { countsOf, createTracker } from "@/app/(app)/training/sim/tracker";
import { makeView, postOf } from "../fixtures/training-ai";
import { memberFromSet, runtime, seatBattle } from "./training-sim-fixtures";

/**
 * status2 Track R-T (SPEC2 §6's R part, ADDENDUM2 §6 R-T, USER-DECISIONS Q1 and Q9) on pinned Showdown c23d2e94: Training
 * passes each side's real bench (the AI's own exactly, the player's from the belief world), the replacement picks (the
 * player's healthiest bench Pokémon, the AI's own ReplacePolicy), the entry hazards with their layers, and Assist's party;
 * the prelude answers a replacement asked before the moves; E2's newcomers and leavers go back into the post-turn state; and
 * the AI's seat keeps its own chosen targets (INTEGRATION-1B's open item: Future Sight's "[still]" line, a retarget).
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
const hex = (n: number) => n.toString(16).padStart(32, "0");
const move = (moveId: string, target: DoublesSlotId | null = null): SlotAction => ({ kind: "move", moveId, target });
/** A cell: own-left is p1a, own-right p1b, opponent-right p2a, opponent-left p2b (model/positions.ts). */
const cellOf = (p1a: SlotAction, p1b: SlotAction, p2a: SlotAction, p2b: SlotAction): CellActions => ({
  own: { "own-left": p1a, "own-right": p1b }, opponent: { "opponent-right": p2a, "opponent-left": p2b },
});
const quiet = cellOf(move("protect"), move("protect"), move("protect"), move("protect"));
const idle = (species: string, moves = ["Rest", "Protect"], extra: Record<string, unknown> = {}) => set(species, "", runtime.speciesById.get(species.toLowerCase())?.abilities[0] === "thickfat" ? "Thick Fat" : "Pressure", moves, extra);

/** A real Champions battle from the AI's seat (p2), every member brought in team order. */
function seat(p1: Set[], p2: Set[], turns: [string, string][] = [], seed = [1, 2, 3, 4]) {
  const s = seatBattle(seed, { own: team(p1), opponent: team(p2) });
  s.step(`team ${p1.map((_, i) => i + 1).join("")}`, `team ${p2.map((_, i) => i + 1).join("")}`);
  for (const [a, b] of turns) s.step(a, b);
  return s;
}
const engineInput = (worlds: ReturnType<ReturnType<typeof createTurnServices>["engineWorlds"]>): DoublesTurnInput => {
  if (worlds.kind !== "engine") throw new Error(`${worlds.kind}: ${worlds.reasons.join(" ")}`);
  return worlds.worlds[0].input;
};

describe("the AI's seat keeps its own chosen targets (tracker.chose; INTEGRATION-1B open item 3)", () => {
  const LEAD = ["|switch|p1a: Cofagrigus|Cofagrigus, L50, M|100/100", "|switch|p1b: Raichu|Raichu, L50, M|100/100",
    "|switch|p2a: Garchomp|Garchomp, L50, M|183/183", "|switch|p2b: Farigiraf|Farigiraf, L50, M|195/195", "|turn|1"];
  const state = (lines: string[], choice?: string, more: { choice?: string; lines: string[] }[] = []) => {
    const t = createTracker("p2", keyOf);
    t.push(LEAD);
    if (choice) t.chose(choice);
    t.push(lines);
    for (const step of more) { if (step.choice) t.chose(step.choice); t.push(step.lines); }
    return t.state();
  };
  it("a Future Sight line with no target ([still]: the slot already holds one) keeps the slot it was chosen at", () => {
    const line = ["|move|p2b: Farigiraf|Future Sight||[still]", "|-fail|p2b: Farigiraf"];
    expect(state(line).mons["p2:farigiraf"].lastMoveTarget).toBeNull();
    expect(state(line, "move 1 2, move 1 1").mons["p2:farigiraf"].lastMoveTarget).toEqual({ side: "p1", position: 0 });
  });
  it("a retarget after the chosen target fainted keeps the chosen target, and is no longer unknown", () => {
    const lines = ["|move|p2a: Garchomp|Dragon Claw|p1b: Raichu", "|-damage|p1b: Raichu|0 fnt", "|faint|p1b: Raichu", "|move|p2b: Farigiraf|Psychic|p1a: Cofagrigus"];
    const plain = state(lines);
    expect(countsOf(plain.mons["p2:farigiraf"]).lastTargetUnknown).toBe(true);
    const chosen = state(lines, "move 1 2, move 2 2");
    expect(chosen.mons["p2:farigiraf"].lastMoveTarget).toEqual({ side: "p1", position: 1 });
    expect(countsOf(chosen.mons["p2:farigiraf"]).lastTargetUnknown).toBeUndefined();
    expect(chosen.mons["p2:garchomp"].lastMoveTarget).toEqual({ side: "p1", position: 1 });
  });
  it("a Lightning Rod redirection and a Follow Me: the chosen target stands; the player's Pokémon (no choice known) stay unknown", () => {
    const rod = state(["|move|p2a: Garchomp|Thunder Fang|p1b: Raichu", "|-activate|p1b: Raichu|ability: Lightning Rod", "|-immune|p1b: Raichu|[from] ability: Lightning Rod"], "move 1 1, move 1 1");
    expect(rod.mons["p2:garchomp"].lastMoveTarget).toEqual({ side: "p1", position: 0 });
    expect(countsOf(rod.mons["p2:garchomp"]).lastTargetUnknown).toBeUndefined();
    const follow = ["|move|p2a: Garchomp|Protect|p2a: Garchomp", "|-singleturn|p2b: Farigiraf|move: Follow Me", "|move|p1a: Cofagrigus|Shadow Ball|p2b: Farigiraf"];
    expect(countsOf(state(follow, "move 3, move 4").mons["p1:cofagrigus"]).lastTargetUnknown).toBe(true);
  });
  it("an instructed move keeps its user's last target (pinned instruct: lastMoveTargetLoc); its own action later this turn takes its choice", () => {
    const first = { choice: "move 1 1, move 1 1", lines: ["|move|p2a: Garchomp|Dragon Claw|p1a: Cofagrigus", "|-damage|p1a: Cofagrigus|60/100", "|", "|upkeep", "|turn|2"] };
    const instructed = state([], undefined, [first, { choice: "move 1 2, move 3 -1", lines: [
      "|move|p2b: Farigiraf|Instruct|p2a: Garchomp", "|-singleturn|p2a: Garchomp|move: Instruct|[of] p2b: Farigiraf",
      "|move|p2a: Garchomp|Dragon Claw|p1b: Raichu", "|-damage|p1b: Raichu|50/100",
    ] }]);
    // The instructed Dragon Claw ran at the earlier loc (p1a); its line's target says p1b (a retarget would print so too).
    expect(instructed.mons["p2:garchomp"].lastMoveTarget).toEqual({ side: "p1", position: 0 });
    const then = state([], undefined, [first, { choice: "move 1 2, move 3 -1", lines: [
      "|move|p2b: Farigiraf|Instruct|p2a: Garchomp", "|-singleturn|p2a: Garchomp|move: Instruct|[of] p2b: Farigiraf",
      "|move|p2a: Garchomp|Dragon Claw|p1a: Cofagrigus", "|-damage|p1a: Cofagrigus|30/100", "|move|p2a: Garchomp|Dragon Claw|p1b: Raichu",
    ] }]);
    expect(then.mons["p2:garchomp"].lastMoveTarget).toEqual({ side: "p1", position: 1 });
    expect(then.mons["p2:farigiraf"].lastMoveTarget).toEqual({ side: "p2", position: 0 });
  });
  it("a choice whose move did not run (cant) or whose Pokémon left writes nothing; the next turn's line is read as before", () => {
    const flinched = state(["|cant|p2a: Garchomp|flinch", "|", "|upkeep", "|turn|2", "|move|p2a: Garchomp|Dragon Claw|p1b: Raichu"], "move 1 1, move 2");
    expect(flinched.mons["p2:garchomp"].lastMoveTarget).toEqual({ side: "p1", position: 1 });
    const left = state(["|switch|p2a: Snorlax|Snorlax, L50, M|100/100", "|move|p2a: Snorlax|Body Slam|p1b: Raichu"], "move 1 1, move 2");
    expect(left.mons["p2:snorlax"].lastMoveTarget).toEqual({ side: "p1", position: 1 });
  });
  it("real battles: the belief battle's lastMoveTargetLoc is the real one after a [still] Future Sight and after a retarget", () => {
    // Farigiraf's second Future Sight at p1a fails (the slot holds one): its line names no target.
    const fs = seat([idle("Snorlax"), idle("Corviknight")], [set("Farigiraf", "", "Cud Chew", ["Future Sight", "Protect"]), idle("Snorlax")],
      [["move 1, move 1", "move 1 1, move 2"], ["move 1, move 1", "move 1 1, move 2"]]);
    expect(fs.battle.log.some((line) => /^\|move\|p2a: Farigiraf\|Future Sight\|\|\[still\]/.test(line))).toBe(true);
    const fsBelief = buildBeliefBattle(fs.inputs(), fs.truthWorld(), runtime);
    const real = fs.battle.p2.active[0] as unknown as Pokemon, believed = fsBelief.battle.p2.active[0];
    expect(real.lastMoveTargetLoc).toBe(1);
    expect(believed?.lastMoveTargetLoc).toBe(real.lastMoveTargetLoc);
    // Garchomp (faster) knocks out p1b (left at 1 HP); Kingambit's Iron Head chosen at p1b retargets to p1a.
    const rt = seat([idle("Snorlax"), idle("Corviknight")], [set("Garchomp", "", "Rough Skin", ["Dragon Claw", "Protect"]), set("Kingambit", "", "Defiant", ["Iron Head", "Protect"])]);
    (rt.battle.p1.active[1] as unknown as { hp: number }).hp = 1;
    rt.step("move 1, move 1", "move 1 2, move 1 2");
    const kingambit = rt.battle.p2.active[1] as unknown as Pokemon;
    expect(rt.battle.log.some((line) => line.startsWith("|move|p2b: Kingambit|Iron Head|p1a: "))).toBe(true);
    expect(kingambit.lastMoveTargetLoc).toBe(2);
    expect(countsOf(rt.inputs().public.mons["p2:kingambit"]).lastTargetUnknown).toBeUndefined();
    expect(buildBeliefBattle(rt.inputs(), rt.truthWorld(), runtime).battle.p2.active[1]?.lastMoveTargetLoc).toBe(2);
  });
});

describe("the bench, the replacements and the hazards (SPEC2 §6 R; ADDENDUM2 §6 R-T)", () => {
  const P1 = [idle("Snorlax"), idle("Corviknight"), set("Garchomp", "", "Rough Skin", ["Dragon Claw", "Protect"]), set("Incineroar", "", "Intimidate", ["Fake Out", "Protect"])];
  const P2 = [idle("Snorlax"), idle("Corviknight"), set("Kingambit", "", "Defiant", ["Iron Head", "Swords Dance"]), set("Farigiraf", "", "Cud Chew", ["Psychic", "Protect"])];
  const services = (inputs = seat(P1, P2).inputs(), world?: ReturnType<ReturnType<typeof seat>["truthWorld"]>) => {
    const s = seat(P1, P2);
    return createTurnServices(inputs, [world ?? s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(1) });
  };
  it("each side's living bench in party order, under its MonKey, with its build and moves (Assist's party); no rollout, canSwitch kept", () => {
    const input = engineInput(services().engineWorlds(quiet));
    expect(input.bench?.own?.map((each) => each.id)).toEqual(["own:garchomp", "own:incineroar"]);
    expect(input.bench?.opponent?.map((each) => each.id)).toEqual(["opponent:kingambit", "opponent:farigiraf"]);
    expect(input.bench?.opponent?.[0]).toMatchObject({ build: { speciesId: "kingambit", abilityId: "defiant", currentHP: null }, moves: ["ironhead", "swordsdance"] });
    expect(input.bench?.own?.[1].moves).toEqual(["fakeout", "protect"]);
    expect(input.canSwitch).toEqual({ own: true, opponent: true });
    expect(input.hazards).toBeUndefined();
    // The engine takes the bench (doubles-turn.ts benchIssues: no issue).
    expect(calculateDoublesOutcomes(input).status).not.toBe("issues");
  });
  it("the player's bench is the belief world's (its believed sets), not the real battle's", () => {
    const s = seat(P1, P2);
    const world = s.truthWorld();
    const believed = { ...world, sets: { ...world.sets, garchomp: { ...world.sets.garchomp, item: "Life Orb", moves: ["Earthquake", "Protect"] } } };
    const input = engineInput(createTurnServices(s.inputs(), [believed], { runtime, keys: s.keys, seedBase: hex(1) }).engineWorlds(quiet));
    expect(input.bench?.own?.[0]).toMatchObject({ id: "own:garchomp", build: { itemId: "lifeorb" }, moves: ["earthquake", "protect"] });
  });
  it("the replacements: the player's healthiest bench Pokémon at each switch (replacementOrder); the AI's own ReplacePolicy pick and ranking, none without one", () => {
    const s = seat(P1, P2);
    const inputs = s.inputs();
    const svc = createTurnServices(inputs, [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(1) });
    const plain = engineInput(svc.engineWorlds(quiet));
    expect([plain.replacement, plain.replacementOrder]).toEqual([undefined, { own: "healthiest" }]);
    const picked: ReplacePolicy = (_side, slots, options) => slots.map(() => options[options.length - 1]);
    const withPolicy = engineInput(svc.engineWorlds(quiet, picked));
    expect(withPolicy.replacement).toEqual({ "opponent-left": "opponent:farigiraf", "opponent-right": "opponent:farigiraf" });
    // The AI's ranking of its whole living party (its Pokémon in play by their slots' start ids), the policy's pick first.
    expect(withPolicy.replacementOrder).toEqual({ own: "healthiest", opponent: [startId("opponent-right"), startId("opponent-left"), "opponent:farigiraf", "opponent:kingambit"] });
    // One memo per policy: the same policy gives the same worlds, none gives its own.
    expect(svc.engineWorlds(quiet, picked)).toBe(svc.engineWorlds(quiet, picked));
    expect(svc.engineWorlds(quiet)).not.toBe(svc.engineWorlds(quiet, picked));
    // A damaged Garchomp (seen in battle at 40%): Incineroar is the healthiest.
    const hurt = s.inputs();
    hurt.public.mons["p1:garchomp"] = { ...structuredClone(hurt.public.mons["p1:snorlax"]), key: "p1:garchomp", speciesId: "garchomp", position: null, hp: { percent: 40, color: null }, switchIns: 1, volatiles: [], lastMove: null, lastMoveTarget: null };
    // (the test setting's exact HP, which the perfect-information inputs carry, says the same)
    const real = s.battle.p1.pokemon.find((each) => each.species.id === "garchomp")!;
    hurt.reveals.exactHP!["p1:garchomp"] = { hp: Math.floor(real.maxhp * 0.4), maxhp: real.maxhp };
    const healthier = engineInput(createTurnServices(hurt, [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(1) }).engineWorlds(quiet));
    expect(healthier.bench?.own?.[0].build.currentHP).toBeGreaterThan(0);
    expect(healthier.replacementOrder?.own).toBe("healthiest");
  });
  it("the entry hazards with their layers, engine orientation (own: the player's side)", () => {
    const s = seat(P1, P2);
    const inputs = s.inputs();
    inputs.public.sides.p1.conditions.push({ id: "stealthrock", since: 1, layers: 1, setterKey: null }, { id: "spikes", since: 1, layers: 2, setterKey: null });
    inputs.public.sides.p2.conditions.push({ id: "toxicspikes", since: 1, layers: 1, setterKey: null }, { id: "stickyweb", since: 1, layers: 1, setterKey: null });
    const input = engineInput(createTurnServices(inputs, [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(1) }).engineWorlds(quiet));
    // Review 2 (R7-2): with the order they went up (the public -sidestart order: the belief battle's effectOrder).
    expect(input.hazards).toEqual({ own: { stealthRock: true, spikes: 2, order: ["stealthrock", "spikes"] }, opponent: { toxicSpikes: 1, stickyWeb: true, order: ["toxicspikes", "stickyweb"] } });
    expect(calculateDoublesOutcomes(input).status).not.toBe("issues");
    const belief = buildBeliefBattle(inputs, s.truthWorld(), runtime);
    belief.battle.p1.sideConditions.spikes = { ...belief.battle.p1.sideConditions.spikes, layers: 3 } as never;
    expect(hazardsOf(belief.battle, "p1")).toEqual({ stealthRock: true, spikes: 3, order: ["stealthrock", "spikes"] });
    expect(hazardsOf(belief.battle, "p2")).toEqual({ toxicSpikes: 1, stickyWeb: true, order: ["toxicspikes", "stickyweb"] });
    // Sticky Web up before Stealth Rock: that order; one hazard alone carries none.
    const reversed = s.inputs();
    reversed.public.sides.p1.conditions.push({ id: "stickyweb", since: 1, layers: 1, setterKey: null }, { id: "stealthrock", since: 2, layers: 1, setterKey: null });
    reversed.public.sides.p2.conditions.push({ id: "spikes", since: 1, layers: 1, setterKey: null });
    expect(engineInput(createTurnServices(reversed, [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(1) }).engineWorlds(quiet)).hazards)
      .toEqual({ own: { stealthRock: true, stickyWeb: true, order: ["stickyweb", "stealthrock"] }, opponent: { spikes: 1 } });
  });
  it("benchOf: a benched sleeper keeps its sleep counter (the public counts) and its once-a-battle effects; one with no public counts is a rollout reason", () => {
    const s = seat(P1, P2);
    const belief = buildBeliefBattle(s.inputs(), s.truthWorld(), runtime);
    const kingambit = belief.battle.p2.pokemon.find((each) => each.species.id === "kingambit")!;
    kingambit.status = "slp";
    (kingambit as unknown as { swordBoost: boolean }).swordBoost = true;
    const pub = { statusElapsed: 2, restSleep: true } as unknown as PublicMon;
    const reasons = new Set<string>();
    const { entries } = benchOf(belief.battle, "p2", { runtime, keys: belief.keys, aiSide: "p2", publicOf: (key) => (key === "opponent:kingambit" ? pub : null) }, reasons);
    expect(entries[0]).toMatchObject({ id: "opponent:kingambit", build: { status: "slp" }, carried: { sleep: { attempts: 2, rest: true }, onceUsed: ["intrepidsword"] } });
    expect(reasons.size).toBe(0);
    benchOf(belief.battle, "p2", { runtime, keys: belief.keys, aiSide: "p2" }, reasons);
    expect([...reasons]).toEqual(["Kingambit: its sleep needs the public counts."]);
  });
  it("Beat Up's party comes from the bench (the engine's), not a list from the turn's start: a burned partner that U-turned out does not hit", () => {
    const P1B = [set("Farigiraf", "", "Armor Tail", ["Beat Up", "Protect"]), set("Corviknight", "", "Pressure", ["U-turn", "Protect"]), set("Garchomp", "", "Rough Skin", ["Protect", "Earthquake"]), set("Incineroar", "", "Intimidate", ["Protect", "Fake Out"])];
    const P2B = [set("Dragapult", "", "Infiltrator", ["Will-O-Wisp", "Protect"]), set("Snorlax", "", "Thick Fat", ["Curse", "Protect"]), set("Kingambit", "", "Defiant", ["Protect", "Iron Head"])];
    const s = seat(P1B, P2B, [], [2, 2, 3, 4]);
    const services = createTurnServices(s.inputs(), [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(6) });
    // The damage rows' start input keeps the listed party (it has no bench); the turn's input leaves it to the bench.
    expect(services.startInput().pokemon["own-left"]?.contexts.beatup).toEqual({ party: ["corviknight", "garchomp", "incineroar"] });
    const cell = cellOf(move("beatup", "opponent-left"), move("uturn", "opponent-left"), move("willowisp", "own-right"), move("curse"));
    const input = engineInput(services.engineWorlds(cell));
    expect(input.pokemon["own-left"]?.contexts.beatup).toBeUndefined();
    const snorlax = (turn: DoublesTurnInput) => {
      const result = calculateDoublesOutcomes(turn);
      if (result.status !== "ready") throw new Error(result.status);
      const hp = result.outcomes.flatMap((each) => each.mons["opponent-left"]!.hp.map((entry) => entry.hp));
      return [Math.min(...hp), Math.max(...hp)];
    };
    // The engine's world (Will-O-Wisp hits): Corviknight burned, U-turn, Garchomp in, then Beat Up with Farigiraf, Garchomp and
    // Incineroar (3 hits). With the party listed as the turn starts (Corviknight in it), 4 hits.
    const [low, high] = snorlax(input);
    const listed = { ...input, pokemon: { ...input.pokemon, "own-left": { ...input.pokemon["own-left"]!, contexts: { beatup: { party: ["corviknight", "garchomp", "incineroar"] } } } } };
    const [listedLow, listedHigh] = snorlax(listed);
    // With no switch before it, the bench's party is the listed one: the same outcomes.
    const still = engineInput(services.engineWorlds(cellOf(move("beatup", "opponent-left"), move("protect"), move("protect"), move("curse"))));
    const stillListed = { ...still, pokemon: { ...still.pokemon, "own-left": { ...still.pokemon["own-left"]!, contexts: { beatup: { party: ["corviknight", "garchomp", "incineroar"] } } } } };
    expect(JSON.stringify(calculateDoublesOutcomes(still))).toBe(JSON.stringify(calculateDoublesOutcomes(stillListed)));
    // The real battle on this seed: Will-O-Wisp hits, no critical hit; Beat Up hits 3 times.
    s.step("move 1 2, move 1 2", "move 1 2, move 1");
    for (let asked = 0; asked < 4 && s.battle.requestState === "switch" && !s.battle.ended; asked++) s.step(replacementChoice(s.battle as never, "p1", "p2", s.keys, () => []) ?? "", "");
    const turn = s.battle.log.slice(s.battle.log.lastIndexOf("|turn|1"));
    expect(turn.some((line) => line.startsWith("|-status|p1b: Corviknight|brn"))).toBe(true);
    expect(turn.some((line) => line.startsWith("|-crit|"))).toBe(false);
    expect(turn).toContain("|-hitcount|p2b: Snorlax|3");
    const real = s.battle.p2.active[1]!.hp;
    expect(real).toBeGreaterThanOrEqual(low);
    expect(real).toBeLessThanOrEqual(high);
    expect(real > listedHigh || real < listedLow).toBe(true);
  });
  it("a Future Sight landing from a benched user: its build is the bench entry's (the real bench), HP not read", () => {
    const s = seat([idle("Snorlax"), idle("Corviknight")], [set("Farigiraf", "", "Cud Chew", ["Future Sight", "Protect"]), idle("Snorlax"), set("Kingambit", "", "Defiant", ["Iron Head", "Protect"])],
      [["move 1, move 1", "move 1 1, move 2"], ["move 1, move 1", "switch 3, move 2"]]);
    const input = engineInput(createTurnServices(s.inputs(), [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(1) }).engineWorlds(quiet));
    const landing = input.pokemon["own-left"]!.carried?.futureMove;
    const benched = input.bench?.opponent?.find((each) => each.id === "opponent:farigiraf");
    expect(benched).toBeDefined();
    expect(landing).toEqual({ move: "futuresight", build: { ...benched!.build, currentHP: null } });
    expect(calculateDoublesOutcomes(input).status).not.toBe("issues");
  });
  it("inputKey tells the bench, the replacements and the hazards apart (the engine memo)", () => {
    const input = engineInput(services().engineWorlds(quiet));
    expect(inputKey({ ...input, bench: { ...input.bench, own: [] } })).not.toBe(inputKey(input));
    expect(inputKey({ ...input, replacement: { "own-left": "own:incineroar" } })).not.toBe(inputKey(input));
    expect(inputKey({ ...input, hazards: { own: { spikes: 1 } } })).not.toBe(inputKey(input));
    expect(inputKey({ ...input })).toBe(inputKey(input));
  });
  it("liveBuild of a bench Pokémon is what the bridge passes; a Protean or Libero used before it left is unused again (its entry's fresh state)", () => {
    const s = seat(P1, P2);
    const belief = buildBeliefBattle(s.inputs(), s.truthWorld(), runtime);
    const { entries, mons } = benchOf(belief.battle, "p1", { runtime, keys: belief.keys, aiSide: "p2" }, new Set());
    entries.forEach((entry, i) => expect(entry.build).toEqual(liveBuild(mons[i], runtime)));
    // Cinderace used Libero (U-turn), then went to the bench: Showdown keeps the flag on its old ability state until it comes in.
    const used = seat([set("Cinderace", "", "Libero", ["U-turn", "Protect"]), idle("Corviknight"), idle("Snorlax")], [idle("Snorlax"), idle("Corviknight")],
      [["move 1 1, move 1", "move 1, move 1"], ["switch 3", ""]]);
    const cinderace = used.battle.p1.pokemon.find((each) => each.species.id === "cinderace") as unknown as Pokemon;
    expect(cinderace.isActive).toBe(false);
    expect((cinderace.abilityState as Record<string, unknown>).libero).toBe(true);
    const reasons = new Set<string>();
    const bench = benchOf(used.battle as never, "p1", { runtime, keys: used.keys, aiSide: "p2" }, reasons).entries;
    expect(bench.find((each) => each.build.speciesId === "cinderace")?.build.abilityActive).toBe(true);
    expect([...reasons]).toEqual([]);
  });
  it("Court Change swaps the two sides' conditions in the tracker (the belief battle's hazards are the real battle's)", () => {
    const s = seat([set("Cinderace", "", "Blaze", ["Court Change", "Protect"]), idle("Corviknight")], [set("Glimmora", "", "Toxic Debris", ["Toxic Spikes", "Stealth Rock"]), idle("Snorlax")],
      [["move 2, move 1", "move 1, move 1"], ["move 2, move 1", "move 2, move 1"], ["move 1, move 1", "move 2, move 1"]]);
    expect(s.battle.log.some((line) => line.startsWith("|-swapsideconditions"))).toBe(true);
    const ids = (side: "p1" | "p2", conditions: Record<string, unknown>) => [side, Object.keys(conditions).sort()];
    const belief = buildBeliefBattle(s.inputs(), s.truthWorld(), runtime);
    for (const side of ["p1", "p2"] as const) expect(ids(side, belief.battle[side].sideConditions)).toEqual(ids(side, s.battle[side].sideConditions));
    expect(Object.keys(s.battle.p2.sideConditions).sort()).toEqual(["stealthrock", "toxicspikes"]);
    expect(Number((belief.battle.p2.sideConditions.toxicspikes as { layers?: number }).layers)).toBe(1);
  });
});

describe("the prelude answers a replacement asked before the moves (T2E §4.8; the rollout reason went)", () => {
  const lax = (name: string, spe: number, extra: Record<string, unknown> = {}) => ({ name, species: "Snorlax", ability: "Thick Fat", item: "", moves: ["Protect"], nature: "Serious", evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe }, ivs: IV, level: 50, gender: "M", ...extra });
  const golisopod = { ...lax("Golisopod", 0), species: "Golisopod", ability: "Emergency Exit" };
  /** p2 switches Golisopod (at 60%) in onto Stealth Rock (a quarter for a Bug type): Emergency Exit asks for a replacement before the moves. */
  function json() {
    const b = new Battle({ formatid: "gen9championsvgc2026regmc", seed: [1, 2, 3, 4] });
    b.setPlayer("p1", { team: [lax("A", 1), { ...lax("B", 2), species: "Corviknight", ability: "Pressure" }] as never });
    b.setPlayer("p2", { team: [lax("C", 3), { ...lax("D", 4), species: "Corviknight", ability: "Pressure" }, golisopod, { ...lax("E", 5), species: "Kingambit", ability: "Defiant" }] as never });
    b.makeChoices("team 12", "team 1234");
    const goli = b.p2.pokemon.find((each) => each.species.id === "golisopod")!;
    (goli as unknown as { hp: number }).hp = Math.floor(goli.maxhp * 0.6);
    (b.p2 as unknown as { addSideCondition(id: string, source: unknown): boolean }).addSideCondition("stealthrock", b.p1.active[0]);
    return JSON.stringify(State.serializeBattle(b));
  }
  const choices = { p1: "move 1, move 1", p2: "switch 3, move 1" };
  it("without an answer: the old reason; with one: the copy runs on to the moves, the AI's pick in Golisopod's place", () => {
    expect(runPreludeWorlds(json(), choices, hex(1))).toEqual({ kind: "rollout", reasons: ["A replacement is needed before the moves."] });
    const keys = { keyOf: keyOf, speciesOf: (_side: "p1" | "p2", key: string) => key };
    const asked: MonKey[][] = [];
    const replace: ReplacePolicy = (_side, slots, options) => { asked.push(options); return slots.map(() => options[options.length - 1]); };
    const result = runPreludeWorlds(json(), choices, hex(1), { aiSide: "p2", keys, replace });
    if (result.kind !== "stopped") throw new Error(result.reasons.join(" "));
    expect(asked).toEqual([["opponent:c", "opponent:e"]]);
    const battle = result.worlds[0].battle;
    expect(battle.log.some((line) => line.startsWith("|-activate|p2a: Golisopod|ability: Emergency Exit"))).toBe(true);
    expect(battle.p2.active[0]?.species.id).toBe("kingambit");
    const goli = battle.p2.pokemon.find((each) => each.species.id === "golisopod")!;
    expect(goli.isActive).toBe(false);
    expect(goli.hp).toBeLessThanOrEqual(goli.maxhp / 2);
  });
  it("the player's replacement there is its healthiest bench Pokémon", () => {
    const b = new Battle({ formatid: "gen9championsvgc2026regmc", seed: [1, 2, 3, 4] });
    b.setPlayer("p1", { team: [lax("A", 1), { ...lax("B", 2), species: "Corviknight", ability: "Pressure" }, golisopod, { ...lax("F", 6), species: "Garchomp", ability: "Rough Skin" }] as never });
    b.setPlayer("p2", { team: [lax("C", 3), { ...lax("D", 4), species: "Corviknight", ability: "Pressure" }] as never });
    b.makeChoices("team 1234", "team 12");
    // After the switch the bench is A (switched out, at 70%) then Garchomp (full): Garchomp is the healthiest.
    for (const each of b.p1.pokemon) if (each.species.id === "golisopod") (each as unknown as { hp: number }).hp = Math.floor(each.maxhp * 0.6);
    (b.p1.active[0] as unknown as { hp: number }).hp = Math.floor(b.p1.active[0]!.maxhp * 0.7);
    (b.p1 as unknown as { addSideCondition(id: string, source: unknown): boolean }).addSideCondition("stealthrock", b.p2.active[0]);
    const keys = { keyOf: keyOf, speciesOf: (_side: "p1" | "p2", key: string) => key };
    const result = runPreludeWorlds(JSON.stringify(State.serializeBattle(b)), { p1: "switch 3, move 1", p2: "move 1, move 1" }, hex(2), { aiSide: "p2", keys, replace: (_s, slots, options) => options.slice(0, slots.length) });
    if (result.kind !== "stopped") throw new Error(result.reasons.join(" "));
    expect(result.worlds[0].battle.p1.active[0]?.species.id).toBe("garchomp");
  });
  it("services: the cell is an engine cell (prelude) with the newcomer switched in and Golisopod on the bench", () => {
    const s = seat([idle("Snorlax"), idle("Corviknight")], [idle("Snorlax"), idle("Corviknight"), set("Golisopod", "", "Emergency Exit", ["First Impression", "Protect"]), set("Kingambit", "", "Defiant", ["Iron Head", "Protect"])]);
    const inputs = s.inputs();
    const request = inputs.request.side.pokemon.find((each) => each.ident.endsWith("Golisopod"))!;
    const max = Number(request.condition.split("/")[1]);
    request.condition = `${Math.floor(max * 0.6)}/${max}`;
    inputs.public.sides.p2.conditions.push({ id: "stealthrock", since: 1, layers: 1, setterKey: null });
    const cell = cellOf(move("protect"), move("protect"), { kind: "switch", to: "golisopod" }, move("protect"));
    const worlds = createTurnServices(inputs, [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(3) }).engineWorlds(cell, (_side, slots, options) => slots.map(() => options[options.length - 1]));
    if (worlds.kind !== "engine") throw new Error(`${worlds.kind}: ${worlds.reasons.join(" ")}`);
    expect(worlds.source).toBe("prelude");
    const input = worlds.worlds[0].input;
    expect(input.pokemon["opponent-right"]).toMatchObject({ build: { speciesId: "kingambit" }, switchedIn: true, action: { moveId: null } });
    const benched = input.bench?.opponent?.find((each) => each.id === "opponent:golisopod");
    expect(benched?.build.currentHP).toBeLessThanOrEqual(max / 2);
    expect(calculateDoublesOutcomes(input).status).not.toBe("issues");
  });
  it("a Pokémon that leaves before the moves by Eject Pack (a switch-in's Intimidate): its replacement switched in and takes no action, as in the real battle", () => {
    const s = seat([set("Snorlax", "Eject Pack", "Thick Fat", ["Protect", "Rest"]), idle("Corviknight"), set("Garchomp", "", "Rough Skin", ["Protect", "Earthquake"])],
      [idle("Snorlax"), idle("Corviknight"), set("Incineroar", "", "Intimidate", ["Protect", "Fake Out"])]);
    const cell = cellOf(move("protect"), move("protect"), { kind: "switch", to: "incineroar" }, move("protect"));
    const worlds = createTurnServices(s.inputs(), [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(4) }).engineWorlds(cell);
    if (worlds.kind !== "engine") throw new Error(`${worlds.kind}: ${worlds.reasons.join(" ")}`);
    expect(worlds.source).toBe("prelude");
    for (const { input } of worlds.worlds) {
      // Snorlax's queued Protect left with it (pinned switchIn: queue.cancelAction): Garchomp, its replacement (the player's
      // healthiest), has no action and switched in this turn; Snorlax is on the bench.
      expect(input.pokemon["own-left"]).toMatchObject({ build: { speciesId: "garchomp" }, switchedIn: true, action: { moveId: null } });
      expect(input.pokemon["own-right"]).toMatchObject({ build: { speciesId: "corviknight" }, action: { moveId: "protect" } });
      expect(input.pokemon["own-right"]?.switchedIn).toBeUndefined();
      expect(input.bench?.own?.map((each) => each.id)).toEqual(["own:snorlax"]);
      expect(calculateDoublesOutcomes(input).status).not.toBe("issues");
    }
    // The real battle: Eject Pack asks p1 for a replacement before the moves; Garchomp comes in and does not move this turn.
    s.step("move 1, move 1", "switch 3, move 1");
    expect(s.battle.p1.activeRequest && "forceSwitch" in s.battle.p1.activeRequest).toBe(true);
    s.step("switch 3", "");
    const turn = s.battle.log.slice(s.battle.log.lastIndexOf("|turn|1") + 1);
    expect(turn.some((line) => line.startsWith("|-enditem|p1a: Snorlax|Eject Pack"))).toBe(true);
    expect(s.battle.p1.active[0]?.species.id).toBe("garchomp");
    expect(turn.some((line) => line.startsWith("|move|p1a: Garchomp"))).toBe(false);
  });
});

describe("a Healing Wish waiting at a position (pinned data/moves.ts healingwish onSwap)", () => {
  it("is tracked from its public lines into the belief battle's slot condition, and a side with a bench is a rollout while it waits", () => {
    // Gardevoir's Healing Wish (it faints); Corviknight comes in at full HP, so the wish waits at p1a.
    const s = seat([set("Gardevoir", "", "Trace", ["Healing Wish", "Protect"]), idle("Snorlax"), idle("Corviknight"), set("Garchomp", "", "Rough Skin", ["Dragon Claw", "Protect"])],
      [idle("Snorlax"), idle("Farigiraf"), set("Kingambit", "", "Defiant", ["Iron Head", "Protect"])], [["move 1, move 1", "move 1, move 1"]]);
    s.step("switch 3", "");
    expect(s.battle.p1.active.map((each) => each?.species.id)).toEqual(["corviknight", "snorlax"]);
    expect(Object.keys(s.battle.p1.slotConditions[0])).toEqual(["healingwish"]);
    const inputs = s.inputs();
    expect(inputs.public.sides.p1.conditions).toContainEqual(expect.objectContaining({ id: "healingwish", layers: 1, setterKey: "p1:gardevoir" }));
    expect(Object.keys(buildBeliefBattle(inputs, s.truthWorld(), runtime).battle.p1.slotConditions[0])).toEqual(["healingwish"]);
    const worlds = createTurnServices(inputs, [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(7) }).engineWorlds(quiet);
    expect(worlds.kind === "rollout" && worlds.reasons).toContain("A Healing Wish waits for a Pokémon at Corviknight's place.");
  });
});

describe("postFromOutcome places E2's newcomers and leavers (SPEC2 §6 R)", () => {
  const view = makeView([
    { side: "own", species: "incineroar", slot: "own-left", moves: ["uturn"], ability: "intimidate" },
    { side: "own", species: "snorlax", slot: "own-right", moves: ["protect"], ability: "thickfat" },
    { side: "own", species: "garchomp", slot: null, moves: ["dragonclaw"], ability: "roughskin", hp: 0.5 },
    { side: "opponent", species: "kingambit", slot: "opponent-left", moves: ["ironhead"], ability: "defiant" },
    { side: "opponent", species: "farigiraf", slot: "opponent-right", moves: ["psychic"], ability: "cudchew" },
  ] as never);
  const base = postOf(view);
  const at = (key: string) => view.mons.find((each) => each.key === key)!;
  const outcomeMon = (key: string, hp: number, extra: Partial<DoublesOutcomeMon> = {}): DoublesOutcomeMon => ({ hp: [{ hp, chance: 1 }], build: at(key).build, protected: false, moved: true, ...extra });
  const side = { reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, faintedThisTurn: 0 };
  const start = Object.fromEntries(view.mons.filter((each) => each.slot).map((each) => [each.slot, { maximum: each.maxHp }])) as unknown as DoublesStart;
  const world: EngineWorld = { weight: 1, input: null as never, keys: { "own-left": "own:incineroar", "own-right": "own:snorlax", "opponent-left": "opponent:kingambit", "opponent-right": "opponent:farigiraf" }, notes: [] };
  // Incineroar U-turns out at 120 HP; Garchomp comes in and ends at 60 HP.
  const outcome = {
    chance: 1, allFainted: { own: 0, opponent: 0 }, positions: { own: "kept", opponent: "kept" }, sides: { own: side, opponent: side },
    field: { weather: "", terrain: "", gravity: false, trickRoom: false, wonderRoom: false, magicRoom: false },
    mons: {
      "own-left": outcomeMon("own:garchomp", 60, { id: "own:garchomp" }), "own-right": outcomeMon("own:snorlax", at("own:snorlax").hp),
      "opponent-left": outcomeMon("opponent:kingambit", 100), "opponent-right": outcomeMon("opponent:farigiraf", at("opponent:farigiraf").hp),
    },
    benched: { own: [{ ...outcomeMon("own:incineroar", 120), id: startId("own-left"), slot: "own-left" }] },
  } as DoublesOutcome;
  it("the newcomer stands in the slot with its own maximum, the leaver is on the bench as it left, nobody twice", () => {
    const post = postFromOutcome({ view, base, residual: {}, outcome, start, world, cell: { own: {}, opponent: {} }, endOfTurn: "applied" });
    const garchomp = post.mons.filter((each) => each.key === "own:garchomp");
    expect(garchomp).toHaveLength(1);
    expect(garchomp[0]).toMatchObject({ slot: "own-left", hp: [{ hp: 60, chance: 1 }], maxHp: at("own:garchomp").maxHp });
    const incineroar = post.mons.filter((each) => each.key === "own:incineroar");
    expect(incineroar).toHaveLength(1);
    expect(incineroar[0]).toMatchObject({ slot: null, hp: [{ hp: 120, chance: 1 }], maxHp: at("own:incineroar").maxHp, protected: false });
    expect(post.mons).toHaveLength(view.mons.length);
  });
  it("with the end of turn not applied, the residual pass is added only to the Pokémon that stayed", () => {
    const residual = { "own:incineroar": -20, "own:snorlax": -10, "own:garchomp": -5 } as Record<MonKey, number>;
    const post = postFromOutcome({ view, base, residual, outcome, start, world, cell: { own: {}, opponent: {} } });
    expect(post.mons.find((each) => each.key === "own:garchomp")!.hp).toEqual([{ hp: 60, chance: 1 }]);
    expect(post.mons.find((each) => each.key === "own:incineroar")!.hp).toEqual([{ hp: 120, chance: 1 }]);
    expect(post.mons.find((each) => each.key === "own:snorlax")!.hp).toEqual([{ hp: at("own:snorlax").hp - 10, chance: 1 }]);
  });
  it("a starting Pokémon that left and came back in at the other slot (its id: that slot's start id) stands there under its own key", () => {
    // Incineroar U-turns out (Garchomp in at own-left); Snorlax's Eject Button then brings Incineroar back in at own-right
    // (the input bench is used up: the engine's next pick is the Pokémon that left, as Showdown's healthiest would be).
    const back = {
      ...outcome,
      mons: { ...outcome.mons, "own-left": outcomeMon("own:garchomp", 60, { id: "own:garchomp" }), "own-right": outcomeMon("own:incineroar", 120, { id: startId("own-left") }) },
      benched: { own: [{ ...outcomeMon("own:snorlax", 90), id: startId("own-right"), slot: "own-right" }] },
    } as DoublesOutcome;
    const post = postFromOutcome({ view, base, residual: {}, outcome: back, start, world, cell: { own: {}, opponent: {} }, endOfTurn: "applied" });
    expect(post.mons.map((each) => each.key).sort()).toEqual(view.mons.map((each) => each.key).sort());
    expect(post.mons.find((each) => each.key === "own:incineroar")).toMatchObject({ slot: "own-right", hp: [{ hp: 120, chance: 1 }], maxHp: at("own:incineroar").maxHp });
    expect(post.mons.find((each) => each.key === "own:garchomp")).toMatchObject({ slot: "own-left", hp: [{ hp: 60, chance: 1 }] });
    expect(post.mons.find((each) => each.key === "own:snorlax")).toMatchObject({ slot: null, hp: [{ hp: 90, chance: 1 }], maxHp: at("own:snorlax").maxHp });
    expect(engineIdKey(startId("opponent-right"), world)).toBe("opponent:farigiraf");
    expect(engineIdKey("own:garchomp", world)).toBe("own:garchomp");
  });
  it("the engine's own outcomes: a U-turn, then an Eject Button with the input bench used up, bring the U-turn user back in at the other slot", () => {
    const s = seat([set("Corviknight", "", "Pressure", ["U-turn", "Protect"]), set("Garchomp", "Eject Button", "Rough Skin", ["Dragon Claw", "Protect"]), set("Incineroar", "", "Intimidate", ["Fake Out", "Protect"])],
      [set("Kingambit", "", "Defiant", ["Iron Head", "Protect"]), idle("Snorlax"), idle("Farigiraf")]);
    const services = createTurnServices(s.inputs(), [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(5) });
    const cell = cellOf(move("uturn", "opponent-right"), move("dragonclaw", "opponent-right"), move("ironhead", "own-right"), move("protect"));
    const worlds = services.engineWorlds(cell);
    if (worlds.kind !== "engine") throw new Error(`${worlds.kind}: ${worlds.reasons.join(" ")}`);
    // The belief world's Pokémon (the player's unrevealed Incineroar included).
    const keys = new Set(services.current().mons.map((each) => each.key));
    let back = 0;
    for (const engineWorld of worlds.worlds) {
      const result = calculateDoublesOutcomes(engineWorld.input);
      if (result.status !== "ready") throw new Error(result.status === "issues" ? JSON.stringify(result.issues) : result.reason);
      for (const each of result.outcomes) {
        const post = postFromOutcome({ view: services.view, base: services.current(), residual: {}, outcome: each, start: result.start, world: engineWorld, cell, endOfTurn: result.endOfTurn });
        // Every Pokémon once, under its own key; the slots hold distinct Pokémon.
        expect(post.mons.map((mon) => mon.key).filter((key) => !keys.has(key))).toEqual([]);
        expect(new Set(post.mons.map((mon) => mon.key)).size).toBe(post.mons.length);
        const slots = post.mons.filter((mon) => mon.slot !== null).map((mon) => mon.slot);
        expect(new Set(slots).size).toBe(slots.length);
        if (each.mons["own-right"]?.id === startId("own-left")) {
          back++;
          expect(post.mons.find((mon) => mon.key === "own:corviknight")?.slot).toBe("own-right");
          expect(post.mons.find((mon) => mon.key === "own:incineroar")?.slot).toBe("own-left");
          expect(post.mons.find((mon) => mon.key === "own:garchomp")?.slot).toBeNull();
        }
      }
    }
    expect(back).toBeGreaterThan(0);
    // The real battle, its replacements answered by the rollouts' rule (the player's healthiest): Corviknight is back at p1b.
    s.step("move 1 1, move 1 1", "move 1 2, move 2");
    for (let asked = 0; asked < 4 && s.battle.requestState === "switch" && !s.battle.ended; asked++) s.step(replacementChoice(s.battle as never, "p1", "p2", s.keys, () => []) ?? "", "");
    expect(s.battle.log.some((line) => line.startsWith("|-enditem|p1b: Garchomp|Eject Button"))).toBe(true);
    expect(s.battle.p1.active.map((each) => each?.species.id)).toEqual(["incineroar", "corviknight"]);
  });
  it("both player Pokémon U-turn: each newcomer is the healthiest bench Pokémon at its switch, the first U-turn user included (Q9), as the real battle answered by the rollouts' rule", () => {
    const s = seat([set("Rillaboom", "", "Overgrow", ["U-turn", "Protect"]), set("Corviknight", "", "Pressure", ["U-turn", "Protect"]), set("Garchomp", "", "Rough Skin", ["Dragon Claw", "Protect"]),
      set("Incineroar", "", "Intimidate", ["Fake Out", "Protect"])], [idle("Snorlax"), idle("Farigiraf"), set("Kingambit", "", "Defiant", ["Iron Head", "Protect"])]);
    // The bench before the turn: Garchomp at 40%, Incineroar at 60% (seen in battle; the test setting's exact HP says the same).
    const inputs = s.inputs();
    for (const [species, share] of [["garchomp", 0.4], ["incineroar", 0.6]] as const) {
      const real = s.battle.p1.pokemon.find((each) => each.species.id === species)!;
      const hp = Math.floor(real.maxhp * share);
      (real as unknown as { hp: number }).hp = hp;
      inputs.public.mons[`p1:${species}`] = { ...structuredClone(inputs.public.mons["p1:rillaboom"]), key: `p1:${species}`, speciesId: species, position: null, hp: { percent: share * 100, color: null }, switchIns: 1, volatiles: [], lastMove: null, lastMoveTarget: null };
      inputs.reveals.exactHP![`p1:${species}`] = { hp, maxhp: real.maxhp };
    }
    const services = createTurnServices(inputs, [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(6) });
    const cell = cellOf(move("uturn", "opponent-right"), move("uturn", "opponent-right"), move("rest"), move("rest"));
    const worlds = services.engineWorlds(cell);
    if (worlds.kind !== "engine") throw new Error(`${worlds.kind}: ${worlds.reasons.join(" ")}`);
    for (const engineWorld of worlds.worlds) {
      expect(engineWorld.input.replacementOrder?.own).toBe("healthiest");
      const result = calculateDoublesOutcomes(engineWorld.input);
      if (result.status !== "ready") throw new Error(result.status === "issues" ? JSON.stringify(result.issues) : result.reason);
      // Rillaboom (faster) U-turns out: Incineroar (60%) comes in; Corviknight then: Rillaboom (unhurt), not Garchomp (40%).
      for (const each of result.outcomes) expect([each.mons["own-left"]?.id, each.mons["own-right"]?.id]).toEqual(["own:incineroar", startId("own-left")]);
    }
    s.step("move 1 1, move 1 1", "move 1, move 1");
    for (let asked = 0; asked < 4 && s.battle.requestState === "switch" && !s.battle.ended; asked++) s.step(replacementChoice(s.battle as never, "p1", "p2", s.keys, () => []) ?? "", "");
    expect(s.battle.p1.active.map((each) => each?.species.id)).toEqual(["incineroar", "rillaboom"]);
  });
  it("a bridged turn with no switch: postFromOutcome as before (no id, no benched)", () => {
    const plain = { ...outcome, mons: { ...outcome.mons, "own-left": outcomeMon("own:incineroar", 150) }, benched: undefined } as DoublesOutcome;
    const post = postFromOutcome({ view, base, residual: {}, outcome: plain, start, world, cell: { own: {}, opponent: {} }, endOfTurn: "applied" });
    expect(post.mons.find((each) => each.key === "own:incineroar")).toMatchObject({ slot: "own-left", hp: [{ hp: 150, chance: 1 }] });
    expect(post.mons.find((each) => each.key === "own:garchomp")).toMatchObject({ slot: null, hp: [{ hp: at("own:garchomp").hp, chance: 1 }] });
  });
});

describe("bridgeTurn without a policy (direct callers)", () => {
  it("passes the bench and the player's replacement order, none for the AI's side", () => {
    const s = seat([idle("Snorlax"), idle("Corviknight"), set("Garchomp", "", "Rough Skin", ["Dragon Claw", "Protect"])], [idle("Snorlax"), idle("Corviknight"), set("Kingambit", "", "Defiant", ["Iron Head", "Protect"])]);
    const inputs = s.inputs();
    const belief = buildBeliefBattle(inputs, s.truthWorld(), runtime);
    const publicOf = (key: string) => inputs.public.mons[`${key.startsWith("own:") ? "p1" : "p2"}:${key.slice(key.indexOf(":") + 1)}`] ?? null;
    const bridged = bridgeTurn(belief.battle, quiet, { runtime, keys: belief.keys, aiSide: "p2", switched: new Set(), publicOf });
    if (bridged.kind !== "engine") throw new Error(bridged.reasons.join(" "));
    expect([bridged.input.replacement, bridged.input.replacementOrder]).toEqual([undefined, { own: "healthiest" }]);
    expect(bridged.input.bench?.opponent?.map((each) => each.id)).toEqual(["opponent:kingambit"]);
  });
  it("a prelude copy's Chilly Reception volatile (set as the turn starts) is not a rollout reason: the move is the engine's", () => {
    const s = seat([idle("Snorlax"), idle("Corviknight"), set("Garchomp", "", "Rough Skin", ["Dragon Claw", "Protect"])],
      [set("Slowking", "", "Regenerator", ["Chilly Reception", "Protect"]), idle("Corviknight"), set("Kingambit", "", "Defiant", ["Iron Head", "Protect"])]);
    const cell = cellOf({ kind: "switch", to: "garchomp" }, move("protect"), move("chillyreception"), move("protect"));
    const worlds = createTurnServices(s.inputs(), [s.truthWorld()], { runtime, keys: s.keys, seedBase: hex(4) }).engineWorlds(cell);
    if (worlds.kind !== "engine") throw new Error(`${worlds.kind}: ${worlds.reasons.join(" ")}`);
    expect(worlds.source).toBe("prelude");
    expect(worlds.worlds[0].input.pokemon["opponent-right"]).toMatchObject({ build: { speciesId: "slowking" }, action: { moveId: "chillyreception" } });
  });
});
