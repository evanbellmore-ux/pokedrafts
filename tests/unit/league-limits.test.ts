import { describe, expect, it } from "vitest";
import {
  CREATE_LEAGUE_DEFAULTS,
  buildCreateLeagueInput,
  clampToRange,
  isPlayoffFormat,
  isTiebreaker,
  parseClampedInt,
} from "@/app/lib/league/limits";
import { LEAGUE_LIMITS } from "@/app/types/league";

describe("clampToRange", () => {
  const range = { min: 2, max: 24 };

  it("keeps in-range integers and truncates fractions", () => {
    expect(clampToRange(8, range, 8)).toBe(8);
    expect(clampToRange(7.9, range, 8)).toBe(7);
    expect(clampToRange(2, range, 8)).toBe(2);
    expect(clampToRange(24, range, 8)).toBe(24);
  });

  it("clamps out-of-range values to the nearest bound", () => {
    expect(clampToRange(1, range, 8)).toBe(2);
    expect(clampToRange(0, range, 8)).toBe(2);
    expect(clampToRange(-5, range, 8)).toBe(2);
    expect(clampToRange(25, range, 8)).toBe(24);
    expect(clampToRange(1e9, range, 8)).toBe(24);
  });

  it("uses the fallback for null, undefined, NaN and Infinity", () => {
    expect(clampToRange(null, range, 8)).toBe(8);
    expect(clampToRange(undefined, range, 8)).toBe(8);
    expect(clampToRange(Number.NaN, range, 8)).toBe(8);
    expect(clampToRange(Number.POSITIVE_INFINITY, range, 8)).toBe(8);
    // Even the fallback is clamped.
    expect(clampToRange(null, range, 100)).toBe(24);
  });
});

describe("parseClampedInt", () => {
  const range = LEAGUE_LIMITS.pickTimerSeconds;

  it("parses strings with Number.parseInt semantics", () => {
    expect(parseClampedInt("90", range, 120)).toBe(90);
    expect(parseClampedInt(" 45 ", range, 120)).toBe(45);
    expect(parseClampedInt("60.7", range, 120)).toBe(60);
  });

  it("rejects NaN and clamps", () => {
    expect(parseClampedInt("", range, 120)).toBe(120);
    expect(parseClampedInt("abc", range, 120)).toBe(120);
    expect(parseClampedInt(null, range, 120)).toBe(120);
    expect(parseClampedInt(undefined, range, 120)).toBe(120);
    expect(parseClampedInt("5", range, 120)).toBe(range.min);
    expect(parseClampedInt("99999", range, 120)).toBe(range.max);
    expect(parseClampedInt(3, range, 120)).toBe(range.min);
  });
});

describe("buildCreateLeagueInput", () => {
  const valid = {
    name: "  Kanto Cup ",
    teamName: " Rocket ",
    maxCoaches: 8,
    draftFormatId: "",
  };

  it("trims text, nulls an empty format and applies the defaults", () => {
    const result = buildCreateLeagueInput(valid);
    expect(result.error).toBeNull();
    expect(result.input).toEqual({
      name: "Kanto Cup",
      teamName: "Rocket",
      maxCoaches: 8,
      draftFormatId: null,
      pointBudget: CREATE_LEAGUE_DEFAULTS.pointBudget,
      picksPerTeam: CREATE_LEAGUE_DEFAULTS.picksPerTeam,
      pickTimerSeconds: CREATE_LEAGUE_DEFAULTS.pickTimerSeconds,
      playoffFormat: "top_4",
      tiebreaker: "head_to_head",
    });
  });

  it("keeps a chosen playoff format and refuses an unknown one (section 12.6)", () => {
    expect(buildCreateLeagueInput({ ...valid, playoffFormat: "top_8" }).input).toMatchObject({
      playoffFormat: "top_8",
      tiebreaker: CREATE_LEAGUE_DEFAULTS.tiebreaker,
    });
    expect(buildCreateLeagueInput({ ...valid, playoffFormat: " none " }).input).toMatchObject({
      playoffFormat: "none",
    });
    expect(buildCreateLeagueInput({ ...valid, playoffFormat: "" }).input).toMatchObject({
      playoffFormat: CREATE_LEAGUE_DEFAULTS.playoffFormat,
    });
    expect(buildCreateLeagueInput({ ...valid, playoffFormat: null }).input).toMatchObject({
      playoffFormat: CREATE_LEAGUE_DEFAULTS.playoffFormat,
    });
    expect(buildCreateLeagueInput({ ...valid, playoffFormat: "top_3" })).toEqual({
      input: null,
      error: "Choose a playoff format.",
    });
    expect(isPlayoffFormat("top_6")).toBe(true);
    expect(isPlayoffFormat("TOP_6")).toBe(false);
    expect(isTiebreaker("differential")).toBe(true);
    expect(isTiebreaker("coin_flip")).toBe(false);
  });

  it("keeps a chosen draft format id", () => {
    const result = buildCreateLeagueInput({
      ...valid,
      draftFormatId: " 8f3c9c1e-1111-4222-8333-444455556666 ",
    });
    expect(result.input?.draftFormatId).toBe(
      "8f3c9c1e-1111-4222-8333-444455556666"
    );
  });

  it("clamps every number to the section 4 ranges", () => {
    const result = buildCreateLeagueInput({
      ...valid,
      maxCoaches: "99",
      pointBudget: 0,
      picksPerTeam: "31",
      pickTimerSeconds: "1",
    });
    expect(result.input).toMatchObject({
      maxCoaches: LEAGUE_LIMITS.maxCoaches.max,
      pointBudget: LEAGUE_LIMITS.pointBudget.min,
      picksPerTeam: LEAGUE_LIMITS.picksPerTeam.max,
      pickTimerSeconds: LEAGUE_LIMITS.pickTimerSeconds.min,
    });
  });

  it("falls back to defaults for empty or non-numeric fields", () => {
    const result = buildCreateLeagueInput({
      ...valid,
      maxCoaches: "",
      pointBudget: null,
      picksPerTeam: "x",
    });
    expect(result.input).toMatchObject({
      maxCoaches: CREATE_LEAGUE_DEFAULTS.maxCoaches,
      pointBudget: CREATE_LEAGUE_DEFAULTS.pointBudget,
      picksPerTeam: CREATE_LEAGUE_DEFAULTS.picksPerTeam,
    });
  });

  it("returns user-facing errors for missing or over-long names", () => {
    expect(buildCreateLeagueInput({ ...valid, name: "   " })).toEqual({
      input: null,
      error: "Enter a league name.",
    });
    expect(buildCreateLeagueInput({ ...valid, teamName: "" })).toEqual({
      input: null,
      error: "Enter a team name.",
    });
    expect(
      buildCreateLeagueInput({
        ...valid,
        name: "n".repeat(LEAGUE_LIMITS.name.max + 1),
      }).error
    ).toMatch(/at most 60 characters/);
    expect(
      buildCreateLeagueInput({
        ...valid,
        teamName: "t".repeat(LEAGUE_LIMITS.teamName.max + 1),
      }).error
    ).toMatch(/at most 40 characters/);
    expect(
      buildCreateLeagueInput({
        ...valid,
        name: "n".repeat(LEAGUE_LIMITS.name.max),
      }).error
    ).toBeNull();
  });
});
