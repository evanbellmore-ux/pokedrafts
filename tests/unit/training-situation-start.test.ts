import { describe, expect, it } from "vitest";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { situationIntro, situationProblem, type SituationSide, type TrainingSituation } from "@/app/(app)/training/model/situation";
import type { TrainingSetup, TrainingTeam } from "@/app/(app)/training/model/view-types";
import { BattleHost } from "@/app/(app)/training/sim/battle-host";
import { memberKeys, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { hostSituation, startHP } from "@/app/(app)/training/sim/situation-start";
import { createTracker } from "@/app/(app)/training/sim/tracker";
import { createMemorySealer } from "@/app/(app)/training/worker/sealer";
import { playBattle, runSavedCheck } from "@/scripts/training/lib/saved-check";
import { parsePools, teamPair, type TeamPair } from "@/scripts/training/lib/teams";
import { createChooser } from "../../scripts/lib/showdown-sim/fixtures.mjs";
import { AI_TEAM, PLAYER_TEAM } from "./training-sim-fixtures";

// Situations (model/situation.ts): a battle dealt partway through starts in the pinned simulator at its position (the
// leads' switch lines carry their HP and status, the fainted ones are public, stat stages and Tailwind go in before turn 1),
// both seats' trackers read it as a player would, the AI plays it out, and its replay and Resume re-run the same way.

const FORMAT = "gen9championsvgc2026regmc";
const keysOf = (team: TrainingTeam) => team.members.map((member) => member.key);
function situation(own: SituationSide, opponent: SituationSide): TrainingSituation {
  return { request: { kind: "spot", spot: "down-one", level: "hard" }, spot: "down-one", own, opponent };
}
const setupWith = (dealt: TrainingSituation, own = PLAYER_TEAM, opponent = AI_TEAM): TrainingSetup & { situation: TrainingSituation } => ({
  own, opponent, difficulty: "safe", showRead: true, info: DEFAULT_INFO, situation: dealt,
});
/** The host as the worker makes it, both dealt team choices made, drained to turn 1. */
function started(setup: TrainingSetup & { situation: TrainingSituation }, seed = [1, 2, 3, 4]) {
  const own = toShowdownTeam(setup.own.members, runtime), opponent = toShowdownTeam(setup.opponent.members, runtime);
  const dealt = hostSituation(setup);
  const host = new BattleHost({ formatid: FORMAT, seed, p1: { name: "You", team: own.sets.map((each) => each.set) }, p2: { name: "Training", team: opponent.sets.map((each) => each.set) }, situation: dealt.start });
  const keys = memberKeys(own, opponent);
  const trackers = { p1: createTracker("p1", keys.keyOf, keys.speciesOf), p2: createTracker("p2", keys.keyOf, keys.speciesOf) };
  const drainInto = () => { const drain = host.drain(); trackers.p1.push(drain.channel.p1); trackers.p2.push(drain.channel.p2); return drain; };
  drainInto();
  expect(host.choose("p2", `team ${dealt.order.p2.join("")}`).ok).toBe(true);
  expect(host.choose("p1", `team ${dealt.order.p1.join("")}`).ok).toBe(true);
  return { host, trackers, drain: drainInto(), dealt, keys };
}

const [incineroar, charizard, whimsicott, garchomp, rotom, kingambit] = keysOf(PLAYER_TEAM);
const [gyarados, pelipper, sneasler, archaludon] = keysOf(AI_TEAM);

describe("a situation in the simulator", () => {
  it("starts at turn 1 with its HP, status, faints, stat stages and Tailwind, in every channel", () => {
    const dealt = situation(
      { members: [{ key: garchomp, hp: 60, status: "brn", boosts: { atk: -1 } }, { key: incineroar, hp: 0 }, { key: charizard, hp: 0 }, { key: whimsicott, hp: 0 }] },
      { members: [{ key: gyarados, hp: 100, boosts: { atk: 2, spe: 1 } }, { key: pelipper, hp: 45, status: "par" }, { key: sneasler, hp: 30 }, { key: archaludon, hp: 0 }], tailwind: true },
    );
    const { host, trackers, drain } = started(setupWith(dealt));
    expect(drain.turn).toBe(1);
    const battle = host.battle as unknown as {
      p1: { pokemonLeft: number; totalFainted: number; pokemon: { name: string; hp: number; maxhp: number; fainted: boolean; status: string; boosts: Record<string, number> }[] };
      p2: { pokemonLeft: number; totalFainted: number; sideConditions: Record<string, { duration?: number }>; pokemon: { name: string; hp: number; maxhp: number; status: string; boosts: Record<string, number> }[] };
    };
    // The brought four in the dealt order: Garchomp leads alone, the other three have fainted.
    expect(battle.p1.pokemon.map((each) => each.name)).toEqual(["Garchomp", "Incineroar", "Charizard", "Whimsicott"]);
    expect([battle.p1.pokemonLeft, battle.p1.totalFainted, battle.p2.pokemonLeft, battle.p2.totalFainted]).toEqual([1, 3, 3, 1]);
    const chomp = battle.p1.pokemon[0];
    expect([chomp.hp, chomp.status, chomp.boosts.atk]).toEqual([startHP(chomp.maxhp, 60), "brn", -1]);
    expect(battle.p1.pokemon.slice(1).every((each) => each.fainted && each.hp === 0)).toBe(true);
    expect([battle.p2.pokemon[0].boosts.atk, battle.p2.pokemon[0].boosts.spe, battle.p2.pokemon[1].status]).toEqual([2, 1, "par"]);
    expect(battle.p2.pokemon[2].hp).toBe(startHP(battle.p2.pokemon[2].maxhp, 30));
    expect(battle.p2.sideConditions.tailwind?.duration).toBe(4);
    // The log: the intro, the faints, the leads as they stand, then the stat stages and Tailwind, all before turn 1.
    const lines = drain.channel.p1;
    const at = (prefix: string) => lines.findIndex((line) => line.startsWith(prefix));
    expect(lines[at("|-message|")]).toBe(`|-message|${situationIntro(dealt)}`);
    expect(lines).toContain("|faint|p1: Incineroar");
    expect(lines).toContain("|faint|p2: Archaludon");
    expect(lines.find((line) => line.startsWith("|switch|p1a: Garchomp|"))).toMatch(/\|\d+\/\d+ brn$/);
    expect(drain.channel.p2.find((line) => line.startsWith("|switch|p1a: Garchomp|"))).toMatch(/\|60\/100 brn$/);
    expect(lines).toContain("|-setboost|p2a: Gyarados|atk|2");
    expect(lines).toContain("|-sidestart|p2: Training|move: Tailwind");
    expect(at("|-message|")).toBeLessThan(at("|start"));
    expect(at("|-sidestart|")).toBeLessThan(at("|turn|1"));
    // The AI's seat reads your side as you showed it: Garchomp at 60%, burned, −1 Attack, three fainted.
    const ai = trackers.p2.state();
    expect(ai.mons[`p1:${garchomp}`]).toMatchObject({ position: 0, hp: { percent: 60 }, status: "brn", fainted: false });
    expect(ai.mons[`p1:${garchomp}`].boosts.atk).toBe(-1);
    for (const key of [incineroar, charizard, whimsicott]) expect(ai.mons[`p1:${key}`]).toMatchObject({ fainted: true, position: null });
    expect(ai.sides.p1.totalFainted).toBe(3);
    expect(ai.mons[`p1:${rotom}`]).toBeUndefined();
    // Yours: the AI's two leads, Tailwind for 4 turns from turn 1; its back Pokémon unseen.
    const you = trackers.p1.state();
    expect(you.mons[`p2:${pelipper}`]).toMatchObject({ position: 1, hp: { percent: 45 }, status: "par" });
    expect(you.sides.p2.conditions).toEqual([{ id: "tailwind", since: 1, layers: 1, setterKey: null }]);
    expect(you.mons[`p2:${sneasler}`]).toBeUndefined();
    // Your request: the one Pokémon left, its fainted partner in the other slot (as a side with no replacement leaves it).
    const request = host.request("p1");
    expect(request && "active" in request && request.side.pokemon.map((each) => each.condition)).toEqual([`${chomp.hp}/${chomp.maxhp} brn`, "0 fnt", "0 fnt", "0 fnt"]);
  });

  it("plays to the end from starts with one, two, three and four Pokémon left", () => {
    const starts: [SituationSide, SituationSide][] = [
      [{ members: [{ key: kingambit, hp: 60 }, { key: incineroar, hp: 0 }, { key: charizard, hp: 0 }, { key: whimsicott, hp: 0 }] }, { members: [{ key: gyarados, hp: 100 }, { key: pelipper, hp: 45 }, { key: sneasler, hp: 0 }, { key: archaludon, hp: 0 }] }],
      [{ members: [{ key: garchomp, hp: 50 }, { key: rotom, hp: 50 }, { key: charizard, hp: 50 }, { key: incineroar, hp: 0 }] }, { members: [{ key: gyarados, hp: 50 }, { key: pelipper, hp: 50 }, { key: sneasler, hp: 50 }, { key: archaludon, hp: 50 }] }],
      [{ members: [{ key: whimsicott, hp: 20, status: "par" }, { key: rotom, hp: 35, status: "tox" }, { key: garchomp, hp: 0 }, { key: kingambit, hp: 0 }] }, { members: [{ key: sneasler, hp: 100, boosts: { atk: 6 } }, { key: gyarados, hp: 0 }, { key: pelipper, hp: 0 }, { key: archaludon, hp: 0 }] }],
    ];
    const choose = createChooser(7);
    starts.forEach(([own, opponent], n) => {
      const { host } = started(setupWith(situation(own, opponent)), [n + 1, 2, 3, 4]);
      const errors: string[] = [];
      for (let guard = 0; !host.battle.ended && guard < 400; guard++) {
        for (const side of ["p2", "p1"] as const) {
          if (!host.needsChoice(side)) continue;
          const choice = choose(side, host.request(side));
          if (!host.choose(side, choice).ok) errors.push(`${side} turn ${host.battle.turn}: ${choice}`);
        }
        host.drain();
      }
      expect(errors).toEqual([]);
      expect(host.battle.ended).toBe(true);
    });
  }, 30_000);

  it("a Pokémon that fainted before the start keeps its form in both trackers (Rotom-Wash battles as \"Rotom\")", () => {
    const dealt = situation(
      { members: [{ key: garchomp, hp: 100 }, { key: kingambit, hp: 100 }, { key: incineroar, hp: 100 }, { key: rotom, hp: 0 }] },
      { members: [{ key: gyarados, hp: 100 }, { key: pelipper, hp: 100 }, { key: sneasler, hp: 100 }, { key: archaludon, hp: 100 }] },
    );
    const { trackers, drain } = started(setupWith(dealt));
    expect(drain.channel.p2).toContain("|faint|p1: Rotom");
    for (const viewer of ["p1", "p2"] as const) expect(trackers[viewer].state().mons[`p1:${rotom}`]).toMatchObject({ speciesId: "rotomwash", fainted: true });
  });

  it("Supreme Overlord counts the Pokémon that fainted before the start", () => {
    const dealt = situation(
      { members: [{ key: kingambit, hp: 100 }, { key: garchomp, hp: 100 }, { key: incineroar, hp: 0 }, { key: charizard, hp: 0 }] },
      { members: [{ key: gyarados, hp: 100 }, { key: pelipper, hp: 100 }, { key: sneasler, hp: 100 }, { key: archaludon, hp: 100 }] },
    );
    const kingambitSet = PLAYER_TEAM.members.find((member) => member.key === kingambit)!;
    const overlord = { ...PLAYER_TEAM, members: PLAYER_TEAM.members.map((member) => member === kingambitSet ? { ...member, build: { ...member.build, abilityId: "supremeoverlord" } } : member) };
    const { drain, host } = started(setupWith(dealt, overlord));
    expect(drain.channel.p1.some((line) => line.startsWith("|-activate|p1a: Kingambit|ability: Supreme Overlord"))).toBe(true);
    expect((host.battle.p1 as unknown as { totalFainted: number }).totalFainted).toBe(2);
  });

  it("hostSituation maps the dealt keys to each side's team choice and refuses what the teams cannot hold", () => {
    const dealt = situation(
      { members: [{ key: garchomp, hp: 80 }, { key: kingambit, hp: 70 }, { key: rotom, hp: 60 }, { key: incineroar, hp: 0 }] },
      { members: [{ key: archaludon, hp: 100 }, { key: gyarados, hp: 100 }, { key: pelipper, hp: 100 }, { key: sneasler, hp: 100 }] },
    );
    expect(hostSituation(setupWith(dealt)).order).toEqual({ p1: [4, 6, 5, 1], p2: [4, 1, 2, 3] });
    const bad: [string, TrainingSituation][] = [
      ["does not list 4", { ...dealt, own: { members: dealt.own.members.slice(0, 3) } }],
      ["lists a Pokémon twice", { ...dealt, own: { members: [dealt.own.members[0], ...dealt.own.members.slice(0, 3)] } }],
      ["its team does not have", { ...dealt, opponent: { members: [{ key: "mew", hp: 50 }, ...dealt.opponent.members.slice(1)] } }],
      ["no Pokémon left", { ...dealt, own: { members: dealt.own.members.map((member) => ({ ...member, hp: 0 })) } }],
      ["before one still standing", { ...dealt, own: { members: [dealt.own.members[0], dealt.own.members[3], dealt.own.members[1], dealt.own.members[2]] } }],
      ["not in play", { ...dealt, own: { members: dealt.own.members.map((member, index) => index === 2 ? { ...member, boosts: { atk: 1 } } : member) } }],
      ["a fainted Pokémon a status", { ...dealt, own: { members: dealt.own.members.map((member, index) => index === 3 ? { ...member, status: "brn" as const } : member) } }],
    ];
    for (const [text, each] of bad) {
      expect(situationProblem(each, setupWith(each))).toContain(text);
      expect(() => hostSituation(setupWith(each))).toThrow(text);
    }
  });
});

/** A position per battle from its pair: down one, down two with status, one left against a boosted lead, half health with Tailwind. */
function dealtFor(pair: TeamPair, index: number): TrainingSituation {
  const own = keysOf(pair.p1.team), opponent = keysOf(pair.p2.team);
  const shift = index % 6;
  const pick = (keys: string[]) => [0, 1, 2, 3].map((i) => keys[(i + shift) % 6]);
  const [a, b, c, d] = pick(own), [w, x, y, z] = pick(opponent);
  switch (index % 4) {
    case 0: return situation({ members: [{ key: a, hp: 80 }, { key: b, hp: 65 }, { key: c, hp: 90 }, { key: d, hp: 0 }] }, { members: [{ key: w, hp: 100 }, { key: x, hp: 85 }, { key: y, hp: 100 }, { key: z, hp: 70 }] });
    case 1: return situation({ members: [{ key: a, hp: 70, status: "par" }, { key: b, hp: 100 }, { key: c, hp: 0 }, { key: d, hp: 0 }] }, { members: [{ key: w, hp: 60 }, { key: x, hp: 90 }, { key: y, hp: 100 }, { key: z, hp: 100 }] });
    case 2: return situation({ members: [{ key: a, hp: 100 }, { key: b, hp: 0 }, { key: c, hp: 0 }, { key: d, hp: 0 }] }, { members: [{ key: w, hp: 50, boosts: { atk: 2, spe: 1 } }, { key: x, hp: 40 }, { key: y, hp: 0 }, { key: z, hp: 0 }] });
    default: return situation({ members: [{ key: a, hp: 50 }, { key: b, hp: 50 }, { key: c, hp: 50 }, { key: d, hp: 50 }] }, { members: [{ key: w, hp: 100 }, { key: x, hp: 100 }, { key: y, hp: 100 }, { key: z, hp: 100 }], tailwind: true });
  }
}

describe("situation battles in the worker", () => {
  it("random p1: 8 situation battles end, re-run hash-equal with equal boards, and resume equal to uninterrupted play", async () => {
    const result = await runSavedCheck({ battles: 8, seat: "random", run: "situation-unit-random", pools: "S,V,U", situation: dealtFor });
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ battles: 8, ended: 8, replays: 8, replayEqual: 8, replayBoardsEqual: 8 });
    expect(result.resumeEqual).toBe(result.resumed);
  }, 180_000);

  it("the engine AI plays a situation out (its belief and habits rebuilt by Resume)", async () => {
    const result = await runSavedCheck({ battles: 2, seat: "safe", run: "situation-unit-engine", pools: "S,V", situation: dealtFor });
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ replayEqual: 2, resumeEqual: result.resumed });
  }, 240_000);

  it("your dealt order is played whatever team preview choice the page sends, and the habits learn no leads or brings", async () => {
    const pair = teamPair("situation-unit-order", 0, parsePools("S,V"), runtime);
    const dealt = dealtFor(pair, 5);
    const setup: TrainingSetup = { own: pair.p1.team, opponent: pair.p2.team, difficulty: "safe", showRead: true, info: DEFAULT_INFO, situation: dealt };
    const played = await playBattle({ run: "situation-unit-order", index: 0, setup, seat: "safe", sealer: createMemorySealer() });
    expect(played.errors).toEqual([]);
    expect(played.ended).not.toBeNull();
    const order = hostSituation({ ...setup, situation: dealt }).order;
    expect(order.p1).toEqual([6, 1, 2, 3]);
    expect(played.ended!.inputLog!.slice(0, 2).sort()).toEqual([`>p1 team ${order.p1.join(", ")}`, `>p2 team ${order.p2.join(", ")}`].sort());
    const data = played.habits?.data as { leads: Record<string, number>; brings: Record<string, number>; battles: number } | undefined;
    expect(data && Object.keys(data.leads)).toEqual([]);
    expect(data && Object.keys(data.brings)).toEqual([]);
    expect(data?.battles).toBe(1);
    // Turn 0 has no AI read (it chose no team), and the first move request is turn 1.
    expect(played.log.get(0)?.read ?? null).toBeNull();
    expect(played.messages.find((message) => message.type === "battle" && message.request?.kind === "move")).toMatchObject({ board: { turn: 1 } });
  }, 120_000);
});
