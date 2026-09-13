import { describe, expect, it } from "vitest";
import { computeStandings, type StandingsMatch } from "@/app/lib/league/standings";

/**
 * Contract lens on `computeStandings` against docs/release-architecture.md
 * section 12.3 and docs/schema.md ("Standings and playoffs"): a three-way tie
 * that head-to-head resolves only partially, the "0 when a coach has none"
 * head-to-head rule, the differential with null counts, strength of schedule
 * as one term per completed match, and what `seed`, `rank` and `tied` mean
 * around a coin-flip group.
 */

function completed(
  home: string,
  away: string,
  winner: string,
  remaining: number | null = null
): StandingsMatch {
  return {
    home_member_id: home,
    away_member_id: away,
    status: "completed",
    winner_member_id: winner,
    stage: "regular",
    winner_remaining: remaining,
  };
}

function upcoming(home: string, away: string): StandingsMatch {
  return {
    home_member_id: home,
    away_member_id: away,
    status: "upcoming",
    winner_member_id: null,
    stage: "regular",
    winner_remaining: null,
  };
}

const ids = (rows: { member: { id: string } }[]) => rows.map((row) => row.member.id);

describe("three-way tie resolved partially by head-to-head", () => {
  // a, b, c are all 2-1. a beat b and c; b and c never met (their third
  // match is still upcoming), each lost only to a and beat a filler.
  const members = [
    { id: "a", team_name: "Alpha" },
    { id: "b", team_name: "Bravo" },
    { id: "c", team_name: "Charlie" },
    { id: "x", team_name: "X" },
    { id: "y", team_name: "Y" },
  ];
  const matches: StandingsMatch[] = [
    completed("a", "b", "a"),
    completed("a", "c", "a"),
    completed("x", "a", "x"),
    completed("b", "x", "b"),
    completed("b", "y", "b"),
    completed("c", "x", "c"),
    completed("c", "y", "c"),
    upcoming("b", "c"),
  ];

  it("places the head-to-head winner first and sends the rest to the next tiebreaker", () => {
    const standings = computeStandings(members, matches, "head_to_head");
    const top = standings.slice(0, 3);
    expect(ids(top)).toEqual(["a", "b", "c"]);
    // a: 1.000 inside the group; b and c: 0 (lost their only group game).
    expect(top.map((row) => row.headToHeadApplied)).toEqual([true, true, true]);
    // b and c: same differential (0, no counts), same strength of schedule
    // (a, x, y each) -> coin flip: shared rank 2, distinct seeds, tied.
    expect(top.map((row) => row.seed)).toEqual([1, 2, 3]);
    expect(top.map((row) => row.rank)).toEqual([1, 2, 2]);
    expect(top.map((row) => row.tied)).toEqual([false, true, true]);
    expect(top.map((row) => row.rankLabel)).toEqual(["1", "T-2", "T-2"]);
    expect(top.map((row) => row.remaining)).toEqual([0, 1, 1]);
  });

  it("lets a differential split the sub-group that head-to-head left tied", () => {
    const withCounts = matches.map((match) =>
      match.home_member_id === "c" && match.away_member_id === "y"
        ? { ...match, winner_remaining: 4 }
        : match
    );
    const standings = computeStandings(members, withCounts, "head_to_head");
    expect(ids(standings.slice(0, 3))).toEqual(["a", "c", "b"]);
    expect(standings.slice(0, 3).map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(standings.slice(0, 3).map((row) => row.tied)).toEqual([false, false, false]);
    expect(standings.slice(0, 3).map((row) => row.headToHeadApplied)).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe("head-to-head scores a coach with no group games as 0", () => {
  it("ties a coach who never met the group with one who lost every group game", () => {
    // a, b, c are 1-1. a beat b; c never met either (beat x, lost to y).
    const members = [
      { id: "a", team_name: "Alpha" },
      { id: "b", team_name: "Bravo" },
      { id: "c", team_name: "Charlie" },
      { id: "x", team_name: "X" },
      { id: "y", team_name: "Y" },
    ];
    const matches: StandingsMatch[] = [
      completed("a", "b", "a"),
      completed("y", "a", "y"),
      completed("b", "x", "b"),
      completed("c", "x", "c"),
      completed("y", "c", "y"),
    ];
    const standings = computeStandings(members, matches, "head_to_head");
    // y 2-0 first; then a (1.000 head-to-head), then b and c (0 each: b
    // lost its only group game, c played none). b faced a (.500) and x (0);
    // c faced x (0) and y (1.000): c wins on strength of schedule, so the
    // two are separated, not coin-flipped.
    expect(ids(standings.slice(0, 4))).toEqual(["y", "a", "c", "b"]);
    expect(standings[2].strengthOfSchedule).toBe(0.5);
    expect(standings[3].strengthOfSchedule).toBe(0.25);
    expect(standings.slice(1, 4).map((row) => row.headToHeadApplied)).toEqual([
      true,
      true,
      true,
    ]);
    expect(standings.every((row) => !row.tied)).toBe(true);
  });
});

describe("differential", () => {
  it("adds the winner's count for wins, subtracts it for losses, null as 0", () => {
    const members = [
      { id: "a", team_name: "Alpha" },
      { id: "b", team_name: "Bravo" },
      { id: "c", team_name: "Charlie" },
    ];
    const matches: StandingsMatch[] = [
      completed("a", "b", "a", 3),
      completed("b", "c", "b", null),
      completed("c", "a", "c", 5),
      { ...completed("a", "c", "a"), winner_remaining: undefined },
    ];
    const byId = new Map(computeStandings(members, matches).map((row) => [row.member.id, row]));
    expect(byId.get("a")?.differential).toBe(3 - 5);
    expect(byId.get("b")?.differential).toBe(-3);
    expect(byId.get("c")?.differential).toBe(5);
  });

  it("differential first: separates a pct/wins tie before head-to-head is consulted", () => {
    const members = [
      { id: "a", team_name: "Alpha" },
      { id: "b", team_name: "Bravo" },
      { id: "c", team_name: "Charlie" },
      { id: "d", team_name: "Delta" },
    ];
    // a and b both 1-1; a beat b (count 1) but b's win over d was worth 6.
    const matches: StandingsMatch[] = [
      completed("a", "b", "a", 1),
      completed("b", "d", "b", 6),
      completed("c", "a", "c", 2),
      completed("c", "d", "c", 2),
    ];
    const standings = computeStandings(members, matches, "differential");
    expect(ids(standings)).toEqual(["c", "b", "a", "d"]);
    expect(standings.map((row) => row.headToHeadApplied)).toEqual([false, false, false, false]);
    expect(ids(computeStandings(members, matches, "head_to_head"))).toEqual(["c", "a", "b", "d"]);
  });
});

describe("strength of schedule", () => {
  it("averages one term per completed match, so a repeated opponent counts twice", () => {
    const members = [
      { id: "a", team_name: "Alpha" },
      { id: "b", team_name: "Bravo" },
      { id: "c", team_name: "Charlie" },
      { id: "d", team_name: "Delta" },
    ];
    // c 2-0 (beat d twice); d 0-3. a beat d once and b once; b beat d, lost to a.
    const matches: StandingsMatch[] = [
      completed("c", "d", "c"),
      completed("d", "c", "c"),
      completed("a", "d", "a"),
      completed("b", "d", "b"),
      completed("a", "b", "a"),
    ];
    const byId = new Map(computeStandings(members, matches).map((row) => [row.member.id, row]));
    // d faced c (1.000), c (1.000), a (1.000), b (.500): mean .875.
    expect(byId.get("d")?.strengthOfSchedule).toBe(0.875);
    // c faced d twice (0): 0. A coach with no completed match: 0.
    expect(byId.get("c")?.strengthOfSchedule).toBe(0);
    expect(
      computeStandings([{ id: "solo", team_name: "Solo" }], [])[0].strengthOfSchedule
    ).toBe(0);
  });
});

describe("coin flip: seed, rank and tied", () => {
  it("shares a rank only inside the coin-flip group and numbers seeds through it", () => {
    // Five coaches, all 0-0 with one upcoming match each: everything ties.
    const members = ["e", "c", "a", "d", "b"].map((id) => ({ id, team_name: id.toUpperCase() }));
    const matches: StandingsMatch[] = [upcoming("a", "b"), upcoming("c", "d"), upcoming("e", "a")];
    const standings = computeStandings(members, matches, "differential");
    expect(ids(standings)).toEqual(["a", "b", "c", "d", "e"]);
    expect(standings.map((row) => row.seed)).toEqual([1, 2, 3, 4, 5]);
    expect(standings.map((row) => row.rank)).toEqual([1, 1, 1, 1, 1]);
    expect(standings.every((row) => row.tied && row.rankLabel === "T-1")).toBe(true);
    expect(standings.every((row) => !row.headToHeadApplied)).toBe(true);
  });

  it("gives the group after a coin-flip group the rank its first seed holds", () => {
    const members = [
      { id: "a", team_name: "Alpha" },
      { id: "b", team_name: "Bravo" },
      { id: "c", team_name: "Charlie" },
    ];
    // a and b 1-0 against c, never met; c 0-2.
    const matches: StandingsMatch[] = [completed("a", "c", "a"), completed("b", "c", "b")];
    const standings = computeStandings(members, matches);
    expect(standings.map((row) => [row.seed, row.rank, row.tied])).toEqual([
      [1, 1, true],
      [2, 1, true],
      [3, 3, false],
    ]);
  });

  it("compares win percentage at 3 decimals, half up, like the function's pct_key", () => {
    // 0.6665 rounds to 0.667 (half up) and ties 2/3 at 3 decimals; more
    // wins then decides, not the fourth decimal.
    const members = [
      { id: "b", team_name: "Bravo" },
      { id: "a", team_name: "Alpha" },
    ];
    const matches: StandingsMatch[] = [];
    for (let i = 0; i < 2; i += 1) matches.push(completed("a", `f${i}`, "a"));
    matches.push(completed("a", "f2", "f2"));
    for (let i = 0; i < 1333; i += 1) matches.push(completed("b", `g${i}`, "b"));
    for (let i = 0; i < 667; i += 1) matches.push(completed("b", `h${i}`, `h${i}`));
    const fillers = [
      ...Array.from({ length: 3 }, (_, i) => ({ id: `f${i}`, team_name: null })),
      ...Array.from({ length: 1333 }, (_, i) => ({ id: `g${i}`, team_name: null })),
      ...Array.from({ length: 667 }, (_, i) => ({ id: `h${i}`, team_name: null })),
    ];
    const pair = computeStandings([...members, ...fillers], matches).filter(
      (row) => row.member.id === "a" || row.member.id === "b"
    );
    expect(ids(pair)).toEqual(["b", "a"]);
    expect(pair.map((row) => row.winPercentage)).toEqual([0.667, 0.667]);
    expect(pair[0].seed).toBe(pair[1].seed - 1);
    expect(pair[0].rank).not.toBe(pair[1].rank);
    expect(pair.map((row) => row.tied)).toEqual([false, false]);
  });
});
