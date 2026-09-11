import { describe, expect, it } from "vitest";
import {
  canAffordPick,
  getDraftRound,
  getSnakeDraftIndex,
  totalDraftPicks,
} from "@/app/lib/league/draft";

describe("getSnakeDraftIndex", () => {
  it("snakes through four teams", () => {
    const order = Array.from({ length: 12 }, (_, index) =>
      getSnakeDraftIndex(index + 1, 4)
    );
    expect(order).toEqual([0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3]);
  });

  it("snakes through two teams", () => {
    const order = Array.from({ length: 6 }, (_, index) =>
      getSnakeDraftIndex(index + 1, 2)
    );
    expect(order).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it("always returns the only team for a one-team draft", () => {
    for (let pick = 1; pick <= 5; pick += 1) {
      expect(getSnakeDraftIndex(pick, 1)).toBe(0);
    }
  });

  it("is defensive about invalid input", () => {
    expect(getSnakeDraftIndex(0, 4)).toBe(0);
    expect(getSnakeDraftIndex(3, 0)).toBe(0);
  });

  it("stays within bounds for every pick of a full draft", () => {
    for (let teams = 2; teams <= 9; teams += 1) {
      const total = totalDraftPicks(teams, 10);
      for (let pick = 1; pick <= total; pick += 1) {
        const index = getSnakeDraftIndex(pick, teams);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(teams);
      }
    }
  });
});

describe("getDraftRound", () => {
  it("increments once every teamCount picks", () => {
    expect(getDraftRound(1, 4)).toBe(1);
    expect(getDraftRound(4, 4)).toBe(1);
    expect(getDraftRound(5, 4)).toBe(2);
    expect(getDraftRound(9, 4)).toBe(3);
  });
});

describe("canAffordPick (budget rule)", () => {
  it("rejects a pick that exceeds the remaining budget", () => {
    expect(
      canAffordPick({ points: 20, remainingBudget: 19, slotsLeftAfter: 0, minPoolPoints: 1 })
    ).toBe(false);
  });

  it("rejects a pick that leaves too little to fill remaining slots", () => {
    // 20 left, pick costs 15, 3 slots still open at 2 points minimum each.
    expect(
      canAffordPick({ points: 15, remainingBudget: 20, slotsLeftAfter: 3, minPoolPoints: 2 })
    ).toBe(false);
  });

  it("accepts a pick that leaves exactly enough for the remaining slots", () => {
    expect(
      canAffordPick({ points: 14, remainingBudget: 20, slotsLeftAfter: 3, minPoolPoints: 2 })
    ).toBe(true);
  });

  it("accepts spending the whole budget on the final slot", () => {
    expect(
      canAffordPick({ points: 20, remainingBudget: 20, slotsLeftAfter: 0, minPoolPoints: 1 })
    ).toBe(true);
  });
});

describe("totalDraftPicks", () => {
  it("multiplies teams by picks per team", () => {
    expect(totalDraftPicks(6, 10)).toBe(60);
    expect(totalDraftPicks(0, 10)).toBe(0);
  });
});
