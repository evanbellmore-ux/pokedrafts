import { describe, expect, it } from "vitest";
import {
  bracketRounds,
  eliminationMatch,
  eliminationRoundName,
  feederOf,
  isInBracket,
  isPlayable,
  nextPlayoffMatchFor,
  playoffMatchLabel,
  playoffMatches,
  playoffResultsExist,
  playoffSize,
  regularMatches,
  regularSeasonComplete,
  slotInfo,
  slotLabel,
  toPlayoffFormat,
  toTiebreaker,
} from "@/app/lib/league/bracket";
import {
  playoffFormatLabel,
  playoffMatchName,
  playoffRoundName,
  tiebreakerLabel,
} from "@/app/lib/league/labels";
import type { LeagueMatch } from "@/app/types/league";

/**
 * The bracket helpers read the rows `_generate_playoffs` writes
 * (docs/release-architecture.md section 12.4). The fixture is the `top_6`
 * shape: two quarterfinals, semifinals where seeds 1 and 2 wait for the
 * quarterfinal winners, and the final.
 */

function match(overrides: Partial<LeagueMatch> & { id: string }): LeagueMatch {
  return {
    league_id: "L",
    round_number: 1,
    match_number: 1,
    home_member_id: "a",
    away_member_id: "b",
    status: "upcoming",
    winner_member_id: null,
    scheduled_at: null,
    created_at: "",
    stage: "regular",
    winner_remaining: null,
    home_seed: null,
    away_seed: null,
    feeds_match_id: null,
    feeds_slot: null,
    ...overrides,
  };
}

const members = [
  { id: "m1", team_name: "Team One" },
  { id: "m2", team_name: "Team Two" },
  { id: "m3", team_name: "Team Three" },
  { id: "m4", team_name: "Team Four" },
  { id: "m5", team_name: "Team Five" },
  { id: "m6", team_name: "Team Six" },
  { id: "m7", team_name: null },
];

const regular = [
  match({ id: "r1", round_number: 1, home_member_id: "m1", away_member_id: "m2", status: "completed", winner_member_id: "m1" }),
  match({ id: "r2", round_number: 2, home_member_id: "m3", away_member_id: "m4", status: "completed", winner_member_id: "m3" }),
];

/** Seeds 4 v 5 and 3 v 6 in the quarterfinals; 1 and 2 have a bye. */
const top6 = [
  match({ id: "qf1", stage: "playoff", round_number: 3, match_number: 1, home_member_id: "m4", away_member_id: "m5", home_seed: 4, away_seed: 5, feeds_match_id: "sf1", feeds_slot: "away" }),
  match({ id: "qf2", stage: "playoff", round_number: 3, match_number: 2, home_member_id: "m3", away_member_id: "m6", home_seed: 3, away_seed: 6, feeds_match_id: "sf2", feeds_slot: "away" }),
  match({ id: "sf1", stage: "playoff", round_number: 4, match_number: 1, home_member_id: "m1", away_member_id: null, home_seed: 1, feeds_match_id: "final", feeds_slot: "home" }),
  match({ id: "sf2", stage: "playoff", round_number: 4, match_number: 2, home_member_id: "m2", away_member_id: null, home_seed: 2, feeds_match_id: "final", feeds_slot: "away" }),
  match({ id: "final", stage: "playoff", round_number: 5, match_number: 1, home_member_id: null, away_member_id: null }),
];

/** The same bracket after seed 5 upset seed 4 in the first quarterfinal. */
const afterQf1 = top6.map((entry) => {
  if (entry.id === "qf1") {
    return { ...entry, status: "completed", winner_member_id: "m5", winner_remaining: 2 };
  }
  if (entry.id === "sf1") return { ...entry, away_member_id: "m5", away_seed: 5 };
  return entry;
});

const all = [...regular, ...top6];

