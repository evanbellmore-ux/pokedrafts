// Round-1 review probes for the playoffs migration (security, correctness and
// concurrency lens): cross-league ids, grants, two commissioners racing on the
// last regular result, a report racing clear_playoffs, hand-checked ties
// inside ties, and the comparison precision of the two standings
// implementations. Each title says whether it pins a defect or confirms a
// behaviour.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeStandings } from "../../app/lib/league/standings";
import {
  asAnon,
  asUser,
  buildLeague,
  connect,
  count,
  expectRpcError,
  expectSqlState,
  leagueRow,
  newsFor,
  rpc,
  rpcAs,
  runFullDraft,
  samplePool,
  type Client,
  type LeagueFixture,
} from "./harness";
import { PLAYOFFS_MIGRATION, applyMigration, readMigrations } from "./migrations-lib";

type MatchRow = {
  id: string;
  round_number: number;
  match_number: number;
  stage: string;
  home_member_id: string | null;
  away_member_id: string | null;
  status: string;
  winner_member_id: string | null;
  home_seed: number | null;
  away_seed: number | null;
  feeds_match_id: string | null;
  feeds_slot: string | null;
};

type StandingRow = {
  member_id: string;
  seed: number;
  rank: number;
  tied: boolean;
  wins: number;
  losses: number;
  played: number;
  remaining: number;
  win_pct: number;
  differential: number;
  strength_of_schedule: number;
  head_to_head_applied: boolean;
};

async function allMatches(client: Client, leagueId: string): Promise<MatchRow[]> {
  const { rows } = await client.query<MatchRow>(
    `select id, round_number, match_number, stage, home_member_id, away_member_id, status, winner_member_id,
            home_seed, away_seed, feeds_match_id, feeds_slot
     from public.league_matches where league_id = $1 order by round_number, match_number`,
    [leagueId],
  );
  return rows;
}

const regularOf = (matches: MatchRow[]) => matches.filter((m) => m.stage === "regular");
const playoffOf = (matches: MatchRow[]) => matches.filter((m) => m.stage === "playoff");

async function standingsAs(client: Client, userId: string, leagueId: string): Promise<StandingRow[]> {
  return asUser(client, userId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>("select * from public.league_standings(p_league_id => $1)", [leagueId]);
    return rows.map((row) => ({
      member_id: String(row.member_id),
      seed: Number(row.seed),
      rank: Number(row.rank),
      tied: Boolean(row.tied),
      wins: Number(row.wins),
      losses: Number(row.losses),
      played: Number(row.played),
      remaining: Number(row.remaining),
      win_pct: Number(row.win_pct),
      differential: Number(row.differential),
      strength_of_schedule: Number(row.strength_of_schedule),
      head_to_head_applied: Boolean(row.head_to_head_applied),
    }));
  });
}

async function seasonLeague(client: Client, teams: number, playoffFormat: "none" | "top_2" | "top_4" | "top_6" | "top_8"): Promise<LeagueFixture> {
  const league = await buildLeague(client, { coaches: teams - 1, picksPerTeam: 1, pool: samplePool(teams * 2), playoffFormat });
  await runFullDraft(client, league);
  return league;
}

function report(client: Client, league: LeagueFixture, matchId: string, winner: string | null, remaining: number | null = null): Promise<unknown> {
  return rpcAs(client, league.commissioner.userId, "report_match_result", { p_match_id: matchId, p_winner_member_id: winner, p_winner_remaining: remaining });
}

async function reportRegularSeason(client: Client, league: LeagueFixture, except?: string): Promise<void> {
  for (const match of regularOf(await allMatches(client, league.leagueId))) {
    if (match.status !== "completed" && match.id !== except) {
      await report(client, league, match.id, match.home_member_id);
    }
  }
}

function settings(client: Client, league: LeagueFixture, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  return rpcAs<Record<string, unknown>>(client, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: values });
}

// Writes regular results straight to the tables (the standings function does
// not care about the schedule's shape): [winner, loser, winner_remaining].
async function writeResults(client: Client, leagueId: string, results: Array<[string, string, number | null]>): Promise<void> {
  await client.query(
    `insert into public.league_matches (league_id, round_number, match_number, stage, home_member_id, away_member_id, status, winner_member_id, winner_remaining)
     select $1, r.round, 1, 'regular', r.winner, r.loser, 'completed', r.winner, r.remaining
     from jsonb_to_recordset($2::jsonb) as r(round integer, winner uuid, loser uuid, remaining integer)`,
    [leagueId, JSON.stringify(results.map(([winner, loser, remaining], index) => ({ round: index + 1, winner, loser, remaining })))],
  );
}

