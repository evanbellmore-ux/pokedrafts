import { describe, expect, it } from "vitest";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { logHash } from "@/app/(app)/training/model/saved-battle";
import type { TrainingSetup } from "@/app/(app)/training/model/view-types";
import type { FromWorker } from "@/app/(app)/training/model/worker-protocol";
import { createMemorySealer } from "@/app/(app)/training/worker/sealer";
import { createStubProvider } from "@/app/(app)/training/worker/stub-provider";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { playBattle, replayBattle, runSavedCheck } from "@/scripts/training/lib/saved-check";
import { parsePools, teamPair } from "@/scripts/training/lib/teams";

// Saved battles in the worker: a finished battle re-run from its seed and choice lines reproduces its log exactly; Resume
// from a checkpoint (AI state rebuilt by replaying its decides) plays on exactly as the uninterrupted battle did; the
// checkpoint leaves the worker sealed; imports are validated before they are re-run.

const pair = (index: number) => teamPair("saved-unit", index, parsePools("S,V"), runtime);
const setupOf = (index: number, info = DEFAULT_INFO): TrainingSetup => ({ own: pair(index).p1.team, opponent: pair(index).p2.team, difficulty: "safe", showRead: true, info });

describe("replays and Resume are deterministic", () => {
  it("random AI: 8 battles re-run hash-equal and resume equal to uninterrupted play (forfeits included)", async () => {
    const result = await runSavedCheck({ battles: 8, seat: "random", run: "saved-unit-random", pools: "S,V,U" });
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ battles: 8, ended: 8, replays: 8, replayEqual: 8 });
    expect(result.resumeEqual).toBe(result.resumed);
    expect(result.resumed).toBeGreaterThanOrEqual(7);
    expect(result.forfeits).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("engine AI (its belief and habits rebuilt by Resume): 2 battles", async () => {
    const result = await runSavedCheck({ battles: 2, seat: "safe", run: "saved-unit-engine", pools: "S,V" });
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ replayEqual: 2, resumed: 2, resumeEqual: 2 });
  }, 240_000);
});

describe("checkpoints and Resume", () => {
  it("each resolved turn posts one sealed checkpoint; nothing in it reads as the seed or a choice", async () => {
    const played = await playBattle({ run: "saved-unit", index: 1, setup: setupOf(1), seat: "random", sealer: createMemorySealer() });
    expect(played.ended).not.toBeNull();
    const turns = played.checkpoints.map((each) => each.turn);
    expect(turns).toEqual([...new Set(turns)].sort((a, b) => a - b));
    expect(turns[0]).toBe(1);
    expect(turns.at(-1)).toBe(played.ended!.board.turn);
    const posted = played.messages.filter((message) => message.type === "checkpoint");
    for (const message of posted) {
      expect(Object.keys(message).sort()).toEqual(["battleId", "sealed", "turn", "type"]);
      expect(message.type === "checkpoint" && message.sealed).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }
    const text = JSON.stringify(posted);
    expect(text).not.toContain(played.ended!.seed!.slice(7));
    expect(text).not.toMatch(/move \d|switch \d|team \d/);
    // Until the end, the battle messages carry no seed and no choice lines.
    for (const message of played.messages) if (message.type === "battle" && !message.ended) expect(message.seed === null && message.inputLog === undefined).toBe(true);
    expect(played.ended!.inputLog!.every((line) => /^>p[12] /.test(line))).toBe(true);
  }, 60_000);

  it("without a sealer there are no checkpoints and Resume is refused", async () => {
    const played = await playBattle({ run: "saved-unit", index: 2, setup: setupOf(2), seat: "random", sealer: null });
    expect(played.ended).not.toBeNull();
    expect(played.messages.some((message) => message.type === "checkpoint")).toBe(false);
    const posted: FromWorker[] = [];
    const worker = createTrainingWorker({ post: (message) => posted.push(message), createProvider: createStubProvider, now: () => 0, randomHex: () => "0".repeat(32), deadlineMs: null });
    worker.receive({ type: "resume", battleId: 9, setup: setupOf(2), sealed: "abc", log: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted).toEqual([{ type: "battle-error", battleId: 9, message: "Resume is unavailable in this browser." }]);
  }, 60_000);

  it("a checkpoint from another browser's key, or changed, cannot be opened", async () => {
    const sealer = createMemorySealer();
    const played = await playBattle({ run: "saved-unit", index: 3, setup: setupOf(3), seat: "random", sealer });
    const sealed = played.checkpoints[0].sealed;
    for (const [other, text] of [[createMemorySealer(), sealed], [sealer, `${sealed.slice(0, -6)}AAAA${sealed.slice(-2)}`]] as const) {
      const posted: FromWorker[] = [];
      const worker = createTrainingWorker({ post: (message) => posted.push(message), createProvider: createStubProvider, now: () => 0, randomHex: () => "0".repeat(32), deadlineMs: null, sealer: other });
      worker.receive({ type: "resume", battleId: 4, setup: setupOf(3), sealed: text, log: [] });
      for (let i = 0; i < 20 && !posted.length; i++) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(posted).toEqual([{ type: "battle-error", battleId: 4, message: "The saved battle cannot be opened in this browser." }]);
    }
  }, 60_000);

  it("a checkpoint resumed with other teams does not re-run the same way", async () => {
    const sealer = createMemorySealer();
    const played = await playBattle({ run: "saved-unit", index: 4, setup: setupOf(4), seat: "random", sealer });
    const at = played.checkpoints.at(-1)!;
    const resumed = await playBattle({ run: "saved-unit", index: 4, setup: { ...setupOf(4), opponent: pair(5).p2.team }, seat: "random", sealer }, { sealed: at.sealed, log: [] });
    expect(resumed.errors.join(" ")).toContain("The saved battle did not re-run the same way.");
  }, 60_000);
});

describe("Resume while it rebuilds", () => {
  it("ignores a forfeit and choices until the battle is rebuilt, then plays on", async () => {
    const sealer = createMemorySealer();
    const flush = async (times = 10) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 1)); };
    const first: FromWorker[] = [];
    const a = createTrainingWorker({ post: (message) => first.push(structuredClone(message)), createProvider: createStubProvider, now: () => 0, randomHex: () => "a".repeat(32), deadlineMs: null, sealer });
    a.receive({ type: "start", battleId: 1, setup: setupOf(8), habits: null });
    await flush();
    const preview = first.filter((m) => m.type === "battle").at(-1) as Extract<FromWorker, { type: "battle" }>;
    a.receive({ type: "choose", battleId: 1, requestId: preview.request!.id, choice: { kind: "team", order: [1, 2, 3, 4] } });
    await flush();
    const checkpoint = first.find((m) => m.type === "checkpoint");
    expect(checkpoint && checkpoint.type === "checkpoint" && checkpoint.turn).toBe(1);
    const log = first.filter((m) => m.type === "battle").flatMap((m) => (m.type === "battle" ? m.log : [])).filter((turn) => turn.turn < 1);

    let open = () => {};
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const posted: FromWorker[] = [];
    const b = createTrainingWorker({
      post: (message) => posted.push(structuredClone(message)), now: () => 0, randomHex: () => "b".repeat(32), deadlineMs: null, sealer,
      createProvider: (habits) => {
        const stub = createStubProvider(habits);
        return { ...stub, async teamPreview(context, options) { await gate; return stub.teamPreview(context, options); } };
      },
    });
    b.receive({ type: "resume", battleId: 2, setup: setupOf(8), sealed: checkpoint!.type === "checkpoint" ? checkpoint!.sealed! : "", log });
    await flush();
    b.receive({ type: "forfeit", battleId: 2 });
    b.receive({ type: "choose", battleId: 2, requestId: 1, choice: { kind: "team", order: [1, 2, 3, 4] } });
    expect(posted).toEqual([]);
    open();
    await flush();
    const battle = posted.find((m) => m.type === "battle");
    expect(battle && battle.type === "battle" && battle.ended).toBeNull();
    expect(battle && battle.type === "battle" && battle.request?.kind).toBe("move");
    expect(posted.some((m) => m.type === "battle-error")).toBe(false);
  }, 60_000);
});