describe("bracketRounds", () => {
  it("groups playoff matches into named rounds from the first round to the final", () => {
    const rounds = bracketRounds([...top6].reverse().concat(regular));
    expect(rounds.map((round) => round.name)).toEqual([
      "Quarterfinals",
      "Semifinals",
      "Final",
    ]);
    expect(rounds.map((round) => round.roundNumber)).toEqual([3, 4, 5]);
    expect(rounds.map((round) => round.matches.map((entry) => entry.id))).toEqual([
      ["qf1", "qf2"],
      ["sf1", "sf2"],
      ["final"],
    ]);
  });

  it("lists the top seeds' byes in the round they sit out", () => {
    const rounds = bracketRounds(all);
    expect(rounds[0].byes).toEqual([
      { memberId: "m1", seed: 1 },
      { memberId: "m2", seed: 2 },
    ]);
    expect(rounds[1].byes).toEqual([]);
    expect(rounds[2].byes).toEqual([]);
  });

  it("does not call a filled semifinal slot a bye once the quarterfinal decided it", () => {
    const rounds = bracketRounds([...regular, ...afterQf1]);
    expect(rounds[0].byes.map((bye) => bye.memberId)).toEqual(["m1", "m2"]);
  });

  it("names a lone final and returns nothing without playoff matches", () => {
    const top2 = [
      match({ id: "f", stage: "playoff", round_number: 3, home_member_id: "m1", away_member_id: "m2", home_seed: 1, away_seed: 2 }),
    ];
    expect(bracketRounds(top2).map((round) => round.name)).toEqual(["Final"]);
    expect(bracketRounds(regular)).toEqual([]);
  });
});

describe("round and match names (section 12.1)", () => {
  it("names rounds by their distance from the final", () => {
    expect(playoffRoundName(1)).toBe("Final");
    expect(playoffRoundName(2)).toBe("Semifinals");
    expect(playoffRoundName(4)).toBe("Quarterfinals");
    expect(playoffRoundName(8)).toBe("Round of 16");
    expect(playoffRoundName(0)).toBe("Round of 2");
  });

  it("names one match inside a round", () => {
    expect(playoffMatchName(1, 1)).toBe("Final");
    expect(playoffMatchName(2, 2)).toBe("Semifinal 2");
    expect(playoffMatchName(4, 3)).toBe("Quarterfinal 3");
    expect(playoffMatchName(8, 3)).toBe("Round of 16, match 3");
  });

  it("labels a match from its round's size in the league's matches", () => {
    expect(playoffMatchLabel(top6[0], all)).toBe("Quarterfinal 1");
    expect(playoffMatchLabel(top6[3], all)).toBe("Semifinal 2");
    expect(playoffMatchLabel(top6[4], all)).toBe("Final");
  });
});

describe("slot labels (section 12.6)", () => {
  it("shows the seed and team for a decided slot", () => {
    expect(slotLabel(top6[2], "home", all, members)).toBe("Seed 1 · Team One");
    expect(slotLabel(top6[0], "home", all, members)).toBe("Seed 4 · Team Four");
    expect(slotLabel(top6[0], "away", all, members)).toBe("Seed 5 · Team Five");
  });

  it("derives 'Winner of ...' from the match that feeds the empty slot", () => {
    expect(slotLabel(top6[2], "away", all, members)).toBe("Winner of Quarterfinal 1");
    expect(slotLabel(top6[3], "away", all, members)).toBe("Winner of Quarterfinal 2");
    expect(slotLabel(top6[4], "home", all, members)).toBe("Winner of Semifinal 1");
    expect(slotLabel(top6[4], "away", all, members)).toBe("Winner of Semifinal 2");
  });

  it("shows the advancing coach once the feeding match is decided", () => {
    const sf1 = afterQf1.find((entry) => entry.id === "sf1")!;
    expect(slotLabel(sf1, "away", afterQf1, members)).toBe("Seed 5 · Team Five");
    expect(slotInfo(sf1, "away", afterQf1)).toEqual({
      kind: "member",
      memberId: "m5",
      seed: 5,
    });
  });

  it("falls back to 'Bye' for an empty slot nothing feeds, and labels unnamed teams", () => {
    const orphan = match({ id: "x", stage: "playoff", home_member_id: "m7", away_member_id: null, home_seed: 2 });
    expect(slotLabel(orphan, "away", [orphan], members)).toBe("Bye");
    expect(slotInfo(orphan, "away", [orphan])).toEqual({ kind: "bye" });
    expect(slotLabel(orphan, "home", [orphan], members)).toBe("Seed 2 · Unnamed team");
    const unknown = match({ id: "y", stage: "playoff", home_member_id: "gone", away_member_id: "m1" });
    expect(slotLabel(unknown, "home", [unknown], members)).toBe("Unknown team");
  });

  it("finds the feeder of a slot", () => {
    expect(feederOf(top6[2], "away", all)?.id).toBe("qf1");
    expect(feederOf(top6[2], "home", all)).toBeNull();
  });
});

