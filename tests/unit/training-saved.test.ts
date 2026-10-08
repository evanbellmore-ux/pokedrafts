import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyHabits } from "@/app/(app)/training/model/habits-data";
import {
  canonicalJson, EXPORT_KIND, exportFileName, exportText, firstDifference, IMPORT_MAX_BYTES, IMPORT_MAX_DEPTH, logHash, MAX_TIME, migrateSavedBattle,
  nestsDeeper, parseExportText, parseFinishedBattle, parseStoredBattle, parseSummary, resultText, RULES_VERSION, SAVED_BATTLES_CAP, summaryOf, turnHashes,
  turnsText, type SavedBattle,
} from "@/app/(app)/training/model/saved-battle";
import { TRAINING_FORMAT_ID, type LogTurn } from "@/app/(app)/training/model/view-types";
import type { FromWorker } from "@/app/(app)/training/model/worker-protocol";
import { createBattleStore, memoryBackend, memoryBattleStore, STORAGE_FULL, STORAGE_UNAVAILABLE, storeErrorOf, type BattleStore } from "@/app/(app)/training/saved/battle-store";
import { createTrainingSession, HABITS_KEY } from "@/app/(app)/training/training-session";
import { boardView, fakeTransport, logTurns, memoryStorage, moveRequest, trainingSetup } from "../fixtures/training";

// Saved battles (docs/training.md "Saved battles and replays"): the record format v1, the export file and its import check,
// the BattleStore on the in-memory adapter (cap, errors), and the page store's autosave, Resume, replay and import flows.

const SEED = "sodium,0123456789abcdef0123456789abcdef";
const WON = { result: "win" as const, forfeited: false };
const INPUT = [">p1 team 1, 2, 3, 4", ">p2 team 1, 2, 3, 4", ">p1 move 1 1, move 2", ">p2 move 1 2, move 1 1"];

function finished(patch: Partial<SavedBattle> = {}): SavedBattle {
  return {
    version: 1, id: "battle-1", status: "finished", source: "played", format: TRAINING_FORMAT_ID, rules: RULES_VERSION,
    createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000, setup: trainingSetup(), turn: 7, result: { result: "win", forfeited: false },
    seed: SEED, inputLog: [...INPUT], log: logTurns(), resume: null, habitsBefore: null, habitsAfter: null, order: [1, 2, 3, 4],
    ...patch,
  };
}
function unfinished(patch: Partial<SavedBattle> = {}): SavedBattle {
  return finished({ id: "battle-2", status: "unfinished", turn: 3, result: null, seed: null, inputLog: null, resume: { sealed: "c2VhbGVk" }, habitsBefore: emptyHabits(), ...patch });
}
const flush = async (times = 8) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

