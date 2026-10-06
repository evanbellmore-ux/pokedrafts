import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrainingSession, getTrainingSession, HABITS_KEY, INFO_KEY, TRENDS_KEY } from "@/app/(app)/training/training-session";
import { emptyHabits, type HabitsData } from "@/app/(app)/training/model/habits-data";
import { PERFECT_INFORMATION } from "@/app/(app)/training/model/info";
import type { BoardView, LogTurn, TrainingRequest } from "@/app/(app)/training/model/view-types";
import type { FromWorker } from "@/app/(app)/training/model/worker-protocol";
import { boardView, fakeTransport, logTurns, memoryStorage, moveRequest, PREVIEW_REQUEST, report, switchRequest, throwingStorage, trainingSetup } from "../fixtures/training";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setupSession(storage: Storage | null = memoryStorage()) {
  const fake = fakeTransport();
  const factory = vi.fn(() => fake.transport);
  const session = createTrainingSession({ transport: factory, storage });
  const unsubscribe = session.subscribe(() => undefined);
  return { session, fake, factory, unsubscribe };
}

function loaded() {
  const parts = setupSession();
  parts.fake.emit({ type: "loaded", ms: 120 });
  return parts;
}

function battleMessage(battleId: number, request: TrainingRequest | null, extra: Partial<Extract<FromWorker, { type: "battle" }>> = {}): FromWorker {
  return { type: "battle", battleId, seed: null, request, board: boardView({ turn: request?.kind === "team-preview" ? 0 : 3 }), log: [], ended: null, ...extra };
}

