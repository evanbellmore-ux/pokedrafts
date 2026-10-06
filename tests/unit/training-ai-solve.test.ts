import { describe, expect, it } from "vitest";
import { columnPayoffs, purify, robustResponse, rowPayoffs, sample, solveZeroSum } from "@/app/(app)/training/ai/solve";
import { createRandom } from "@/app/(app)/training/model/random";

/** SPEC 10.7: RM+ (alternating, linear averaging), the robust response, purification and seeded sampling. */
describe("solveZeroSum", () => {
  it("rock-paper-scissors is uniform with value 0", () => {
    const rps = [[0, -1, 1], [1, 0, -1], [-1, 1, 0]];
    const solution = solveZeroSum(rps);
    for (const p of [...solution.x, ...solution.y]) expect(p).toBeCloseTo(1 / 3, 2);
    expect(Math.abs(solution.value)).toBeLessThan(0.01);
    expect(solution.exploitability).toBeLessThan(0.01);
  });

  it("gives dominated rows and columns no weight", () => {
    // Row 1 is dominated by row 0; column 2 by column 0 (the column player minimises).
    const M = [[3, 1, 4], [2, 0, 3], [1, 2, 5]];
    const { x, y } = solveZeroSum(M);
    expect(x[1]).toBeLessThan(0.01);
    expect(y[2]).toBeLessThan(0.01);
  });

  it("finds known 2×2 and 3×3 equilibria within 1e-2", () => {
    // Unequal matching pennies.
    const M = [[3, -1], [-2, 1]];
    const { x, y, value } = solveZeroSum(M);
    // Row mixes p on row 0: 3p − 2(1−p) = −p + (1−p) → p = 3/7; column q on col 0: 3q − (1−q) = −2q + (1−q) → q = 2/7; v = 1/7.
    expect(x[0]).toBeCloseTo(3 / 7, 2);
    expect(y[0]).toBeCloseTo(2 / 7, 2);
    expect(value).toBeCloseTo(1 / 7, 2);
    // A 3×3 with a pure saddle point at (1, 1).
    const saddle = [[4, 2, 5], [6, 3, 7], [1, 0, 8]];
    const s = solveZeroSum(saddle);
    expect(s.x[1]).toBeGreaterThan(0.99);
    expect(s.y[1]).toBeGreaterThan(0.99);
    expect(s.value).toBeCloseTo(3, 2);
  });

  it("keeps exploitability within 2% of the spread on random 10×6 games (SPEC 14.2 gate) and is deterministic", () => {
    const random = createRandom("solver", 1);
    let worst = 0;
    for (let k = 0; k < 40; k++) {
      const M = Array.from({ length: 10 }, () => Array.from({ length: 6 }, () => random.float() * 2 - 1));
      const solution = solveZeroSum(M);
      worst = Math.max(worst, solution.exploitability);
      expect(solveZeroSum(M)).toEqual(solution);
      expect(solution.x.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(solution.y.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(solution.value).toBeCloseTo(Math.min(...columnPayoffs(M, solution.x)), 12);
      expect(solution.spread).toBeGreaterThan(0);
    }
    expect(worst).toBeLessThan(0.02);
  });

  it("handles a constant matrix and a single row", () => {
    expect(solveZeroSum([[2, 2], [2, 2]])).toEqual({ x: [0.5, 0.5], y: [0.5, 0.5], value: 2, exploitability: 0, spread: 0 });
    const one = solveZeroSum([[1, -1, 0]]);
    expect(one.x).toEqual([1]);
    expect(one.y[1]).toBeGreaterThan(0.99);
  });
});

describe("robustResponse", () => {
  it("best-responds to a predictable opponent when that stays within the safety bound", () => {
    const M = [[2, -1], [-1, 1], [0.5, 0.5]];
    const safe = solveZeroSum(M);
    const x = robustResponse(M, [1, 0], safe, { tauShare: 0.1, epsilonShare: 0.5 });
    expect(x[0]).toBeGreaterThan(0.9);
    expect(Math.min(...columnPayoffs(M, x))).toBeGreaterThanOrEqual(safe.value - 0.5 * safe.spread - 1e-9);
  });

  it("falls back toward x* when exploiting would cost more than ε", () => {
    const M = [[2, -3], [0.2, 0.2]];
    const safe = solveZeroSum(M);
    const x = robustResponse(M, [1, 0], safe, { tauShare: 0.1, epsilonShare: 0.01 });
    expect(Math.min(...columnPayoffs(M, x))).toBeGreaterThanOrEqual(safe.value - 0.01 * safe.spread - 1e-9);
    expect(x[1]).toBeGreaterThan(0.5);
  });

  it("is uniform over Mq ties", () => {
    const M = [[1, 0], [1, 0]];
    const safe = solveZeroSum(M);
    expect(robustResponse(M, [1, 0], safe)).toEqual([0.5, 0.5]);
    expect(rowPayoffs(M, [1, 0])).toEqual([1, 1]);
  });
});

describe("purify and sample", () => {
  it("drops probabilities below the floor and renormalises", () => {
    expect(purify([0.5, 0.46, 0.04])).toEqual([0.5 / 0.96, 0.46 / 0.96, 0]);
    expect(purify([0.03, 0.04, 0.02])).toEqual([0, 1, 0]);
    expect(purify([])).toEqual([]);
  });

  it("samples by one seeded draw, the same index for the same seed", () => {
    const p = [0.2, 0.5, 0.3];
    const draws = Array.from({ length: 20 }, (_, i) => sample(p, createRandom("draw", i)));
    expect(Array.from({ length: 20 }, (_, i) => sample(p, createRandom("draw", i)))).toEqual(draws);
    expect(new Set(draws).size).toBeGreaterThan(1);
    expect(sample([0, 1, 0], createRandom("x"))).toBe(1);
    const counts = [0, 0, 0];
    const random = createRandom("many");
    for (let i = 0; i < 4000; i++) counts[sample(p, random)]++;
    expect(counts[1] / 4000).toBeCloseTo(0.5, 1);
  });
});
