import { describe, expect, it } from "vitest";
import { CLOSED_TEAM_SHEETS, OPEN_TEAM_SHEETS, PERFECT_INFORMATION, type InfoView } from "@/app/(app)/training/model/info";
import { redactSheet } from "@/app/(app)/training/model/sheet";
import { BattleHost } from "@/app/(app)/training/sim/battle-host";
import { buildBoard } from "@/app/(app)/training/sim/board";
import { aiInputs, createTestOracle } from "@/app/(app)/training/sim/inputs";
import { memberKeys, sheetFromSets, toShowdownTeam } from "@/app/(app)/training/sim/showdown-set";
import { createTracker } from "@/app/(app)/training/sim/tracker";
import { AI_TEAM, PLAYER_TEAM, runtime } from "./training-sim-fixtures";

// SPEC §7.6 (sim/board.ts) and §9.1 (sim/inputs.ts): your view obeys youSee; the AI's inputs obey aiKnows.

const own = toShowdownTeam(PLAYER_TEAM.members, runtime), opponent = toShowdownTeam(AI_TEAM.members, runtime);
const keys = memberKeys(own, opponent);
const ownKeys = own.sets.map((s) => s.key);

function start(youSee: InfoView, turns: [string, string][]) {
  const host = new BattleHost({ formatid: "gen9championsvgc2026regmc", seed: [9, 2, 3, 4], p1: { name: "You", team: own.sets.map((s) => s.set) }, p2: { name: "Training", team: opponent.sets.map((s) => s.set) } });
  const seat = createTracker("p1", keys.keyOf), ai = createTracker("p2", keys.keyOf);
  const pump = () => { const drain = host.drain(); seat.push(drain.channel.p1); ai.push(drain.channel.p2); };
  pump();
  host.choose("p2", "team 1234"); host.choose("p1", "team 1234"); pump();
  for (const [p1, p2] of turns) { host.choose("p2", p2); host.choose("p1", p1); pump(); }
  const sheet = redactSheet(sheetFromSets(opponent), youSee);
  return { host, seat, ai, board: buildBoard({ battle: host.battle, tracker: seat, sheet, info: youSee, keys, runtime, ownKeys }) };
}

