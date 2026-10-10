import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AIReadPanel from "@/app/(app)/training/log/AIReadPanel";
import BattleAnnouncer from "@/app/(app)/training/log/BattleAnnouncer";
import BattleLog from "@/app/(app)/training/log/BattleLog";
import LastTurn from "@/app/(app)/training/log/LastTurn";
import { announcement, latestResolved, logText, resolvedTurns } from "@/app/(app)/training/log/announcement";
import { jointText, occupantNames, providerText, slotActionText, turnNames } from "@/app/(app)/training/log/report-format";
import { UNSEEN_MEMBER } from "@/app/(app)/training/model/ai-inputs";
import { emptyHabits } from "@/app/(app)/training/model/habits-data";
import type { LogTurn, TrainingBattle } from "@/app/(app)/training/model/view-types";
import { boardView, logTurns, moveRequest, OCCUPANTS, report, runtime, switchRequest, trainingSetup } from "../fixtures/training";
import { positionalIn } from "../fixtures/naming";

const ownName = (key: string) => trainingSetup().own.members.find((member) => member.key === key)?.name ?? null;

function battle(patch: Partial<TrainingBattle> = {}): TrainingBattle {
  return { id: 1, setup: trainingSetup(), seed: null, phase: { kind: "choose", request: moveRequest() }, board: boardView(), log: logTurns(), ai: { status: "idle" }, lastPreview: null, habitsBefore: emptyHabits(), savedId: "saved-1", startedAt: 0, ...patch };
}

describe("report text", () => {
  it("words slot actions by the Pokémon in each slot at the decision, switches by member, and the source", () => {
    const board = boardView();
    const names = occupantNames(OCCUPANTS, board);
    expect(names).toEqual({ "own-left": "Garchomp", "own-right": "Gyarados", "opponent-left": "Ampharos", "opponent-right": "Absol-Mega" });
    expect(slotActionText("own-left", { kind: "move", moveId: "rockslide", target: null }, board, runtime, names)).toBe("Rock Slide → both foes");
    expect(slotActionText("opponent-right", { kind: "move", moveId: "closecombat", target: "own-left", mega: "mega" }, board, runtime, names)).toBe("Close Combat → Garchomp (Mega Evolution)");
    expect(slotActionText("own-right", { kind: "move", moveId: "protect", target: null }, board, runtime, names)).toBe("Protect");
    expect(slotActionText("opponent-left", { kind: "switch", to: "ai-annihilape" }, board, runtime, names)).toBe("Switch to Annihilape");
    expect(slotActionText("opponent-left", { kind: "switch", to: UNSEEN_MEMBER }, board, runtime, names)).toBe("Switch to a Pokémon not seen yet");
    expect(jointText(null, board, runtime, names)).toBe("Not shown");
    expect(jointText(report().predicted[1].action, board, runtime, names)).toBe("Garchomp: Rock Slide → both foes · Gyarados: Waterfall → Absol-Mega");
    // A move on itself, and a slot whose Pokémon is not known.
    expect(slotActionText("own-left", { kind: "move", moveId: "dragonclaw", target: "own-left" }, board, runtime, names)).toBe("Dragon Claw → itself");
    expect(jointText(report().predicted[1].action, board, runtime)).toBe("—: Rock Slide → both foes · —: Waterfall → —");
    expect(providerText(report())).toBe("Engine · 0.4 s · 10 × 6 pairings · Plays safe");
    expect(providerText(report({ difficulty: "reads", provider: "engine-fallback", elapsedMs: 1260 }))).toBe("Engine (Jev unavailable) · 1.3 s · Reads you");
    expect(providerText(report({ provider: "jev", elapsedMs: 600 }))).toBe("Jev · 0.6 s");
  });

  it("names each slot as the board does: the team's word in a mirror, a number for two of one name on a side, — when unknown", () => {
    // Both teams have Garchomp: the side word on yours (by the mirrored key), and on the AI's Garchomp beside it.
    const garchomp = { ...boardView().active["opponent-left"]!, key: "ai-garchomp", speciesId: "garchomp", name: "Garchomp" };
    const board = boardView({ mirrored: ["own-garchomp", "ai-garchomp"], team: { ...boardView().team, opponent: [garchomp, ...boardView().team.opponent] } });
    expect(occupantNames({ ...OCCUPANTS, "opponent-left": "ai-garchomp" }, board)).toEqual({
      "own-left": "Garchomp (yours)", "own-right": "Gyarados", "opponent-left": "Garchomp (opponent's)", "opponent-right": "Absol-Mega",
    });
    // Two of one name on one side (an Illusion): numbered in slot order.
    const twin = { ...boardView().team.own[1], key: "own-zoroark", name: "Garchomp" };
    const twins = boardView({ team: { ...boardView().team, own: [...boardView().team.own, twin] } });
    expect(occupantNames({ ...OCCUPANTS, "own-right": "own-zoroark" }, twins)).toMatchObject({ "own-left": "Garchomp (1)", "own-right": "Garchomp (2)" });
    expect(occupantNames(undefined, board)).toEqual({ "own-left": "—", "own-right": "—", "opponent-left": "—", "opponent-right": "—" });
    expect(occupantNames({ "own-left": "own-garchomp" }, boardView())["opponent-left"]).toBe("—");
    // Without occupants (a battle saved before them): a replay's board at the turn's start names the slots.
    expect(turnNames({}, boardView(), null)["own-left"]).toBe("—");
    expect(turnNames({}, null, boardView())).toEqual({ "own-left": "Garchomp", "own-right": "Gyarados", "opponent-left": "Ampharos", "opponent-right": "Absol-Mega" });
  });
});

