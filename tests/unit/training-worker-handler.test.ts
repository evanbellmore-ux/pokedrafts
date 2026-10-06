import { describe, expect, it } from "vitest";
import type { AiInputs } from "@/app/(app)/training/model/ai-inputs";
import type { DecisionProvider, HabitsRecord, TurnRecord } from "@/app/(app)/training/model/decision";
import { CLOSED_TEAM_SHEETS, DEFAULT_INFO, PERFECT_INFORMATION } from "@/app/(app)/training/model/info";
import type { FromWorker } from "@/app/(app)/training/model/worker-protocol";
import type { JointAction, TrainingSetup } from "@/app/(app)/training/model/view-types";
import { createStubProvider } from "@/app/(app)/training/worker/stub-provider";
import { createTrainingWorker } from "@/app/(app)/training/worker/worker-handler";
import { AI_TEAM, PLAYER_TEAM } from "./training-sim-fixtures";

// SPEC §7.2 / §13.3: the worker loop with a provider that resolves late (G1–G5).

const flush = async (times = 6) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const setup = (info = DEFAULT_INFO): TrainingSetup => ({ own: PLAYER_TEAM, opponent: AI_TEAM, difficulty: "safe", showRead: true, info });

type Gate = { open(): void; promise: Promise<void> };
const gate = (): Gate => { let open = () => {}; const promise = new Promise<void>((resolve) => { open = resolve; }); return { open, promise }; };

/** The stand-in provider's choices, released by the test; records every TurnContext's inputs. */
function lateProvider(options: { throwOnTurn?: number; badAction?: boolean } = {}) {
  const gates: Gate[] = [];
  const seen: AiInputs[] = [];
  const records: TurnRecord[] = [];
  const stub = createStubProvider(null);
  const provider: DecisionProvider = {
    ...stub,
    async chooseTurn(context, decide) {
      seen.push(structuredClone(context.inputs));
      const g = gate(); gates.push(g);
      await g.promise;
      if (options.throwOnTurn === context.inputs.public.turn) throw new Error("Engine failed.");
      const decision = await stub.chooseTurn(context, decide);
      // A strategy that also names a move the AI never used (closed moves: "Not shown").
      const hidden: JointAction = { "opponent-right": { kind: "move", moveId: "crunch", target: "own-left" }, "opponent-left": { kind: "move", moveId: "hurricane", target: "own-right" } };
      const action: JointAction = options.badAction ? { "opponent-right": { kind: "move", moveId: "waterfall", target: "opponent-right" }, "opponent-left": { kind: "move", moveId: "weatherball", target: null } } : decision.action;
      return { ...decision, action, report: { ...decision.report, strategy: [{ action: decision.action, chance: 0.7 }, { action: hidden, chance: 0.3 }] } };
    },
    observeTurn(record) { records.push(record); stub.observeTurn(record); },
  };
  return { provider, gates, seen, records };
}

function harness(provider: DecisionProvider) {
  const posted: FromWorker[] = [];
  let hex = 0;
  const worker = createTrainingWorker({
    post: (message) => posted.push(structuredClone(message)),
    createProvider: () => provider, now: () => 0, randomHex: () => (++hex).toString(16).padStart(32, "0"), deadlineMs: null,
  });
  const battles = () => posted.filter((m): m is Extract<FromWorker, { type: "battle" }> => m.type === "battle");
  const last = () => battles().at(-1)!;
  return { worker, posted, battles, last };
}