describe("record format v1", () => {
  it("hashes the simulator's lines and steps only, independent of key order, reads and actions", () => {
    const log = logTurns();
    const reordered = log.map((turn) => ({ read: null, actions: null, steps: turn.steps, lines: turn.lines.map((line) => ({ slots: line.slots, kind: line.kind, text: line.text })), turn: turn.turn }));
    expect(logHash(reordered)).toBe(logHash(log));
    expect(logHash(log)).toMatch(/^[0-9a-f]{32}$/);
    const changed = structuredClone(log);
    changed[2].lines[0].text = "Ampharos (opponent's left) fainted!";
    expect(logHash(changed)).not.toBe(logHash(log));
    expect(firstDifference(turnHashes(log), turnHashes(changed))).toBe(2);
    expect(firstDifference(turnHashes(log), turnHashes(log))).toBeNull();
    // An empty turn (no lines, no steps) is not part of the hash: the page never received it.
    expect(logHash([...log, { turn: 3, lines: [], steps: [], actions: null, read: null }])).toBe(logHash(log));
    expect(canonicalJson({ b: 1, a: [undefined, { d: undefined, c: 2 }] })).toBe('{"a":[null,{"c":2}],"b":1}');
  });

  it("summarises a record for the list and words result and turns as facts", () => {
    expect(summaryOf(finished())).toEqual({
      id: "battle-1", status: "finished", source: "played", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_100_000,
      own: "Your team", opponent: "Rival", turn: 7, result: { result: "win", forfeited: false }, difficulty: "safe",
    });
    expect(resultText(finished())).toBe("Won");
    expect(resultText(finished({ result: { result: "loss", forfeited: true } }))).toBe("Forfeited");
    expect(resultText(finished({ result: { result: "tie", forfeited: false } }))).toBe("Tie");
    expect(resultText(unfinished())).toBe("Unfinished");
    expect(turnsText(finished())).toBe("7 turns");
    expect(turnsText(finished({ turn: 1 }))).toBe("1 turn");
    expect(turnsText(unfinished())).toBe("Turn 3");
    expect(exportFileName({ createdAt: new Date(2026, 9, 8, 14, 2).getTime() })).toBe("training-battle-2026-10-08-1402.json");
  });

  it("exports only what a replay needs (no habits, no sealed checkpoint) and imports it back", () => {
    const text = exportText(finished({ habitsBefore: emptyHabits(), habitsAfter: { version: 1, turns: 3, data: null } }));
    const file = JSON.parse(text);
    expect(file.kind).toBe(EXPORT_KIND);
    expect(file.version).toBe(1);
    expect(file.battle.habitsBefore).toBeNull();
    expect(file.battle.habitsAfter).toBeNull();
    expect(file.battle.resume).toBeNull();
    const parsed = parseExportText(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.record.log).toEqual(finished().log);
      expect(parsed.record.order).toBeNull();
    }
  });

  it("refuses untrusted files with facts: size, JSON, kind, newer versions, other rules, unfinished, bad fields", () => {
    const valid = JSON.parse(exportText(finished()));
    const withBattle = (patch: Record<string, unknown>) => JSON.stringify({ ...valid, battle: { ...valid.battle, ...patch } });
    expect(parseExportText("x".repeat(IMPORT_MAX_BYTES + 1))).toEqual({ ok: false, error: "The file is larger than 2 MB." });
    expect(parseExportText("{nope")).toEqual({ ok: false, error: "The file is not JSON." });
    expect(parseExportText(JSON.stringify({ kind: "something", version: 1 }))).toEqual({ ok: false, error: "Not a saved Training battle." });
    expect(parseExportText(JSON.stringify({ ...valid, version: 2 }))).toEqual({ ok: false, error: "Saved by a newer version of Training (format 2)." });
    expect(parseExportText(withBattle({ version: 3 }))).toEqual({ ok: false, error: "Saved by a newer version of Training (format 3)." });
    expect(parseExportText(withBattle({ rules: "deadbeef" }))).toEqual({ ok: false, error: `Played on Pokémon Showdown deadbeef; Training runs ${RULES_VERSION}.` });
    expect(parseExportText(withBattle({ status: "unfinished" }))).toEqual({ ok: false, error: "Unfinished battles cannot be imported." });
    expect(parseExportText(withBattle({ format: "gen9ou" }))).toEqual({ ok: false, error: "Another format (gen9ou)." });
    expect(parseExportText(withBattle({ seed: "sodium,zz" }))).toEqual({ ok: false, error: "Not a saved Training battle: battle.seed is not a simulator seed." });
    expect(parseExportText(withBattle({ inputLog: [">p3 move 1"] }))).toEqual({ ok: false, error: "Not a saved Training battle: battle.inputLog.0 is not a choice line." });
    const fiveMembers = { ...valid.battle.setup, own: { ...valid.battle.setup.own, members: valid.battle.setup.own.members.slice(0, 5) } };
    expect(parseExportText(withBattle({ setup: fiveMembers }))).toEqual({ ok: false, error: "Not a saved Training battle: battle.setup.own.members is not a list of 6 entries." });
    const badRead = structuredClone(valid.battle.log);
    badRead[1].read.strategy[0].action = { "opponent-left": { kind: "move", moveId: "Protect<script>", target: null } };
    expect(parseExportText(withBattle({ log: badRead }))).toMatchObject({ ok: false, error: expect.stringContaining("battle.log.1.read.strategy.0.action.opponent-left.moveId is not an id") });
    const unredacted = structuredClone(valid.battle.log);
    unredacted[1].read.facts = { reasons: [], mega: [] };
    expect(parseExportText(withBattle({ log: unredacted })).ok).toBe(false);
    const repeated = [...valid.battle.log, valid.battle.log[1]];
    expect(parseExportText(withBattle({ log: repeated }))).toEqual({ ok: false, error: "Not a saved Training battle: battle.log repeats a turn." });
  });

  it("has a migration hook: version 1 passes, other versions are refused as facts", () => {
    expect(migrateSavedBattle({ version: 1, id: "x" })).toEqual({ ok: true, value: { version: 1, id: "x" } });
    expect(migrateSavedBattle({ version: 0 })).toEqual({ ok: false, error: "Not a saved Training battle." });
    expect(migrateSavedBattle({ version: 9 })).toEqual({ ok: false, error: "Saved by a newer version of Training (format 9)." });
    expect(parseFinishedBattle(null)).toEqual({ ok: false, error: "Not a saved Training battle." });
    expect(parseStoredBattle(finished())).toEqual(finished());
    expect(parseStoredBattle(unfinished())).toEqual(unfinished());
    expect(parseStoredBattle({ ...unfinished(), resume: null })).toBeNull();
    expect(parseStoredBattle({ ...finished(), version: 2 })).toBeNull();
  });
});

