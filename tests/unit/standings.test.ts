import { describe, expect, it } from "vitest";
import {
  computeStandings,
  formatDifferential,
  formatWinPercentage,
  roundPercentage,
  tiebreakerLegend,
  tiebreakerSteps,
  type StandingsMatch,
} from "@/app/lib/league/standings";

/**
 * `computeStandings` mirrors `league_standings` (docs/release-architecture.md
 * section 12.3) and is the oracle of the SQL/TS parity test, so every rule
 * of the section has a case here: the two orderings, head-to-head inside
 * the tied group, differential, strength of schedule, the coin flip and
 * what `rank`, `seed` and `tied` mean.
 */

const members = [
  { id: "a", team_name: "Alpha" },
  { id: "b", team_name: "Bravo" },
  { id: "c", team_name: "Charlie" },
  { id: "d", team_name: "Delta" },
];

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

function playoff(
  home: string | null,
  away: string | null,
  winner: string | null
): StandingsMatch {
  return {
    home_member_id: home,
    away_member_id: away,
    status: winner ? "completed" : "upcoming",
    winner_member_id: winner,
    stage: "playoff",
    winner_remaining: null,
  };
}

describe("computeStandings", () => {
  it("sorts by win percentage, then wins, and labels coin-flip ties", () => {
    const matches = [
      completed("a", "b", "a"),
      completed("c", "d", "c"),
      completed("a", "c", "a"),
      completed("b", "d", "b"),
      upcoming("a", "d"),
      upcoming("b", "c"),
    ];

    const standings = computeStandings(members, matches, "head_to_head");

    // b and c are 1-1, never met, same differential (0) and the same
    // strength of schedule (one win against d, one loss to a): coin flip.
    expect(standings.map((s) => s.member.id)).toEqual(["a", "b", "c", "d"]);
    expect(standings.map((s) => s.rankLabel)).toEqual(["1", "T-2", "T-2", "4"]);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 2, 4]);
    expect(standings.map((s) => s.seed)).toEqual([1, 2, 3, 4]);
    expect(standings.map((s) => s.tied)).toEqual([false, true, true, false]);
    expect(standings.map((s) => s.headToHeadApplied)).toEqual([false, false, false, false]);
    expect(standings[0]).toMatchObject({ wins: 2, losses: 0, played: 2, remaining: 1 });
    expect(standings[3]).toMatchObject({ wins: 0, losses: 2, played: 2, remaining: 1 });
    expect(standings[1].strengthOfSchedule).toBe(0.5);
    expect(standings[2].strengthOfSchedule).toBe(0.5);
  });

  it("does not need a tiebreaker when records already differ", () => {
    const matches = [
      completed("a", "b", "a"),
      completed("c", "d", "c"),
      completed("a", "c", "a"),
      completed("b", "d", "b"),
      completed("c", "b", "c"),
      completed("a", "d", "a"),
    ];

    const standings = computeStandings(members, matches, "head_to_head");

    // a 3-0, c 2-1, b 1-2, d 0-3.
    expect(standings.map((s) => s.member.id)).toEqual(["a", "c", "b", "d"]);
    expect(standings.map((s) => s.rankLabel)).toEqual(["1", "2", "3", "4"]);
    expect(standings.every((s) => !s.tied && !s.headToHeadApplied)).toBe(true);
  });

  it("uses the tiebreakers only when percentage and wins are equal", () => {
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
    // a: 3-1, b: 3-1, c: 1-3, d: 1-3; a vs b split 1-1, c vs d split 1-1,
    // no differential, identical schedules: every step ties, coin flip.
    const standings = computeStandings(members, matches, "head_to_head");
    expect(standings.map((s) => s.rankLabel)).toEqual(["T-1", "T-1", "T-3", "T-3"]);
    expect(standings.map((s) => s.member.id)).toEqual(["a", "b", "c", "d"]);
    expect(standings.map((s) => s.seed)).toEqual([1, 2, 3, 4]);
    expect(standings.every((s) => s.tied)).toBe(true);
    expect(standings.every((s) => !s.headToHeadApplied)).toBe(true);
  });

  describe("tiebreaker order", () => {
    // a and b are both 2-1: a beat b, b has the far better differential.
    // c and d are both 1-2 with the same differential: c beat d.
    const matches = [
      completed("a", "b", "a", 1),
      completed("a", "c", "a", 1),
      completed("d", "a", "d", 3),
      completed("b", "c", "b", 6),
      completed("b", "d", "b", 6),
      completed("c", "d", "c", 2),
    ];

    it("head-to-head first: the head-to-head winner ranks higher", () => {
      const standings = computeStandings(members, matches, "head_to_head");
      expect(standings.map((s) => s.member.id)).toEqual(["a", "b", "c", "d"]);
      expect(standings.map((s) => s.differential)).toEqual([-1, 11, -5, -5]);
      expect(standings.map((s) => s.headToHeadApplied)).toEqual([true, true, true, true]);
      expect(standings.every((s) => !s.tied)).toBe(true);
      expect(standings.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
    });

    it("differential first: the differential decides, then head-to-head for the rest", () => {
      const standings = computeStandings(members, matches, "differential");
      expect(standings.map((s) => s.member.id)).toEqual(["b", "a", "c", "d"]);
      // a and b were separated by the differential, so head-to-head never
      // touched their position; c and d needed it after an equal differential.
      expect(standings.map((s) => s.headToHeadApplied)).toEqual([false, false, true, true]);
      expect(standings.every((s) => !s.tied)).toBe(true);
    });

    it("defaults to head-to-head first", () => {
      expect(computeStandings(members, matches).map((s) => s.member.id)).toEqual(
        computeStandings(members, matches, "head_to_head").map((s) => s.member.id)
      );
    });
  });

  it("scores head-to-head as win percentage inside the tied group only", () => {
    // a, b, c are all 2-1 and each beat one of the others (a > b > c > a):
    // .500 apiece inside the group, so the group moves on to the differential.
    const three = members.slice(0, 3);
    const matches = [
      completed("a", "b", "a", 2),
      completed("b", "c", "b", 4),
      completed("c", "a", "c", 6),
      completed("a", "d", "a", 1),
      completed("b", "d", "b", 1),
      completed("c", "d", "c", 1),
    ];
    // Differentials: a = 2 - 6 + 1 = -3, b = 4 - 2 + 1 = 3, c = 6 - 4 + 1 = 3.
    const standings = computeStandings([...three, members[3]], matches, "head_to_head");
    expect(standings.map((s) => s.member.id)).toEqual(["b", "c", "a", "d"]);
    expect(standings.slice(0, 3).map((s) => s.headToHeadApplied)).toEqual([false, false, false]);
    // b and c share a differential and never split on strength of schedule
    // (they faced the same three opponents), so the coin flip separates them.
    expect(standings.map((s) => s.rankLabel)).toEqual(["T-1", "T-1", "3", "4"]);
  });

  it("refines a group head-to-head split into sub-groups with the next tiebreaker", () => {
    // Four 1-1 teams: b beat f, c and f split, a lost inside the group.
    const six = [
      ...members,
      { id: "e", team_name: "Echo" },
      { id: "f", team_name: "Foxtrot" },
    ];
    const matches = [
      completed("c", "a", "c"),
      completed("a", "d", "a"),
      completed("e", "b", "e"),
      completed("b", "f", "b"),
      completed("f", "c", "f"),
      completed("e", "d", "e"),
    ];
    // e 2-0; a, b, c, f 1-1; d 0-2.
    const standings = computeStandings(six, matches, "head_to_head");
    expect(standings.map((s) => s.member.id)).toEqual(["e", "b", "c", "f", "a", "d"]);
    expect(standings.map((s) => s.rankLabel)).toEqual(["1", "2", "T-3", "T-3", "5", "6"]);
    // The head-to-head step split the four; c and f then tied on everything
    // else (same differential, same strength of schedule) and flipped.
    expect(standings.map((s) => s.headToHeadApplied)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("breaks a tie on strength of schedule, the mean of opponents' win percentage", () => {
    const six = [
      ...members,
      { id: "e", team_name: "Echo" },
      { id: "f", team_name: "Foxtrot" },
    ];
    const matches = [
      completed("c", "a", "c"),
      completed("a", "d", "a"),
      completed("e", "b", "e"),
      completed("b", "f", "b"),
      completed("c", "d", "c"),
      completed("e", "f", "e"),
      completed("c", "e", "c"),
    ];
    // c 3-0, e 2-1, a 1-1, b 1-1, d 0-2, f 0-2. a faced c (1.000) and d (0);
    // b faced e (.667) and f (0). d faced a (.500) and c; f faced b and e.
    const standings = computeStandings(six, matches, "head_to_head");
    expect(standings.map((s) => s.member.id)).toEqual(["c", "e", "a", "b", "d", "f"]);
    expect(standings.find((s) => s.member.id === "a")?.strengthOfSchedule).toBe(0.5);
    expect(standings.find((s) => s.member.id === "b")?.strengthOfSchedule).toBe(0.333);
    expect(standings.find((s) => s.member.id === "d")?.strengthOfSchedule).toBe(0.75);
    expect(standings.find((s) => s.member.id === "f")?.strengthOfSchedule).toBe(0.583);
    expect(standings.every((s) => !s.tied && !s.headToHeadApplied)).toBe(true);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("flips the coin on member id, ignoring team names and input order", () => {
    const pair = [
      { id: "z", team_name: "Alpha" },
      { id: "y", team_name: "Zulu" },
    ];
    const matches = [completed("z", "y", "z"), completed("y", "z", "y")];

    const standings = computeStandings(pair, matches, "differential");
    expect(standings.map((s) => s.member.id)).toEqual(["y", "z"]);
    expect(standings.map((s) => s.seed)).toEqual([1, 2]);
    expect(standings.map((s) => s.rank)).toEqual([1, 1]);
    expect(standings.map((s) => s.tied)).toEqual([true, true]);
    expect(standings.map((s) => s.rankLabel)).toEqual(["T-1", "T-1"]);
    expect(computeStandings([...pair].reverse(), matches).map((s) => s.member.id)).toEqual([
      "y",
      "z",
    ]);
  });

  it("gives a larger coin-flip group its own rank after a smaller one", () => {
    // a and b: 3-1, split their two meetings, one win each over c/e and
    // d/f. c, d, e, f: 1-2 in a cycle, each with one loss to the top pair.
    const six = [
      ...members,
      { id: "e", team_name: "Echo" },
      { id: "f", team_name: "Foxtrot" },
    ];
    const matches = [
      completed("a", "b", "a"),
      completed("b", "a", "b"),
      completed("a", "c", "a"),
      completed("a", "e", "a"),
      completed("b", "d", "b"),
      completed("b", "f", "b"),
      completed("c", "d", "c"),
      completed("d", "e", "d"),
      completed("e", "f", "e"),
      completed("f", "c", "f"),
    ];
    const standings = computeStandings(six, matches, "head_to_head");
    expect(standings.map((s) => s.member.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(standings.map((s) => s.rank)).toEqual([1, 1, 3, 3, 3, 3]);
    expect(standings.map((s) => s.seed)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(standings.map((s) => s.rankLabel)).toEqual([
      "T-1",
      "T-1",
      "T-3",
      "T-3",
      "T-3",
      "T-3",
    ]);
    expect(standings.map((s) => s.strengthOfSchedule)).toEqual([
      0.542,
      0.542,
      0.472,
      0.472,
      0.472,
      0.472,
    ]);
  });

  it("sums the differential from the winner's Pokémon left, null counting as 0", () => {
    const matches = [
      completed("a", "b", "a", 4),
      completed("b", "a", "b", null),
      completed("a", "c", "a", 2),
      completed("c", "d", "d", 6),
    ];
    const byId = new Map(
      computeStandings(members, matches, "differential").map((s) => [s.member.id, s])
    );
    expect(byId.get("a")?.differential).toBe(6);
    expect(byId.get("b")?.differential).toBe(-4);
    expect(byId.get("c")?.differential).toBe(-8);
    expect(byId.get("d")?.differential).toBe(6);
  });

  it("ranks a higher win percentage above raw wins", () => {
    const three = [
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
    const standings = computeStandings(three, matches);
    expect(standings.map((s) => s.member.id)).toEqual(["x", "y", "z"]);
    expect(formatWinPercentage(standings[0].winPercentage)).toBe("1.000");
    expect(formatWinPercentage(standings[1].winPercentage)).toBe(".800");
    expect(standings[1].winPercentage).toBe(0.8);
  });

  it("counts only regular-season matches; playoff matches are ignored entirely", () => {
    const matches = [
      completed("a", "b", "a"),
      playoff("b", "a", "b"),
      playoff("a", null, null),
      upcoming("a", "c"),
    ];
    const byId = new Map(computeStandings(members, matches).map((s) => [s.member.id, s]));
    expect(byId.get("a")).toMatchObject({ wins: 1, losses: 0, played: 1, remaining: 1 });
    expect(byId.get("b")).toMatchObject({ wins: 0, losses: 1, played: 1, remaining: 0 });
  });

  it("treats a missing stage as regular", () => {
    const standings = computeStandings(members, [
      {
        home_member_id: "a",
        away_member_id: "b",
        status: "completed",
        winner_member_id: "a",
      },
    ]);
    expect(standings[0]).toMatchObject({ member: { id: "a" }, wins: 1 });
  });

  it("excludes spectators who play in no match and keeps everyone else", () => {
    const roster = [
      { id: "a", team_name: "Alpha", draft_position: 1 },
      { id: "b", team_name: "Bravo", draft_position: 2 },
      { id: "s", team_name: "Spectator", draft_position: null },
      { id: "n", team_name: "Named", draft_position: null },
      { id: "u", team_name: "Unknown position" },
    ];
    const standings = computeStandings(roster, [
      completed("a", "b", "a"),
      upcoming("n", "a"),
    ]);
    expect(standings.map((s) => s.member.id).sort()).toEqual(["a", "b", "n", "u"]);
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
    expect(standings.every((s) => s.rankLabel === "T-1")).toBe(true);
    expect(standings.map((s) => s.seed)).toEqual([1, 2, 3, 4]);
  });

  it("returns no rows for no members", () => {
    expect(computeStandings([], [completed("a", "b", "a")])).toEqual([]);
  });
});

describe("tiebreaker order and formatting helpers", () => {
  it("lists the steps in the league's order, ending with the coin flip", () => {
    expect(tiebreakerSteps("head_to_head")).toEqual([
      "head_to_head",
      "differential",
      "strength_of_schedule",
      "coin_flip",
    ]);
    expect(tiebreakerSteps("differential")).toEqual([
      "differential",
      "head_to_head",
      "strength_of_schedule",
      "coin_flip",
    ]);
  });

  it("writes the standings legend in that order", () => {
    expect(tiebreakerLegend("head_to_head")).toBe(
      "Tiebreakers: head-to-head, then differential, then strength of schedule, then a coin flip"
    );
    expect(tiebreakerLegend("differential")).toBe(
      "Tiebreakers: differential, then head-to-head, then strength of schedule, then a coin flip"
    );
  });

  it("rounds percentages to 3 decimals, half up, like the numeric columns", () => {
    expect(roundPercentage(2 / 3)).toBe(0.667);
    expect(roundPercentage(1 / 3)).toBe(0.333);
    expect(roundPercentage(1 / 16)).toBe(0.063);
    expect(roundPercentage(0.1625)).toBe(0.163);
    expect(roundPercentage(0)).toBe(0);
    expect(roundPercentage(1)).toBe(1);
  });

  it("formats the differential with an explicit sign for gains", () => {
    expect(formatDifferential(3)).toBe("+3");
    expect(formatDifferential(0)).toBe("0");
    expect(formatDifferential(-2)).toBe("-2");
  });
});