describe("bracket state helpers", () => {
  it("splits regular and playoff matches and knows when a match is playable", () => {
    expect(regularMatches(all).map((entry) => entry.id)).toEqual(["r1", "r2"]);
    expect(playoffMatches(all).map((entry) => entry.id)).toEqual(["qf1", "qf2", "sf1", "sf2", "final"]);
    expect(isPlayable(top6[0])).toBe(true);
    expect(isPlayable(top6[2])).toBe(false);
    expect(isPlayable(top6[4])).toBe(false);
  });

  it("reports playoff results and regular-season completeness", () => {
    expect(playoffResultsExist(all)).toBe(false);
    expect(playoffResultsExist([...regular, ...afterQf1])).toBe(true);
    expect(regularSeasonComplete(all)).toBe(true);
    expect(regularSeasonComplete([match({ id: "open" }), ...top6])).toBe(false);
    expect(regularSeasonComplete(top6)).toBe(false);
  });

  it("finds the round a coach went out in, or null while alive", () => {
    const bracket = [...regular, ...afterQf1];
    expect(eliminationMatch(bracket, "m4")?.id).toBe("qf1");
    expect(eliminationRoundName(bracket, "m4")).toBe("Quarterfinals");
    expect(eliminationRoundName(bracket, "m5")).toBeNull();
    expect(eliminationRoundName(bracket, "m1")).toBeNull();
    expect(eliminationRoundName(bracket, "m7")).toBeNull();
  });

  it("finds a coach's next playoff match, playable or waiting", () => {
    const bracket = [...regular, ...afterQf1];
    expect(nextPlayoffMatchFor(bracket, "m1")?.id).toBe("sf1");
    expect(nextPlayoffMatchFor(bracket, "m5")?.id).toBe("sf1");
    expect(nextPlayoffMatchFor(bracket, "m4")).toBeNull();
    expect(nextPlayoffMatchFor(bracket, "m3")?.id).toBe("qf2");
    expect(isInBracket(bracket, "m7")).toBe(false);
    expect(isInBracket(bracket, "m6")).toBe(true);
  });
});

describe("formats and labels", () => {
  it("knows how many coaches each format takes", () => {
    expect(playoffSize("none")).toBe(0);
    expect(playoffSize("top_2")).toBe(2);
    expect(playoffSize("top_4")).toBe(4);
    expect(playoffSize("top_6")).toBe(6);
    expect(playoffSize("top_8")).toBe(8);
    expect(playoffSize("top_16")).toBe(0);
    expect(playoffSize(null)).toBe(0);
  });

  it("normalises raw column values", () => {
    expect(toPlayoffFormat("top_6")).toBe("top_6");
    expect(toPlayoffFormat("nonsense")).toBe("none");
    expect(toPlayoffFormat(undefined)).toBe("none");
    expect(toTiebreaker("differential")).toBe("differential");
    expect(toTiebreaker("head_to_head")).toBe("head_to_head");
    expect(toTiebreaker(null)).toBe("head_to_head");
  });

  it("labels the settings values as section 12.6 spells them", () => {
    expect(playoffFormatLabel("none")).toBe("No playoffs");
    expect(playoffFormatLabel("top_2")).toBe("Top 2 (final only)");
    expect(playoffFormatLabel("top_4")).toBe("Top 4");
    expect(playoffFormatLabel("top_6")).toBe("Top 6 (top 2 seeds get a bye)");
    expect(playoffFormatLabel("top_8")).toBe("Top 8");
    expect(playoffFormatLabel("bogus")).toBe("No playoffs");
    expect(tiebreakerLabel("head_to_head")).toBe("Head-to-head first");
    expect(tiebreakerLabel("differential")).toBe("Differential first");
    expect(tiebreakerLabel(null)).toBe("Head-to-head first");
  });
});
