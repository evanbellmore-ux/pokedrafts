import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import type { HabitsRecord } from "@/app/(app)/training/model/decision";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { createRandom } from "@/app/(app)/training/model/random";
import { logHash } from "@/app/(app)/training/model/saved-battle";
import type { TrainingSetup, TrainingSnapshot } from "@/app/(app)/training/model/view-types";
import type { FromWorker, ToWorker, TrainingTransport } from "@/app/(app)/training/model/worker-protocol";
import { memoryBattleStore } from "@/app/(app)/training/saved/battle-store";
import { createTrainingSession, HABITS_KEY, type TrainingSession } from "@/app/(app)/training/training-session";
import { createMemorySealer, type Sealer } from "@/app/(app)/training/worker/sealer";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { createSeat } from "@/scripts/training/lib/providers";
import { seededChoice } from "@/scripts/training/lib/saved-check";
import { parsePools, teamPair } from "@/scripts/training/lib/teams";
import { memoryStorage } from "../fixtures/training";

// Saved battles end to end on the page store with the real worker message loop (the browser pane could not open /training):
// save -> list -> replay -> export -> import -> a reload's Resume -> delete. Messages cross as structured clones on a timer,
// as a Worker's would; the AI is the random seat; the store is the in-memory BattleStore.

/** The worker in this process behind the page's transport (each message cloned and delivered on a timer). */
function inProcess(sealer: Sealer): () => TrainingTransport {
  return () => {
    const listeners = new Set<(message: FromWorker) => void>();
    const worker = createTrainingWorker({
      post: (message) => { const copy = structuredClone(message); setTimeout(() => { for (const listener of [...listeners]) listener(copy); }, 0); },
      createProvider: (habits: HabitsRecord | null) => createSeat("random", runtime, habits).provider,
      now: () => 0, randomHex: () => "ab".repeat(16), deadlineMs: null, sealer,
    });
    return {
      post: (message: ToWorker) => { const copy = structuredClone(message); setTimeout(() => worker.receive(copy), 0); },
      onMessage: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      terminate: () => { listeners.clear(); },
    };
  };
}

