import { describe, expect, it } from "vitest";
import {
  createRemotePlayerModel, createRemoteTieBreaker, parseJevPick, parseJevPrediction, questionSummary, withFallback, type FetchJson,
} from "@/app/(app)/training/ai/jev";
import type { PlayerModel, PlayerQuestion } from "@/app/(app)/training/model/decision";
import { makeView, type MonSpec } from "../fixtures/training-ai";
import { runtime } from "../fixtures/training-ai";

/** SPEC 11 the Jev seam: request/response validation, the remote model's fallbacks, withFallback's combination. */
const question: PlayerQuestion = {
  kind: "turn", turn: 2, slots: {},
  options: [
    { id: "a", action: { "own-left": { kind: "move", moveId: "protect", target: null } }, label: "Garchomp: Protect" },
    { id: "b", action: { "own-left": { kind: "move", moveId: "earthquake", target: null } }, label: "Garchomp: Earthquake" },
  ],
  summary: "Turn 2",
};
const signal = () => new AbortController().signal;
const fixed = (probabilities: Record<string, number>, weight = 1): PlayerModel => ({
  id: "habits", predict: async () => ({ probabilities, weight }), observeTurn() {}, observeBattle() {},
});

describe("parseJevPrediction", () => {
  it("renormalises valid answers and rejects unknown ids, bad numbers and empty totals", () => {
    expect(parseJevPrediction({ probabilities: { a: 3, b: 1 } }, ["a", "b"])).toEqual({ a: 0.75, b: 0.25 });
    expect(parseJevPrediction({ probabilities: { a: 1 } }, ["a", "b"])).toEqual({ a: 1, b: 0 });
    for (const bad of [null, "x", {}, { probabilities: { c: 1 } }, { probabilities: { a: -1, b: 2 } }, { probabilities: { a: Number.NaN } }, { probabilities: { a: 0, b: 0 } }, { probabilities: { a: "1" } }]) {
      expect(parseJevPrediction(bad, ["a", "b"])).toBeNull();
    }
    expect(parseJevPick({ pick: "b" }, ["a", "b"])).toBe("b");
    expect(parseJevPick({ pick: "z" }, ["a", "b"])).toBeNull();
  });
});

describe("the remote player model", () => {
  it("sends the question and its summary, and returns the parsed answer with weight 1", async () => {
    const sent: unknown[] = [];
    const fetchJson: FetchJson = async (body) => { sent.push(body); return { probabilities: { a: 1, b: 3 } }; };
    const model = createRemotePlayerModel(fetchJson, { timeoutMs: 100 });
    expect(model.id).toBe("jev");
    expect(await model.predict(question, signal())).toEqual({ probabilities: { a: 0.25, b: 0.75 }, weight: 1 });
    expect(sent).toEqual([{ version: 1, kind: "predict-player", question, summary: "Turn 2" }]);
  });
  it("answers null on invalid data, a rejection, a timeout or an abort", async () => {
    expect(await createRemotePlayerModel(async () => ({ probabilities: { z: 1 } }), { timeoutMs: 100 }).predict(question, signal())).toBeNull();
    expect(await createRemotePlayerModel(async () => { throw new Error("offline"); }, { timeoutMs: 100 }).predict(question, signal())).toBeNull();
    let aborted = false;
    const slow: FetchJson = (_body, inner) => new Promise((resolve) => { inner.addEventListener("abort", () => { aborted = true; }); setTimeout(() => resolve({ probabilities: { a: 1 } }), 500); });
    expect(await createRemotePlayerModel(slow, { timeoutMs: 20 }).predict(question, signal())).toBeNull();
    expect(aborted).toBe(true);
    const controller = new AbortController();
    const pending = createRemotePlayerModel(slow, { timeoutMs: 400 }).predict(question, controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
  });
  it("tie-breaks to one of the options or null", async () => {
    const options = question.kind === "turn" ? question.options : [];
    expect(await createRemoteTieBreaker(async () => ({ pick: "a" }), { timeoutMs: 100 }).pick({ options }, signal())).toBe("a");
    expect(await createRemoteTieBreaker(async () => ({ pick: "x" }), { timeoutMs: 100 }).pick({ options }, signal())).toBeNull();
  });
});

describe("withFallback", () => {
  it("combines answers by weight and drops models that fail", async () => {
    const failing: PlayerModel = { id: "jev", predict: async () => { throw new Error("down"); }, observeTurn() {}, observeBattle() {} };
    const combined = withFallback([fixed({ a: 1, b: 0 }), fixed({ a: 0, b: 1 }, 3), failing]);
    expect(combined.id).toBe("jev");
    const answer = await combined.predict(question, signal());
    expect(answer!.probabilities.a).toBeCloseTo(0.25, 12);
    expect(answer!.probabilities.b).toBeCloseTo(0.75, 12);
    expect(answer!.weight).toBe(4);
    expect(await withFallback([failing]).predict(question, signal())).toBeNull();
  });
});

describe("questionSummary", () => {
  it("states only the AI view's facts", () => {
    const specs: MonSpec[] = [
      { side: "opponent", species: "charizard", slot: "opponent-left", moves: ["heatwave"], hp: 0.8 },
      { side: "own", species: "garchomp", slot: "own-left", moves: ["earthquake"], hp: 0.64 },
      { side: "own", species: "incineroar", slot: null, moves: ["fakeout"] },
    ];
    const view = makeView(specs, { turn: 3, field: { weather: "Sun", trickRoom: true } });
    // HP as the Champions shown percent of the believed HP (floor, PS/sim/pokemon.ts getHealth).
    const shown = (key: string) => { const mon = view.mons.find((each) => each.key === key)!; return Math.floor(100 * mon.hp / mon.maxHp); };
    expect(questionSummary(view, runtime)).toBe(`Turn 3 · Yours: Garchomp ${shown("own:garchomp")}% · Its: Charizard ${shown("opponent:charizard")}% · Field: Sun, Trick Room`);
    expect(questionSummary(view, runtime)).not.toContain("Incineroar");
  });
});
