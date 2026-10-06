import { describe, expect, it } from "vitest";
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { DEFAULT_INFO } from "@/app/(app)/training/model/info";
import { loadTrainingUsage } from "@/app/(app)/training/usage/training-usage";
import { runMatch, type MatchResult } from "@/scripts/training/lib/match";
import { createSeat, ensureSeats } from "@/scripts/training/lib/providers";
import { teamPair } from "@/scripts/training/lib/teams";

// SPEC §14.2 smoke: the match runner plays whole battles with each seat on its own tracker and AiInputs.
const usage = loadTrainingUsage();
async function play(p2: Parameters<typeof createSeat>[0], p1: Parameters<typeof createSeat>[0], index: number): Promise<MatchResult> {
  await ensureSeats([p1, p2]);
  const pair = teamPair("match-smoke", index, ["S", "V"], runtime);
  return runMatch({
    seats: { p1: createSeat(p1, runtime, null), p2: createSeat(p2, runtime, null) },
    teams: { p1: pair.p1.team, p2: pair.p2.team }, info: DEFAULT_INFO, runtime, usage, seedRun: "match-smoke", index,
  });
}

describe("training match runner (SPEC §14.2)", () => {
  it("plays VAL's random seats to the end, deterministically", async () => {
    const first = await play("val-random", "val-random", 0);
    expect(first.errors).toEqual([]);
    expect(first.ended).toBe(true);
    expect(first.winner).not.toBeNull();
    expect(first.decisions.filter((record) => record.kind === "preview")).toHaveLength(2);
    const again = await play("val-random", "val-random", 0);
    expect(again.choiceLogHash).toBe(first.choiceLogHash);
  }, 60_000);

  it("3 battles of Plays safe vs RandomLegal under the default settings: all end, 0 errors", async () => {
    for (let index = 0; index < 3; index++) {
      const result = await play("safe", "random", index);
      expect(result.errors, `battle ${index}`).toEqual([]);
      expect(result.ended, `battle ${index}`).toBe(true);
      expect(result.capped).toBe(false);
      expect(result.decisions.filter((record) => record.side === "p2" && record.recovery?.kind === "fallback")).toEqual([]);
      for (const record of result.decisions.filter((each) => each.side === "p2" && each.kind === "turn")) {
        expect(record.stats).not.toBeNull();
        expect(record.stats!.engineCalls).toBeLessThanOrEqual(240);
        expect(record.stats!.rolloutSamples).toBeLessThanOrEqual(160);
        expect(record.stats!.builds).toBeLessThanOrEqual(4);
      }
    }
  }, 600_000);
});
