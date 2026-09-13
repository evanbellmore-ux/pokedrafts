import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  groupRounds,
  isCompleted,
  isResultsExistError,
  isStaleBracketError,
  LATER_ROUND_DECIDED_CODE,
  MATCH_NOT_READY_CODE,
  matchLabel,
  memberTeamName,
  participants,
  PLAYOFFS_STARTED_CODE,
  RESULTS_EXIST_CODE,
  resultErrorHint,
  toScheduleFormat,
} from "@/app/(app)/leagues/[leagueId]/matches/helpers";
import {
  buildSettingsPatch,
  groupFormatOptions,
  membersKey,
  playingCoachCount,
  playoffFormatOptions,
  positionedMembers,
  settingsValuesFromLeague,
  shuffle,
  spectatorMembers,
  timerLabel,
  type SettingsMember,
} from "@/app/(app)/leagues/[leagueId]/settings/helpers";
import { createRpc } from "@/app/lib/rpc";
import {
  LEAGUE_LIMITS,
  PLAYOFF_FORMATS,
  type League,
  type LeagueMatch,
} from "@/app/types/league";

/**
 * Pure helpers behind the Matches and Settings pages. The pages themselves
 * are driven by `useLeague()` and the RPC wrappers; what can go wrong on the
 * client side is the grouping, the payload building and the error matching
 * covered here.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function match(overrides: Partial<LeagueMatch>): LeagueMatch {
  return {
    id: "x",
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

function league(overrides: Partial<League> = {}): League {
  return {
    id: "L",
    name: "Kanto Cup",
    commissioner_id: "u1",
    max_coaches: 8,
    created_at: null,
    draft_format_id: null,
    point_budget: 100,
    draft_started: false,
    current_pick_number: 1,
    picks_per_team: 10,
    draft_completed: false,
    pick_timer_seconds: 120,
    pick_started_at: null,
    auto_pick_in_progress: false,
    custom_pool: null,
    schedule_format: "round_robin",
    free_agent_swap_limit: 3,
    tiebreaker: "head_to_head",
    playoff_format: "top_4",
    champion_member_id: null,
    ...overrides,
  };
}

function member(
  overrides: Partial<SettingsMember> & { id: string }
): SettingsMember {
  return {
    user_id: `user-${overrides.id}`,
    team_name: null,
    role: "coach",
    draft_position: null,
    joined_at: null,
    ...overrides,
  };
}

describe("matches helpers", () => {
  it("groups matches by round in order and finds the bye of an odd-sized round", () => {
    const rounds = groupRounds([
      match({ id: "r2m1", round_number: 2, home_member_id: "c", away_member_id: "a" }),
      match({ id: "r1m1", round_number: 1, home_member_id: "a", away_member_id: "b" }),
      match({ id: "r3m1", round_number: 3, home_member_id: "b", away_member_id: "c" }),
    ]);

    expect(rounds.map((round) => round.roundNumber)).toEqual([1, 2, 3]);
    expect(rounds.map((round) => round.byeMemberIds)).toEqual([["c"], ["b"], ["a"]]);
    expect(rounds[0].matches.map((entry) => entry.id)).toEqual(["r1m1"]);
  });

  it("orders matches within a round by match number and reports no bye for even rounds", () => {
    const rounds = groupRounds([
      match({ id: "m2", match_number: 2, home_member_id: "c", away_member_id: "d" }),
      match({ id: "m1", match_number: 1, home_member_id: "a", away_member_id: "b" }),
    ]);

    expect(rounds).toHaveLength(1);
    expect(rounds[0].matches.map((entry) => entry.id)).toEqual(["m1", "m2"]);
    expect(rounds[0].byeMemberIds).toEqual([]);
  });

  it("returns no rounds for an empty schedule", () => {
    expect(groupRounds([])).toEqual([]);
  });

  it("leaves playoff matches to the bracket and never counts an empty slot as a bye", () => {
    const rounds = groupRounds([
      match({ id: "r1m1", round_number: 1, home_member_id: "a", away_member_id: "b" }),
      match({ id: "sf", round_number: 2, stage: "playoff", home_member_id: "a", away_member_id: null }),
    ]);
    expect(rounds.map((round) => round.roundNumber)).toEqual([1]);
    expect(rounds[0].byeMemberIds).toEqual([]);
  });

  it("labels regular matches by round and playoff matches by name", () => {
    const all = [
      match({ id: "r3", round_number: 3 }),
      match({ id: "sf1", round_number: 4, match_number: 1, stage: "playoff" }),
      match({ id: "sf2", round_number: 4, match_number: 2, stage: "playoff" }),
      match({ id: "f", round_number: 5, match_number: 1, stage: "playoff" }),
    ];
    expect(matchLabel(all[0], all)).toBe("Round 3");
    expect(matchLabel(all[2], all)).toBe("Semifinal 2");
    expect(matchLabel(all[3], all)).toBe("Final");
  });

  it("only offers result actions on a match with both sides decided", () => {
    expect(participants(match({ id: "x" }))).toEqual({ home: "a", away: "b" });
    expect(participants(match({ id: "y", away_member_id: null }))).toBeNull();
  });

  it("adds a next step for the playoff refusal codes and reloads on them", () => {
    expect(resultErrorHint(PLAYOFFS_STARTED_CODE)).toMatch(/clear the bracket/);
    expect(resultErrorHint(LATER_ROUND_DECIDED_CODE)).toMatch(/next round/);
    expect(resultErrorHint(MATCH_NOT_READY_CODE)).toMatch(/both coaches/i);
    expect(resultErrorHint("invalid_winner")).toBeNull();
    expect(resultErrorHint(null)).toBeNull();
    expect(isStaleBracketError(PLAYOFFS_STARTED_CODE)).toBe(true);
    expect(isStaleBracketError(LATER_ROUND_DECIDED_CODE)).toBe(true);
    expect(isStaleBracketError(MATCH_NOT_READY_CODE)).toBe(true);
    expect(isStaleBracketError("invalid_score")).toBe(false);
    expect(isStaleBracketError(null)).toBe(false);
  });

  it("treats only `completed` (any casing) as a final", () => {
    expect(isCompleted({ status: "completed" })).toBe(true);
    expect(isCompleted({ status: " Completed " })).toBe(true);
    expect(isCompleted({ status: "upcoming" })).toBe(false);
    expect(isCompleted({ status: "" })).toBe(false);
  });

  it("labels teams by member id with an unnamed and an unknown fallback", () => {
    const members = [
      { id: "a", team_name: "Pallet Rockets" },
      { id: "b", team_name: "   " },
    ];
    expect(memberTeamName(members, "a")).toBe("Pallet Rockets");
    expect(memberTeamName(members, "b")).toBe("Unnamed team");
    expect(memberTeamName(members, "zzz")).toBe("Unknown team");
    expect(memberTeamName(members, null)).toBe("Unknown team");
  });

  it("opens the Discard dialog on the results_exist code the migration raises", async () => {
    const migration = readFileSync(
      join(root, "supabase/migrations/20260909120000_release_hardening.sql"),
      "utf8"
    );
    const raised = migration.match(/_fail\('([^']+)',\s*'(results_exist)'\)/);
    expect(raised, "generate_schedule raises results_exist with a message").not.toBeNull();
    expect(raised![2]).toBe(RESULTS_EXIST_CODE);

    // The card sees the raise the way PostgREST reports it: the detail code
    // travels as `code` on the RPC result, so the sentence is never matched.
    const failWith = (details: string, message = raised![1]) =>
      createRpc({
        rpc: async () => ({ data: null, error: { code: "P0001", message, details } }),
      } as unknown as SupabaseClient).generateSchedule("league-1", "round_robin", false);

    expect(isResultsExistError(await failWith(RESULTS_EXIST_CODE))).toBe(true);
    // Any other raise keeps its message on screen, whatever its wording.
    expect(
      isResultsExistError(
        await failWith("draft_not_completed", "Results exist only once the draft has finished.")
      )
    ).toBe(false);
    expect(isResultsExistError({ code: "P0001" })).toBe(false);
    expect(isResultsExistError({ code: null })).toBe(false);
  });

  it("falls back to round robin for unknown schedule formats", () => {
    expect(toScheduleFormat("double_round_robin")).toBe("double_round_robin");
    expect(toScheduleFormat("round_robin")).toBe("round_robin");
    expect(toScheduleFormat("nonsense")).toBe("round_robin");
  });
});

describe("settings payload (update_league_settings sends only changed keys)", () => {
  const saved = settingsValuesFromLeague(league({ draft_format_id: "f1" }));

  it("mirrors the league row, with an empty string for no format", () => {
    expect(settingsValuesFromLeague(league())).toEqual({
      name: "Kanto Cup",
      maxCoaches: 8,
      pointBudget: 100,
      picksPerTeam: 10,
      pickTimerSeconds: 120,
      freeAgentSwapLimit: 3,
      scheduleFormat: "round_robin",
      draftFormatId: "",
      playoffFormat: "top_4",
      tiebreaker: "head_to_head",
    });
    expect(
      settingsValuesFromLeague(
        league({ playoff_format: "bogus" as League["playoff_format"], tiebreaker: "differential" })
      )
    ).toMatchObject({ playoffFormat: "none", tiebreaker: "differential" });
  });

  it("produces an empty patch when nothing changed", () => {
    expect(buildSettingsPatch(saved, saved, 4)).toEqual({ patch: {}, errors: {} });
  });

  it("sends only the changed keys, trims the name and maps None to null", () => {
    const { patch, errors } = buildSettingsPatch(
      saved,
      { ...saved, name: "  Johto League  ", pickTimerSeconds: 90, draftFormatId: "" },
      4
    );
    expect(errors).toEqual({});
    expect(patch).toEqual({
      name: "Johto League",
      pick_timer_seconds: 90,
      draft_format_id: null,
    });
  });

  it("does not send a name that only differs by surrounding whitespace", () => {
    const { patch } = buildSettingsPatch(saved, { ...saved, name: "  Kanto Cup " }, 4);
    expect(patch).toEqual({});
  });

  it("clamps integers into the documented ranges before sending", () => {
    const { patch, errors } = buildSettingsPatch(
      saved,
      { ...saved, pickTimerSeconds: 5, pointBudget: 999999, freeAgentSwapLimit: -2 },
      4
    );
    expect(errors).toEqual({});
    expect(patch).toEqual({
      pick_timer_seconds: LEAGUE_LIMITS.pickTimerSeconds.min,
      point_budget: LEAGUE_LIMITS.pointBudget.max,
      free_agent_swap_limit: LEAGUE_LIMITS.freeAgentSwapLimit.min,
    });
  });

  it("rejects an empty number field and a coach limit below the member count", () => {
    const { patch, errors } = buildSettingsPatch(
      saved,
      { ...saved, maxCoaches: 3, picksPerTeam: null },
      4
    );
    expect(patch).toEqual({});
    expect(errors.maxCoaches).toMatch(/already has 4 coaches/);
    expect(errors.picksPerTeam).toMatch(/whole number/);
  });

  it("rejects an empty or overlong name", () => {
    expect(buildSettingsPatch(saved, { ...saved, name: "   " }, 4).errors.name).toBeTruthy();
    expect(
      buildSettingsPatch(
        saved,
        { ...saved, name: "x".repeat(LEAGUE_LIMITS.name.max + 1) },
        4
      ).errors.name
    ).toBeTruthy();
  });

  it("sends a changed schedule format and draft format id", () => {
    const { patch } = buildSettingsPatch(
      saved,
      { ...saved, scheduleFormat: "double_round_robin", draftFormatId: "f2" },
      4
    );
    expect(patch).toEqual({
      schedule_format: "double_round_robin",
      draft_format_id: "f2",
    });
  });

  it("sends a changed playoff format and tiebreaker (section 12.5 keys)", () => {
    const { patch } = buildSettingsPatch(
      saved,
      { ...saved, playoffFormat: "none", tiebreaker: "differential" },
      4
    );
    expect(patch).toEqual({ playoff_format: "none", tiebreaker: "differential" });
    expect(buildSettingsPatch(saved, { ...saved, playoffFormat: "top_4" }, 4).patch).toEqual({});
  });
});

describe("playoff format choices (section 12.6)", () => {
  it("disables formats that need more coaches than play, naming the count", () => {
    const options = playoffFormatOptions(PLAYOFF_FORMATS, 5, "none");
    expect(options.map((option) => [option.value, option.disabled, option.needs])).toEqual([
      ["none", false, 0],
      ["top_2", false, 2],
      ["top_4", false, 4],
      ["top_6", true, 6],
      ["top_8", true, 8],
    ]);
  });

  it("always keeps the league's saved format selectable", () => {
    const options = playoffFormatOptions(PLAYOFF_FORMATS, 3, "top_8");
    expect(options.find((option) => option.value === "top_8")?.disabled).toBe(false);
    expect(options.find((option) => option.value === "top_4")?.disabled).toBe(true);
  });

  it("offers every format before the draft, when the function accepts any", () => {
    const options = playoffFormatOptions(PLAYOFF_FORMATS, null, "none");
    expect(options.every((option) => !option.disabled)).toBe(true);
    expect(options.map((option) => option.needs)).toEqual([0, 2, 4, 6, 8]);
  });

  it("counts the draft order as the coaches who play, or everyone before it is set", () => {
    expect(
      playingCoachCount([
        { draft_position: 1 },
        { draft_position: 2 },
        { draft_position: null },
      ])
    ).toBe(2);
    expect(playingCoachCount([{ draft_position: null }, { draft_position: null }])).toBe(2);
    expect(playingCoachCount([])).toBe(0);
  });
});

describe("draft format choices (_visible_format rule)", () => {
  const formats = [
    { id: "own", name: "Mine", created_by: "u1" },
    { id: "shared", name: "Shared", created_by: null },
    { id: "theirs", name: "Theirs", created_by: "u9" },
    { id: "other-league", name: "Another league's", created_by: "u8" },
  ];

  it("offers own and shared formats and leaves other people's out", () => {
    const groups = groupFormatOptions(formats, "u1", null);
    expect(groups.own.map((format) => format.id)).toEqual(["own"]);
    expect(groups.shared.map((format) => format.id)).toEqual(["shared"]);
    expect(groups.current).toBeNull();
    expect(groups.currentMissing).toBe(false);
  });

  it("keeps the league's current format selectable when a previous commissioner owns it", () => {
    const groups = groupFormatOptions(formats, "u1", "theirs");
    expect(groups.current?.id).toBe("theirs");
    expect(groups.own.map((format) => format.id)).toEqual(["own"]);
    expect(groups.currentMissing).toBe(false);
  });

  it("does not duplicate a current format that is already own or shared", () => {
    expect(groupFormatOptions(formats, "u1", "own").current).toBeNull();
    expect(groupFormatOptions(formats, "u1", "shared").current).toBeNull();
  });

  it("flags a current format that is not in the visible list", () => {
    const groups = groupFormatOptions(formats, "u1", "gone");
    expect(groups.current).toBeNull();
    expect(groups.currentMissing).toBe(true);
  });
});

describe("draft order helpers", () => {
  const members = [
    member({ id: "m3", team_name: "Zubat Zone", draft_position: 3 }),
    member({ id: "m1", team_name: "Pallet Rockets", draft_position: 1, role: "commissioner" }),
    member({ id: "m4", team_name: "beta watchers" }),
    member({ id: "m2", team_name: "Cerulean Waves", draft_position: 2 }),
    member({ id: "m5", team_name: "Alpha Fans" }),
  ];

  it("lists drafting coaches by position and spectators by name", () => {
    expect(positionedMembers(members).map((entry) => entry.id)).toEqual(["m1", "m2", "m3"]);
    expect(spectatorMembers(members).map((entry) => entry.id)).toEqual(["m5", "m4"]);
  });

  it("builds a members key that ignores array identity but not content", () => {
    const copy = members.map((entry) => ({ ...entry }));
    expect(membersKey(copy)).toBe(membersKey(members));

    const renamed = members.map((entry) =>
      entry.id === "m2" ? { ...entry, team_name: "Cerulean Tide" } : entry
    );
    expect(membersKey(renamed)).not.toBe(membersKey(members));

    const swapped = members.map((entry) => {
      if (entry.id === "m1") return { ...entry, draft_position: 2 };
      if (entry.id === "m2") return { ...entry, draft_position: 1 };
      return entry;
    });
    expect(membersKey(swapped)).not.toBe(membersKey(members));
  });

  describe("shuffle", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns a permutation without touching the input", () => {
      const input = [1, 2, 3, 4, 5, 6];
      const output = shuffle(input);
      expect(input).toEqual([1, 2, 3, 4, 5, 6]);
      expect([...output].sort((a, b) => a - b)).toEqual(input);
    });

    it("is Fisher-Yates: one draw per position from the end", () => {
      let draws = 0;
      vi.spyOn(Math, "random").mockImplementation(() => {
        draws += 1;
        return 0;
      });
      const output = shuffle(["a", "b", "c", "d"]);
      // j is always 0, so the passes swap (3,0), (2,0) and (1,0):
      // [d,b,c,a] -> [c,b,d,a] -> [b,c,d,a]. A sort-based shuffle or a
      // draw-from-the-front loop would not land here with three draws.
      expect(output).toEqual(["b", "c", "d", "a"]);
      expect(draws).toBe(3);
    });
  });
});

describe("timer label", () => {
  it("formats seconds, whole minutes and mixed values", () => {
    expect(timerLabel(45)).toBe("45 s");
    expect(timerLabel(120)).toBe("2 min");
    expect(timerLabel(90)).toBe("1 min 30 s");
  });
});
