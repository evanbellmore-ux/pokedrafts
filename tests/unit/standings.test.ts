import { describe, expect, it } from "vitest";
import {
  computeStandings,
  formatWinPercentage,
  type StandingsMatch,
} from "@/app/lib/league/standings";

const members = [
  { id: "a", team_name: "Alpha" },
  { id: "b", team_name: "Bravo" },
  { id: "c", team_name: "Charlie" },
  { id: "d", team_name: "Delta" },
];

function completed(
  home: string,
  away: string,
  winner: string
): StandingsMatch {
  return {
    home_member_id: home,
    away_member_id: away,
    status: "completed",
    winner_member_id: winner,
  };
}

function upcoming(home: string, away: string): StandingsMatch {
  return {
    home_member_id: home,
    away_member_id: away,
    status: "upcoming",
    winner_member_id: null,
  };
}

describe("computeStandings", () => {
  it("sorts by win percentage, then wins, and labels ties", () => {
    const matches = [
      completed("a", "b", "a"),
      completed("c", "d", "c"),
      completed("a", "c", "a"),
      completed("b", "d", "b"),
      upcoming("a", "d"),
      upcoming("b", "c"),
    ];

    const standings = computeStandings(members, matches);

    expect(standings.map((s) => s.member.id)).toEqual(["a", "b", "c", "d"]);
    expect(standings.map((s) => s.rankLabel)).toEqual(["1", "T-2", "T-2", "4"]);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 2, 4]);
    expect(standings[1].tied).toBe(true);
    expect(standings[0].tied).toBe(false);
    expect(standings[0]).toMatchObject({ wins: 2, losses: 0, played: 2, remaining: 1 });
    expect(standings[3]).toMatchObject({ wins: 0, losses: 2, played: 2, remaining: 1 });
  });

  it("breaks a tie on head-to-head and removes the tie label", () => {
    const matches = [
      completed("a", "b", "a"),
      completed("c", "d", "c"),
      completed("a", "c", "a"),
      completed("b", "d", "b"),
      completed("c", "b", "c"),
      completed("a", "d", "a"),
    ];

    const standings = computeStandings(members, matches);

    // b and c are both 1-2? No: c is 2-1 (beat d, beat b; lost to a), b is 1-2.
    expect(standings.map((s) => s.member.id)).toEqual(["a", "c", "b", "d"]);
    expect(standings.map((s) => s.rankLabel)).toEqual(["1", "2", "3", "4"]);
  });

  it("uses head-to-head only when percentage and wins are equal", () => {
    const matches = [
      completed("a", "b", "a"),
      completed("b", "a", "b"),
      completed("a", "c", "a"),
      completed("b", "d", "b"),
      completed("c", "d", "d"),
      completed("d", "c", "c"),
      completed("a", "d", "a"),
      completed("b", "c", "b"),
    ];
    // a: 3-1, b: 3-1, c: 1-3, d: 1-3; a vs b split 1-1, c vs d split 1-1.
    const standings = computeStandings(members, matches);
    expect(standings.map((s) => s.rankLabel)).toEqual(["T-1", "T-1", "T-3", "T-3"]);
    // Fully tied groups fall back to team name order.
    expect(standings.map((s) => s.member.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("ranks a higher win percentage above raw wins", () => {
    const two = [
      { id: "x", team_name: "Xray" },
      { id: "y", team_name: "Yankee" },
      { id: "z", team_name: "Zulu" },
    ];
    const matches = [
      completed("x", "z", "x"),
      completed("x", "z", "x"),
      completed("x", "z", "x"),
      completed("y", "z", "y"),
      completed("y", "z", "y"),
      completed("y", "z", "y"),
      completed("y", "z", "y"),
      completed("y", "z", "z"),
    ];
    // x: 3-0 (1.000), y: 4-1 (.800)
    const standings = computeStandings(two, matches);
    expect(standings.map((s) => s.member.id)).toEqual(["x", "y", "z"]);
    expect(formatWinPercentage(standings[0].winPercentage)).toBe("1.000");
    expect(formatWinPercentage(standings[1].winPercentage)).toBe(".800");
  });

  it("ignores matches for unknown members and counts upcoming games as remaining", () => {
    const standings = computeStandings(members, [
      completed("a", "ghost", "a"),
      upcoming("a", "b"),
    ]);
    expect(standings.find((s) => s.member.id === "a")).toMatchObject({
      wins: 0,
      played: 0,
      remaining: 1,
    });
    expect(standings.every((s) => s.rankLabel.startsWith("T-"))).toBe(true);
  });
});