type OracleMember = { id: string; team_name: string; draft_position: number | null };

async function oracleInputs(client: Client, leagueId: string): Promise<{ members: OracleMember[]; matches: Array<Record<string, unknown>> }> {
  const members = await client.query<OracleMember>("select id, team_name, draft_position from public.league_members where league_id = $1", [leagueId]);
  const matches = await client.query<Record<string, unknown>>(
    "select home_member_id, away_member_id, status, winner_member_id, stage, winner_remaining from public.league_matches where league_id = $1",
    [leagueId],
  );
  return { members: members.rows, matches: matches.rows };
}

// Opens a transaction as `userId` on `client`, runs `fn`, and returns a commit
// callback so a test can hold the league lock while another connection waits.
async function holdTransaction<T>(client: Client, userId: string, fn: (c: Client) => Promise<T>): Promise<{ result: T; commit: () => Promise<void> }> {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await client.query("set local role authenticated");
  const result = await fn(client);
  return {
    result,
    commit: async () => {
      await client.query("commit");
    },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const INTERNAL_HELPERS = [
  "_playoff_size",
  "_round_name",
  "_bracket_rows",
  "_league_standings",
  "_regular_season_complete",
  "_playoffs_started",
  "_last_regular_round",
  "_delete_playoffs",
  "_crown_top_seed",
  "_generate_playoffs",
];

const API_FUNCTIONS = [
  "league_standings",
  "create_league",
  "update_league_settings",
  "generate_playoffs",
  "clear_playoffs",
  "report_match_result",
  "clear_match_result",
  "generate_schedule",
  "reset_draft",
];

describe("review round 1: playoffs migration", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  it("CONFIRMED: another league's match, league or bracket is refused for a commissioner of a different league and for a coach of the same league", async () => {
    const mine = await seasonLeague(db, 4, "top_4");
    const theirs = await seasonLeague(db, 4, "top_4");
    await reportRegularSeason(db, theirs);
    const theirBracket = playoffOf(await allMatches(db, theirs.leagueId));
    expect(theirBracket).toHaveLength(3);
    const [theirRegular] = regularOf(await allMatches(db, theirs.leagueId));
    const [theirSemi] = theirBracket;
    const attacker = mine.commissioner.userId;

    await expectRpcError(rpcAs(db, attacker, "report_match_result", { p_match_id: theirSemi.id, p_winner_member_id: theirSemi.home_member_id }), "not_commissioner");
    await expectRpcError(rpcAs(db, attacker, "report_match_result", { p_match_id: theirRegular.id, p_winner_member_id: theirRegular.away_member_id }), "not_commissioner");
    await expectRpcError(rpcAs(db, attacker, "clear_match_result", { p_match_id: theirRegular.id }), "not_commissioner");
    await expectRpcError(rpcAs(db, attacker, "generate_playoffs", { p_league_id: theirs.leagueId }), "not_commissioner");
    await expectRpcError(rpcAs(db, attacker, "clear_playoffs", { p_league_id: theirs.leagueId }), "not_commissioner");
    await expectRpcError(rpcAs(db, attacker, "update_league_settings", { p_league_id: theirs.leagueId, p_settings: { playoff_format: "none" } }), "not_commissioner");
    await expectRpcError(standingsAs(db, attacker, theirs.leagueId), "not_a_member");
    // A coach of the league itself cannot report or clear a playoff match.
    const coach = theirs.coaches[0].userId;
    await expectRpcError(rpcAs(db, coach, "report_match_result", { p_match_id: theirSemi.id, p_winner_member_id: theirSemi.home_member_id }), "not_commissioner");
    await expectRpcError(rpcAs(db, coach, "clear_match_result", { p_match_id: theirSemi.id }), "not_commissioner");
    // Nothing moved.
    const after = await allMatches(db, theirs.leagueId);
    expect(playoffOf(after).map((m) => [m.id, m.status])).toEqual(theirBracket.map((m) => [m.id, "upcoming"]));
    expect(regularOf(after).every((m) => m.status === "completed" && m.winner_member_id === m.home_member_id)).toBe(true);
    expect((await leagueRow(db, theirs.leagueId)).playoff_format).toBe("top_4");
  });

  it("CONFIRMED: every _ helper is unexecutable by anon and authenticated, every API function is granted to authenticated only, and the old overloads are gone", async () => {
    for (const fn of INTERNAL_HELPERS) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>(
        `select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
        [fn],
      );
      expect(rows, fn).toHaveLength(1);
      expect(rows[0], fn).toEqual({ anon: false, authenticated: false });
    }
    for (const fn of API_FUNCTIONS) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; args: string }>(
        `select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
        [fn],
      );
      expect(rows, `${fn} must have exactly one signature`).toHaveLength(1);
      expect(rows[0].anon, fn).toBe(false);
      expect(rows[0].authenticated, fn).toBe(true);
    }
    // The three-parameter report_match_result and the nine-parameter
    // create_league are the only ones PostgREST can see.
    const { rows: rmr } = await db.query<{ args: string }>(
      "select pg_get_function_identity_arguments(p.oid) as args from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'report_match_result'",
    );
    expect(rmr[0].args).toBe("p_match_id uuid, p_winner_member_id uuid, p_winner_remaining integer");
    const { rows: cl } = await db.query<{ n: string }>(
      "select count(*)::text as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_league' and pronargs = 9",
    );
    expect(cl[0].n).toBe("1");
    // Anon cannot call the API functions at all.
    for (const fn of ["league_standings", "generate_playoffs", "clear_playoffs"]) {
      await expectSqlState(asAnon(db, (c) => rpc(c, fn, { p_league_id: randomUUID() })), "42501");
    }
    await expectSqlState(asAnon(db, (c) => rpc(c, "report_match_result", { p_match_id: randomUUID(), p_winner_member_id: randomUUID() })), "42501");
  });

  it("CONFIRMED: two commissioners' sessions reporting the last regular match at once leave exactly one bracket and one bracket news row", async () => {
    const league = await seasonLeague(db, 4, "top_4");
    const regular = regularOf(await allMatches(db, league.leagueId));
    const last = regular[regular.length - 1];
    await reportRegularSeason(db, league, last.id);
    expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);

    const connA = await connect();
    const connB = await connect();
    try {
      const outcomes = await Promise.all(
        [connA, connB].map((conn) =>
          rpcAs(conn, league.commissioner.userId, "report_match_result", { p_match_id: last.id, p_winner_member_id: last.home_member_id }).then(
            () => ({ ok: true as const }),
            (error: { detail?: string }) => ({ ok: false as const, detail: error.detail }),
          ),
        ),
      );
      expect(outcomes).toEqual([{ ok: true }, { ok: true }]);
    } finally {
      await connA.end();
      await connB.end();
    }

    const matches = await allMatches(db, league.leagueId);
    const bracket = playoffOf(matches);
    expect(bracket).toHaveLength(3);
    expect(bracket.map((m) => [m.home_seed, m.away_seed])).toEqual([[1, 4], [2, 3], [null, null]]);
    expect(bracket[0].feeds_match_id).toBe(bracket[2].id);
    expect(bracket[1].feeds_match_id).toBe(bracket[2].id);
    // (league_id, round_number, match_number) stayed unique: one row per slot.
    expect(new Set(bracket.map((m) => `${m.round_number}/${m.match_number}`)).size).toBe(3);
    expect(await count(db, "league_news", "league_id = $1 and news_type = 'season'", [league.leagueId])).toBe(1);
    expect(await count(db, "league_news", "league_id = $1 and news_type = 'match_result'", [league.leagueId])).toBe(regular.length);
    const seeds = await standingsAs(db, league.commissioner.userId, league.leagueId);
    expect(bracket[0].home_member_id).toBe(seeds[0].member_id);
    expect(bracket[1].home_member_id).toBe(seeds[1].member_id);
  });

  it("CONFIRMED: a semifinal report that waited behind clear_playoffs is refused with match_not_found and writes nothing", async () => {
    const league = await seasonLeague(db, 4, "top_4");
    await reportRegularSeason(db, league);
    const [sf1] = playoffOf(await allMatches(db, league.leagueId));
    const regularNews = await count(db, "league_news", "league_id = $1 and news_type = 'match_result'", [league.leagueId]);

    const connA = await connect();
    const connB = await connect();
    try {
      const held = await holdTransaction(connA, league.commissioner.userId, (c) => rpc(c, "clear_playoffs", { p_league_id: league.leagueId }));
      const outcome = rpcAs(connB, league.commissioner.userId, "report_match_result", { p_match_id: sf1.id, p_winner_member_id: sf1.home_member_id }).then(
        () => ({ ok: true as const }),
        (error: { detail?: string }) => ({ ok: false as const, detail: error.detail }),
      );
      await wait(300);
      await held.commit();
      expect(await outcome).toEqual({ ok: false, detail: "match_not_found" });
    } finally {
      await connA.end();
      await connB.end();
    }
    expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);
    expect(await count(db, "league_news", "league_id = $1 and news_type = 'match_result'", [league.leagueId])).toBe(regularNews);
    expect(await newsFor(db, league.leagueId, "season")).toHaveLength(0);
    expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();
  });

  it("CONFIRMED: a three-way tie where head-to-head lifts one coach and differential splits the other two, in both tiebreaker orders, matching computeStandings", async () => {
    const league = await buildLeague(db, { coaches: 3, playoffFormat: "none" });
    const [a, b, c, d] = league.order.map((p) => p.memberId);
    // D 5-2. A, B and C are all 2-3: A beat B and C (head-to-head 1.000),
    // B and C split their two games and each beat D once (0.333 each), so
    // the differential decides between them: B -3 (A beat B by 3), C -1.
    await writeResults(db, league.leagueId, [
      [a, b, 3],
      [a, c, 1],
      [d, a, 1],
      [d, a, 1],
      [d, a, 1],
      [b, d, 1],
      [d, b, 1],
      [b, c, 1],
      [c, b, 1],
      [c, d, 1],
      [d, c, 1],
    ]);
    const rows = await standingsAs(db, league.commissioner.userId, league.leagueId);
    expect(rows.map((r) => r.member_id)).toEqual([d, a, c, b]);
    expect(rows.map((r) => [r.wins, r.losses, r.played, r.remaining])).toEqual([[5, 2, 7, 0], [2, 3, 5, 0], [2, 3, 5, 0], [2, 3, 5, 0]]);
    expect(rows.map((r) => r.win_pct)).toEqual([0.714, 0.4, 0.4, 0.4]);
    expect(rows.map((r) => r.differential)).toEqual([3, 1, -1, -3]);
    expect(rows.map((r) => r.strength_of_schedule)).toEqual([0.4, 0.589, 0.526, 0.526]);
    expect(rows.map((r) => r.head_to_head_applied)).toEqual([false, true, true, true]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(rows.every((r) => !r.tied)).toBe(true);
    const inputs = await oracleInputs(db, league.leagueId);
    const mirror = computeStandings(inputs.members, inputs.matches as never, "head_to_head");
    expect(mirror.map((s) => s.member.id)).toEqual([d, a, c, b]);
    expect(mirror.map((s) => s.headToHeadApplied)).toEqual([false, true, true, true]);
    expect(mirror.map((s) => s.strengthOfSchedule)).toEqual([0.4, 0.589, 0.526, 0.526]);

    // Differential first: +1, -1, -3 separate A, C and B before any
    // head-to-head comparison, so the same order without the flag.
    await settings(db, league, { tiebreaker: "differential" });
    const diff = await standingsAs(db, league.commissioner.userId, league.leagueId);
    expect(diff.map((r) => r.member_id)).toEqual([d, a, c, b]);
    expect(diff.map((r) => r.head_to_head_applied)).toEqual([false, false, false, false]);
    const mirrorDiff = computeStandings(inputs.members, inputs.matches as never, "differential");
    expect(mirrorDiff.map((s) => s.member.id)).toEqual([d, a, c, b]);
    expect(mirrorDiff.map((s) => s.headToHeadApplied)).toEqual([false, false, false, false]);
  });

  it("FIXED: after a complete season in a league that cannot fill its playoff format, changing only the tiebreaker is saved and the league stays without a bracket (the strict regeneration used to run for any playoff-setting change)", async () => {
    // Three coaches, the create_league default of top_4: the season ends
    // without a bracket (documented). The commissioner opens Settings and
    // changes just the tiebreaker. During this review update_league_settings
    // skipped the playing-count check (the format did not change) but then
    // called _generate_playoffs(strict) because v_playoffs_changed was true,
    // and refused with not_enough_coaches over a format the commissioner did
    // not touch; it now rebuilds strictly only for a changed format.
    const league = await seasonLeague(db, 3, "top_4");
    await reportRegularSeason(db, league);
    expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);
    expect((await settings(db, league, { tiebreaker: "differential" })).tiebreaker).toBe("differential");
    expect((await leagueRow(db, league.leagueId)).tiebreaker).toBe("differential");
    expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);
    // A changed format is still held to the coach count.
    const error = await expectRpcError(settings(db, league, { playoff_format: "top_6" }), "not_enough_coaches");
    expect(error.message).toContain("Top 6 playoffs need at least 6 coaches");
    // Before the last result the same change is accepted too.
    const open = await seasonLeague(db, 3, "top_4");
    expect((await settings(db, open, { tiebreaker: "differential" })).tiebreaker).toBe("differential");
  });

  it("FIXED: clear_playoffs on a league without playoffs keeps the champion the rules say is the top seed (it used to null it, and only the migration's data fix or a re-reported result brought it back)", async () => {
    const league = await seasonLeague(db, 3, "none");
    await reportRegularSeason(db, league);
    const champion = (await leagueRow(db, league.leagueId)).champion_member_id;
    expect(champion).not.toBeNull();
    // No bracket exists; the call is a no-op on matches and news, and the
    // top seed stays crowned (a league without playoffs is crowned by rule).
    await rpcAs(db, league.commissioner.userId, "clear_playoffs", { p_league_id: league.leagueId });
    expect((await leagueRow(db, league.leagueId)).champion_member_id).toBe(champion);
    expect(await count(db, "league_matches", "league_id = $1", [league.leagueId])).toBe(3);
    expect(await count(db, "league_news", "league_id = $1 and news_type = 'season'", [league.leagueId])).toBe(0);
    // A cleared regular result takes the champion away as before, and the
    // migration's data fix does not crown an unfinished season.
    const [first] = regularOf(await allMatches(db, league.leagueId));
    await rpcAs(db, league.commissioner.userId, "clear_match_result", { p_match_id: first.id });
    expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();
    const playoffs = readMigrations().find((m) => m.name === PLAYOFFS_MIGRATION);
    if (!playoffs) throw new Error("playoffs migration missing");
    await applyMigration(db, playoffs);
    expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();
    // The last result crowns seed 1 again, and clear_playoffs leaves it.
    await report(db, league, first.id, first.home_member_id);
    await rpcAs(db, league.commissioner.userId, "clear_playoffs", { p_league_id: league.leagueId });
    expect((await leagueRow(db, league.leagueId)).champion_member_id).toBe(champion);
  });

  it("FIXED: league_standings and computeStandings both compare win percentages rounded to 3 decimals, so 21-20 (.5122) and 22-21 (.5116) tie on percentage and wins decide in both", async () => {
    // Only reachable mid-season in a league with at least 22 coaches (played
    // 41 against 43). During this review the client compared at 9 decimals
    // and seeded 21-20 first; it now rounds like the function does.
    const league = await buildLeague(db, { coaches: 2, playoffFormat: "none" });
    const [x, y, z] = league.order.map((p) => p.memberId);
    const results: Array<[string, string, number | null]> = [];
    for (let i = 0; i < 21; i += 1) results.push([x, z, null]);
    for (let i = 0; i < 20; i += 1) results.push([z, x, null]);
    for (let i = 0; i < 22; i += 1) results.push([y, z, null]);
    for (let i = 0; i < 21; i += 1) results.push([z, y, null]);
    await writeResults(db, league.leagueId, results);
    const sql = await standingsAs(db, league.commissioner.userId, league.leagueId);
    expect(sql.map((r) => [r.wins, r.losses, r.win_pct])).toEqual([[22, 21, 0.512], [21, 20, 0.512], [41, 43, 0.488]]);
    const inputs = await oracleInputs(db, league.leagueId);
    const mirror = computeStandings(inputs.members, inputs.matches as never, "head_to_head");
    // Equal at .512 on both sides, so wins decide: 22-21 first.
    expect({ sql: sql.map((r) => r.member_id), ts: mirror.map((s) => s.member.id) }).toEqual({ sql: [y, x, z], ts: [y, x, z] });
    expect(mirror.map((s) => s.winPercentage)).toEqual([0.512, 0.512, 0.488]);
  });
});