describe("replay re-runs", () => {
  it("posts the board as each turn began and after the end, per You see, and the log's hash", async () => {
    const setup = setupOf(6, { aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS });
    const played = await playBattle({ run: "saved-unit", index: 6, setup, seat: "random", sealer: null });
    const replay = await replayBattle(setup, played.ended!);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.message.hash).toBe(logHash([...played.log.values()]));
    const turns = Object.keys(replay.message.starts).map(Number);
    expect(turns[0]).toBe(1);
    expect(turns).toEqual(turns.map((_, index) => index + 1));
    // The AI's sheet stays closed on every board: no natures or Stat Points, unseen moves counted.
    for (const board of [...Object.values(replay.message.starts), replay.message.end]) {
      for (const mon of board.team.opponent) {
        expect(mon.nature).toBeNull();
        expect(mon.points).toBeNull();
        expect(mon.brought).toBeNull();
      }
    }
    expect(replay.message.end).toEqual(played.ended!.board);
  }, 60_000);

  it("validates the teams first and states what does not fit", async () => {
    const setup = setupOf(7);
    const played = await playBattle({ run: "saved-unit", index: 7, setup, seat: "random", sealer: null });
    const ended = played.ended!;
    const illegal = structuredClone(setup);
    illegal.own.members[0].moves[0] = { moveId: "sketch", origin: "manual", gameType: null };
    const refused = await replayBattle(illegal, ended);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/^Your team: /);
    const cut = await replayBattle(setup, { ...ended, inputLog: ended.inputLog!.slice(0, 3), ended: { result: "win", forfeited: false } });
    expect(cut).toEqual({ ok: false, error: "The saved choices end before the battle does." });
    const wrong = await replayBattle(setup, { ...ended, inputLog: [ended.inputLog![0], ">p1 move 9 9"] });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toMatch(/^The saved choices do not fit the battle/);
    const otherSeed = await replayBattle(setup, { ...ended, seed: "sodium,00000000000000000000000000000000" });
    expect(otherSeed.ok && otherSeed.message.hash === logHash([...played.log.values()])).toBe(false);
  }, 60_000);
});
