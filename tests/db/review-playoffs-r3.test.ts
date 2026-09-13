// Round-3 review probes for the playoffs migration (security, correctness
// and concurrency lens), after the round-2 fixes. The file first re-applies
// the playoffs migration so this file and every file vitest runs after it
// exercise a schema the file has been applied to more than once. Each title
// says whether it pins a defect or confirms a behaviour.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeStandings } from "../../app/lib/league/standings";
import {
  asUser,
  buildLeague,
  connect,
  count,
  expectRpcError,
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
  winner_remaining: number | null;
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
            winner_remaining, home_seed, away_seed, feeds_match_id, feeds_slot
     from public.league_matches where league_id = $1 order by round_number, match_number`,
    [leagueId],
  );
  return rows;
}

const regularOf = (matches: MatchRow[]) => matches.filter((m) => m.stage === "regular");
const playoffOf = (matches: MatchRow[]) => matches.filter((m) => m.stage === "playoff");
const byId = (matches: MatchRow[], id: string) => matches.find((m) => m.id === id)!;

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

function clear(client: Client, league: LeagueFixture, matchId: string): Promise<unknown> {
  return rpcAs(client, league.commissioner.userId, "clear_match_result", { p_match_id: matchId });
}

async function reportRegularSeason(client: Client, league: LeagueFixture): Promise<void> {
  for (const match of regularOf(await allMatches(client, league.leagueId))) {
    if (match.status !== "completed") {
      await report(client, league, match.id, match.home_member_id);
    }
  }
}

function settings(client: Client, league: LeagueFixture, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  return rpcAs<Record<string, unknown>>(client, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: values });
}

// Writes regular results straight to the tables: [winner, loser, winner_remaining].
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
const sorted = (ids: string[]) => [...ids].sort();

describe("review round 3: playoffs migration", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
    // Every probe below, and every file after this one, runs on a database
    // the playoffs file has been applied to at least twice.
    const playoffs = readMigrations().find((m) => m.name === PLAYOFFS_MIGRATION);
    if (!playoffs) throw new Error("playoffs migration missing");
    await applyMigration(db, playoffs);
  });

  afterAll(async () => {
    await db.end();
  });

  it("CONFIRMED: a four-way tie that every tiebreaker leaves equal ends in two coin-flip pairs with shared ranks, no head-to-head flag, in both tiebreaker orders", async () => {
    const league = await buildLeague(db, { coaches: 3, playoffFormat: "none" });
    const [a, b, c, d] = league.order.map((p) => p.memberId);
    // Everyone 1-1 with one win: A beat C by 2, D beat A by 1, B beat D by
    // 2, C beat B by 1. Head-to-head inside the group is .500 for all four,
    // the differential splits {A, B} (+1) from {C, D} (-1), and every
    // strength of schedule is .500, so each pair is a coin flip.
    await writeResults(db, league.leagueId, [
      [a, c, 2],
      [d, a, 1],
      [b, d, 2],
      [c, b, 1],
    ]);
    for (const tiebreaker of ["head_to_head", "differential"] as const) {
      await settings(db, league, { tiebreaker });
      const rows = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect(rows.map((r) => [r.wins, r.losses, r.played, r.remaining, r.win_pct, r.strength_of_schedule])).toEqual([
        [1, 1, 2, 0, 0.5, 0.5],
        [1, 1, 2, 0, 0.5, 0.5],
        [1, 1, 2, 0, 0.5, 0.5],
        [1, 1, 2, 0, 0.5, 0.5],
      ]);
      expect(rows.map((r) => r.differential)).toEqual([1, 1, -1, -1]);
      expect(sorted(rows.slice(0, 2).map((r) => r.member_id))).toEqual(sorted([a, b]));
      expect(sorted(rows.slice(2).map((r) => r.member_id))).toEqual(sorted([c, d]));
      // The coin flip is member id ascending, so the seeds are stable.
      expect(rows.slice(0, 2).map((r) => r.member_id)).toEqual(sorted([a, b]));
      expect(rows.slice(2).map((r) => r.member_id)).toEqual(sorted([c, d]));
      expect(rows.map((r) => r.seed)).toEqual([1, 2, 3, 4]);
      expect(rows.map((r) => r.rank)).toEqual([1, 1, 3, 3]);
      expect(rows.map((r) => r.tied)).toEqual([true, true, true, true]);
      expect(rows.map((r) => r.head_to_head_applied)).toEqual([false, false, false, false]);
      const inputs = await oracleInputs(db, league.leagueId);
      const mirror = computeStandings(inputs.members, inputs.matches as never, tiebreaker);
      expect(mirror.map((s) => [s.member.id, s.rank, s.tied, s.headToHeadApplied])).toEqual(rows.map((r) => [r.member_id, r.rank, r.tied, r.head_to_head_applied]));
    }
  });

  it("CONFIRMED: two unbeaten coaches who never met and share a differential are split by strength of schedule, and a pair with no head-to-head record falls through to the differential", async () => {
    const league = await buildLeague(db, { coaches: 4, playoffFormat: "none" });
    const [a, b, c, d, e] = league.order.map((p) => p.memberId);
    // A beat C by 2 and B beat D by 2 (both 1-0, +2, head-to-head 0 with
    // no meeting). C then beat E by 1, so A's opponent is .500 and B's is
    // .000. D and E are both 0-1 and never met: D is -2, E is -1.
    await writeResults(db, league.leagueId, [
      [a, c, 2],
      [b, d, 2],
      [c, e, 1],
    ]);
    const rows = await standingsAs(db, league.commissioner.userId, league.leagueId);
    expect(rows.map((r) => r.member_id)).toEqual([a, b, c, e, d]);
    expect(rows.map((r) => [r.wins, r.losses, r.win_pct, r.differential, r.strength_of_schedule])).toEqual([
      [1, 0, 1, 2, 0.5],
      [1, 0, 1, 2, 0],
      [1, 1, 0.5, -1, 0.5],
      [0, 1, 0, -1, 0.5],
      [0, 1, 0, -2, 1],
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.every((r) => !r.tied && !r.head_to_head_applied)).toBe(true);
    const inputs = await oracleInputs(db, league.leagueId);
    expect(computeStandings(inputs.members, inputs.matches as never, "head_to_head").map((s) => s.member.id)).toEqual([a, b, c, e, d]);
    expect(computeStandings(inputs.members, inputs.matches as never, "differential").map((s) => s.member.id)).toEqual([a, b, c, e, d]);
  });

  it("CONFIRMED: before any result every scheduled coach is a 0-0 coin-flip tie at rank 1 with the full schedule remaining, and a coach with no draft position and no match is not a row", async () => {
    const league = await buildLeague(db, { coaches: 4, setOrder: false, playoffFormat: "top_4" });
    const spectator = league.coaches[3];
    const playing = league.order.filter((p) => p.memberId !== spectator.memberId);
    await rpcAs(db, league.commissioner.userId, "set_draft_order", { p_league_id: league.leagueId, p_member_ids: playing.map((p) => p.memberId) });
    // Positioned, no schedule yet: a row each, nothing played, nothing remaining.
    let rows = await standingsAs(db, league.commissioner.userId, league.leagueId);
    expect(sorted(rows.map((r) => r.member_id))).toEqual(sorted(playing.map((p) => p.memberId)));
    expect(rows.map((r) => [r.wins, r.losses, r.played, r.remaining, r.win_pct, r.differential, r.strength_of_schedule, r.rank, r.tied])).toEqual(
      playing.map(() => [0, 0, 0, 0, 0, 0, 0, 1, true]),
    );
    await runFullDraft(db, league);
    rows = await standingsAs(db, league.commissioner.userId, league.leagueId);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.member_id)).toEqual(sorted(playing.map((p) => p.memberId)));
    expect(rows.map((r) => [r.played, r.remaining, r.rank, r.tied, r.head_to_head_applied])).toEqual(playing.map(() => [0, 3, 1, true, false]));
    expect(rows.find((r) => r.member_id === spectator.memberId)).toBeUndefined();
    // The spectator can read the standings but is not in them.
    expect((await standingsAs(db, spectator.userId, league.leagueId)).map((r) => r.member_id)).not.toContain(spectator.memberId);
    // And the bracket seeds from those four, never from the spectator.
    await reportRegularSeason(db, league);
    const bracket = playoffOf(await allMatches(db, league.leagueId));
    expect(bracket).toHaveLength(3);
    expect(bracket.flatMap((m) => [m.home_member_id, m.away_member_id]).filter(Boolean)).not.toContain(spectator.memberId);
  });

  it("CONFIRMED: after a double round robin the playoff rounds continue after round 2(n-1), and their news names the round, not its number", async () => {
    const league = await seasonLeague(db, 4, "top_4");
    await rpcAs(db, league.commissioner.userId, "generate_schedule", { p_league_id: league.leagueId, p_format: "double_round_robin", p_randomize: false });
    const regular = regularOf(await allMatches(db, league.leagueId));
    expect(Math.max(...regular.map((m) => m.round_number))).toBe(6);
    await reportRegularSeason(db, league);
    const bracket = playoffOf(await allMatches(db, league.leagueId));
    expect(bracket.map((m) => [m.round_number, m.match_number])).toEqual([[7, 1], [7, 2], [8, 1]]);
    await report(db, league, bracket[0].id, bracket[0].home_member_id);
    const [news] = await newsFor(db, league.leagueId, "match_result");
    expect(news.message).toMatch(/ in the Semifinals\.$/);
    expect(news.message).not.toContain("Round 7");
    expect(news.metadata).toMatchObject({ round_number: 7, match_number: 1, stage: "playoff" });
  });

  it("CONFIRMED: playoff reports validate winner_remaining and the winner before writing, playoff settings reject malformed values, and clearing the final alone does not unlock the settings", async () => {
    const league = await seasonLeague(db, 4, "top_4");
    await reportRegularSeason(db, league);
    const [sf1, sf2, final] = playoffOf(await allMatches(db, league.leagueId));
    for (const remaining of [0, 13, -1]) {
      await expectRpcError(report(db, league, sf1.id, sf1.home_member_id, remaining), "invalid_score");
    }
    // A coach of the league who is not in this match, and a member of another league.
    await expectRpcError(report(db, league, sf1.id, sf2.home_member_id), "invalid_winner");
    const other = await seasonLeague(db, 2, "none");
    await expectRpcError(report(db, league, sf1.id, other.coaches[0].memberId), "invalid_winner");
    await expectRpcError(report(db, league, sf1.id, null), "invalid_winner");
    expect(byId(await allMatches(db, league.leagueId), sf1.id)).toMatchObject({ status: "upcoming", winner_member_id: null, winner_remaining: null });
    expect(await count(db, "league_news", "league_id = $1 and news_type = 'match_result' and metadata ->> 'stage' = 'playoff'", [league.leagueId])).toBe(0);

    await expectRpcError(settings(db, league, { playoff_format: null }), "invalid_playoff_format");
    await expectRpcError(settings(db, league, { playoff_format: "top_3" }), "invalid_playoff_format");
    await expectRpcError(settings(db, league, { tiebreaker: 1 }), "invalid_tiebreaker");
    await expectRpcError(settings(db, league, { tiebreaker: "" }), "invalid_tiebreaker");
    expect((await leagueRow(db, league.leagueId)).playoff_format).toBe("top_4");

    await report(db, league, sf1.id, sf1.home_member_id);
    await report(db, league, sf2.id, sf2.home_member_id);
    await report(db, league, final.id, sf1.home_member_id, 3);
    expect((await leagueRow(db, league.leagueId)).champion_member_id).toBe(sf1.home_member_id);
    // The champion is cleared with the final, but two semifinal results
    // still stand, so the playoff settings stay locked until they are
    // cleared too (or the bracket is).
    await clear(db, league, final.id);
    expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();
    await expectRpcError(settings(db, league, { playoff_format: "top_2" }), "playoffs_started");
    await expectRpcError(settings(db, league, { tiebreaker: "differential" }), "playoffs_started");
    const [regular] = regularOf(await allMatches(db, league.leagueId));
    await expectRpcError(report(db, league, regular.id, regular.away_member_id), "playoffs_started");
    await clear(db, league, sf1.id);
    await clear(db, league, sf2.id);
    const updated = await settings(db, league, { playoff_format: "top_2" });
    expect(updated.playoff_format).toBe("top_2");
    const rebuilt = playoffOf(await allMatches(db, league.leagueId));
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]).toMatchObject({ home_seed: 1, away_seed: 2, feeds_match_id: null, feeds_slot: null, status: "upcoming" });
    expect((await newsFor(db, league.leagueId, "season")).map((n) => n.metadata.kind)).toEqual(["bracket"]);
    expect(await count(db, "league_news", "league_id = $1 and news_type = 'match_result' and metadata ->> 'stage' = 'playoff'", [league.leagueId])).toBe(0);
  });

  it("CONFIRMED: clearing a playoff match that has no result is harmless: a waiting final keeps its bracket, a Top 6 semifinal keeps its bye seed", async () => {
    const four = await seasonLeague(db, 4, "top_4");
    await reportRegularSeason(db, four);
    const [sf1, , final] = playoffOf(await allMatches(db, four.leagueId));
    await report(db, four, sf1.id, sf1.home_member_id);
    await clear(db, four, final.id);
    let matches = await allMatches(db, four.leagueId);
    expect(byId(matches, final.id)).toMatchObject({ status: "upcoming", home_member_id: sf1.home_member_id, home_seed: 1, away_member_id: null });
    expect(byId(matches, sf1.id)).toMatchObject({ status: "completed", winner_member_id: sf1.home_member_id });
    expect((await newsFor(db, four.leagueId, "season")).map((n) => n.metadata.kind)).toEqual(["bracket"]);
    expect(await count(db, "league_news", "league_id = $1 and news_type = 'match_result' and metadata ->> 'match_id' = $2", [four.leagueId, sf1.id])).toBe(1);

    const six = await seasonLeague(db, 6, "top_6");
    await reportRegularSeason(db, six);
    const [qf1, , sixSf1, , sixFinal] = playoffOf(await allMatches(db, six.leagueId));
    await report(db, six, qf1.id, qf1.home_member_id);
    await clear(db, six, sixSf1.id);
    matches = await allMatches(db, six.leagueId);
    expect(byId(matches, sixSf1.id)).toMatchObject({ status: "upcoming", home_seed: 1, home_member_id: sixSf1.home_member_id, away_member_id: qf1.home_member_id, away_seed: 4 });
    expect(byId(matches, sixFinal.id)).toMatchObject({ home_member_id: null, away_member_id: null });
    expect(byId(matches, qf1.id).status).toBe("completed");
  });

  it("CONFIRMED: a final report that waited behind a re-reported semifinal is refused with invalid_winner because the match is re-read under the league lock, and nothing is crowned", async () => {
    const league = await seasonLeague(db, 4, "top_4");
    await reportRegularSeason(db, league);
    const [sf1, sf2, final] = playoffOf(await allMatches(db, league.leagueId));
    await report(db, league, sf1.id, sf1.home_member_id);
    await report(db, league, sf2.id, sf2.home_member_id);
    const x = sf1.home_member_id!;
    const z = sf1.away_member_id!;

    const connA = await connect();
    const connB = await connect();
    try {
      // Session A changes the first semifinal's winner to Z and holds the
      // league lock; session B reports the final for X, the winner it saw.
      const held = await holdTransaction(connA, league.commissioner.userId, (c) =>
        rpc(c, "report_match_result", { p_match_id: sf1.id, p_winner_member_id: z, p_winner_remaining: null }),
      );
      const outcome = rpcAs(connB, league.commissioner.userId, "report_match_result", { p_match_id: final.id, p_winner_member_id: x, p_winner_remaining: 2 }).then(
        () => ({ ok: true as const }),
        (error: { detail?: string }) => ({ ok: false as const, detail: error.detail }),
      );
      await wait(300);
      await held.commit();
      expect(await outcome).toEqual({ ok: false, detail: "invalid_winner" });
    } finally {
      await connA.end();
      await connB.end();
    }
    const matches = await allMatches(db, league.leagueId);
    expect(byId(matches, sf1.id)).toMatchObject({ status: "completed", winner_member_id: z });
    expect(byId(matches, final.id)).toMatchObject({ status: "upcoming", winner_member_id: null, home_member_id: z, home_seed: 4, away_member_id: sf2.home_member_id });
    expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();
    expect((await newsFor(db, league.leagueId, "season")).map((n) => n.metadata.kind)).toEqual(["bracket"]);
  });

  it("CONFIRMED: two generate_playoffs calls at once, and a settings change racing a playoff report, leave one bracket and no stray result", async () => {
    const league = await seasonLeague(db, 4, "top_4");
    await reportRegularSeason(db, league);
    const before = playoffOf(await allMatches(db, league.leagueId));
    expect(before).toHaveLength(3);

    const connA = await connect();
    const connB = await connect();
    try {
      const results = await Promise.all(
        [connA, connB].map((conn) => rpcAs<number>(conn, league.commissioner.userId, "generate_playoffs", { p_league_id: league.leagueId })),
      );
      expect(results).toEqual([3, 3]);
      let bracket = playoffOf(await allMatches(db, league.leagueId));
      expect(bracket).toHaveLength(3);
      expect(bracket.map((m) => m.id)).not.toEqual(expect.arrayContaining(before.map((m) => m.id)));
      expect(await count(db, "league_news", "league_id = $1 and news_type = 'season'", [league.leagueId])).toBe(1);

      // A format change that waits behind nothing, with a semifinal report
      // waiting behind it: the report finds its match gone.
      const [sf1] = bracket;
      const held = await holdTransaction(connA, league.commissioner.userId, (c) =>
        rpc(c, "update_league_settings", { p_league_id: league.leagueId, p_settings: { playoff_format: "top_2" } }),
      );
      const outcome = rpcAs(connB, league.commissioner.userId, "report_match_result", { p_match_id: sf1.id, p_winner_member_id: sf1.home_member_id, p_winner_remaining: null }).then(
        () => ({ ok: true as const }),
        (error: { detail?: string }) => ({ ok: false as const, detail: error.detail }),
      );
      await wait(300);
      await held.commit();
      expect(await outcome).toEqual({ ok: false, detail: "match_not_found" });
      bracket = playoffOf(await allMatches(db, league.leagueId));
      expect(bracket).toHaveLength(1);
      expect(bracket[0]).toMatchObject({ home_seed: 1, away_seed: 2, status: "upcoming" });
      expect(await count(db, "league_news", "league_id = $1 and news_type = 'match_result' and metadata ->> 'stage' = 'playoff'", [league.leagueId])).toBe(0);
    } finally {
      await connA.end();
      await connB.end();
    }
  });

  it("CONFIRMED: a half-filled final is still waiting, and a regular re-report after a cleared semifinal reseeds the bracket and drops the old rows with their news", async () => {
    const league = await seasonLeague(db, 4, "top_4");
    await reportRegularSeason(db, league);
    const [sf1, , final] = playoffOf(await allMatches(db, league.leagueId));
    await report(db, league, sf1.id, sf1.home_member_id);
    await expectRpcError(report(db, league, final.id, sf1.home_member_id), "match_not_ready");
    // Undo the semifinal, then flip a regular result: the bracket is
    // rebuilt from the new standings and the old rows (and their news) go.
    await clear(db, league, sf1.id);
    const regular = regularOf(await allMatches(db, league.leagueId));
    await report(db, league, regular[0].id, regular[0].away_member_id, 1);
    const matches = await allMatches(db, league.leagueId);
    const bracket = playoffOf(matches);
    expect(bracket).toHaveLength(3);
    expect(bracket.map((m) => m.id)).not.toContain(sf1.id);
    expect(bracket.every((m) => m.status === "upcoming" && m.winner_member_id === null)).toBe(true);
    const standings = await standingsAs(db, league.commissioner.userId, league.leagueId);
    expect(bracket[0].home_member_id).toBe(standings[0].member_id);
    expect(bracket[0].away_member_id).toBe(standings[3].member_id);
    expect(bracket[1].home_member_id).toBe(standings[1].member_id);
    expect(bracket[1].away_member_id).toBe(standings[2].member_id);
    const news = await newsFor(db, league.leagueId, "match_result");
    expect(news).toHaveLength(regular.length);
    expect(news.every((n) => regular.some((m) => m.id === n.metadata.match_id))).toBe(true);
    expect((await newsFor(db, league.leagueId, "season")).map((n) => n.metadata.kind)).toEqual(["bracket"]);
  });
});