describe("buildBoard", () => {
  it("your side is exact; the AI's follows the open sheet (Champions open team sheets)", () => {
    const { board } = start(OPEN_TEAM_SHEETS, []);
    const incineroar = board.active["own-left"]!, gyarados = board.active["opponent-right"]!;
    expect(incineroar).toMatchObject({ key: "incineroar", side: "own", hp: { kind: "exact", current: 202, maximum: 202 }, nature: "Careful", points: { hp: 32, atk: 2, def: 16, spa: 0, spd: 16, spe: 0 }, item: { state: "held", id: "sitrusberry" }, revealed: true, brought: true });
    expect(incineroar.moves.map((m) => [m.id, m.pp])).toEqual([["fakeout", 12], ["flareblitz", 16], ["partingshot", 20], ["protect", 8]]);
    expect(gyarados).toMatchObject({ key: "gyarados", side: "opponent", hp: { kind: "percent", percent: 100 }, item: { state: "held", id: "gyaradosite" }, ability: { id: "intimidate" }, nature: "Adamant", points: null, revealed: true, brought: null });
    expect(gyarados.moves.map((m) => m.id)).toEqual(["waterfall", "crunch", "dragondance", "protect"]);
    expect(gyarados.unseenMoves).toBeUndefined();
    expect(board.team.opponent.map((m) => m.key)).toEqual(["gyarados", "pelipper", "sneasler", "archaludon", "farigiraf", "dragonite"]);
    expect(board.team.opponent.filter((m) => m.revealed).map((m) => m.key)).toEqual(["gyarados", "pelipper"]);
    expect(board.team.own.map((m) => m.key)).toEqual(["incineroar", "charizard", "whimsicott", "garchomp"]);
    expect(board.field.weather).toEqual({ id: "raindance", name: "Rain", turns: 5 });
  });

  it("closed categories stay unknown until the battle shows them; moves seen used and the rest counted", () => {
    const { board } = start(CLOSED_TEAM_SHEETS, [["move 4, move 4", "move 1 1, move 1 2"]]);
    const gyarados = board.team.opponent.find((m) => m.key === "gyarados")!, sneasler = board.team.opponent.find((m) => m.key === "sneasler")!;
    expect(gyarados).toMatchObject({ item: { state: "unknown" }, ability: { id: "intimidate" }, nature: null, points: null, unseenMoves: 3 });
    expect(gyarados.moves.map((m) => m.id)).toEqual(["waterfall"]);
    expect(board.active["opponent-left"]).toMatchObject({ key: "pelipper", ability: { id: "drizzle" }, item: { state: "unknown" } });
    expect(sneasler).toMatchObject({ revealed: false, item: { state: "unknown" }, ability: null, moves: [], unseenMoves: 4, brought: null });
    // The weather's setter item is closed: its length could be 8 (Damp Rock).
    expect(board.field.weather).toEqual({ id: "raindance", name: "Rain", turns: null });
  });

  it("shows a Mega form's own ability once it Mega Evolves, with abilities closed", () => {
    const { board } = start(CLOSED_TEAM_SHEETS, [["move 4, move 4", "move 4 mega, move 4"]]);
    expect(board.megaUsed.opponent).toBe(true);
    expect(board.active["opponent-right"]).toMatchObject({ key: "gyarados", speciesId: "gyaradosmega", mega: true, ability: { id: "moldbreaker" }, item: { state: "held", id: "gyaradosite" } });
  });

  it("shows the brought four and exact HP only under the test settings", () => {
    const { board } = start(PERFECT_INFORMATION, [["move 2 1, move 4", "move 4, move 4"]]);
    expect(board.team.opponent.map((m) => m.brought)).toEqual([true, true, true, true, false, false]);
    expect(board.active["opponent-right"]!.hp).toEqual({ kind: "exact", current: 172, maximum: 172 });
    expect(board.team.opponent[0].points).toEqual({ hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 });
  });
});

describe("aiInputs", () => {
  it("copies its own seat's request, sets, the redacted sheet and tracker; no test reveals by default", () => {
    const { host, ai } = start(OPEN_TEAM_SHEETS, []);
    const sheet = redactSheet(sheetFromSets(own), OPEN_TEAM_SHEETS);
    const oracle = createTestOracle(host.battle, "p2", OPEN_TEAM_SHEETS, keys);
    expect(oracle).toBeNull();
    const inputs = aiInputs({ side: "p2", requestId: host.requestId, request: host.request("p2")!, own: opponent, sheet, tracker: ai, info: OPEN_TEAM_SHEETS, oracle });
    expect(inputs.reveals).toEqual({ exactHP: null, brought: null });
    expect(inputs.sheet.members.every((m) => m.points === null)).toBe(true);
    expect(inputs.public.mons["p1:incineroar"].exact).toBeNull();
    expect(inputs.request.side.id).toBe("p2");
    expect(structuredClone(inputs)).toEqual(inputs);
    expect(Object.keys(inputs).sort()).toEqual(["info", "observations", "own", "perspective", "public", "request", "requestId", "reveals", "sheet"]);
  });

  it("with the test extras, reveals the other side's brought four and their exact HP", () => {
    const { host, ai } = start(OPEN_TEAM_SHEETS, []);
    const oracle = createTestOracle(host.battle, "p2", PERFECT_INFORMATION, keys)!;
    const inputs = aiInputs({ side: "p2", requestId: 2, request: host.request("p2")!, own: opponent, sheet: redactSheet(sheetFromSets(own), PERFECT_INFORMATION), tracker: ai, info: PERFECT_INFORMATION, oracle });
    expect(inputs.reveals.brought).toEqual(["incineroar", "charizard", "whimsicott", "garchomp"]);
    expect(inputs.reveals.exactHP?.["p1:incineroar"]).toEqual({ hp: 202, maxhp: 202 });
    expect(inputs.sheet.members[0].points).toEqual({ hp: 32, atk: 2, def: 16, spa: 0, spd: 16, spe: 0 });
  });
});