describe("AI's read panel", () => {
  it("lists Predicted, Chose (with the chosen one), You, Assumed, Mega and Source; a redacted option reads Not shown", () => {
    const turn: LogTurn = { ...logTurns()[2], read: report({ mega: { memberKey: "ai-absol", evolved: false, moves: [], text: "Kept Mega Evolution: Absol-Mega would not change this turn's KOs." } }) };
    const html = renderToStaticMarkup(createElement(AIReadPanel, { turn, board: boardView(), runtime, ownName }));
    expect([...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1])).toEqual(["Predicted", "Chose", "You", "Assumed", "Mega", "Source"]);
    expect(html).toContain("Garchomp: Rock Slide → both foes · Gyarados: Protect · 45%");
    expect(html).toContain("Ampharos: Protect · Absol-Mega: Switch to Annihilape · 60% (chosen)");
    expect(html).toContain("Not shown · 40%");
    expect(html).toContain("Garchomp: Rock Slide → both foes · Gyarados: Protect (predicted 45%)");
    expect(positionalIn(html)).toEqual([]);
    expect(html).toContain("Garchomp: 2 HP / 32 Atk / 32 Spe · Jolly (64%)");
    expect(html).toContain("Kept Mega Evolution: Absol-Mega would not change this turn&#x27;s KOs.");
    expect(html).toContain("Engine · 0.4 s · 10 × 6 pairings · Plays safe");
    expect(html).toContain("Predicted Rock Slide into Absol (45%), so it switched to Annihilape.");
  });

  it("names the slots — without occupants, and by the replay's board at the turn's start when one is given", () => {
    const { occupants: _occupants, ...old } = logTurns()[2];
    void _occupants;
    const turn: LogTurn = old;
    const html = renderToStaticMarkup(createElement(AIReadPanel, { turn, board: boardView(), runtime, ownName }));
    expect(html).toContain("—: Rock Slide → both foes · —: Protect · 45%");
    const replayed = renderToStaticMarkup(createElement(AIReadPanel, { turn, board: boardView({ turn: 3 }), decisionBoard: boardView({ turn: 2 }), runtime, ownName }));
    expect(replayed).toContain("Garchomp: Rock Slide → both foes · Gyarados: Protect · 45%");
    const logged = renderToStaticMarkup(createElement(BattleLog, { log: [turn], runtime, showRead: true, board: boardView(), decisionBoards: { 2: boardView({ turn: 2 }) }, ownName, headingId: "log" }));
    expect(logged).toContain("Ampharos: Protect · Absol-Mega: Switch to Annihilape · 60% (chosen)");
  });

  it("shows team preview's expected leads", () => {
    const turn: LogTurn = { turn: 0, lines: [], actions: null, read: report({ turn: 0, predicted: [], strategy: [], assumed: [], preview: { predictedLeads: [{ keys: ["own-garchomp", "own-gyarados"], chance: 0.4 }] } }) };
    const html = renderToStaticMarkup(createElement(AIReadPanel, { turn, board: null, runtime, ownName }));
    expect(html).toContain("Expected leads: Garchomp + Gyarados · 40%");
    expect(html).not.toContain(">Chose<");
  });
});

