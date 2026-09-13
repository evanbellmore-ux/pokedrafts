import { describe, expect, it } from "vitest";
import { computeStandings, type StandingsMatch } from "@/app/lib/league/standings";

/**
 * Review findings for `computeStandings` against docs/schema.md ("Standings
 * and playoffs"): percentages (win, head-to-head, strength of schedule) are
 * compared rounded to 3 decimals, the precision `league_standings` returns
 * (`round(x, 3)` in `_league_standings`), so two coaches whose strength of
 * schedule differs only beyond the third decimal are separated by the coin
 * flip and share a rank.
 */

function completed(home: string, away: string, winner: string): StandingsMatch {
  return {
    home_member_id: home,
    away_member_id: away,
    status: "completed",
    winner_member_id: winner,
    stage: "regular",
    winner_remaining: null,
  };
}

/** `count` filler coaches that only ever play `coach`, winning `wins` of them. */
function fillerGames(
  coach: string,
  wins: number,
  losses: number,
  matches: StandingsMatch[],
  fillers: { id: string; team_name: string }[]
) {
  for (let i = 0; i < wins + losses; i += 1) {
    const filler = { id: `z-${coach}-${i}`, team_name: `Filler ${coach} ${i}` };
    fillers.push(filler);
    matches.push(completed(coach, filler.id, i < wins ? coach : filler.id));
  }
}

describe("computeStandings applies head-to-head inside the group still tied when it is reached", () => {
  // a, b, c are all 2-1 in a cycle (a beat b, b beat c, c beat a); a and b
  // carry a differential of +5, c of 0.
  const members = [
    { id: "a", team_name: "Alpha" },
    { id: "b", team_name: "Bravo" },
    { id: "c", team_name: "Charlie" },
    { id: "f1", team_name: "Filler 1" },
    { id: "f2", team_name: "Filler 2" },
    { id: "f3", team_name: "Filler 3" },
  ];
  const matches: StandingsMatch[] = [
    { ...completed("a", "b", "a"), winner_remaining: 3 },
    { ...completed("b", "c", "b"), winner_remaining: 3 },
    { ...completed("c", "a", "c"), winner_remaining: 3 },
    { ...completed("a", "f1", "a"), winner_remaining: 5 },
    { ...completed("b", "f2", "b"), winner_remaining: 5 },
    completed("c", "f3", "c"),
  ];

  it("differential first: head-to-head is scored between a and b only, so a beat b", () => {
    const standings = computeStandings(members, matches, "differential");
    expect(standings.slice(0, 3).map((s) => s.member.id)).toEqual(["a", "b", "c"]);
    expect(standings.slice(0, 3).map((s) => s.differential)).toEqual([5, 5, 0]);
    expect(standings.slice(0, 3).map((s) => s.headToHeadApplied)).toEqual([true, true, false]);
    expect(standings.slice(0, 3).map((s) => s.tied)).toEqual([false, false, false]);
    expect(standings.slice(0, 3).map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it("head-to-head first: the cycle is .500 apiece, the differential drops c, a and b flip", () => {
    const standings = computeStandings(members, matches, "head_to_head");
    expect(standings.slice(0, 3).map((s) => s.member.id)).toEqual(["a", "b", "c"]);
    expect(standings.slice(0, 3).map((s) => s.headToHeadApplied)).toEqual([false, false, false]);
    expect(standings.slice(0, 3).map((s) => s.rankLabel)).toEqual(["T-1", "T-1", "3"]);
    expect(standings.slice(0, 2).map((s) => s.strengthOfSchedule)).toEqual([0.444, 0.444]);
  });
});

describe("computeStandings compares strength of schedule at 3 decimals (docs/schema.md)", () => {
  it("leaves two coaches whose schedules differ only in the fourth decimal to the coin flip", () => {
    const fillers: { id: string; team_name: string }[] = [];
    const matches: StandingsMatch[] = [];

    // a and b are both 1-1 and never met; no winner_remaining anywhere, so
    // head-to-head (0 each) and differential (0 each) do not separate them.
    // a beat x and lost to y; b beat z and lost to w.
    matches.push(completed("a", "x", "a"));
    matches.push(completed("y", "a", "y"));
    matches.push(completed("b", "z", "b"));
    matches.push(completed("w", "b", "w"));

    // Opponents' records: x 3-2 (.600), y 3-5 (.375), z 5-1 (.833), w 1-6 (.143).
    fillerGames("x", 3, 1, matches, fillers);
    fillerGames("y", 2, 5, matches, fillers);
    fillerGames("z", 5, 0, matches, fillers);
    fillerGames("w", 0, 6, matches, fillers);

    const members = [
      { id: "a", team_name: "Alpha" },
      { id: "b", team_name: "Bravo" },
      { id: "x", team_name: "X" },
      { id: "y", team_name: "Y" },
      { id: "z", team_name: "Z" },
      { id: "w", team_name: "W" },
      ...fillers,
    ];

    const standings = computeStandings(members, matches, "head_to_head");
    const a = standings.find((s) => s.member.id === "a")!;
    const b = standings.find((s) => s.member.id === "b")!;

    // a: (3/5 + 3/8) / 2 = 0.4875; b: (5/6 + 1/7) / 2 = 0.488095...; both
    // are 0.488 at the precision the function compares and reports.
    expect(a.strengthOfSchedule).toBe(0.488);
    expect(b.strengthOfSchedule).toBe(0.488);
    expect(a.wins).toBe(1);
    expect(b.wins).toBe(1);
    expect(a.differential).toBe(0);
    expect(b.differential).toBe(0);

    // docs/schema.md: equal at 3 decimals, so the coin flip (member id
    // ascending) orders a before b and they share a rank.
    expect(a.seed).toBeLessThan(b.seed);
    expect(a.rank).toBe(b.rank);
    expect(a.tied).toBe(true);
    expect(b.tied).toBe(true);
  });
});