describe("BattleStore (in-memory adapter)", () => {
  it("lists newest first, replaces by id, removes one or all", async () => {
    const store = memoryBattleStore();
    await store.save(finished({ id: "a", updatedAt: 10 }));
    await store.save(finished({ id: "b", updatedAt: 30 }));
    await store.save(unfinished({ id: "c", updatedAt: 20 }));
    expect((await store.list()).map((each) => each.id)).toEqual(["b", "c", "a"]);
    await store.save(finished({ id: "a", updatedAt: 40, turn: 9 }));
    expect((await store.list()).map((each) => [each.id, each.turn])).toEqual([["a", 9], ["b", 7], ["c", 3]]);
    expect((await store.get("c"))?.status).toBe("unfinished");
    expect(await store.get("missing")).toBeNull();
    await store.remove("b");
    expect((await store.list()).map((each) => each.id)).toEqual(["a", "c"]);
    await store.removeAll();
    expect(await store.list()).toEqual([]);
  });

  it(`keeps ${SAVED_BATTLES_CAP} and removes the oldest first (finished before an unfinished one)`, async () => {
    const store = memoryBattleStore({ cap: 3 });
    await store.save(unfinished({ id: "u", updatedAt: 1 }));
    await store.save(finished({ id: "f2", updatedAt: 2 }));
    await store.save(finished({ id: "f3", updatedAt: 3 }));
    const { removed } = await store.save(finished({ id: "f4", updatedAt: 4 }));
    expect(removed).toEqual(["f2"]);
    expect((await store.list()).map((each) => each.id).sort()).toEqual(["f3", "f4", "u"]);
  });

  it("states storage failures as facts", async () => {
    const store = memoryBattleStore();
    store.backend.fail = "QuotaExceededError";
    await expect(store.save(finished())).rejects.toThrow(STORAGE_FULL);
    store.backend.fail = "SecurityError";
    await expect(store.save(finished())).rejects.toThrow(STORAGE_UNAVAILABLE);
    expect(storeErrorOf(Object.assign(new Error("x"), { name: "NS_ERROR_DOM_QUOTA_REACHED" })).message).toBe(STORAGE_FULL);
    const broken = createBattleStore({ ...memoryBackend(), summaries: async () => { throw Object.assign(new Error("blocked"), { name: "InvalidStateError" }); } });
    await expect(broken.list()).rejects.toThrow(STORAGE_UNAVAILABLE);
  });

  it("skips corrupt rows, exports finished battles only, and imports a file after its check under a new id", async () => {
    const backend = memoryBackend();
    const store = createBattleStore(backend, { newId: () => "imported-1", now: () => 99 });
    await store.save(finished());
    await store.save(unfinished());
    backend.records.set("bad", { nope: true } as unknown as SavedBattle);
    expect(await store.get("bad")).toBeNull();
    expect(await store.export("battle-2")).toBeNull();
    const file = await store.export("battle-1");
    expect(file?.name).toMatch(/^training-battle-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const verify = vi.fn(async () => null);
    const record = await store.import(file!.text, verify);
    expect(verify).toHaveBeenCalledOnce();
    expect(record).toMatchObject({ id: "imported-1", source: "imported", updatedAt: 99, status: "finished" });
    expect((await store.list()).map((each) => each.id)).toContain("imported-1");
    await expect(store.import(file!.text, async () => "Your team: Garchomp's move Shadow Claw is not legal.")).rejects.toThrow("Your team: Garchomp's move Shadow Claw is not legal.");
    await expect(store.import("[]")).rejects.toThrow("Not a saved Training battle.");
  });
});

describe("page store: autosave, Resume, replays and imports", () => {
  beforeEach(() => { vi.stubGlobal("window", {}); });
  afterEach(() => { vi.unstubAllGlobals(); });

  function setup(store: BattleStore | null = memoryBattleStore(), storage = memoryStorage()) {
    const fake = fakeTransport();
    const session = createTrainingSession({ transport: () => fake.transport, storage, battleStore: () => store, now: () => 1_700_000_000_000 });
    session.subscribe(() => undefined);
    fake.emit({ type: "loaded", ms: 1 });
    session.bindAccount("user-1");
    return { session, fake, store, storage };
  }
  const battleMessage = (battleId: number, extra: Partial<Extract<FromWorker, { type: "battle" }>> = {}): FromWorker => ({
    type: "battle", battleId, seed: null, request: moveRequest({ id: 5 }), board: boardView({ turn: 3 }), log: logTurns(), ended: null, ...extra,
  });

  it("autosaves each checkpoint as the unfinished battle and the end as the finished one (same id)", async () => {
    const { session, fake, store } = setup();
    await flush();
    expect(session.getSnapshot().saved).toMatchObject({ status: "ready", list: [] });
    session.start(trainingSetup());
    const battle = session.getSnapshot().battle!;
    fake.emit(battleMessage(battle.id));
    fake.emit({ type: "checkpoint", battleId: battle.id, turn: 3, sealed: "U0VBTEVE" });
    await flush();
    const saved = await store!.get(battle.savedId);
    expect(saved).toMatchObject({ status: "unfinished", turn: 3, resume: { sealed: "U0VBTEVE" }, seed: null, inputLog: null, result: null });
    expect(saved!.log.map((turn) => turn.turn)).toEqual([0, 1, 2]);
    expect(session.getSnapshot().saved.autosaved).toEqual({ battleId: battle.id, turn: 3 });
    expect(session.getSnapshot().saved.list.map((each) => each.status)).toEqual(["unfinished"]);
    fake.emit(battleMessage(battle.id, { seed: SEED, request: null, ended: { result: "loss", forfeited: false }, inputLog: INPUT, board: boardView({ turn: 4 }) }));
    // A checkpoint sealed late (after the end) never replaces the final save.
    fake.emit({ type: "checkpoint", battleId: battle.id, turn: 4, sealed: "TEFURQ==" });
    await flush();
    const done = await store!.get(battle.savedId);
    expect(done).toMatchObject({ status: "finished", turn: 4, seed: SEED, inputLog: INPUT, result: { result: "loss", forfeited: false }, resume: null, habitsBefore: null });
    expect(session.getSnapshot().saved.list).toHaveLength(1);
    expect(session.getSnapshot().saved.autosaved).toBeNull();
  });

  it("states storage failures as facts and keeps playing", async () => {
    const store = memoryBattleStore();
    const { session, fake } = setup(store);
    await flush();
    session.start(trainingSetup());
    const battle = session.getSnapshot().battle!;
    fake.emit(battleMessage(battle.id));
    store.backend.fail = "QuotaExceededError";
    fake.emit({ type: "checkpoint", battleId: battle.id, turn: 3, sealed: "U0VBTEVE" });
    await flush();
    expect(session.getSnapshot().saved.message).toBe("Storage is full. Turn 3 was not saved for Resume.");
    expect(session.getSnapshot().saved.autosaved).toBeNull();
    fake.emit({ type: "checkpoint", battleId: battle.id, turn: 4, sealed: null });
    expect(session.getSnapshot().saved.message).toBe("Resume is unavailable in this browser.");
    expect(session.getSnapshot().battle?.phase.kind).toBe("choose");
  });

  it("works without storage: the list states it is unavailable", async () => {
    const { session } = setup(null);
    await flush();
    expect(session.getSnapshot().saved).toMatchObject({ status: "unavailable", message: STORAGE_UNAVAILABLE });
    const broken = setup(createBattleStore({ ...memoryBackend(), summaries: async () => { throw Object.assign(new Error("x"), { name: "SecurityError" }); } }));
    await flush();
    expect(broken.session.getSnapshot().saved).toMatchObject({ status: "unavailable", message: STORAGE_UNAVAILABLE });
    const throwing = createTrainingSession({ transport: () => fakeTransport().transport, storage: null, battleStore: () => { throw new Error("blocked"); } });
    throwing.bindAccount(null);
    expect(throwing.getSnapshot().saved.status).toBe("unavailable");
  });

  it("Resume posts the sealed checkpoint with the saved log and plays on as the same record", async () => {
    const store = memoryBattleStore();
    const storage = memoryStorage();
    const habitsAfter = { version: 1 as const, turns: 4, data: null };
    storage.setItem(`${HABITS_KEY}user-1`, JSON.stringify(habitsAfter));
    await store.save(unfinished({ habitsAfter, order: [2, 1, 3, 4] }));
    const { session, fake } = setup(store, storage);
    await flush();
    session.resume("battle-2");
    await flush();
    const battle = session.getSnapshot().battle!;
    expect(battle).toMatchObject({ resumed: true, savedId: "battle-2", phase: { kind: "starting" }, lastPreview: [2, 1, 3, 4] });
    expect(fake.of("resume")).toEqual([{ type: "resume", battleId: battle.id, setup: unfinished().setup, sealed: "c2VhbGVk", log: unfinished().log }]);
    expect(session.getSnapshot().saved.autosaved).toEqual({ battleId: battle.id, turn: 3 });
    fake.emit(battleMessage(battle.id, { habits: { version: 1, turns: 5, data: null } }));
    expect(session.getSnapshot().battle?.phase.kind).toBe("choose");
    // The stored habits were the ones this battle left: it goes on updating them.
    expect(JSON.parse(storage.getItem(`${HABITS_KEY}user-1`)!)).toEqual({ version: 1, turns: 5, data: null });
  });

  it("a resumed battle leaves the habits alone when they changed since its autosave", async () => {
    const store = memoryBattleStore();
    const storage = memoryStorage();
    storage.setItem(`${HABITS_KEY}user-1`, JSON.stringify({ version: 1, turns: 9, data: null }));
    await store.save(unfinished({ habitsAfter: { version: 1, turns: 4, data: null } }));
    const { session, fake } = setup(store, storage);
    await flush();
    session.resume("battle-2");
    await flush();
    fake.emit(battleMessage(session.getSnapshot().battle!.id, { habits: { version: 1, turns: 5, data: null } }));
    expect(JSON.parse(storage.getItem(`${HABITS_KEY}user-1`)!)).toEqual({ version: 1, turns: 9, data: null });
    expect(session.getSnapshot().habits.turns).toBe(9);
  });

  it("a Resume that fails to rebuild returns to setup with the fact", async () => {
    const store = memoryBattleStore();
    await store.save(unfinished());
    const { session, fake } = setup(store);
    await flush();
    session.resume("battle-2");
    await flush();
    fake.emit({ type: "battle-error", battleId: session.getSnapshot().battle!.id, message: "The saved battle cannot be opened in this browser." });
    expect(session.getSnapshot().battle).toBeNull();
    expect(session.getSnapshot().setupError).toBe("The saved battle cannot be opened in this browser.");
  });

  it("Replay re-runs the battle in the worker; equal logs show the board, a different one only the saved log", async () => {
    const store = memoryBattleStore();
    await store.save(finished());
    const { session, fake } = setup(store);
    await flush();
    session.openReplay("battle-1");
    await flush();
    expect(session.getSnapshot().replay).toMatchObject({ id: "battle-1", status: "loading", boards: null });
    const [message] = fake.of("replay");
    expect(message).toMatchObject({ setup: finished().setup, seed: SEED, inputLog: INPUT, forfeited: false });
    const starts = { 1: boardView({ turn: 1 }), 2: boardView({ turn: 2 }) };
    fake.emit({ type: "replay-ready", replayId: message.replayId, starts, end: boardView({ turn: 3 }), hash: logHash(finished().log), turnHashes: turnHashes(finished().log), result: WON });
    expect(session.getSnapshot().replay).toMatchObject({ status: "board", boards: { starts, end: boardView({ turn: 3 }) }, message: null });
    session.closeReplay();
    expect(session.getSnapshot().replay).toBeNull();

    session.openReplay("battle-1");
    await flush();
    const second = fake.of("replay")[1];
    const other: LogTurn[] = structuredClone(finished().log);
    other[1].lines[1].text = "Garchomp (your left) used Earthquake.";
    fake.emit({ type: "replay-ready", replayId: second.replayId, starts, end: boardView(), hash: logHash(other), turnHashes: turnHashes(other), result: WON });
    expect(session.getSnapshot().replay).toMatchObject({ status: "log", boards: null, message: "The re-run differs from the saved log from turn 1. The saved log is shown." });

    session.openReplay("battle-1");
    await flush();
    fake.emit({ type: "replay-error", replayId: fake.of("replay")[2].replayId, message: "The saved choices do not fit the battle (turn 2)." });
    expect(session.getSnapshot().replay).toMatchObject({ status: "log", message: "The battle could not be re-run: The saved choices do not fit the battle (turn 2). The saved log is shown." });
  });

  it("a replay asked for before the worker loads waits for it", async () => {
    const store = memoryBattleStore();
    await store.save(finished());
    const fake = fakeTransport();
    const session = createTrainingSession({ transport: () => fake.transport, storage: null, battleStore: () => store });
    session.subscribe(() => undefined);
    session.bindAccount(null);
    await flush();
    session.openReplay("battle-1");
    await flush();
    expect(fake.of("replay")).toHaveLength(0);
    fake.emit({ type: "loaded", ms: 1 });
    expect(fake.of("replay")).toHaveLength(1);
  });

  it("imports a file: size cap first, then the schema, then the worker's validator and re-run; saved and opened", async () => {
    const store = memoryBattleStore();
    const { session, fake } = setup(store);
    await flush();
    const text = exportText(finished());
    session.importSaved({ name: "big.json", size: IMPORT_MAX_BYTES + 1, text: async () => text });
    expect(session.getSnapshot().saved.import).toEqual({ status: "error", name: "big.json", message: "The file is larger than 2 MB." });
    session.importSaved({ name: "notes.json", size: 5, text: async () => "hello" });
    await flush();
    expect(session.getSnapshot().saved.import).toEqual({ status: "error", name: "notes.json", message: "The file is not JSON." });
    // The validator refuses a team: nothing is saved.
    session.importSaved({ name: "illegal.json", size: text.length, text: async () => text });
    await flush();
    expect(session.getSnapshot().saved.import).toEqual({ status: "checking", name: "illegal.json" });
    fake.emit({ type: "replay-error", replayId: fake.of("replay")[0].replayId, message: "Your team: Garchomp's move Shadow Claw is not legal." });
    await flush();
    expect(session.getSnapshot().saved.import).toEqual({ status: "error", name: "illegal.json", message: "Your team: Garchomp's move Shadow Claw is not legal." });
    expect(await store.list()).toEqual([]);
    // A log that a re-run does not reproduce is refused too.
    session.importSaved({ name: "edited.json", size: text.length, text: async () => text });
    await flush();
    fake.emit({ type: "replay-ready", replayId: fake.of("replay")[1].replayId, starts: {}, end: boardView({ turn: 7 }), hash: "0".repeat(32), turnHashes: { 0: "x" }, result: WON });
    await flush();
    expect(session.getSnapshot().saved.import).toEqual({ status: "error", name: "edited.json", message: "The file's log does not match a re-run of its battle from turn 0." });
    // A good file.
    session.importSaved({ name: "good.json", size: text.length, text: async () => text });
    await flush();
    const starts = { 1: boardView({ turn: 1 }) };
    fake.emit({ type: "replay-ready", replayId: fake.of("replay")[2].replayId, starts, end: boardView({ turn: 7 }), hash: logHash(finished().log), turnHashes: turnHashes(finished().log), result: WON });
    await flush();
    expect(session.getSnapshot().saved.import).toEqual({ status: "done", name: "good.json" });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "imported", status: "finished" });
    expect(list[0].id).not.toBe("battle-1");
    expect(session.getSnapshot().replay).toMatchObject({ id: list[0].id, status: "board", boards: { starts } });
  });

  it("deletes one or all and exports a finished battle's file", async () => {
    const store = memoryBattleStore();
    await store.save(finished());
    await store.save(unfinished());
    const { session } = setup(store);
    await flush();
    expect(session.getSnapshot().saved.list).toHaveLength(2);
    const file = await session.exportSaved("battle-1");
    expect(file && parseExportText(file.text).ok).toBe(true);
    expect(await session.exportSaved("battle-2")).toBeNull();
    session.deleteSaved("battle-1");
    await flush();
    expect(session.getSnapshot().saved.list.map((each) => each.id)).toEqual(["battle-2"]);
    session.deleteAllSaved();
    await flush();
    expect(session.getSnapshot().saved.list).toEqual([]);
  });

  it("each account has its own store", async () => {
    const stores = new Map<string, BattleStore>();
    const fake = fakeTransport();
    const session = createTrainingSession({ transport: () => fake.transport, storage: null, battleStore: (account) => { const store = memoryBattleStore(); stores.set(account, store); return store; } });
    session.subscribe(() => undefined);
    session.bindAccount("a");
    await stores.get("a")!.save(finished());
    session.bindAccount("b");
    await flush();
    expect([...stores.keys()]).toEqual(["a", "b"]);
    expect(session.getSnapshot().saved.list).toEqual([]);
  });
});

