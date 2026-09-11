// Round-4 review probes (correctness and concurrency lens) after the pool-copy
// change: a league's pool is always leagues.custom_pool and a chosen format is
// copied onto it by create_league / update_league_settings / reset_league_pool.
// Each title says whether it pins a defect or confirms a behaviour.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  buildLeague,
  connect,
  count,
  createUser,
  expectRpcError,
  inviteCodeFor,
  leagueRow,
  matchesFor,
  memberFor,
  newsFor,
  rpcAs,
  samplePool,
  teamFor,
  type Client,
} from "./harness";

type PickResult = { pick_number: number; draft_completed: boolean; pokemon_name?: string; skipped?: boolean };
type PoolEntryRow = { name: string; points: number; tier: number };

async function formatOwnedBy(db: Client, userId: string, pokemon: unknown[]): Promise<string> {
  const { rows } = await asUser(db, userId, (c) =>
    c.query<{ id: string }>("insert into public.draft_formats (name, json) values ('R4', $1) returning id", [
      JSON.stringify({ version: "1.0", leagueName: "R4", pokemon }),
    ]),
  );
  return rows[0].id;
}

describe("review round 4: correctness and concurrency", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  it("FIXED: a format copied by create_league goes through update_league_pool's validation (points 0 / 25, mismatched tier are refused), so the reserve rule can never price empty slots at 0", async () => {
    const commissioner = await createUser(db);
    const rigged = [
      { name: "Ten", points: 10, tier: 11 },
      { name: "Nine", points: 9, tier: 12 },
      { name: "Eight", points: 8, tier: 13 },
      { name: "Zero", points: 0 }, // rejected by update_league_pool (1..20)
      { name: "Twenty Five", points: 25 }, // rejected by update_league_pool (1..20)
      { name: "Seven", points: 7, tier: 3 }, // rejected by update_league_pool (tier must be 21 - points)
    ];
    const formatId = await formatOwnedBy(db, commissioner, rigged);
    const args = { p_name: "Rigged", p_team_name: "Commish", p_max_coaches: 3, p_draft_format_id: formatId, p_point_budget: 10, p_picks_per_team: 2 };

    // The same verdict update_league_pool gives, naming the first offending
    // entry and the format; nothing is inserted.
    const error = await expectRpcError(rpcAs(db, commissioner, "create_league", args), "invalid_points");
    expect(error.message).toBe('The draft format "R4" cannot be used as a pool: "Zero" needs integer points between 1 and 20.');
    expect(await count(db, "leagues", "commissioner_id = $1", [commissioner])).toBe(0);
    expect(await count(db, "league_members", "user_id = $1", [commissioner])).toBe(0);

    // Each remaining rule in turn, until the list is clean and the copy is taken.
    const fix = (pokemon: unknown[]) =>
      asUser(db, commissioner, (c) => c.query("update public.draft_formats set json = $1 where id = $2", [JSON.stringify({ pokemon }), formatId]));
    await fix(rigged.filter((p) => p.name !== "Zero"));
    expect((await expectRpcError(rpcAs(db, commissioner, "create_league", args), "invalid_points")).message).toContain('"Twenty Five" needs integer points');
    await fix(rigged.filter((p) => p.name !== "Zero" && p.name !== "Twenty Five"));
    expect((await expectRpcError(rpcAs(db, commissioner, "create_league", args), "invalid_tier")).message).toContain('"Seven" has a tier that does not match');
    await fix([...rigged.slice(0, 3), { name: "Seven", points: 7 }]);
    const leagueId = await rpcAs<string>(db, commissioner, "create_league", args);
    const { rows: pool } = await db.query<PoolEntryRow>("select name, points, tier from public._league_pool($1) order by name", [leagueId]);
    expect(pool).toEqual([
      { name: "Eight", points: 8, tier: 13 },
      { name: "Nine", points: 9, tier: 12 },
      { name: "Seven", points: 7, tier: 14 },
      { name: "Ten", points: 10, tier: 11 },
    ]);

    // With a floor price of 7 the cheapest full roster (2 * 7) no longer fits
    // the budget of 10, so start_draft refuses instead of letting the reserve
    // rule run on a 0-point floor.
    const coachUser = await createUser(db);
    await rpcAs(db, coachUser, "join_league", { p_code: await inviteCodeFor(db, leagueId), p_team_name: "Coach" });
    const commishMember = await memberFor(db, leagueId, commissioner);
    const coachMember = await memberFor(db, leagueId, coachUser);
    await rpcAs(db, commissioner, "set_draft_order", { p_league_id: leagueId, p_member_ids: [commishMember.id, coachMember.id] });
    await expectRpcError(rpcAs(db, commissioner, "start_draft", { p_league_id: leagueId }), "budget_too_small");
  });

  it("FIXED: update_league_settings (format change) and reset_league_pool take the same validated copy, and refuse an edit that breaks the rules without touching the pool", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 10 });
    const commissioner = league.commissioner.userId;
    const formatId = await formatOwnedBy(db, commissioner, [{ name: "Zero", points: 0 }, { name: "Big", points: 999999 }]);
    const settings = (p_settings: Record<string, unknown>) =>
      rpcAs<Record<string, unknown>>(db, commissioner, "update_league_settings", { p_league_id: league.leagueId, p_settings });
    const fix = (pokemon: unknown[]) =>
      asUser(db, commissioner, (c) => c.query("update public.draft_formats set json = $1 where id = $2", [JSON.stringify({ pokemon }), formatId]));

    const before = await leagueRow(db, league.leagueId);
    await expectRpcError(settings({ draft_format_id: formatId }), "invalid_points");
    const after = await leagueRow(db, league.leagueId);
    expect(after.custom_pool).toEqual(before.custom_pool);
    expect(after.draft_format_id).toBeNull();

    // The owner fixes the format: the change goes through and the copy is
    // normalized (string points, tier filled in, the format's order kept).
    await fix([{ name: "One", points: "1" }, { name: "Two", points: 2, tier: 19 }, { name: "Three", points: 3 }, { name: "Four", points: 4 }]);
    const changed = await settings({ draft_format_id: formatId });
    expect(changed.draft_format_id).toBe(formatId);
    expect((changed.custom_pool as { pokemon: unknown[] }).pokemon).toEqual([
      { name: "One", points: 1, tier: 20 },
      { name: "Two", points: 2, tier: 19 },
      { name: "Three", points: 3, tier: 18 },
      { name: "Four", points: 4, tier: 17 },
    ]);

    // Later edits that break the rules ("000" points, a duplicate name) are
    // refused by reset_league_pool; the copy stays as it was.
    await fix([{ name: "Zero", points: "000" }, { name: "Also Zero", points: 1 }]);
    await expectRpcError(rpcAs(db, commissioner, "reset_league_pool", { p_league_id: league.leagueId }), "invalid_points");
    await fix([{ name: "One", points: 1 }, { name: " one ", points: 2 }]);
    await expectRpcError(rpcAs(db, commissioner, "reset_league_pool", { p_league_id: league.leagueId }), "duplicate_pokemon");
    const { rows } = await db.query<PoolEntryRow>("select name, points, tier from public._league_pool($1) order by points", [league.leagueId]);
    expect(rows.map((r) => r.name)).toEqual(["One", "Two", "Three", "Four"]);
    // 4 entries = 2 coaches * 2 picks and a floor price of 1: the draft can start from the copy.
    await rpcAs(db, commissioner, "start_draft", { p_league_id: league.leagueId });
    // Once a valid edit is made the copy is taken again on request (after a reset of the draft).
    await rpcAs(db, commissioner, "reset_draft", { p_league_id: league.leagueId });
    await fix([{ name: "Five", points: 5 }, { name: "Six", points: 6 }, { name: "Seven", points: 7 }, { name: "Eight", points: 8 }]);
    await rpcAs(db, commissioner, "reset_league_pool", { p_league_id: league.leagueId });
    const { rows: again } = await db.query<PoolEntryRow>("select name from public._league_pool($1) order by points", [league.leagueId]);
    expect(again.map((r) => r.name)).toEqual(["Five", "Six", "Seven", "Eight"]);
  });

  it("CONFIRMED: the same coach double-submitting a swap with one swap left: exactly one succeeds, the other reports no_swaps_left", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    const [a, b] = league.order;
    await rpcAs(db, a.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { free_agent_swap_limit: 1 } });
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon002" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon003" });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon004" });
    const connA = await connect();
    const connB = await connect();
    try {
      const results = await Promise.allSettled([
        rpcAs(connA, b.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: "Mon002", p_add_name: "Mon005" }),
        rpcAs(connB, b.userId, "swap_free_agent", { p_league_id: league.leagueId, p_drop_name: "Mon003", p_add_name: "Mon006" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0].reason as { detail?: string }).detail).toBe("no_swaps_left");
    } finally {
      await connA.end();
      await connB.end();
    }
    const member = await memberFor(db, league.leagueId, b.userId);
    expect(member.free_agent_swaps_used).toBe(1);
    const team = await teamFor(db, league.leagueId, b.memberId);
    expect(team.pokemon).toHaveLength(2);
    expect(team.total_points).toBe(team.pokemon.reduce((sum, p) => sum + p.points, 0));
    expect(await count(db, "league_news", "league_id = $1 and news_type = 'free_agent'", [league.leagueId])).toBe(1);
  });

  it("BUG (legacy recovery): finalize_draft on a completed league without drafted_teams regenerates the schedule, discarding reported results and orphaning their news", async () => {
    // A pre-release league whose old client failed at saveFinalTeams but still
    // wrote matches and reported results: draft_completed = true, no
    // drafted_teams rows, completed matches. The wrapper's guard is
    // `draft_completed and exists drafted_teams`, so it runs _finalize_draft,
    // which always deletes and reinserts league_matches.
    const league = await buildLeague(db, { coaches: 2, picksPerTeam: 1, pool: samplePool(6) });
    const [a, b, c] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon001" });
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon002" });
    await rpcAs(db, c.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon003" });
    const matches = await matchesFor(db, league.leagueId);
    expect(matches).toHaveLength(3);
    await rpcAs(db, a.userId, "report_match_result", { p_match_id: matches[0].id, p_winner_member_id: matches[0].home_member_id });
    expect((await newsFor(db, league.leagueId, "match_result"))).toHaveLength(1);

    await db.query("delete from public.drafted_teams where league_id = $1", [league.leagueId]);
    await rpcAs(db, a.userId, "finalize_draft", { p_league_id: league.leagueId });

    expect(await count(db, "drafted_teams", "league_id = $1", [league.leagueId])).toBe(3);
    const after = await matchesFor(db, league.leagueId);
    expect(after.map((m) => m.status)).toEqual(["upcoming", "upcoming", "upcoming"]);
    expect(after.map((m) => m.id)).not.toContain(matches[0].id);
    // The result's news row survives, pointing at a match id that no longer exists.
    const orphan = await newsFor(db, league.leagueId, "match_result");
    expect(orphan).toHaveLength(1);
    expect(orphan[0].metadata.match_id).toBe(matches[0].id);
    await expectRpcError(rpcAs(db, a.userId, "clear_match_result", { p_match_id: matches[0].id }), "match_not_found");
  });

  it("CONFIRMED: undo_last_pick after a mid-draft skip reopens the highest made pick, not the skipped turn (no duplicate numbers)", async () => {
    // 2 coaches x 3 picks, budget 12, min price 1. Turns: A1 B2 B3 A4 A5 B6.
    // A: Nine A (3 left), B: Nine B (3 left), B: One (2 left). Turn 4 (A, 3
    // left, 1 slot after): Three needs 3 - 3 >= 1 -> no; Fives do not fit ->
    // skipped, current becomes 5 with picks 1..3 made.
    const pool = [
      { name: "Nine A", points: 9, tier: 12 },
      { name: "Nine B", points: 9, tier: 12 },
      { name: "One", points: 1, tier: 20 },
      { name: "Three", points: 3, tier: 18 },
      { name: "Five A", points: 5, tier: 16 },
      { name: "Five B", points: 5, tier: 16 },
      { name: "Five C", points: 5, tier: 16 },
    ];
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 3, pointBudget: 12, pool });
    const [a, b] = league.order;
    await rpcAs(db, a.userId, "start_draft", { p_league_id: league.leagueId });
    await rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine A" }); // 1
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Nine B" }); // 2
    await rpcAs(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "One" }); // 3
    await expectRpcError(rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Three" }), "over_budget");
    const skipped = await rpcAs<PickResult>(db, a.userId, "force_pick", { p_league_id: league.leagueId, p_pokemon_name: null });
    expect(skipped).toMatchObject({ skipped: true, draft_completed: false, pick_number: 4 });
    expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(5);

    // Undo reopens pick 3 (B's One), not the skipped turn 4.
    const undone = await rpcAs<{ pick_number: number; pokemon_name: string }>(db, a.userId, "undo_last_pick", { p_league_id: league.leagueId });
    expect(undone).toEqual({ pick_number: 3, pokemon_name: "One" });
    expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(3);
    await expectRpcError(rpcAs(db, a.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "One" }), "not_your_turn");
    const again = await rpcAs<PickResult>(db, b.userId, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "One" });
    expect(again.pick_number).toBe(3);
    const { rows: numbers } = await db.query<{ pick_number: number }>("select pick_number from public.draft_picks where league_id = $1 order by pick_number", [league.leagueId]);
    expect(numbers.map((r) => r.pick_number)).toEqual([1, 2, 3]);
    expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(4);
  });

  it("CONFIRMED: update_league_settings on a started draft accepts the echoed unchanged values and refuses only real changes to locked fields", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    const formatId = await formatOwnedBy(db, league.commissioner.userId, [{ name: "A", points: 5, tier: 16 }]);
    await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
    const before = await leagueRow(db, league.leagueId);
    const echo = {
      name: before.name,
      max_coaches: before.max_coaches,
      point_budget: before.point_budget,
      picks_per_team: before.picks_per_team,
      pick_timer_seconds: 45,
      free_agent_swap_limit: 7,
      schedule_format: "double_round_robin",
      draft_format_id: before.draft_format_id,
    };
    const updated = await rpcAs<Record<string, unknown>>(db, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: echo });
    expect(updated).toMatchObject({ pick_timer_seconds: 45, free_agent_swap_limit: 7, schedule_format: "double_round_robin" });
    for (const [key, value] of [
      ["max_coaches", Number(before.max_coaches) + 1],
      ["point_budget", Number(before.point_budget) + 1],
      ["picks_per_team", Number(before.picks_per_team) + 1],
      ["draft_format_id", formatId],
    ] as const) {
      await expectRpcError(
        rpcAs(db, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { ...echo, [key]: value } }),
        "locked_during_draft",
      );
    }
    // The pool copy is untouched by the echo (custom_pool set by buildLeague).
    const row = await leagueRow(db, league.leagueId);
    expect((row.custom_pool as { pokemon: unknown[] }).pokemon).toHaveLength(8);
  });

  it("CONFIRMED: every detail code raised by the migration is snake_case and the codes named in the architecture contract all exist", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20260909120000_release_hardening.sql", "utf8");
    const codes = new Set<string>();
    for (const match of sql.matchAll(/_fail\((?:'(?:[^']|'')*'|format\([^)]*\)),\s*'([a-z_]+)'\)/g)) {
      codes.add(match[1]);
    }
    expect(codes.size).toBeGreaterThan(40);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
    const documented = [
      "not_authenticated", "not_commissioner", "not_a_member", "invite_invalid", "draft_already_started", "league_full",
      "locked_during_draft", "draft_not_started", "draft_completed", "draft_paused", "not_your_turn", "pokemon_not_in_pool",
      "pokemon_already_drafted", "over_budget", "no_swaps_left", "pokemon_owned", "not_on_roster", "roster_full", "results_exist",
    ];
    for (const code of documented) {
      expect(codes.has(code), code).toBe(true);
    }
    // No raise exception outside _fail (warnings/notices in the DO blocks are fine).
    const raises = [...sql.matchAll(/raise exception/g)];
    expect(raises).toHaveLength(1);
  });
});