async function until(check: () => boolean, what: string, ms = 30_000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error(`Timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** Plays your side with seeded legal choices until `stop` (or the end). */
async function play(session: TrainingSession, setup: TrainingSetup, stop: (snapshot: TrainingSnapshot) => boolean = () => false) {
  let chosen = -1;
  let attempt = 0;
  for (let step = 0; step < 1500; step++) {
    const snapshot = session.getSnapshot();
    const battle = snapshot.battle;
    if (!battle) throw new Error(`No battle: ${snapshot.setupError}`);
    if (battle.phase.kind === "ended" || stop(snapshot)) return;
    const phase = battle.phase;
    if ((phase.kind === "preview" || phase.kind === "choose" || phase.kind === "switch") && (phase.request.id !== chosen || phase.error)) {
      attempt = phase.request.id === chosen ? attempt + 1 : 0;
      chosen = phase.request.id;
      const choice = seededChoice(phase.request, battle.board, setup.own, createRandom("saved-flow", phase.request.id, attempt));
      if (choice) session.choose(choice);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const last = session.getSnapshot();
  throw new Error(`The battle did not end: ${JSON.stringify({ phase: last.battle?.phase, ai: last.battle?.ai, turn: last.battle?.board?.turn, engine: last.engine })?.slice(0, 600)}`);
}

function newSession(store: ReturnType<typeof memoryBattleStore>, storage: ReturnType<typeof memoryStorage>, sealer: Sealer) {
  let clock = 1_760_000_000_000;
  const session = createTrainingSession({ transport: inProcess(sealer), storage, battleStore: () => store, now: () => (clock += 1000) });
  session.subscribe(() => undefined);
  session.bindAccount("user-1");
  return session;
}

describe("saved battles end to end (page store + real worker)", () => {
  beforeEach(() => { vi.stubGlobal("window", {}); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("save -> list -> replay -> export -> import -> Resume after a reload -> delete", async () => {
    const pair = teamPair("saved-flow", 1, parsePools("S,V"), runtime);
    const setup: TrainingSetup = { own: pair.p1.team, opponent: pair.p2.team, difficulty: "safe", showRead: true, info: { aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS } };
    const store = memoryBattleStore();
    const storage = memoryStorage();
    const sealer = createMemorySealer();
    const session = newSession(store, storage, sealer);
    await until(() => session.getSnapshot().engine.status === "ready" && session.getSnapshot().saved.status === "ready", "engine and list");

    // Save: a battle played to its end is the list's finished record.
    session.start(setup);
    await play(session, setup);
    const first = session.getSnapshot().battle!;
    expect(first.phase.kind).toBe("ended");
    await until(() => session.getSnapshot().saved.list.some((each) => each.id === first.savedId && each.status === "finished"), "finished save");
    const record = (await store.get(first.savedId))!;
    expect(record).toMatchObject({ status: "finished", source: "played", turn: first.board!.turn, seed: first.seed, resume: null });
    expect(record.log).toEqual(first.log);
    expect(record.inputLog!.length).toBeGreaterThan(2);

    // Replay: the page's saved log is the one a re-run reproduces, so the board plays.
    session.changeTeams();
    session.openReplay(first.savedId);
    await until(() => session.getSnapshot().replay?.status !== undefined && session.getSnapshot().replay?.status !== "loading", "replay");
    expect(session.getSnapshot().replay).toMatchObject({ id: first.savedId, status: "board", message: null });
    const replayBoards = session.getSnapshot().replay!.boards!;
    expect(replayBoards.end).toEqual(first.board);

    // Export, then Import the file: checked, re-run, saved under a new id and opened.
    const file = (await session.exportSaved(first.savedId))!;
    expect(file.name).toMatch(/^training-battle-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    session.closeReplay();
    session.importSaved({ name: file.name, size: file.text.length, text: async () => file.text });
    await until(() => session.getSnapshot().saved.import.status === "done" || session.getSnapshot().saved.import.status === "error", "import");
    expect(session.getSnapshot().saved.import).toEqual({ status: "done", name: file.name });
    const imported = session.getSnapshot().replay!;
    expect(imported).toMatchObject({ status: "board", summary: { source: "imported", result: record.result, turn: record.turn } });
    expect(imported.id).not.toBe(first.savedId);
    expect(logHash(imported.log)).toBe(logHash(record.log));
    session.closeReplay();
    // The same file with its result changed is refused by the re-run.
    const edited = JSON.parse(file.text);
    edited.battle.result = { result: record.result!.result === "win" ? "loss" : "win", forfeited: false };
    session.importSaved({ name: "edited.json", size: 10, text: async () => JSON.stringify(edited) });
    await until(() => session.getSnapshot().saved.import.status === "error", "edited import");
    expect(session.getSnapshot().saved.import).toEqual({ status: "error", name: "edited.json", message: "The file's result does not match a re-run of its battle." });

    // Resume: a battle autosaved at turn 3, then a reload (a new page store and worker on the same storage and key).
    session.start(setup);
    await play(session, setup, (snapshot) => (snapshot.saved.autosaved?.turn ?? 0) >= 3 && snapshot.battle?.phase.kind === "choose");
    const second = session.getSnapshot().battle!;
    if (second.phase.kind === "ended") throw new Error("The second battle ended before turn 3.");
    const turn = session.getSnapshot().saved.autosaved!.turn;
    await until(() => session.getSnapshot().saved.list.some((each) => each.id === second.savedId && each.status === "unfinished" && each.turn === turn), "unfinished save");
    // The habits the autosave left are the stored ones (so the resumed battle goes on writing them).
    expect(JSON.parse(storage.getItem(`${HABITS_KEY}user-1`)!)).toEqual((await store.get(second.savedId))!.habitsAfter);

    const reloaded = newSession(store, storage, sealer);
    await until(() => reloaded.getSnapshot().engine.status === "ready" && reloaded.getSnapshot().saved.status === "ready", "reloaded list");
    const unfinished = reloaded.getSnapshot().saved.list.find((each) => each.status === "unfinished")!;
    expect(unfinished).toMatchObject({ id: second.savedId, turn });
    reloaded.resume(unfinished.id);
    await until(() => reloaded.getSnapshot().battle?.phase.kind === "choose" || !!reloaded.getSnapshot().setupError, "resumed");
    expect(reloaded.getSnapshot().setupError).toBeNull();
    const resumed = reloaded.getSnapshot().battle!;
    expect(resumed).toMatchObject({ resumed: true, savedId: second.savedId });
    expect(resumed.board!.turn).toBe(turn);
    // The log as it was shown, reads included, for every turn before the autosave.
    expect(resumed.log.filter((each) => each.turn < turn)).toEqual(second.log.filter((each) => each.turn < turn));
    await play(reloaded, setup);
    const done = reloaded.getSnapshot().battle!;
    await until(() => reloaded.getSnapshot().saved.list.some((each) => each.id === second.savedId && each.status === "finished"), "resumed battle's finished save");
    const finished = (await store.get(second.savedId))!;
    expect(finished).toMatchObject({ status: "finished", createdAt: second.startedAt, turn: done.board!.turn, seed: done.seed, habitsBefore: null });
    expect(finished.log).toEqual(done.log);
    reloaded.changeTeams();
    reloaded.openReplay(second.savedId);
    await until(() => reloaded.getSnapshot().replay?.status !== undefined && reloaded.getSnapshot().replay?.status !== "loading", "resumed replay");
    expect(reloaded.getSnapshot().replay).toMatchObject({ status: "board" });
    reloaded.closeReplay();

    // Delete one, then all.
    expect(reloaded.getSnapshot().saved.list).toHaveLength(3);
    reloaded.deleteSaved(first.savedId);
    await until(() => reloaded.getSnapshot().saved.list.length === 2, "delete");
    reloaded.deleteAllSaved();
    await until(() => reloaded.getSnapshot().saved.list.length === 0, "delete all");
    expect(await store.list()).toEqual([]);
  }, 120_000);
});