describe("battle log", () => {
  it("renders turn groups with Start / Turn n headings, the reads only when shown, and no live region", () => {
    const html = renderToStaticMarkup(createElement(BattleLog, { log: logTurns(), runtime, showRead: true, board: boardView(), ownName, headingId: "log" }));
    expect(html).toContain('<h2 id="log"');
    expect(html).toContain("<ol data-training-log");
    expect([...html.matchAll(/data-training-log-turn="(\d+)"/g)].map((match) => match[1])).toEqual(["0", "1", "2"]);
    expect([...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((match) => match[1])).toEqual(["Start", "Turn 1", "Turn 2"]);
    expect(html.match(/data-training-read/g)).toHaveLength(2);
    expect(html).not.toContain("aria-live");
    const hidden = renderToStaticMarkup(createElement(BattleLog, { log: logTurns(), runtime, showRead: false, board: boardView(), ownName, headingId: "log" }));
    expect(hidden).not.toContain("data-training-read");
  });

  it("shows the latest resolved turn, never the current one", () => {
    const early = { turn: 3, lines: [{ text: "x", kind: "info" as const, slots: [] }], actions: null, read: report({ turn: 3 }) };
    const current = battle({ log: [...logTurns(), early] });
    expect(resolvedTurns(current).map((turn) => turn.turn)).toEqual([0, 1, 2]);
    expect(latestResolved(current)?.turn).toBe(2);
    expect(latestResolved(battle({ log: [...logTurns(), early], phase: { kind: "ended", result: "win", forfeited: false } }))?.turn).toBe(3);
    const html = renderToStaticMarkup(createElement(LastTurn, { turn: latestResolved(current), runtime, showRead: true, board: boardView(), ownName }));
    expect(html).toContain("Last turn · Turn 2");
    expect(html).toContain("Ampharos fainted.");
    expect(positionalIn(html)).toEqual([]);
  });

  it("announces through one polite live region", () => {
    const html = renderToStaticMarkup(createElement(BattleAnnouncer, { message: "Turn 3." }));
    expect(html).toBe('<div data-training-announcer="true" role="status" aria-live="polite" aria-atomic="true" class="sr-only">Turn 3.</div>');
    expect(announcement(battle())).toBe("Turn 2. Ampharos fainted. AI's read: Predicted Rock Slide into Absol (45%), so it switched to Annihilape. Turn 3.");
    expect(announcement(battle({ phase: { kind: "choose", request: moveRequest(), error: "Can't move: Waterfall needs a target" } }))).toBe("Choice not accepted: Can't move: Waterfall needs a target");
    expect(announcement(battle({ phase: { kind: "switch", request: switchRequest([false, true]) } }))).toContain("Replace Gyarados.");
    expect(announcement(battle({ phase: { kind: "switch", request: switchRequest([true, false], true) } }))).toContain("Switch in for Garchomp.");
    expect(announcement(battle({ phase: { kind: "waiting", reason: "simulating" } }))).toBe("Simulating turn 3…");
    expect(announcement(battle({ phase: { kind: "ended", result: "loss", forfeited: false } }))).toMatch(/The AI won\.$/);
    expect(announcement(battle({ phase: { kind: "preview", request: { kind: "team-preview", id: 1, maxChosenTeamSize: 4, side: [] } }, log: [] }))).toBe("Team preview. Bring 4.");
    // After the board's playback read turn 2 step by step: its AI's read (new) and the next request, not its lines again.
    expect(announcement(battle(), { heard: 2 })).toBe("AI's read: Predicted Rock Slide into Absol (45%), so it switched to Annihilape. Turn 3.");
    // A mid-turn replacement after part of turn 3 played: turn 2's read was read after turn 2 played.
    expect(announcement(battle({ phase: { kind: "switch", request: switchRequest([false, true]) } }), { heard: 3 })).toBe("Replace Gyarados.");
  });

  it("copies the log as plain text", () => {
    expect(logText(logTurns())).toBe([
      "Start\n- Garchomp sent out.",
      "Turn 1\n- Absol Mega Evolved (Absolite).\n- Garchomp used Rock Slide → both foes.",
      "Turn 2\n- Ampharos fainted.",
    ].join("\n\n"));
  });
});
