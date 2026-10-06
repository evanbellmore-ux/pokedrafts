import { describe, expect, it } from "vitest";
import { createBeliefModel } from "@/app/(app)/training/ai/belief/model";
import { emptyHabits } from "@/app/(app)/training/ai/habits";
import { capToOne, teamPreview, type PreviewArgs } from "@/app/(app)/training/ai/preview";
import { CLOSED_TEAM_SHEETS, OPEN_TEAM_SHEETS, type InfoView } from "@/app/(app)/training/model/info";
import { createRandom } from "@/app/(app)/training/model/random";
import { redactSheet } from "@/app/(app)/training/model/sheet";
import { fullSheet, PROBE_AI, PROBE_PLAYER, runtime, trainingTeam, usageFixture } from "../fixtures/training-ai";

/** SPEC 10.11 team preview. */
function args(info: InfoView = OPEN_TEAM_SHEETS, changes: Partial<PreviewArgs> = {}): PreviewArgs {
  const sheet = redactSheet(fullSheet(PROBE_PLAYER), info);
  const belief = createBeliefModel(info, { usage: usageFixture });
  belief.start(sheet, runtime);
  const snapshot = belief.snapshot();
  return {
    runtime, ai: trainingTeam(PROBE_AI), sheet, builds: belief.mapBuilds(runtime),
    moves: Object.fromEntries(Object.entries(snapshot.members).map(([key, member]) => [key, member.moves])),
    habits: null, difficulty: "safe", random: createRandom("preview", 1), ...changes,
  };
}

describe("team preview", () => {
  it("brings four distinct members, the two leads first, from the best of the 90 configurations", () => {
    const started = performance.now();
    const result = teamPreview(args());
    const elapsed = performance.now() - started;
    expect(result.order).toHaveLength(4);
    expect(new Set(result.order).size).toBe(4);
    expect(result.order.every((index) => index >= 1 && index <= 6)).toBe(true);
    expect(result.configurations).toHaveLength(90);
    const best = Math.max(...result.configurations.map((entry) => entry.value));
    const chosen = result.configurations.find((entry) => entry.value === best)!;
    expect(new Set(result.order.slice(0, 2).map((i) => i - 1))).toEqual(new Set(chosen.leads));
    expect(new Set(result.order.map((i) => i - 1))).toEqual(new Set(chosen.members));
    expect(result.report).toMatchObject({ turn: 0, provider: "engine", mega: null, evaluated: { yours: 15, its: 90 } });
    expect(result.report.preview!.predictedLeads).toHaveLength(3);
    // SPEC 15 gates preview p95 ≤ 150 ms (VAL measures it); here only a sanity bound that holds under a loaded test run.
    expect(elapsed).toBeLessThan(1500);
  });

  it("predicts your bring as chances that sum to four, none above 1, and leans on bring and lead habits", () => {
    const plain = teamPreview(args());
    const values = Object.values(plain.bring);
    expect(values.reduce((sum, p) => sum + p, 0)).toBeCloseTo(4, 9);
    expect(Math.max(...values)).toBeLessThanOrEqual(1 + 1e-12);
    const habits = { ...emptyHabits(), battles: 20, brings: { rotomwash: 20, kingambit: 20 }, leads: { "kingambit+rotomwash": 20 } };
    const learned = teamPreview(args(OPEN_TEAM_SHEETS, { habits }));
    expect(learned.bring.rotomwash).toBeGreaterThan(plain.bring.rotomwash);
    expect(learned.report.preview!.predictedLeads[0].keys.sort()).toEqual(["kingambit", "rotomwash"]);
  });

  it("is deterministic; Reads you samples among the top three with the decision's random", () => {
    expect(teamPreview(args()).order).toEqual(teamPreview(args()).order);
    const orders = new Set<string>();
    for (let seed = 0; seed < 30; seed++) orders.add(teamPreview(args(OPEN_TEAM_SHEETS, { difficulty: "reads", random: createRandom("reads", seed) })).order.join(","));
    expect(orders.size).toBeGreaterThan(1);
    expect(orders.size).toBeLessThanOrEqual(3 * 2);
  });

  it("plays with closed team sheets from the belief's MAP builds", () => {
    const result = teamPreview(args(CLOSED_TEAM_SHEETS));
    expect(result.order).toHaveLength(4);
  });

  it("caps chances at 1 and keeps the total", () => {
    const capped = capToOne([5, 1, 1, 1, 0.5, 0.5], 4);
    expect(capped.reduce((sum, p) => sum + p, 0)).toBeCloseTo(4, 12);
    expect(Math.max(...capped)).toBeCloseTo(1, 12);
  });
});