describe("training session store", () => {
  it("creates the transport on the first subscribe and posts load; loaded makes the engine ready", () => {
    const { session, fake, factory } = setupSession();
    expect(factory).toHaveBeenCalledOnce();
    expect(fake.posted).toEqual([{ type: "load" }]);
    expect(session.getSnapshot().engine.status).toBe("loading");
    session.subscribe(() => undefined);
    expect(factory).toHaveBeenCalledOnce();
    fake.emit({ type: "loaded", ms: 120 });
    expect(session.getSnapshot().engine).toEqual({ status: "ready" });
  });

  it("shows a load error and retries with a new transport", () => {
    const { session, fake, factory } = setupSession();
    fake.emit({ type: "load-error", message: "Worker failed." });
    expect(session.getSnapshot().engine).toEqual({ status: "error", message: "Worker failed." });
    session.retryEngine();
    expect(fake.terminated).toBe(1);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().engine.status).toBe("loading");
  });

  it("fails suggestions and move lists waiting for a worker that did not load, and re-asks after Retry", () => {
    const { session, fake } = setupSession();
    const members = [{ key: "k1", speciesId: "garchomp", abilityId: null }];
    session.suggest("own", "s1", members);
    session.loadMoveOptions("garchomp");
    fake.emit({ type: "load-error", message: "The simulator worker is not built yet." });
    expect(session.getSnapshot().suggestions.own).toEqual({ status: "error", key: "s1", message: "The simulator worker is not built yet." });
    expect(session.getSnapshot().moveOptions.garchomp).toEqual({ status: "error", message: "The simulator worker is not built yet." });
    session.loadMoveOptions("gyarados");
    session.suggest("opponent", "s2", members);
    expect(session.getSnapshot().moveOptions.gyarados.status).toBe("error");
    expect(session.getSnapshot().suggestions.opponent.status).toBe("error");
    session.retryEngine();
    expect(session.getSnapshot().suggestions.own).toEqual({ status: "loading", key: "s1" });
    fake.emit({ type: "loaded", ms: 1 });
    expect(fake.of("suggest").map((message) => message.key)).toEqual(["s1", "s2"]);
    expect(fake.of("move-options")).toEqual([]);
  });

  it("debounces validation by 250 ms and drops a stale key's result", () => {
    const { session, fake } = loaded();
    const setup = trainingSetup();
    session.validate(setup, "a");
    session.validate(setup, "b");
    expect(fake.of("validate")).toEqual([]);
    vi.advanceTimersByTime(249);
    expect(fake.of("validate")).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fake.of("validate").map((message) => message.key)).toEqual(["b"]);
    expect(session.getSnapshot().validation).toEqual({ status: "checking", key: "b" });
    fake.emit({ type: "validated", key: "a", own: { team: [], members: {} }, opponent: { team: [], members: {} } });
    expect(session.getSnapshot().validation.status).toBe("checking");
    fake.emit({ type: "validated", key: "b", own: { team: [], members: { x: ["Garchomp can't learn Spore."] } }, opponent: { team: [], members: {} } });
    expect(session.getSnapshot().validation).toMatchObject({ status: "ready", key: "b", own: { members: { x: ["Garchomp can't learn Spore."] } } });
    session.validate(setup, "b");
    vi.advanceTimersByTime(300);
    expect(fake.of("validate")).toHaveLength(1);
  });

  it("queues suggestions until the worker is loaded, keys them by member and drops stale ones", () => {
    const { session, fake } = setupSession();
    const members = [{ key: "k1", speciesId: "garchomp", abilityId: null }];
    session.suggest("own", "s1", members);
    expect(fake.of("suggest")).toEqual([]);
    expect(session.getSnapshot().suggestions.own).toEqual({ status: "loading", key: "s1" });
    fake.emit({ type: "loaded", ms: 1 });
    expect(fake.of("suggest")).toEqual([{ type: "suggest", key: "s1", side: "own", members }]);
    session.suggest("own", "s1", members);
    expect(fake.of("suggest")).toHaveLength(1);
    fake.emit({ type: "suggested", key: "old", side: "own", sets: [] });
    expect(session.getSnapshot().suggestions.own.status).toBe("loading");
    fake.emit({ type: "suggested", key: "s1", side: "own", sets: [{ key: "k1", speciesId: "garchomp", source: "usage", moves: ["protect"], itemId: "", abilityId: "roughskin", nature: "Hardy", points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, protectAdded: true }] });
    const state = session.getSnapshot().suggestions.own;
    expect(state.status === "ready" && state.sets.k1.protectAdded).toBe(true);
    fake.emit({ type: "suggest-error", key: "s2", side: "opponent", message: "x" });
    expect(session.getSnapshot().suggestions.opponent.status).toBe("idle");
    session.suggest("opponent", "s2", members);
    fake.emit({ type: "suggest-error", key: "s2", side: "opponent", message: "No usage data." });
    expect(session.getSnapshot().suggestions.opponent).toEqual({ status: "error", key: "s2", message: "No usage data." });
    session.suggest("opponent", "s2", members, true);
    expect(fake.of("suggest").filter((message) => message.side === "opponent")).toHaveLength(2);
  });

  it("asks for a species' move list once, and again after an error", () => {
    const { session, fake } = loaded();
    session.loadMoveOptions("garchomp");
    session.loadMoveOptions("garchomp");
    expect(fake.of("move-options")).toEqual([{ type: "move-options", speciesId: "garchomp" }]);
    fake.emit({ type: "move-options-ready", speciesId: "garchomp", moves: [{ id: "protect", weight: 0.9 }, { id: "spore", weight: null }] });
    expect(session.getSnapshot().moveOptions.garchomp).toEqual({ status: "ready", moves: [{ id: "protect", weight: 0.9 }, { id: "spore", weight: null }] });
    session.loadMoveOptions("gyarados");
    fake.emit({ type: "move-options-error", speciesId: "gyarados", message: "Validator failed." });
    session.loadMoveOptions("gyarados");
    expect(fake.of("move-options").map((message) => message.speciesId)).toEqual(["garchomp", "gyarados", "gyarados"]);
  });

  it("runs a battle: start → preview → waiting → choose; the AI status resets on a new request", () => {
    const { session, fake } = loaded();
    session.start(trainingSetup());
    const start = fake.of("start")[0];
    expect(start).toMatchObject({ battleId: 1, habits: null });
    expect(session.getSnapshot().battle?.phase).toEqual({ kind: "starting" });
    fake.emit(battleMessage(1, PREVIEW_REQUEST));
    expect(session.getSnapshot().battle?.phase).toEqual({ kind: "preview", request: PREVIEW_REQUEST });
    fake.emit({ type: "ai", battleId: 1, requestId: 1, status: "thinking" });
    expect(session.getSnapshot().battle?.ai.status).toBe("thinking");
    session.choose({ kind: "team", order: [1, 2, 3, 4] });
    expect(fake.of("choose")).toEqual([{ type: "choose", battleId: 1, requestId: 1, choice: { kind: "team", order: [1, 2, 3, 4] } }]);
    expect(session.getSnapshot().battle?.phase).toEqual({ kind: "waiting", reason: "simulating" });
    fake.emit({ type: "ai", battleId: 1, requestId: 1, status: "locked" });
    expect(session.getSnapshot().battle?.ai.status).toBe("locked");
    fake.emit(battleMessage(1, moveRequest()));
    const battle = session.getSnapshot().battle!;
    expect(battle.phase.kind).toBe("choose");
    expect(battle.ai.status).toBe("idle");
    expect(battle.board?.turn).toBe(3);
  });

  it("restores the phase with Showdown's message on a choice error, keeping the request id (also for an updated request)", () => {
    const { session, fake } = loaded();
    session.start(trainingSetup());
    fake.emit(battleMessage(1, moveRequest()));
    session.choose({ kind: "action", action: { "own-left": { kind: "move", moveId: "earthquake", target: null } } });
    fake.emit({ type: "choice-error", battleId: 1, requestId: 99, message: "stale" });
    expect(session.getSnapshot().battle?.phase.kind).toBe("waiting");
    fake.emit({ type: "choice-error", battleId: 1, requestId: 7, message: "Can't move: Earth Power needs a target" });
    let phase = session.getSnapshot().battle!.phase;
    expect(phase).toMatchObject({ kind: "choose", error: "Can't move: Earth Power needs a target", request: { id: 7 } });
    session.choose({ kind: "action", action: {} });
    const trapped = moveRequest({ id: 123, active: [{ ...moveRequest().active[0]!, trapped: true }, moveRequest().active[1]] });
    fake.emit({ type: "choice-error", battleId: 1, requestId: 7, message: "Can't switch: The active Pokémon is trapped", request: trapped });
    phase = session.getSnapshot().battle!.phase;
    expect(phase.kind === "choose" && phase.request.id).toBe(7);
    expect(phase.kind === "choose" && phase.request.active[0]?.trapped).toBe(true);
  });

  it("maps a wait request, a forced switch and the end; the seed arrives with the end", () => {
    const { session, fake } = loaded();
    session.start(trainingSetup());
    fake.emit(battleMessage(1, { kind: "wait", id: 8, side: [] }));
    expect(session.getSnapshot().battle?.phase).toEqual({ kind: "waiting", reason: "opponent-switch" });
    fake.emit(battleMessage(1, switchRequest([false, true])));
    expect(session.getSnapshot().battle?.phase.kind).toBe("switch");
    session.choose({ kind: "action", action: { "own-left": { kind: "pass" }, "own-right": { kind: "switch", to: "own-incineroar" } } });
    expect(fake.of("choose").at(-1)).toMatchObject({ requestId: 9 });
    fake.emit(battleMessage(1, null, { seed: "sodium,abc", ended: { result: "win", forfeited: false } }));
    const battle = session.getSnapshot().battle!;
    expect(battle.phase).toEqual({ kind: "ended", result: "win", forfeited: false });
    expect(battle.seed).toBe("sodium,abc");
  });

  it("merges log turns by number and strips the read of a turn that has not resolved", () => {
    const { session, fake } = loaded();
    session.start(trainingSetup());
    const turns = logTurns();
    const early: LogTurn = { turn: 3, lines: [], actions: null, read: report({ turn: 3 }) };
    fake.emit(battleMessage(1, moveRequest(), { log: [...turns, early] }));
    let log = session.getSnapshot().battle!.log;
    expect(log.map((turn) => turn.turn)).toEqual([0, 1, 2, 3]);
    expect(log[2].read).not.toBeNull();
    expect(log[3].read).toBeNull();
    const replaced: LogTurn = { ...turns[2], lines: [{ text: "Tie.", kind: "result", slots: [] }] };
    const board: BoardView = boardView({ turn: 4 });
    fake.emit(battleMessage(1, moveRequest({ id: 8 }), { log: [replaced, { ...early, read: report({ turn: 3 }) }], board }));
    log = session.getSnapshot().battle!.log;
    expect(log[2].lines[0].text).toBe("Tie.");
    expect(log[3].read).not.toBeNull();
  });

  it("drops another battle's messages after a rematch and keeps the submitted order for Same as last battle", () => {
    const { session, fake } = loaded();
    session.start(trainingSetup());
    fake.emit(battleMessage(1, PREVIEW_REQUEST));
    session.choose({ kind: "team", order: [3, 1, 5, 2] });
    fake.emit(battleMessage(1, null, { ended: { result: "loss", forfeited: true } }));
    session.rematch();
    const battle = session.getSnapshot().battle!;
    expect(battle.id).toBe(2);
    expect(battle.lastPreview).toEqual([3, 1, 5, 2]);
    expect(fake.of("start")).toHaveLength(2);
    fake.emit(battleMessage(1, moveRequest()));
    fake.emit({ type: "ai", battleId: 1, requestId: 7, status: "thinking" });
    fake.emit({ type: "battle-error", battleId: 1, message: "old" });
    expect(session.getSnapshot().battle).toMatchObject({ id: 2, phase: { kind: "starting" }, ai: { status: "idle" } });
  });

  it("forfeits, stops on Change teams and keeps the draft; a battle error returns to Setup with the message", () => {
    const { session, fake } = loaded();
    session.updateDraft((draft) => ({ ...draft, difficulty: "reads" }));
    session.start(trainingSetup());
    fake.emit(battleMessage(1, moveRequest()));
    session.forfeit();
    expect(fake.of("forfeit")).toEqual([{ type: "forfeit", battleId: 1 }]);
    session.changeTeams();
    expect(fake.of("stop")).toEqual([{ type: "stop", battleId: 1 }]);
    expect(session.getSnapshot().battle).toBeNull();
    expect(session.getSnapshot().draft.difficulty).toBe("reads");
    session.start(trainingSetup());
    fake.emit({ type: "battle-error", battleId: 2, message: "Garchomp's move Spore is not legal." });
    expect(session.getSnapshot().battle).toBeNull();
    expect(session.getSnapshot().setupError).toBe("Garchomp's move Spore is not legal.");
  });

  it("reads, writes and clears habits per account, and sends them with start", () => {
    const storage = memoryStorage({ [`${HABITS_KEY}user-1`]: JSON.stringify({ version: 1, turns: 37, data: { a: 1 } }) });
    const { session, fake } = setupSession(storage);
    fake.emit({ type: "loaded", ms: 1 });
    session.bindAccount("user-1");
    expect(session.getSnapshot().habits).toEqual({ turns: 37, data: emptyHabits() });
    session.start(trainingSetup());
    expect(fake.of("start")[0].habits).toEqual({ version: 1, turns: 37, data: { a: 1 } });
    fake.emit(battleMessage(1, moveRequest(), { habits: { version: 1, turns: 38, data: { a: 2 } } }));
    expect(session.getSnapshot().habits).toEqual({ turns: 38, data: emptyHabits() });
    expect(JSON.parse(storage.data.get(`${HABITS_KEY}user-1`)!)).toEqual({ version: 1, turns: 38, data: { a: 2 } });
    session.clearHabits();
    expect(storage.data.has(`${HABITS_KEY}user-1`)).toBe(false);
    expect(session.getSnapshot().habits).toEqual({ turns: 0, data: emptyHabits() });
  });

  it("parses stored habits for the trends panel, keeps the start's habits on the battle, and empties them on Clear habits", () => {
    const before: HabitsData = { ...emptyHabits(), battles: 2, classes: { "*": { protect: 1.9, "attack-ko": 3.8 } }, brings: { garchomp: 1.9 } };
    const after: HabitsData = { ...before, battles: 3, classes: { "*": { protect: 2.71, "attack-ko": 5.42 } } };
    const storage = memoryStorage({ [`${HABITS_KEY}user-1`]: JSON.stringify({ version: 1, turns: 3, data: before }) });
    const { session, fake } = setupSession(storage);
    fake.emit({ type: "loaded", ms: 1 });
    session.bindAccount("user-1");
    expect(session.getSnapshot().habits).toEqual({ turns: 3, data: before });
    session.start(trainingSetup());
    expect(session.getSnapshot().battle!.habitsBefore).toEqual(before);
    fake.emit(battleMessage(1, moveRequest(), { habits: { version: 1, turns: 4, data: after } }));
    expect(session.getSnapshot().habits.data).toEqual(after);
    expect(session.getSnapshot().battle!.habitsBefore).toEqual(before);
    // Rematch starts from the habits the last battle left.
    session.rematch();
    expect(session.getSnapshot().battle!.habitsBefore).toEqual(after);
    session.changeTeams();
    session.clearHabits();
    expect(session.getSnapshot().habits).toEqual({ turns: 0, data: emptyHabits() });
    // A battle without stored habits starts from empty data.
    session.start(trainingSetup());
    expect(session.getSnapshot().battle!.habitsBefore).toEqual(emptyHabits());
  });

  it("remembers whether Your trends is open, per account", () => {
    const storage = memoryStorage({ [`${TRENDS_KEY}user-2`]: JSON.stringify({ open: true }) });
    const { session } = setupSession(storage);
    expect(session.getSnapshot().trendsOpen).toBe(false);
    session.bindAccount("user-1");
    expect(session.getSnapshot().trendsOpen).toBe(false);
    session.setTrendsOpen(true);
    expect(session.getSnapshot().trendsOpen).toBe(true);
    expect(JSON.parse(storage.data.get(`${TRENDS_KEY}user-1`)!)).toEqual({ open: true });
    session.bindAccount("user-2");
    expect(session.getSnapshot().trendsOpen).toBe(true);
    session.setTrendsOpen(false);
    expect(JSON.parse(storage.data.get(`${TRENDS_KEY}user-2`)!)).toEqual({ open: false });
    const next = setupSession(storage).session;
    next.bindAccount("user-1");
    expect(next.getSnapshot().trendsOpen).toBe(true);
    for (const broken of [null, throwingStorage()]) {
      const each = setupSession(broken).session;
      each.bindAccount("user-1");
      each.setTrendsOpen(true);
      expect(each.getSnapshot().trendsOpen).toBe(true);
    }
  });

  it("remembers the information categories per account and never the test extras", () => {
    const storage = memoryStorage();
    const { session } = setupSession(storage);
    session.bindAccount("user-1");
    session.updateDraft((draft) => ({ ...draft, info: { ...draft.info, aiKnows: PERFECT_INFORMATION } }));
    const stored = JSON.parse(storage.data.get(`${INFO_KEY}user-1`)!);
    expect(stored.aiKnows.open.statPoints).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/exactHP|brought/);
    const next = setupSession(storage).session;
    next.bindAccount("user-1");
    expect(next.getSnapshot().draft.info.aiKnows).toEqual({ ...PERFECT_INFORMATION, exactHP: false, brought: false });
  });

  it("resets draft, battle, habits view and information on another account", () => {
    const storage = memoryStorage({ [`${HABITS_KEY}user-2`]: JSON.stringify({ version: 1, turns: 5, data: null }) });
    const { session, fake } = setupSession(storage);
    fake.emit({ type: "loaded", ms: 1 });
    session.bindAccount("user-1");
    session.updateDraft((draft) => ({ ...draft, difficulty: "reads", info: { ...draft.info, youSee: PERFECT_INFORMATION } }));
    session.start(trainingSetup());
    session.bindAccount("user-1");
    expect(session.getSnapshot().battle).not.toBeNull();
    session.bindAccount("user-2");
    const snapshot = session.getSnapshot();
    expect(snapshot.battle).toBeNull();
    expect(snapshot.draft.difficulty).toBe("safe");
    expect(snapshot.draft.info.youSee.open.statPoints).toBe(false);
    expect(snapshot.habits).toEqual({ turns: 5, data: emptyHabits() });
    expect(fake.of("stop")).toEqual([{ type: "stop", battleId: 1 }]);
  });

  it("works without storage and survives a throwing storage", () => {
    for (const storage of [null, throwingStorage()]) {
      const { session } = setupSession(storage);
      session.bindAccount("user-1");
      session.updateDraft((draft) => ({ ...draft, info: { ...draft.info, aiKnows: PERFECT_INFORMATION } }));
      session.clearHabits();
      expect(session.getSnapshot().habits).toEqual({ turns: 0, data: emptyHabits() });
    }
  });

  it("returns a fresh inert session on the server, which never creates a transport", () => {
    vi.unstubAllGlobals();
    expect(typeof window).toBe("undefined");
    const first = getTrainingSession();
    const second = getTrainingSession();
    expect(first).not.toBe(second);
    first.subscribe(() => undefined);
    expect(first.getSnapshot().engine.status).toBe("idle");
    expect(first.getServerSnapshot()).toBe(first.getServerSnapshot());
  });
});
