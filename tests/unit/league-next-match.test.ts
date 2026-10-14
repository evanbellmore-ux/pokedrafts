import { describe, expect, it } from "vitest";
import { nextMatchFor, nextOpponentId, opponentId, parseScheduledMatches, type ScheduledMatch } from "@/app/lib/league/next-match";

// A coach's next match and its opponent (app/lib/league/next-match.ts): the league overview's status card and Training's
// default opponent both read it.

const match = (round: number, number: number, home: string | null, away: string | null, status = "upcoming"): ScheduledMatch => ({
  round_number: round, match_number: number, home_member_id: home, away_member_id: away, status, stage: "regular",
});

describe("next match", () => {
  it("is the earliest unplayed match the coach is in, by round then match number", () => {
    const schedule = [match(3, 1, "me", "c"), match(1, 1, "me", "a", "completed"), match(2, 2, "b", "me"), match(2, 1, "x", "y")];
    expect(nextMatchFor(schedule, "me")).toBe(schedule[2]);
    expect(nextOpponentId(schedule, "me")).toBe("b");
    expect(opponentId(schedule[0], "me")).toBe("c");
    expect(opponentId(schedule[2], "me")).toBe("b");
  });

  it("has no opponent with no schedule, every match played, or the next one's other slot undecided", () => {
    expect(nextMatchFor([], "me")).toBeNull();
    expect(nextOpponentId([], "me")).toBeNull();
    expect(nextOpponentId([match(1, 1, "me", "a", "completed")], "me")).toBeNull();
    expect(nextOpponentId([match(4, 1, null, "me")], "me")).toBeNull();
    expect(nextOpponentId([match(1, 1, "a", "b")], "me")).toBeNull();
  });

  it("reads league_matches rows, leaving out rows of another shape", () => {
    const good = match(1, 2, "a", null);
    expect(parseScheduledMatches([good, { ...good, round_number: "1" }, { ...good, home_member_id: 7 }, { ...good, status: null }, { ...good, stage: undefined }, null, "row", { ...good, extra: true }]))
      .toEqual([good, good]);
    expect(parseScheduledMatches(null)).toEqual([]);
    expect(parseScheduledMatches({ data: [] })).toEqual([]);
  });
});