describe("worker-handler", () => {
  it("loads, validates, and starts at team preview with no seed", async () => {
    const { worker, posted, last } = harness(createStubProvider(null));
    worker.receive({ type: "load" });
    expect(posted[0]).toMatchObject({ type: "loaded" });
    worker.receive({ type: "validate", key: "k1", setup: setup() });
    expect(posted.find((m) => m.type === "validated")).toMatchObject({ key: "k1", own: { team: [], members: {} }, opponent: { team: [], members: {} } });
    worker.receive({ type: "start", battleId: 1, setup: setup(), habits: null });
    await flush();
    expect(last()).toMatchObject({ battleId: 1, seed: null, request: { kind: "team-preview", maxChosenTeamSize: 4 } });
    expect(posted.some((m) => m.type === "ai" && m.status === "locked")).toBe(true);
  });

  it("G1: holds your choice until the AI commits; errors come at once; stale ids are dropped", async () => {
    const { provider, gates, seen } = lateProvider();
    const { worker, posted, last } = harness(provider);
    worker.receive({ type: "start", battleId: 1, setup: setup(), habits: null });
    await flush();
    worker.receive({ type: "choose", battleId: 1, requestId: last().request!.id, choice: { kind: "team", order: [1, 2, 3, 4] } });
    await flush();
    const moveRequest = last().request!;
    expect(moveRequest.kind).toBe("move");
    expect(gates.length).toBe(1);
    expect(posted.filter((m) => m.type === "ai").at(-1)).toMatchObject({ status: "thinking", requestId: moveRequest.id });
    // An invalid choice is answered at once, while the AI still thinks (checked on a clone).
    worker.receive({ type: "choose", battleId: 1, requestId: moveRequest.id, choice: { kind: "action", action: { "own-left": { kind: "move", moveId: "fakeout", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } } } });
    expect(posted.at(-1)).toMatchObject({ type: "choice-error", message: "Fake Out: no target" });
    const before = posted.length;
    worker.receive({ type: "choose", battleId: 1, requestId: moveRequest.id - 1, choice: { kind: "action", action: {} } });
    worker.receive({ type: "choose", battleId: 2, requestId: moveRequest.id, choice: { kind: "action", action: {} } });
    expect(posted.length).toBe(before);
    // A valid choice is held: nothing happens until the AI's job resolves.
    worker.receive({ type: "choose", battleId: 1, requestId: moveRequest.id, choice: { kind: "action", action: { "own-left": { kind: "move", moveId: "fakeout", target: "opponent-right" }, "own-right": { kind: "move", moveId: "protect", target: null } } } });
    await flush();
    expect(posted.length).toBe(before);
    expect(JSON.stringify(seen[0])).not.toContain("fakeout\",\"target\":\"opponent-right");
    gates[0].open();
    await flush();
    expect(last().board.turn).toBe(2);
    expect(last().request?.id).toBeGreaterThan(moveRequest.id);
    expect(last().log.find((turn) => turn.turn === 1)?.actions?.own).toEqual({ "own-left": { kind: "move", moveId: "fakeout", target: "opponent-right" }, "own-right": { kind: "move", moveId: "protect", target: null } });
  });

  it("G5: the read for a turn arrives only after it resolves, redacted per youSee; habits learn the shown actions", async () => {
    const { provider, gates, records } = lateProvider();
    const { worker, last, battles } = harness(provider);
    worker.receive({ type: "start", battleId: 1, setup: setup({ aiKnows: DEFAULT_INFO.aiKnows, youSee: CLOSED_TEAM_SHEETS }), habits: null });
    await flush();
    worker.receive({ type: "choose", battleId: 1, requestId: last().request!.id, choice: { kind: "team", order: [1, 2, 3, 4] } });
    await flush();
    expect(battles().flatMap((m) => m.log).some((turn) => turn.turn === 1 && turn.read)).toBe(false);
    gates[0].open();
    await flush();
    expect(battles().flatMap((m) => m.log).some((turn) => turn.turn === 1 && turn.read)).toBe(false);
    worker.receive({ type: "choose", battleId: 1, requestId: last().request!.id, choice: { kind: "action", action: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } } } });
    await flush();
    const turn1 = battles().flatMap((m) => m.log).filter((turn) => turn.turn === 1).at(-1)!;
    expect(turn1.read).not.toBeNull();
    // Crunch and Hurricane were never used and Moves are closed for you: that option reads "Not shown".
    expect(turn1.read!.strategy.some((option) => option.action === null && Math.abs(option.chance - 0.3) < 1e-9)).toBe(true);
    expect(turn1.read!.actual).toEqual({ chance: null });
    expect(records).toHaveLength(1);
    expect(records[0].turn).toBe(1);
    expect(records[0].observed["own-left"]).toMatchObject({ kind: "move", moveId: "protect" });
    expect(records[0].observedMega).toBeNull();
    expect(last().habits).toBeDefined();
  });

  it("a provider that throws falls back to a legal choice; a rejected AI choice falls back too", async () => {
    for (const options of [{ throwOnTurn: 1 }, { badAction: true }]) {
      const { provider, gates } = lateProvider(options);
      const { worker, posted, last } = harness(provider);
      worker.receive({ type: "start", battleId: 1, setup: setup(), habits: null });
      await flush();
      worker.receive({ type: "choose", battleId: 1, requestId: last().request!.id, choice: { kind: "team", order: [1, 2, 3, 4] } });
      await flush();
      gates[0].open();
      await flush();
      expect(posted.filter((m) => m.type === "ai").at(-1)).toMatchObject({ status: "fallback" });
      worker.receive({ type: "choose", battleId: 1, requestId: last().request!.id, choice: { kind: "action", action: { "own-left": { kind: "move", moveId: "protect", target: null }, "own-right": { kind: "move", moveId: "protect", target: null } } } });
      await flush();
      expect(last().board.turn).toBe(2);
    }
  });

  it("builds no test oracle unless a test extra is on; forfeit ends with the seed", async () => {
    for (const [info, revealed] of [[DEFAULT_INFO, false], [{ aiKnows: PERFECT_INFORMATION, youSee: DEFAULT_INFO.youSee }, true]] as const) {
      const { provider, gates, seen } = lateProvider();
      const { worker, last } = harness(provider);
      worker.receive({ type: "start", battleId: 7, setup: setup(info), habits: null });
      await flush();
      worker.receive({ type: "choose", battleId: 7, requestId: last().request!.id, choice: { kind: "team", order: [2, 1, 3, 4] } });
      await flush();
      expect(seen).toHaveLength(1);
      expect(seen[0].reveals.exactHP !== null).toBe(revealed);
      expect(seen[0].reveals.brought !== null).toBe(revealed);
      expect(seen[0].sheet.members.every((member) => (member.points === null) === !revealed)).toBe(true);
      worker.receive({ type: "forfeit", battleId: 7 });
      await flush();
      gates[0].open();
      await flush();
      expect(last()).toMatchObject({ request: null, ended: { result: "loss", forfeited: true } });
      expect(last().seed).toMatch(/^sodium,[0-9a-f]{32}$/);
    }
  });

  it("answers suggestions and the set editor's move list from the training usage data", () => {
    const { worker, posted } = harness(createStubProvider(null as HabitsRecord | null));
    worker.receive({ type: "suggest", key: "s1", side: "own", members: [{ key: "a", speciesId: "incineroar", abilityId: null }] });
    const suggested = posted.find((m) => m.type === "suggested");
    expect(suggested).toMatchObject({ key: "s1", side: "own" });
    expect(suggested && "sets" in suggested ? suggested.sets[0].moves : []).toContain("protect");
    worker.receive({ type: "move-options", speciesId: "incineroar" });
    const options = posted.find((m) => m.type === "move-options-ready");
    expect(options && "moves" in options ? options.moves.map((m) => m.id) : []).toEqual(expect.arrayContaining(["fakeout", "partingshot", "protect", "willowisp"]));
  });
});
