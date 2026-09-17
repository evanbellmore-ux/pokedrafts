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
import {
  DEFAULT_POINTS,
  formatRules,
  makeEntry,
  MAX_POOL_SIZE,
  missingEntries,
  needsPriceChoice,
  parsePoolJson,
  poolRowFor,
  rulesToSave,
  toDraftFormat,
} from "@/app/(app)/builder/poolFormat";
import {
  applyProblems,
  matchCountLabel,
  pointsFor,
} from "@/app/(app)/builder/RuleBuilder";
import { applyRules, defaultRules, parseFormatRules } from "@/app/lib/pokemon/rules";
import { createRpc } from "@/app/lib/rpc";
import { isDraftFormat, isDraftPokemon } from "@/app/types/draft";
import {
  LEAGUE_LIMITS,
  PLAYOFF_FORMATS,
  type League,
  type LeagueMatch,
} from "@/app/types/league";
import type { PokemonEntry, Preset } from "@/app/types/pokemon";

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

/**
 * Pool Builder v2 (docs/release-architecture.md 13.5 and 13.7): the rule
 * card's labels, its live count, the confirm dialog's two choices and how
 * rules travel through the saved format. The card sources are read from
 * disk like the other review suites; the pure helpers are imported.
 */
describe("Pool Builder rule card (docs section 13.7)", () => {
  const builderDir = join(root, "app/(app)/builder");
  const card = readFileSync(join(builderDir, "RuleBuilder.tsx"), "utf8");
  const client = readFileSync(join(builderDir, "BuilderClient.tsx"), "utf8");
  const library = readFileSync(join(builderDir, "FormatLibrary.tsx"), "utf8");

  it("labels the six parts and every control with Field, a legend or a label", () => {
    for (const label of [
      "Start from",
      "Games",
      "Regulation",
      "Filters",
      "Stat total minimum",
      "Stat total maximum",
      "Generation minimum",
      "Generation maximum",
      "Types",
      "Categories",
      "Forms",
      "Result",
      "Price by stat total",
      "Minimum stat total for ${points} points",
      "Reset bands",
      "Apply to pool",
      "Rebuild from rules",
      "Build from rules",
    ]) {
      expect(card, label).toContain(label);
    }
    for (const control of ["<Field", "<NumberInput", "<Select", "<Checkbox", "<Fieldset"]) {
      expect(card, control).toMatch(new RegExp(control));
    }
    // The local checkbox/radio pairs its input with a label through the id.
    expect(card).toMatch(/<input[\s\S]*?id=\{id\}/);
    expect(card).toMatch(/<label htmlFor=\{id\}/);
    // Every Field-wrapped NumberInput has a visible or hidden label.
    expect(card).toMatch(/<Field label=\{`Minimum stat total for \$\{points\} points`\} hideLabel>/);
    // Every checkbox group is a fieldset with a legend.
    expect(card).toMatch(/<fieldset[\s\S]*?<legend/);
  });

  it("announces the live count in a status region", () => {
    expect(card).toMatch(/<p role="status"[^>]*>\s*\{matchCountLabel\(result\.length\)\}/);
    expect(matchCountLabel(312)).toBe("312 Pokémon match");
    expect(matchCountLabel(1)).toBe("1 Pokémon matches");
    expect(matchCountLabel(0)).toBe("0 Pokémon match");
    expect(matchCountLabel(1230)).toBe("1,230 Pokémon match");
  });

  it("confirms Apply with Replace pool and Add missing only, and Rebuild separately", () => {
    expect(card).toContain('title="Apply rules to the pool?"');
    expect(card).toContain('confirmLabel="Replace pool"');
    expect(card).toMatch(/onClick=\{\(\) => finishApply\("add-missing"\)\}[\s\S]*?Add missing only/);
    expect(card).toMatch(/Add missing only keeps the current rows and their prices/);
    expect(card).toContain('title="Rebuild from rules?"');
    expect(card).toContain('confirmLabel="Rebuild pool"');
    // An empty pool applies without asking.
    expect(card).toMatch(/if \(poolSize === 0\) onApply\(result, rules, "replace"\)/);
  });

  it("shows the empty state, the hand-built pill and the mobile disclosure", () => {
    expect(card).toContain('title="The Pokémon dataset has not been loaded yet"');
    expect(card).toContain("This format was built by hand");
    expect(card).toMatch(/aria-expanded=\{expanded\}/);
    // The body is unmounted while collapsed, so the reference goes with it
    // (the MoveResults convention).
    expect(card).toMatch(/aria-controls=\{expanded \? bodyId : undefined\}/);
    expect(card).not.toMatch(/aria-controls=\{bodyId\}/);
    expect(card).toMatch(/useMediaQuery\("\(min-width: 768px\)"\)/);
    // One preview layout at a time, paged at 100 rows like the pool table.
    expect(card).toMatch(/wide \? \(\s*<PreviewTable/);
    expect(card).toMatch(/const PAGE_SIZE = 100;/);
    expect(card).toMatch(/Roster not loaded yet|has not been loaded into this build yet/);
  });

  it("sits above the pool table, saves rules with the format and lists them in the library", () => {
    expect(client.indexOf("<RuleBuilder")).toBeGreaterThan(-1);
    expect(client.indexOf("<RuleBuilder")).toBeLessThan(
      client.indexOf('aria-labelledby="pool-list-heading"')
    );
    expect(client).toMatch(/writeFormat\(savedRules\)/);
    expect(client).toMatch(/toDraftFormat\(trimmedName, entries, rulesToWrite\)/);
    expect(client).toMatch(/rulesToSave\(poolRules, handPriced, priceChoice\)/);
    expect(library).toMatch(/describeRules\(rules, PRESETS\)/);
  });

  it("asks whether to keep manual prices or the bands before Save and Export write (13.5)", () => {
    // Both writers stop at the gate; the dialog's answer resumes them.
    const saveGate = client.indexOf('setPendingWrite("save")');
    const exportGate = client.indexOf('setPendingWrite("export")');
    expect(saveGate).toBeGreaterThan(-1);
    expect(exportGate).toBeGreaterThan(-1);
    expect(client.slice(saveGate - 200, saveGate)).toMatch(
      /if \(needsPriceChoice\(poolRules, handPriced, priceChoice\)\) \{\s*$/
    );
    expect(client.slice(exportGate - 200, exportGate)).toMatch(
      /if \(needsPriceChoice\(poolRules, handPriced, priceChoice\)\) \{\s*$/
    );
    expect(client).toContain('title="Keep the prices you edited?"');
    expect(client).toContain('confirmLabel="Keep manual prices"');
    expect(client).toMatch(/onConfirm=\{\(\) => choosePricing\("manual"\)\}/);
    expect(client).toMatch(/onClick=\{\(\) => choosePricing\("bands"\)\}[\s\S]*?Keep the bands/);
    expect(client).toMatch(/if \(action === "save"\) void writeFormat\(rulesToWrite\);\s*else writeExport\(rulesToWrite\);/);
    // The answer is forgotten whenever the pool is priced afresh.
    expect(client.match(/setPriceChoice\(null\)/g)).toHaveLength(3);
    expect(client).toMatch(/if \(mode === "replace"\) \{\s*setHandPriced\(false\);\s*setPriceChoice\(null\);/);
  });

  /** A dataset row (600 total, generation 1, Champions) with overrides. */
  function datasetEntry(
    id: number,
    slug: string,
    display_name: string,
    overrides: Partial<PokemonEntry> = {}
  ): PokemonEntry {
    return {
      id,
      species_id: id,
      slug,
      display_name,
      species_name: display_name,
      form_kind: "default",
      form_label: null,
      type1: "Normal",
      type2: null,
      hp: 100,
      attack: 100,
      defense: 100,
      special_attack: 100,
      special_defense: 100,
      speed: 100,
      bst: 600,
      generation: 1,
      tags: [],
      games: ["champions"],
      dex_numbers: {},
      sprite_url: null,
      updated_at: null,
      ...overrides,
    };
  }

  it("prices applied rows by bands, or at the default when pricing is manual", () => {
    const entry = datasetEntry(1, "x", "X", { games: [] });
    expect(pointsFor(entry, defaultRules())).toBe(16);
    expect(pointsFor(entry, { ...defaultRules(), pricing: { mode: "manual" } })).toBe(DEFAULT_POINTS);
  });

  it("Add missing only skips rows the pool stores under an older spelling", () => {
    // Every name here resolves to a dataset row the way findDatasetEntry
    // does (display name, slug, or the slug SPECIAL_SLUGS derives), yet
    // none of them shares an entryKey with the dataset's display name, so a
    // key-only check would append the same Pokémon a second time.
    const pool = [
      "Paldean Tauros",
      "Paldean Tauros Blaze",
      "Indeedee-F",
      "Ogerpon Wellspring",
      "Bloodmoon Ursaluna",
      "rotom-wash",
      "Garchomp",
      "",
    ].map((name) => makeEntry(name, 10));
    const result = [
      datasetEntry(10250, "tauros-paldea-combat-breed", "Paldean Tauros (Combat Breed)"),
      datasetEntry(10251, "tauros-paldea-blaze-breed", "Paldean Tauros (Blaze Breed)"),
      datasetEntry(10252, "tauros-paldea-aqua-breed", "Paldean Tauros (Aqua Breed)"),
      datasetEntry(876, "indeedee-male", "Indeedee"),
      datasetEntry(10186, "indeedee-female", "Indeedee (Female)"),
      datasetEntry(10273, "ogerpon-wellspring-mask", "Ogerpon (Wellspring Mask)"),
      datasetEntry(10272, "ursaluna-bloodmoon", "Ursaluna (Bloodmoon)"),
      datasetEntry(10008, "rotom-wash", "Rotom (Wash)"),
      datasetEntry(445, "garchomp", "Garchomp"),
      datasetEntry(128, "tauros", "Tauros"),
    ];
    expect(missingEntries(pool, result).map((entry) => entry.slug)).toEqual([
      "tauros-paldea-aqua-breed",
      "indeedee-male",
      "tauros",
    ]);
    expect(missingEntries([], result)).toEqual(result);
    expect(missingEntries(pool, [])).toEqual([]);
    // The same match tells Add by name which row already stands for a Pokémon.
    expect(poolRowFor(pool, result[1])?.name).toBe("Paldean Tauros Blaze");
    expect(poolRowFor(pool, result[4])?.name).toBe("Indeedee-F");
    expect(poolRowFor(pool, result[3])).toBeNull();
    expect(poolRowFor(pool, result[9])).toBeNull();
    expect(client).toMatch(/const missing = missingEntries\(entries, result\)/);
    expect(client).toMatch(/\? poolRowFor\(entries, row\)/);
  });

  it("refuses to rebuild from rules that select nothing instead of blanking the pool", () => {
    const entries = [datasetEntry(1, "x", "X"), datasetEntry(2, "y", "Y", { games: ["scarlet_violet"] })];
    const rules = defaultRules({ kind: "all" });
    expect(applyProblems(rules, entries)).toEqual([]);
    expect(applyProblems(rules, [])).toEqual(["No Pokémon match these rules in the current dataset."]);

    // A saved source whose game keys are all unknown parses to no games.
    const noGames = parseFormatRules({ ...rules, source: { kind: "games", games: ["pokemon_go"] } })!;
    expect(noGames.source).toEqual({ kind: "games", games: [] });
    expect(applyProblems(noGames, applyRules(entries, [], noGames))).toEqual([
      "Choose at least one game, or start from All Pokémon.",
    ]);

    // An impossible filter is reported as the rules' problem, not as an empty result.
    const inverted = { ...rules, filters: { ...rules.filters, bst: { min: 600, max: 500 } } };
    expect(applyRules(entries, [], inverted)).toEqual([]);
    expect(applyProblems(inverted, [])).toEqual(["Stat total minimum cannot be above the maximum."]);

    // A roster preset that has not been filled yet (13.9) selects nothing.
    const emptyRoster: Preset = {
      key: "champions-m-z",
      game: "champions",
      name: "Regulation Set M-Z",
      starts: "2026-12-02",
      ends: null,
      source: "https://example.test/m-z",
      rule: { kind: "roster", slugs: [] },
    };
    const withPreset = { ...defaultRules(), preset: emptyRoster.key };
    expect(applyRules(entries, [emptyRoster], withPreset)).toEqual([]);
    expect(applyProblems(withPreset, [])).toHaveLength(1);

    const huge = Array.from({ length: MAX_POOL_SIZE + 1 }, (_, i) => datasetEntry(i + 1, `p${i}`, `P ${i}`));
    expect(applyProblems(rules, huge)).toEqual([
      `A draft pool can hold at most ${MAX_POOL_SIZE.toLocaleString("en-US")} Pokémon; these rules select ${(MAX_POOL_SIZE + 1).toLocaleString("en-US")}.`,
    ]);

    // Apply and Rebuild share the gate; a blocked rebuild's dialog has no
    // confirm button, and the confirm path checks once more.
    expect(card).toMatch(/const canApply =\s*!disabled && entries !== null && applyProblems\(rules, result\)\.length === 0;/);
    expect(card).toMatch(/problems: applyProblems\(savedRules, rebuilt\)/);
    expect(card).toMatch(/onConfirm=\{rebuildBlocked \? undefined : finishRebuild\}/);
    expect(card).toMatch(/if \(!savedRules \|\| !rebuild \|\| rebuild\.problems\.length > 0\) return;/);
    expect(card).toMatch(/onApply\(rebuild\.result, savedRules, "replace"\)/);
    expect(card).toMatch(/\{rebuild\.problems\.map\(\(problem\) => \(/);
  });
});

describe("draft format JSON with rules (docs section 13.5)", () => {
  const entries = [makeEntry("Garchomp", 16), makeEntry("Rotom (Wash)", 9)];

  it("writes rules only when the pool was built from them", () => {
    const byHand = toDraftFormat("Hand", entries);
    expect("rules" in byHand).toBe(false);
    expect(byHand).toEqual({
      version: "1.0",
      leagueName: "Hand",
      pokemon: [
        { name: "Garchomp", points: 16, tier: 5 },
        { name: "Rotom (Wash)", points: 9, tier: 12 },
      ],
    });

    const rules = defaultRules({ kind: "games", games: ["scarlet_violet"] });
    const built = toDraftFormat("Built", entries, rules);
    expect(built.rules).toEqual(rules);
    expect(isDraftFormat(built)).toBe(true);
    expect(isDraftFormat(byHand)).toBe(true);
  });

  it("reads rules back from a saved format and reports none for a hand-built one", () => {
    const rules = { ...defaultRules(), preset: "sv-reg-h", pricing: { mode: "manual" as const } };
    const parsed = parsePoolJson({ version: "1.0", leagueName: "Built", pokemon: [{ name: "Garchomp", points: 16 }], rules });
    expect(parsed.rules).toEqual(rules);
    expect(parsed.entries).toHaveLength(1);

    expect(parsePoolJson({ pokemon: [{ name: "Garchomp", points: 16 }] }).rules).toBeNull();
    expect(parsePoolJson({ pokemon: [], rules: { preset: "sv-reg-h" } }).rules).toBeNull();
    expect(formatRules({ rules })).toEqual(rules);
    expect(formatRules(null)).toBeNull();
  });

  it("switches to manual pricing only when a price was edited and the coach chose to keep it", () => {
    const bands = defaultRules();
    const manual = { ...defaultRules(), pricing: { mode: "manual" as const } };

    expect(rulesToSave(null, true, "manual")).toBeNull();
    expect(rulesToSave(bands, false, null)).toBe(bands);
    // An edited price alone changes nothing until the coach answers.
    expect(rulesToSave(bands, true, null)).toBe(bands);
    expect(rulesToSave(bands, true, "bands")).toBe(bands);
    expect(rulesToSave(bands, true, "manual")).toEqual({ ...bands, pricing: { mode: "manual" } });
    expect(bands.pricing.mode).toBe("bands");
    expect(rulesToSave(manual, true, "bands")).toBe(manual);
    expect(rulesToSave(manual, true, null)).toBe(manual);

    expect(needsPriceChoice(bands, true, null)).toBe(true);
    expect(needsPriceChoice(bands, false, null)).toBe(false);
    expect(needsPriceChoice(bands, true, "bands")).toBe(false);
    expect(needsPriceChoice(bands, true, "manual")).toBe(false);
    expect(needsPriceChoice(manual, true, null)).toBe(false);
    expect(needsPriceChoice(null, true, null)).toBe(false);
  });

  it("keeps the type guards strict about entries and blind to unknown keys", () => {
    expect(isDraftPokemon({ name: "Garchomp", points: 16, tier: 5, extra: 1 })).toBe(true);
    expect(isDraftPokemon({ name: " ", points: 16, tier: 5 })).toBe(false);
    expect(isDraftPokemon({ name: "Garchomp", points: "16", tier: 5 })).toBe(false);
    expect(isDraftPokemon({ name: "Garchomp", points: 16 })).toBe(false);
    expect(isDraftPokemon(null)).toBe(false);

    expect(
      isDraftFormat({ version: "1.0", leagueName: "x", pokemon: [], rules: "whatever", other: true })
    ).toBe(true);
    expect(isDraftFormat({ version: "1.0", leagueName: "x", pokemon: [{ name: "" }] })).toBe(false);
    expect(isDraftFormat({ version: "1.0", pokemon: [] })).toBe(false);
    expect(isDraftFormat([])).toBe(false);
  });
});