describe("untrusted files and concurrent re-runs (review fixes)", () => {
  beforeEach(() => { vi.stubGlobal("window", {}); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const valid = () => JSON.parse(exportText(finished()));
  const withBattle = (patch: Record<string, unknown>) => { const file = valid(); return JSON.stringify({ ...file, battle: { ...file.battle, ...patch } }); };

  it("refuses dates no Date holds (they would not render), deep nesting, a missing or wrong file version and junk boosts", () => {
    expect(parseExportText(withBattle({ createdAt: Number.MAX_SAFE_INTEGER }))).toEqual({ ok: false, error: `Not a saved Training battle: battle.createdAt is not a whole number from 0 to ${MAX_TIME}.` });
    expect(parseExportText(withBattle({ updatedAt: MAX_TIME + 1 })).ok).toBe(false);
    expect(parseExportText(withBattle({ createdAt: MAX_TIME })).ok).toBe(true);
    // A 70 KB file nesting 5,000 levels would overflow the stack in the log hash and the structured clone.
    const deep = `${'{"a":'.repeat(5000)}1${"}".repeat(5000)}`;
    const nested = exportText(finished()).replace('"lines":[{', `"lines":[{"x":${deep},`);
    expect(parseExportText(nested)).toEqual({ ok: false, error: `Not a saved Training battle: it nests deeper than ${IMPORT_MAX_DEPTH} levels.` });
    expect(nestsDeeper(valid(), IMPORT_MAX_DEPTH)).toBe(false);
    for (const version of [undefined, 0, "1"]) {
      expect(parseExportText(JSON.stringify({ ...valid(), version }))).toEqual({ ok: false, error: "Not a saved Training battle." });
    }
    const junk = valid();
    junk.battle.setup.own.members[0].build.boosts = { atk: "lots", foo: { bar: [1] } };
    expect(parseExportText(JSON.stringify(junk))).toMatchObject({ ok: false, error: expect.stringContaining("battle.setup.own.members.0.build.boosts") });
    expect(parseSummary({ ...summaryOf(finished()), createdAt: MAX_TIME + 1 })).toBeNull();
  });

  function setupSession(store: BattleStore) {
    const fake = fakeTransport();
    const session = createTrainingSession({ transport: () => fake.transport, storage: memoryStorage(), battleStore: () => store, now: () => 1_700_000_000_000 });
    session.subscribe(() => undefined);
    fake.emit({ type: "loaded", ms: 1 });
    session.bindAccount("user-1");
    return { session, fake };
  }
  const ready = (replayId: number, patch: Partial<Extract<FromWorker, { type: "replay-ready" }>> = {}): FromWorker => ({
    type: "replay-ready", replayId, starts: { 1: boardView({ turn: 1 }) }, end: boardView({ turn: 7 }), hash: logHash(finished().log), turnHashes: turnHashes(finished().log), result: WON, ...patch,
  });

  it("an unreadable file is stated as a fact", async () => {
    const { session } = setupSession(memoryBattleStore());
    await flush();
    session.importSaved({ name: "locked.json", size: 5, text: async () => { throw Object.assign(new Error("A requested file or directory could not be found at the time an operation was processed."), { name: "NotFoundError" }); } });
    await flush();
    expect(session.getSnapshot().saved.import).toEqual({ status: "error", name: "locked.json", message: "The file could not be read." });
  });

  it("an import whose result or turn count is not the re-run's is refused", async () => {
    const store = memoryBattleStore();
    const { session, fake } = setupSession(store);
    await flush();
    const text = exportText(finished());
    session.importSaved({ name: "claims-win.json", size: text.length, text: async () => text });
    await flush();
    fake.emit(ready(fake.of("replay")[0].replayId, { result: { result: "loss", forfeited: false } }));
    await flush();
    expect(session.getSnapshot().saved.import).toEqual({ status: "error", name: "claims-win.json", message: "The file's result does not match a re-run of its battle." });
    session.importSaved({ name: "forfeit.json", size: text.length, text: async () => text });
    await flush();
    fake.emit(ready(fake.of("replay")[1].replayId, { result: { result: "win", forfeited: true } }));
    await flush();
    expect(session.getSnapshot().saved.import).toMatchObject({ status: "error", message: "The file's result does not match a re-run of its battle." });
    session.importSaved({ name: "turns.json", size: text.length, text: async () => text });
    await flush();
    fake.emit(ready(fake.of("replay")[2].replayId, { end: boardView({ turn: 9 }) }));
    await flush();
    expect(session.getSnapshot().saved.import).toEqual({ status: "error", name: "turns.json", message: "The file's turn count does not match a re-run of its battle." });
    expect(await store.list()).toEqual([]);
  });

  it("a replay opened while an import is checked: both re-runs finish", async () => {
    const store = memoryBattleStore();
    await store.save(finished());
    const { session, fake } = setupSession(store);
    await flush();
    const text = exportText(finished());
    session.importSaved({ name: "good.json", size: text.length, text: async () => text });
    await flush();
    session.openReplay("battle-1");
    await flush();
    const [importRun, viewRun] = fake.of("replay");
    expect(importRun.replayId).not.toBe(viewRun.replayId);
    fake.emit(ready(viewRun.replayId));
    expect(session.getSnapshot().replay).toMatchObject({ id: "battle-1", status: "board" });
    fake.emit(ready(importRun.replayId));
    await flush();
    expect(session.getSnapshot().saved.import).toEqual({ status: "done", name: "good.json" });
    expect((await store.list()).map((each) => each.source).sort()).toEqual(["imported", "played"]);
  });

  it("the engine failing to load fails every waiting re-run with the fact", async () => {
    const store = memoryBattleStore();
    await store.save(finished());
    const fake = fakeTransport();
    const session = createTrainingSession({ transport: () => fake.transport, storage: null, battleStore: () => store });
    session.subscribe(() => undefined);
    session.bindAccount(null);
    await flush();
    const text = exportText(finished());
    session.importSaved({ name: "a.json", size: text.length, text: async () => text });
    session.openReplay("battle-1");
    await flush();
    fake.emit({ type: "load-error", message: "Out of memory." });
    await flush();
    expect(session.getSnapshot().saved.import).toEqual({ status: "error", name: "a.json", message: "The battle engine did not load: Out of memory." });
    expect(session.getSnapshot().replay).toMatchObject({ status: "log", message: "The battle could not be re-run: The battle engine did not load: Out of memory. The saved log is shown." });
  });
});
