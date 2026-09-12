// Section 12 of docs/release-architecture.md: standings tiebreakers and
// single-elimination playoffs (supabase/migrations/20260912120000_playoffs.sql).
//
// Covers the bracket shape of every format, automatic generation on the last
// regular result, advancement and later_round_decided, match_not_ready, the
// champion for every format including 'none', the playoff settings
// (reseeding, playoffs_started, not_enough_coaches, a tiebreaker change in a
// league that cannot fill its format), clear_playoffs, generate_schedule /
// reset_draft clearing the champion, winner_remaining validation,
// permissions, the migration's data fix, the standings algorithm on hand-made
// ties inside ties, its speed on a 24-coach double round robin, the 3-decimal
// comparison precision it shares with computeStandings, and the
// SQL/TypeScript parity of the two on randomised fixtures.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeStandings, type Standing } from "../../app/lib/league/standings";
import {
  asAnon,
  asUser,
  buildLeague,
  connect,
  count,
  createUser,
  expectRpcError,
  expectSqlState,
  leagueRow,
  memberFor,
  newsFor,
  rpc,
  rpcAs,
  runFullDraft,
  samplePool,
  type Client,
  type LeagueFixture,
} from "./harness";
import { PLAYOFFS_MIGRATION, applyMigration, readMigrations } from "./migrations-lib";

type PlayoffFormat = "none" | "top_2" | "top_4" | "top_6" | "top_8";
type Tiebreaker = "head_to_head" | "differential";

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

const MATCH_COLUMNS =
  "id, round_number, match_number, stage, home_member_id, away_member_id, status, winner_member_id, winner_remaining, home_seed, away_seed, feeds_match_id, feeds_slot";

async function allMatches(client: Client, leagueId: string): Promise<MatchRow[]> {
  const { rows } = await client.query<MatchRow>(
    `select ${MATCH_COLUMNS} from public.league_matches where league_id = $1 order by round_number, match_number`,
    [leagueId],
  );
  return rows;
}

const regularOf = (matches: MatchRow[]) => matches.filter((m) => m.stage === "regular");
const playoffOf = (matches: MatchRow[]) => matches.filter((m) => m.stage === "playoff");

// node-pg returns numeric columns as strings.
function toStanding(row: Record<string, unknown>): StandingRow {
  return {
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
  };
}

async function standingsAs(client: Client, userId: string, leagueId: string): Promise<StandingRow[]> {
  return asUser(client, userId, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>("select * from public.league_standings(p_league_id => $1)", [leagueId]);
    return rows.map(toStanding);
  });
}

// A league of `teams` coaches (commissioner included) with a finished draft
// and its regular season scheduled.
async function seasonLeague(client: Client, teams: number, playoffFormat: PlayoffFormat, tiebreaker: Tiebreaker = "head_to_head"): Promise<LeagueFixture> {
  const league = await buildLeague(client, { coaches: teams - 1, picksPerTeam: 1, pool: samplePool(teams * 2), playoffFormat, tiebreaker });
  await runFullDraft(client, league);
  return league;
}

function report(client: Client, league: LeagueFixture, matchId: string, winner: string | null, remaining: number | null = null): Promise<unknown> {
  return rpcAs(client, league.commissioner.userId, "report_match_result", { p_match_id: matchId, p_winner_member_id: winner, p_winner_remaining: remaining });
}

function clear(client: Client, league: LeagueFixture, matchId: string): Promise<unknown> {
  return rpcAs(client, league.commissioner.userId, "clear_match_result", { p_match_id: matchId });
}

// Reports every regular match that has no result yet; the home coach wins
// unless `winner` says otherwise.
async function reportRegularSeason(client: Client, league: LeagueFixture, winner: (m: MatchRow) => string | null = (m) => m.home_member_id): Promise<void> {
  for (const match of regularOf(await allMatches(client, league.leagueId))) {
    if (match.status !== "completed") {
      await report(client, league, match.id, winner(match));
    }
  }
}

function settings(client: Client, league: LeagueFixture, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  return rpcAs<Record<string, unknown>>(client, league.commissioner.userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: values });
}

function teamName(league: LeagueFixture, memberId: string | null): string {
  return league.order.find((p) => p.memberId === memberId)?.teamName ?? "?";
}

type Shape = { round: number; match: number; home: number | null; away: number | null; feeds: { round: number; match: number; slot: "home" | "away" } | null };

// Section 12.4, one row per match; rounds count from the first playoff round.
const SHAPES: Record<Exclude<PlayoffFormat, "none">, Shape[]> = {
  top_2: [{ round: 1, match: 1, home: 1, away: 2, feeds: null }],
  top_4: [
    { round: 1, match: 1, home: 1, away: 4, feeds: { round: 2, match: 1, slot: "home" } },
    { round: 1, match: 2, home: 2, away: 3, feeds: { round: 2, match: 1, slot: "away" } },
    { round: 2, match: 1, home: null, away: null, feeds: null },
  ],
  top_6: [
    { round: 1, match: 1, home: 4, away: 5, feeds: { round: 2, match: 1, slot: "away" } },
    { round: 1, match: 2, home: 3, away: 6, feeds: { round: 2, match: 2, slot: "away" } },
    { round: 2, match: 1, home: 1, away: null, feeds: { round: 3, match: 1, slot: "home" } },
    { round: 2, match: 2, home: 2, away: null, feeds: { round: 3, match: 1, slot: "away" } },
    { round: 3, match: 1, home: null, away: null, feeds: null },
  ],
  top_8: [
    { round: 1, match: 1, home: 1, away: 8, feeds: { round: 2, match: 1, slot: "home" } },
    { round: 1, match: 2, home: 4, away: 5, feeds: { round: 2, match: 1, slot: "away" } },
    { round: 1, match: 3, home: 3, away: 6, feeds: { round: 2, match: 2, slot: "home" } },
    { round: 1, match: 4, home: 2, away: 7, feeds: { round: 2, match: 2, slot: "away" } },
    { round: 2, match: 1, home: null, away: null, feeds: { round: 3, match: 1, slot: "home" } },
    { round: 2, match: 2, home: null, away: null, feeds: { round: 3, match: 1, slot: "away" } },
    { round: 3, match: 1, home: null, away: null, feeds: null },
  ],
};

// Checks a bracket against its shape and the standings it was seeded from.
async function expectBracket(client: Client, league: LeagueFixture, format: Exclude<PlayoffFormat, "none">): Promise<MatchRow[]> {
  const matches = await allMatches(client, league.leagueId);
  const lastRegular = Math.max(...regularOf(matches).map((m) => m.round_number));
  const playoff = playoffOf(matches);
  const shape = SHAPES[format];
  expect(playoff).toHaveLength(shape.length);
  const standings = await standingsAs(client, league.commissioner.userId, league.leagueId);
  const bySeed = new Map(standings.map((s) => [s.seed, s.member_id]));
  const find = (round: number, match: number) => playoff.find((m) => m.round_number === lastRegular + round && m.match_number === match);
  for (const row of shape) {
    const match = find(row.round, row.match);
    expect(match, `${format} round ${row.round} match ${row.match}`).toBeDefined();
    expect(match!.status).toBe("upcoming");
    expect(match!.winner_member_id).toBeNull();
    expect(match!.home_seed).toBe(row.home);
    expect(match!.away_seed).toBe(row.away);
    expect(match!.home_member_id).toBe(row.home === null ? null : bySeed.get(row.home));
    expect(match!.away_member_id).toBe(row.away === null ? null : bySeed.get(row.away));
    if (row.feeds) {
      expect(match!.feeds_match_id).toBe(find(row.feeds.round, row.feeds.match)!.id);
      expect(match!.feeds_slot).toBe(row.feeds.slot);
    } else {
      expect(match!.feeds_match_id).toBeNull();
      expect(match!.feeds_slot).toBeNull();
    }
  }
  const size = Number(format.slice(4));
  const season = await newsFor(client, league.leagueId, "season");
  expect(season).toHaveLength(1);
  expect(season[0].message).toBe("The playoff bracket is set.");
  expect(season[0].member_id).toBeNull();
  expect(season[0].metadata.kind).toBe("bracket");
  expect(season[0].metadata.playoff_format).toBe(format);
  expect(season[0].metadata.seeds).toEqual(standings.filter((s) => s.seed <= size).map((s) => ({ seed: s.seed, member_id: s.member_id })));
  expect((await leagueRow(client, league.leagueId)).champion_member_id).toBeNull();
  return playoff;
}

// A pool for leagues written straight to the tables, so the hardening
// migration's health check (a finished league without a pool) stays quiet.
const FIXTURE_POOL = JSON.stringify({"version": "1.0", "leagueName": "Fixture", "pokemon": [{"name": "Mon001", "points": 1, "tier": 20}]});

// A seeded generator so a failing random fixture can be replayed
// (PLAYOFFS_PARITY_SEED=<n> npm run test:db).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type FixtureMember = { id: string; team_name: string; draft_position: number | null };
type FixtureMatch = {
  id: string;
  round_number: number;
  match_number: number;
  stage: "regular" | "playoff";
  home_member_id: string;
  away_member_id: string;
  status: "upcoming" | "completed";
  winner_member_id: string | null;
  winner_remaining: number | null;
};

// A finished-draft league written straight to the tables (the standings
// function does not care about the schedule's shape): the first member is
// the commissioner, every other member a coach. Returns the league and the
// commissioner's user id.
async function writeFixture(client: Client, tiebreaker: Tiebreaker, scheduleFormat: string, members: FixtureMember[], matches: FixtureMatch[]): Promise<{ leagueId: string; commissioner: string }> {
  const commissioner = await createUser(client);
  const { rows } = await client.query<{ id: string }>(
    `insert into public.leagues (name, commissioner_id, max_coaches, draft_started, draft_completed, tiebreaker, playoff_format, schedule_format, custom_pool)
     values ('Parity', $1, 24, true, true, $2, 'none', $3, $4::jsonb) returning id`,
    [commissioner, tiebreaker, scheduleFormat, FIXTURE_POOL],
  );
  const leagueId = rows[0].id;
  await client.query(
    `insert into public.league_members (id, league_id, user_id, role, team_name, draft_position)
     select m.id, $1, m.user_id, m.role, m.team_name, m.draft_position
     from jsonb_to_recordset($2::jsonb) as m(id uuid, user_id uuid, role text, team_name text, draft_position integer)`,
    [
      leagueId,
      JSON.stringify(
        members.map((m, i) => ({ id: m.id, user_id: i === 0 ? commissioner : randomUUID(), role: i === 0 ? "commissioner" : "coach", team_name: m.team_name, draft_position: m.draft_position })),
      ),
    ],
  );
  await client.query(
    `insert into public.league_matches (id, league_id, round_number, match_number, stage, home_member_id, away_member_id, status, winner_member_id, winner_remaining)
     select m.id, $1, m.round_number, m.match_number, m.stage, m.home_member_id, m.away_member_id, m.status, m.winner_member_id, m.winner_remaining
     from jsonb_to_recordset($2::jsonb) as m(id uuid, round_number integer, match_number integer, stage text, home_member_id uuid, away_member_id uuid, status text, winner_member_id uuid, winner_remaining integer)`,
    [leagueId, JSON.stringify(matches)],
  );
  return { leagueId, commissioner };
}

function fixtureCoach(team_name: string, draft_position: number, id: string = randomUUID()): FixtureMember {
  return { id, team_name, draft_position };
}

// Decided regular matches from (winner, loser) pairs, one per round with the
// winner at home and no winner_remaining, so every differential stays 0.
function decided(pairs: Array<[string, string]>): FixtureMatch[] {
  return pairs.map(([winner, loser], index) => ({
    id: randomUUID(),
    round_number: index + 1,
    match_number: 1,
    stage: "regular",
    home_member_id: winner,
    away_member_id: loser,
    status: "completed",
    winner_member_id: winner,
    winner_remaining: null,
  }));
}

// A random league for the parity test: n coaches (plus sometimes a spectator
// with no draft position), a single or double round robin from
// _schedule_rows, a random completed subset with random winners and
// winner_remaining (null included), and sometimes a couple of playoff matches
// that the standings must ignore.
async function randomFixture(client: Client, rng: () => number, tiebreaker: Tiebreaker): Promise<{ leagueId: string; commissioner: string; members: FixtureMember[]; matches: FixtureMatch[] }> {
  const n = 3 + Math.floor(rng() * 7);
  const scheduleFormat = rng() < 0.5 ? "round_robin" : "double_round_robin";
  const members: FixtureMember[] = [];
  for (let i = 0; i < n; i += 1) {
    members.push(fixtureCoach(`Team ${i + 1}`, i + 1));
  }
  if (rng() < 0.3) {
    members.push({ id: randomUUID(), team_name: "Spectator", draft_position: null });
  }
  const playing = members.filter((m) => m.draft_position !== null);
  const schedule = await client.query<{ round_number: number; match_number: number; home_member_id: string; away_member_id: string }>(
    "select * from public._schedule_rows($1::uuid[], $2)",
    [playing.map((m) => m.id), scheduleFormat],
  );
  const matches: FixtureMatch[] = schedule.rows.map((s) => {
    const completed = rng() < 0.65;
    return {
      id: randomUUID(),
      round_number: s.round_number,
      match_number: s.match_number,
      stage: "regular",
      home_member_id: s.home_member_id,
      away_member_id: s.away_member_id,
      status: completed ? "completed" : "upcoming",
      winner_member_id: completed ? (rng() < 0.5 ? s.home_member_id : s.away_member_id) : null,
      winner_remaining: completed && rng() >= 0.3 ? 1 + Math.floor(rng() * 6) : null,
    };
  });
  if (rng() < 0.3) {
    const lastRound = Math.max(...matches.map((m) => m.round_number));
    const extra = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < extra; i += 1) {
      const home = playing[Math.floor(rng() * playing.length)];
      const away = playing.find((m) => m.id !== home.id)!;
      const completed = rng() < 0.7;
      matches.push({
        id: randomUUID(),
        round_number: lastRound + 1,
        match_number: i + 1,
        stage: "playoff",
        home_member_id: home.id,
        away_member_id: away.id,
        status: completed ? "completed" : "upcoming",
        winner_member_id: completed ? home.id : null,
        winner_remaining: completed ? 1 + Math.floor(rng() * 6) : null,
      });
    }
  }
  const { leagueId, commissioner } = await writeFixture(client, tiebreaker, scheduleFormat, members, matches);
  return { leagueId, commissioner, members, matches };
}

// The TypeScript oracle is the client's module itself, called with the
// signature section 12.6 fixes (`computeStandings(members, matches,
// tiebreaker)`) and read through the `Standing` fields it documents, so a
// change to either fails to type-check here. The fixture rows are handed
// over as they are: `computeStandings` leaves out a spectator (no draft
// position, in no match) and ignores playoff matches on its own, like
// `league_standings` does.
function mirrorStandings(members: FixtureMember[], matches: FixtureMatch[], tiebreaker: Tiebreaker): StandingRow[] {
  return computeStandings(members, matches, tiebreaker).map((row: Standing<FixtureMember>) => ({
    member_id: row.member.id,
    seed: row.seed,
    rank: row.rank,
    tied: row.tied,
    wins: row.wins,
    losses: row.losses,
    played: row.played,
    remaining: row.remaining,
    win_pct: row.winPercentage,
    differential: row.differential,
    strength_of_schedule: row.strengthOfSchedule,
    head_to_head_applied: row.headToHeadApplied,
  }));
}

// Runs the client's computeStandings on a fixture and holds it to the
// function's rows, field by field. Both round win percentage and strength of
// schedule to 3 decimals, half up, before reporting them (docs/schema.md),
// so the two columns have to agree to well inside a thousandth: a rounding
// that went the other way on one side would show as a difference of 0.001.
function expectMirror(sql: StandingRow[], members: FixtureMember[], matches: FixtureMatch[], tiebreaker: Tiebreaker, label: string): void {
  const ts = mirrorStandings(members, matches, tiebreaker);
  expect(ts.map((t) => t.member_id), label).toEqual(sql.map((s) => s.member_id));
  expect(sql.map((s) => s.seed), label).toEqual(sql.map((_, index) => index + 1));
  for (let j = 0; j < sql.length; j += 1) {
    const row = sql[j];
    const mirror = ts[j];
    const where = `${label}, seed ${row.seed}`;
    expect(mirror.seed, where).toBe(row.seed);
    expect(mirror.rank, where).toBe(row.rank);
    expect(mirror.tied, where).toBe(row.tied);
    expect(mirror.wins, where).toBe(row.wins);
    expect(mirror.losses, where).toBe(row.losses);
    expect(mirror.played, where).toBe(row.played);
    expect(mirror.remaining, where).toBe(row.remaining);
    expect(mirror.differential, where).toBe(row.differential);
    expect(mirror.win_pct, where).toBeCloseTo(row.win_pct, 9);
    expect(mirror.strength_of_schedule, where).toBeCloseTo(row.strength_of_schedule, 9);
    expect(mirror.head_to_head_applied, where).toBe(row.head_to_head_applied);
  }
}

describe("playoffs and standings", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  describe("create_league", () => {
    it("defaults to Top 4 and head-to-head, stores explicit values, and validates both", async () => {
      const user = await createUser(db);
      const defaults = await leagueRow(db, await rpcAs<string>(db, user, "create_league", { p_name: "Defaults", p_team_name: "T", p_max_coaches: 8 }));
      expect(defaults.playoff_format).toBe("top_4");
      expect(defaults.tiebreaker).toBe("head_to_head");
      expect(defaults.champion_member_id).toBeNull();
      const explicit = await leagueRow(
        db,
        await rpcAs<string>(db, user, "create_league", { p_name: "Explicit", p_team_name: "T", p_max_coaches: 8, p_playoff_format: "top_6", p_tiebreaker: "differential" }),
      );
      expect(explicit.playoff_format).toBe("top_6");
      expect(explicit.tiebreaker).toBe("differential");
      await expectRpcError(rpcAs(db, user, "create_league", { p_name: "Bad", p_team_name: "T", p_max_coaches: 8, p_playoff_format: "top_3" }), "invalid_playoff_format");
      await expectRpcError(rpcAs(db, user, "create_league", { p_name: "Bad", p_team_name: "T", p_max_coaches: 8, p_tiebreaker: "coin" }), "invalid_tiebreaker");
    });
  });

  describe("schema", () => {
    it("enforces the new checks on direct writes and accepts season news", async () => {
      const league = await seasonLeague(db, 3, "none");
      const [match] = await allMatches(db, league.leagueId);
      await expectSqlState(db.query("update public.league_matches set winner_remaining = 13 where id = $1", [match.id]), "23514");
      await expectSqlState(db.query("update public.league_matches set winner_remaining = 0 where id = $1", [match.id]), "23514");
      await expectSqlState(db.query("update public.league_matches set stage = 'group' where id = $1", [match.id]), "23514");
      await expectSqlState(db.query("update public.league_matches set feeds_slot = 'middle' where id = $1", [match.id]), "23514");
      await expectSqlState(db.query("update public.leagues set playoff_format = 'top_3' where id = $1", [league.leagueId]), "23514");
      await expectSqlState(db.query("update public.leagues set tiebreaker = 'coin' where id = $1", [league.leagueId]), "23514");
      await expectSqlState(db.query("update public.leagues set champion_member_id = $2 where id = $1", [league.leagueId, randomUUID()]), "23503");
      await expectSqlState(db.query("update public.league_matches set feeds_match_id = $2 where id = $1", [match.id, randomUUID()]), "23503");
      await expectSqlState(
        db.query("insert into public.league_news (league_id, news_type, message) values ($1, 'gossip', 'x')", [league.leagueId]),
        "23514",
      );
      await db.query("insert into public.league_news (league_id, news_type, message) values ($1, 'season', 'Direct season row')", [league.leagueId]);
      expect(await newsFor(db, league.leagueId, "season")).toHaveLength(1);
      // A playoff slot may be empty.
      await db.query(
        "insert into public.league_matches (league_id, round_number, match_number, stage, home_member_id, away_member_id) values ($1, 99, 1, 'playoff', null, null)",
        [league.leagueId],
      );
      expect(await count(db, "league_matches", "league_id = $1 and home_member_id is null", [league.leagueId])).toBe(1);
    });
  });

  describe("bracket shapes", () => {
    for (const format of ["top_2", "top_4", "top_6", "top_8"] as const) {
      it(`${format}: matches, seeds, feeds links and byes as in section 12.4, numbered after the last regular round`, async () => {
        const size = Number(format.slice(4));
        // One coach more than the format needs: the lowest seed misses out.
        const league = await seasonLeague(db, size + 1, format);
        await reportRegularSeason(db, league);
        const playoff = await expectBracket(db, league, format);
        const lastRegular = Math.max(...regularOf(await allMatches(db, league.leagueId)).map((m) => m.round_number));
        expect(Math.min(...playoff.map((m) => m.round_number))).toBe(lastRegular + 1);
        const standings = await standingsAs(db, league.commissioner.userId, league.leagueId);
        const left = standings.find((s) => s.seed === size + 1)!.member_id;
        expect(playoff.some((m) => m.home_member_id === left || m.away_member_id === left)).toBe(false);
        // Rounds are named by distance from the final once results come in.
        for (const round of [...new Set(playoff.map((m) => m.round_number))].sort()) {
          expect(playoff.filter((m) => m.round_number === round).map((m) => m.match_number)).toEqual(
            playoff.filter((m) => m.round_number === round).map((_, i) => i + 1),
          );
        }
      });
    }
  });

  describe("automatic generation", () => {
    it("builds the bracket with the last regular result, reseeds it when a regular result changes, and leaves a league that cannot fill its format without one", async () => {
      const league = await seasonLeague(db, 4, "top_4");
      const regular = regularOf(await allMatches(db, league.leagueId));
      for (const match of regular.slice(0, -1)) {
        await report(db, league, match.id, match.home_member_id);
        expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);
      }
      const last = regular[regular.length - 1];
      await report(db, league, last.id, last.home_member_id);
      const first = await expectBracket(db, league, "top_4");

      // The same result again reseeds: fresh rows, one bracket news row.
      await report(db, league, last.id, last.away_member_id);
      const second = await expectBracket(db, league, "top_4");
      expect(second.map((m) => m.id)).not.toEqual(first.map((m) => m.id));
      expect(await count(db, "league_news", "league_id = $1 and news_type = 'season'", [league.leagueId])).toBe(1);

      // Three coaches cannot fill a Top 4: no bracket, the result still lands.
      const small = await seasonLeague(db, 3, "top_4");
      await reportRegularSeason(db, small);
      expect(regularOf(await allMatches(db, small.leagueId)).every((m) => m.status === "completed")).toBe(true);
      expect(playoffOf(await allMatches(db, small.leagueId))).toHaveLength(0);
      expect(await newsFor(db, small.leagueId, "season")).toHaveLength(0);
      const error = await expectRpcError(rpcAs(db, small.commissioner.userId, "generate_playoffs", { p_league_id: small.leagueId }), "not_enough_coaches");
      expect(error.message).toContain("Top 4 playoffs need at least 4 coaches");
      // A format the league can fill builds the bracket from Settings.
      const updated = await settings(db, small, { playoff_format: "top_2" });
      expect(updated.playoff_format).toBe("top_2");
      await expectBracket(db, small, "top_2");
      await expectRpcError(settings(db, small, { playoff_format: "top_8" }), "not_enough_coaches");
    });

    it("generate_playoffs is the manual entry point with its own preconditions", async () => {
      const league = await seasonLeague(db, 4, "top_4");
      const generate = (user: string, id = league.leagueId) => rpcAs<number>(db, user, "generate_playoffs", { p_league_id: id });
      await expectRpcError(generate(league.coaches[0].userId), "not_commissioner");
      await expectRpcError(generate(league.commissioner.userId, randomUUID()), "league_not_found");
      await expectRpcError(generate(league.commissioner.userId), "regular_season_incomplete");
      await reportRegularSeason(db, league);
      // The bracket exists already; generating again replaces it in place.
      const before = await expectBracket(db, league, "top_4");
      expect(await generate(league.commissioner.userId)).toBe(3);
      const after = await expectBracket(db, league, "top_4");
      expect(after.map((m) => m.id)).not.toEqual(before.map((m) => m.id));
      await report(db, league, after[0].id, after[0].home_member_id);
      await expectRpcError(generate(league.commissioner.userId), "playoffs_started");
      await settings(db, league, { playoff_format: "top_4" });
      await rpcAs(db, league.commissioner.userId, "clear_playoffs", { p_league_id: league.leagueId });
      await settings(db, league, { playoff_format: "none" });
      await expectRpcError(generate(league.commissioner.userId), "no_playoffs");
      const undrafted = await buildLeague(db, { coaches: 3, playoffFormat: "top_4" });
      await expectRpcError(generate(undrafted.commissioner.userId, undrafted.leagueId), "draft_not_completed");
    });
  });

  describe("advancement", () => {
    it("fills the next round, refuses waiting matches, protects decided later rounds, and crowns the champion at the final", async () => {
      const league = await seasonLeague(db, 4, "top_4");
      await reportRegularSeason(db, league);
      const [sf1, sf2, final] = await expectBracket(db, league, "top_4");
      const seasonStandings = await standingsAs(db, league.commissioner.userId, league.leagueId);

      await expectRpcError(report(db, league, final.id, sf1.home_member_id), "match_not_ready");

      await report(db, league, sf1.id, sf1.home_member_id, 4);
      let matches = await allMatches(db, league.leagueId);
      let fin = matches.find((m) => m.id === final.id)!;
      expect(fin.home_member_id).toBe(sf1.home_member_id);
      expect(fin.home_seed).toBe(1);
      expect(fin.away_member_id).toBeNull();
      const news = await newsFor(db, league.leagueId, "match_result");
      expect(news[0].message).toBe(`${teamName(league, sf1.home_member_id)} defeated ${teamName(league, sf1.away_member_id)} in the Semifinals.`);
      expect(news[0].metadata).toMatchObject({ match_id: sf1.id, stage: "playoff", winner_remaining: 4, round_number: sf1.round_number, match_number: 1 });
      // Still waiting for the other semifinal.
      await expectRpcError(report(db, league, final.id, sf1.home_member_id), "match_not_ready");

      await report(db, league, sf2.id, sf2.away_member_id);
      matches = await allMatches(db, league.leagueId);
      fin = matches.find((m) => m.id === final.id)!;
      expect(fin.away_member_id).toBe(sf2.away_member_id);
      expect(fin.away_seed).toBe(3);

      // A different semifinal winner replaces the slot while the final is open.
      await report(db, league, sf2.id, sf2.home_member_id);
      fin = (await allMatches(db, league.leagueId)).find((m) => m.id === final.id)!;
      expect(fin.away_member_id).toBe(sf2.home_member_id);
      expect(fin.away_seed).toBe(2);

      await expectRpcError(report(db, league, final.id, sf1.away_member_id), "invalid_winner");
      await report(db, league, final.id, fin.away_member_id, 2);
      const row = await leagueRow(db, league.leagueId);
      expect(row.champion_member_id).toBe(fin.away_member_id);
      const season = await newsFor(db, league.leagueId, "season");
      expect(season.map((n) => n.metadata.kind)).toEqual(["champion", "bracket"]);
      expect(season[0].message).toBe(`${teamName(league, fin.away_member_id)} won the championship.`);
      expect(season[0].member_id).toBe(fin.away_member_id);
      expect(season[0].metadata).toEqual({ kind: "champion", member_id: fin.away_member_id, match_id: final.id });
      expect((await newsFor(db, league.leagueId, "match_result"))[0].message).toBe(
        `${teamName(league, fin.away_member_id)} defeated ${teamName(league, fin.home_member_id)} in the Final.`,
      );

      // The final is decided: the semifinals are locked either way.
      await expectRpcError(report(db, league, sf1.id, sf1.away_member_id), "later_round_decided");
      await expectRpcError(clear(db, league, sf1.id), "later_round_decided");
      // ... and so is the regular season.
      const [regular] = regularOf(matches);
      await expectRpcError(report(db, league, regular.id, regular.away_member_id), "playoffs_started");
      await expectRpcError(clear(db, league, regular.id), "playoffs_started");
      // Re-reporting the final replaces the champion and the news.
      await report(db, league, final.id, fin.home_member_id);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBe(fin.home_member_id);
      expect((await newsFor(db, league.leagueId, "season")).filter((n) => n.metadata.kind === "champion")).toHaveLength(1);
      // Playoff results never touch the standings.
      expect(await standingsAs(db, league.commissioner.userId, league.leagueId)).toEqual(seasonStandings);

      // Clearing the final opens it again; clearing a semifinal empties its slot.
      await clear(db, league, final.id);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();
      expect((await newsFor(db, league.leagueId, "season")).map((n) => n.metadata.kind)).toEqual(["bracket"]);
      fin = (await allMatches(db, league.leagueId)).find((m) => m.id === final.id)!;
      expect(fin).toMatchObject({ status: "upcoming", winner_member_id: null, winner_remaining: null, home_member_id: sf1.home_member_id, away_member_id: sf2.home_member_id });
      await clear(db, league, sf1.id);
      fin = (await allMatches(db, league.leagueId)).find((m) => m.id === final.id)!;
      expect(fin.home_member_id).toBeNull();
      expect(fin.home_seed).toBeNull();
      expect(fin.away_member_id).toBe(sf2.home_member_id);
      await expectRpcError(report(db, league, final.id, sf2.home_member_id), "match_not_ready");
      expect(await newsFor(db, league.leagueId, "match_result")).toHaveLength(regularOf(matches).length + 1);
    });

    it("plays a Top 6 bracket through its byes and a Top 8 bracket through three rounds", async () => {
      const six = await seasonLeague(db, 6, "top_6");
      await reportRegularSeason(db, six);
      const [qf1, qf2, sf1, sf2, final] = await expectBracket(db, six, "top_6");
      await expectRpcError(report(db, six, sf1.id, sf1.home_member_id), "match_not_ready");
      await report(db, six, qf1.id, qf1.away_member_id);
      expect((await newsFor(db, six.leagueId, "match_result"))[0].message).toContain("in the Quarterfinals.");
      await report(db, six, qf2.id, qf2.home_member_id);
      let matches = await allMatches(db, six.leagueId);
      expect(matches.find((m) => m.id === sf1.id)).toMatchObject({ home_seed: 1, away_member_id: qf1.away_member_id, away_seed: 5 });
      expect(matches.find((m) => m.id === sf2.id)).toMatchObject({ home_seed: 2, away_member_id: qf2.home_member_id, away_seed: 3 });
      await report(db, six, sf1.id, sf1.home_member_id);
      await report(db, six, sf2.id, qf2.home_member_id);
      matches = await allMatches(db, six.leagueId);
      const fin = matches.find((m) => m.id === final.id)!;
      expect(fin).toMatchObject({ home_member_id: sf1.home_member_id, home_seed: 1, away_member_id: qf2.home_member_id, away_seed: 3 });
      await report(db, six, final.id, qf2.home_member_id);
      expect((await leagueRow(db, six.leagueId)).champion_member_id).toBe(qf2.home_member_id);

      const eight = await seasonLeague(db, 8, "top_8");
      await reportRegularSeason(db, eight, (m) => m.away_member_id);
      const bracket = await expectBracket(db, eight, "top_8");
      const quarters = bracket.slice(0, 4);
      const semis = bracket.slice(4, 6);
      const eightFinal = bracket[6];
      for (const qf of quarters) {
        await report(db, eight, qf.id, qf.home_member_id);
      }
      matches = await allMatches(db, eight.leagueId);
      expect(matches.find((m) => m.id === semis[0].id)).toMatchObject({ home_member_id: quarters[0].home_member_id, home_seed: 1, away_member_id: quarters[1].home_member_id, away_seed: 4 });
      expect(matches.find((m) => m.id === semis[1].id)).toMatchObject({ home_member_id: quarters[2].home_member_id, home_seed: 3, away_member_id: quarters[3].home_member_id, away_seed: 2 });
      await report(db, eight, semis[0].id, quarters[1].home_member_id);
      await report(db, eight, semis[1].id, quarters[3].home_member_id);
      matches = await allMatches(db, eight.leagueId);
      expect(matches.find((m) => m.id === eightFinal.id)).toMatchObject({ home_member_id: quarters[1].home_member_id, home_seed: 4, away_member_id: quarters[3].home_member_id, away_seed: 2 });
      await report(db, eight, eightFinal.id, quarters[3].home_member_id);
      expect((await leagueRow(db, eight.leagueId)).champion_member_id).toBe(quarters[3].home_member_id);
      expect((await newsFor(db, eight.leagueId, "season"))[0].message).toBe(`${teamName(eight, quarters[3].home_member_id)} won the championship.`);
      // Once the final is decided every earlier round is locked.
      await expectRpcError(clear(db, eight, quarters[0].id), "later_round_decided");
      await expectRpcError(clear(db, eight, semis[0].id), "later_round_decided");
    });
  });

  describe("champion without playoffs", () => {
    it("the top seed is the champion once the regular season is complete, and loses it when a result is cleared", async () => {
      const league = await seasonLeague(db, 3, "none");
      const regular = regularOf(await allMatches(db, league.leagueId));
      for (const match of regular.slice(0, -1)) {
        await report(db, league, match.id, match.home_member_id);
        expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();
      }
      const last = regular[regular.length - 1];
      await report(db, league, last.id, last.home_member_id);
      const standings = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBe(standings[0].member_id);
      expect(standings[0].seed).toBe(1);
      expect(await newsFor(db, league.leagueId, "season")).toHaveLength(0);
      expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);

      await clear(db, league, last.id);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();
      await report(db, league, last.id, last.away_member_id);
      const reseeded = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBe(reseeded[0].member_id);
      // A Top 2 league crowns the winner of its single playoff match instead.
      const two = await seasonLeague(db, 2, "top_2");
      await reportRegularSeason(db, two);
      const [fin] = await expectBracket(db, two, "top_2");
      await report(db, two, fin.id, fin.away_member_id);
      expect((await leagueRow(db, two.leagueId)).champion_member_id).toBe(fin.away_member_id);
    });
  });

  describe("update_league_settings", () => {
    it("accepts and validates the playoff keys, reseeds the bracket after the regular season, and locks once a playoff result exists", async () => {
      const league = await seasonLeague(db, 4, "top_4");
      await expectRpcError(settings(db, league, { playoff_format: "top_3" }), "invalid_playoff_format");
      await expectRpcError(settings(db, league, { playoff_format: null }), "invalid_playoff_format");
      await expectRpcError(settings(db, league, { tiebreaker: "coin" }), "invalid_tiebreaker");
      await expectRpcError(settings(db, league, { playoff_format: "top_6" }), "not_enough_coaches");
      const row = await settings(db, league, { tiebreaker: "differential", playoff_format: "top_2" });
      expect(row).toMatchObject({ tiebreaker: "differential", playoff_format: "top_2", champion_member_id: null });
      expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);

      await reportRegularSeason(db, league);
      const first = await expectBracket(db, league, "top_2");
      const bracketNews = (await newsFor(db, league.leagueId, "season"))[0].id;
      // A changed tiebreaker reseeds; a changed format rebuilds.
      await settings(db, league, { tiebreaker: "head_to_head" });
      const second = await expectBracket(db, league, "top_2");
      expect(second[0].id).not.toBe(first[0].id);
      expect((await newsFor(db, league.leagueId, "season"))[0].id).not.toBe(bracketNews);
      await settings(db, league, { playoff_format: "top_4" });
      await expectBracket(db, league, "top_4");
      // Echoing the current values leaves the bracket alone.
      const bracket = await expectBracket(db, league, "top_4");
      await settings(db, league, { playoff_format: "top_4", tiebreaker: "head_to_head", name: "Renamed" });
      expect((await allMatches(db, league.leagueId)).filter((m) => m.stage === "playoff").map((m) => m.id)).toEqual(bracket.map((m) => m.id));

      // No playoffs: the bracket goes and the top seed is champion.
      const none = await settings(db, league, { playoff_format: "none" });
      const standings = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect(none.champion_member_id).toBe(standings[0].member_id);
      expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);
      expect(await newsFor(db, league.leagueId, "season")).toHaveLength(0);
      const back = await settings(db, league, { playoff_format: "top_4" });
      expect(back.champion_member_id).toBeNull();
      const [sf1] = await expectBracket(db, league, "top_4");

      await report(db, league, sf1.id, sf1.home_member_id);
      await expectRpcError(settings(db, league, { playoff_format: "top_2" }), "playoffs_started");
      await expectRpcError(settings(db, league, { tiebreaker: "differential" }), "playoffs_started");
      await expectRpcError(settings(db, league, { playoff_format: "none" }), "playoffs_started");
      const echo = await settings(db, league, { playoff_format: "top_4", tiebreaker: "head_to_head", free_agent_swap_limit: 9 });
      expect(echo.free_agent_swap_limit).toBe(9);
      expect(playoffOf(await allMatches(db, league.leagueId)).find((m) => m.id === sf1.id)?.status).toBe("completed");
    });

    it("before the draft any format is accepted; the coach count is checked once the draft has started", async () => {
      const league = await buildLeague(db, { coaches: 1, maxCoaches: 8, playoffFormat: "none" });
      const row = await settings(db, league, { playoff_format: "top_8" });
      expect(row.playoff_format).toBe("top_8");
      await rpcAs(db, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
      await expectRpcError(settings(db, league, { playoff_format: "top_4" }), "not_enough_coaches");
      const ok = await settings(db, league, { playoff_format: "top_2" });
      expect(ok.playoff_format).toBe("top_2");
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "update_league_settings", { p_league_id: league.leagueId, p_settings: { tiebreaker: "differential" } }), "not_commissioner");
    });

    it("a tiebreaker change after a complete season in a league that cannot fill its playoff format is saved and leaves the league without a bracket", async () => {
      // Three coaches with create_league's default of Top 4: the last regular
      // result leaves the league without a bracket. Changing only the
      // tiebreaker, a control the client has no reason to disable, is held to
      // nothing more; only a changed format is checked against the coach count.
      const league = await seasonLeague(db, 3, "top_4");
      await reportRegularSeason(db, league);
      expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);
      const row = await settings(db, league, { tiebreaker: "differential" });
      expect(row).toMatchObject({ tiebreaker: "differential", playoff_format: "top_4", champion_member_id: null });
      expect((await leagueRow(db, league.leagueId)).tiebreaker).toBe("differential");
      expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);
      expect(await newsFor(db, league.leagueId, "season")).toHaveLength(0);
      // Echoing the format next to it is the same change; a format the league
      // cannot fill is still refused and nothing is saved; one it can fill
      // builds the bracket at once.
      await settings(db, league, { tiebreaker: "head_to_head", playoff_format: "top_4" });
      expect((await leagueRow(db, league.leagueId)).tiebreaker).toBe("head_to_head");
      expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);
      await expectRpcError(settings(db, league, { playoff_format: "top_6", tiebreaker: "differential" }), "not_enough_coaches");
      expect((await leagueRow(db, league.leagueId)).tiebreaker).toBe("head_to_head");
      const filled = await settings(db, league, { playoff_format: "top_2", tiebreaker: "differential" });
      expect(filled).toMatchObject({ playoff_format: "top_2", tiebreaker: "differential" });
      await expectBracket(db, league, "top_2");
    });
  });

  describe("clear_playoffs, clear_match_result, generate_schedule and reset_draft", () => {
    it("clear_playoffs removes the bracket, its news and the champion even with results, and keeps the regular season", async () => {
      const league = await seasonLeague(db, 4, "top_4");
      await reportRegularSeason(db, league);
      const [sf1, sf2, final] = await expectBracket(db, league, "top_4");
      await report(db, league, sf1.id, sf1.home_member_id);
      await report(db, league, sf2.id, sf2.home_member_id);
      await report(db, league, final.id, sf1.home_member_id);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBe(sf1.home_member_id);
      const regularNews = (await newsFor(db, league.leagueId, "match_result")).filter((n) => n.metadata.stage === "regular");

      await expectRpcError(rpcAs(db, league.coaches[0].userId, "clear_playoffs", { p_league_id: league.leagueId }), "not_commissioner");
      await expectRpcError(rpcAs(db, league.commissioner.userId, "clear_playoffs", { p_league_id: randomUUID() }), "league_not_found");
      await rpcAs(db, league.commissioner.userId, "clear_playoffs", { p_league_id: league.leagueId });
      const matches = await allMatches(db, league.leagueId);
      expect(playoffOf(matches)).toHaveLength(0);
      expect(regularOf(matches).every((m) => m.status === "completed")).toBe(true);
      expect((await newsFor(db, league.leagueId, "match_result")).map((n) => n.id).sort()).toEqual(regularNews.map((n) => n.id).sort());
      expect(await newsFor(db, league.leagueId, "season")).toHaveLength(0);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();
      // Clearing twice is harmless, and the bracket can be rebuilt.
      await rpcAs(db, league.commissioner.userId, "clear_playoffs", { p_league_id: league.leagueId });
      expect(await rpcAs<number>(db, league.commissioner.userId, "generate_playoffs", { p_league_id: league.leagueId })).toBe(3);
      await expectBracket(db, league, "top_4");
    });

    it("clearing a regular result with an unplayed bracket removes the bracket; the next full season rebuilds it", async () => {
      const league = await seasonLeague(db, 4, "top_4");
      await reportRegularSeason(db, league);
      await expectBracket(db, league, "top_4");
      const [regular] = regularOf(await allMatches(db, league.leagueId));
      await clear(db, league, regular.id);
      expect(playoffOf(await allMatches(db, league.leagueId))).toHaveLength(0);
      expect(await newsFor(db, league.leagueId, "season")).toHaveLength(0);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();
      await report(db, league, regular.id, regular.away_member_id);
      await expectBracket(db, league, "top_4");
    });

    it("generate_schedule and reset_draft clear the champion and the season news", async () => {
      const league = await seasonLeague(db, 2, "top_2");
      await reportRegularSeason(db, league);
      const [fin] = await expectBracket(db, league, "top_2");
      await report(db, league, fin.id, fin.home_member_id);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBe(fin.home_member_id);
      expect(await newsFor(db, league.leagueId, "season")).toHaveLength(2);
      await expectRpcError(
        rpcAs(db, league.commissioner.userId, "generate_schedule", { p_league_id: league.leagueId, p_format: "round_robin", p_randomize: false }),
        "results_exist",
      );
      const regenerated = await rpcAs<number>(db, league.commissioner.userId, "generate_schedule", {
        p_league_id: league.leagueId,
        p_format: "double_round_robin",
        p_randomize: false,
        p_discard_results: true,
      });
      expect(regenerated).toBe(2);
      const matches = await allMatches(db, league.leagueId);
      expect(matches.every((m) => m.stage === "regular" && m.status === "upcoming")).toBe(true);
      expect(await newsFor(db, league.leagueId)).toHaveLength(0);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBeNull();

      await reportRegularSeason(db, league);
      const [again] = await expectBracket(db, league, "top_2");
      await report(db, league, again.id, again.away_member_id);
      expect((await leagueRow(db, league.leagueId)).champion_member_id).toBe(again.away_member_id);
      await rpcAs(db, league.commissioner.userId, "reset_draft", { p_league_id: league.leagueId });
      const row = await leagueRow(db, league.leagueId);
      expect(row.champion_member_id).toBeNull();
      expect(row.draft_completed).toBe(false);
      expect(await count(db, "league_matches", "league_id = $1", [league.leagueId])).toBe(0);
      expect(await count(db, "league_news", "league_id = $1", [league.leagueId])).toBe(0);
    });
  });

  describe("winner_remaining", () => {
    it("is optional, validated 1..12, stored, cleared with the result, and feeds the differential", async () => {
      const league = await seasonLeague(db, 3, "none");
      const [a, b] = regularOf(await allMatches(db, league.leagueId));
      await expectRpcError(report(db, league, a.id, a.home_member_id, 0), "invalid_score");
      await expectRpcError(report(db, league, a.id, a.home_member_id, 13), "invalid_score");
      await expectRpcError(report(db, league, a.id, a.home_member_id, -1), "invalid_score");
      await report(db, league, a.id, a.home_member_id, 5);
      await report(db, league, b.id, b.away_member_id);
      const matches = await allMatches(db, league.leagueId);
      expect(matches.find((m) => m.id === a.id)?.winner_remaining).toBe(5);
      expect(matches.find((m) => m.id === b.id)?.winner_remaining).toBeNull();
      const standings = await standingsAs(db, league.commissioner.userId, league.leagueId);
      const byMember = new Map(standings.map((s) => [s.member_id, s]));
      expect(byMember.get(a.home_member_id!)?.differential).toBe(5);
      expect(byMember.get(a.away_member_id!)?.differential).toBe(-5);
      expect(byMember.get(b.away_member_id!)?.differential ?? 0).toBe(byMember.get(b.away_member_id!)?.member_id === a.home_member_id ? 5 : byMember.get(b.away_member_id!)?.member_id === a.away_member_id ? -5 : 0);
      // Re-reporting without a count clears it; clearing the result does too.
      await report(db, league, a.id, a.home_member_id);
      expect((await allMatches(db, league.leagueId)).find((m) => m.id === a.id)?.winner_remaining).toBeNull();
      await report(db, league, a.id, a.home_member_id, 12);
      await clear(db, league, a.id);
      expect((await allMatches(db, league.leagueId)).find((m) => m.id === a.id)).toMatchObject({ status: "upcoming", winner_member_id: null, winner_remaining: null });
    });
  });

  describe("permissions", () => {
    it("league_standings is for members, the playoff mutations for the commissioner, and none of it for anon", async () => {
      const league = await seasonLeague(db, 3, "none");
      const outsider = await createUser(db);
      await expectRpcError(standingsAs(db, outsider, league.leagueId), "not_a_member");
      await expectRpcError(standingsAs(db, outsider, randomUUID()), "league_not_found");
      const asCoach = await standingsAs(db, league.coaches[0].userId, league.leagueId);
      expect(asCoach).toHaveLength(3);
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "generate_playoffs", { p_league_id: league.leagueId }), "not_commissioner");
      await expectRpcError(rpcAs(db, league.coaches[0].userId, "clear_playoffs", { p_league_id: league.leagueId }), "not_commissioner");
      await expectRpcError(rpcAs(db, outsider, "clear_playoffs", { p_league_id: league.leagueId }), "not_commissioner");
      for (const fn of ["league_standings", "generate_playoffs", "clear_playoffs"]) {
        await expectSqlState(asAnon(db, (c) => rpc(c, fn, { p_league_id: league.leagueId })), "42501");
      }
      for (const fn of ["_league_standings", "_generate_playoffs", "_delete_playoffs", "_crown_top_seed"]) {
        const { rows } = await db.query<{ ok: boolean }>(
          "select has_function_privilege('authenticated', p.oid, 'execute') as ok from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1",
          [fn],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].ok, `${fn} must stay internal`).toBe(false);
      }
    });
  });

  describe("migration data fix", () => {
    it("re-applying the playoffs file names the top seed champion of finished leagues without playoffs and touches nothing else", async () => {
      const finished = await seasonLeague(db, 3, "none");
      await reportRegularSeason(db, finished);
      const topSeed = (await standingsAs(db, finished.commissioner.userId, finished.leagueId))[0].member_id;
      // Pre-migration state: no champion column value yet.
      await db.query("update public.leagues set champion_member_id = null where id = $1", [finished.leagueId]);
      const unfinished = await seasonLeague(db, 3, "none");
      const [one] = regularOf(await allMatches(db, unfinished.leagueId));
      await report(db, unfinished, one.id, one.home_member_id);
      const bracketed = await seasonLeague(db, 4, "top_4");
      await reportRegularSeason(db, bracketed);
      const bracket = await expectBracket(db, bracketed, "top_4");
      const playoffs = readMigrations().find((m) => m.name === PLAYOFFS_MIGRATION);
      if (!playoffs) throw new Error("playoffs migration missing");

      for (let pass = 0; pass < 2; pass += 1) {
        await applyMigration(db, playoffs);
        expect((await leagueRow(db, finished.leagueId)).champion_member_id).toBe(topSeed);
        expect((await leagueRow(db, unfinished.leagueId)).champion_member_id).toBeNull();
        expect((await leagueRow(db, bracketed.leagueId)).champion_member_id).toBeNull();
        expect(playoffOf(await allMatches(db, bracketed.leagueId)).map((m) => m.id)).toEqual(bracket.map((m) => m.id));
      }
      // The functions still work after the re-apply.
      await report(db, bracketed, bracket[0].id, bracket[0].home_member_id);
      expect(playoffOf(await allMatches(db, bracketed.leagueId)).find((m) => m.id === bracket[2].id)?.home_member_id).toBe(bracket[0].home_member_id);
    });
  });

  describe("league_standings", () => {
    // Sets the six results of a 4-coach round robin by pairing.
    async function setResults(league: LeagueFixture, results: Array<[string, string, number | null]>): Promise<void> {
      const matches = regularOf(await allMatches(db, league.leagueId));
      for (const [winner, loser, remaining] of results) {
        const match = matches.find((m) => (m.home_member_id === winner && m.away_member_id === loser) || (m.home_member_id === loser && m.away_member_id === winner));
        if (!match) throw new Error("pairing not in the schedule");
        await db.query("update public.league_matches set status = 'completed', winner_member_id = $2, winner_remaining = $3 where id = $1", [match.id, winner, remaining]);
      }
    }

    it("applies each tiebreaker to the coaches still tied, in the league's order, down to the coin flip", async () => {
      const league = await seasonLeague(db, 4, "none");
      const [a, b, c, d] = league.order.map((p) => p.memberId);
      // A, B and C are 2-1 with a circular head-to-head (all 1-1), D is 0-3.
      // Differential: A 3, B 1, C 1. Strength of schedule: B and C both faced
      // A, each other and D. Only the coin flip (member id) separates B and C.
      await setResults(league, [
        [a, b, 2],
        [b, c, 2],
        [c, a, 2],
        [a, d, 3],
        [b, d, 1],
        [c, d, 1],
      ]);
      const rows = await standingsAs(db, league.commissioner.userId, league.leagueId);
      const [bc1, bc2] = [b, c].sort();
      expect(rows.map((r) => r.member_id)).toEqual([a, bc1, bc2, d]);
      expect(rows.map((r) => r.seed)).toEqual([1, 2, 3, 4]);
      expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
      expect(rows.map((r) => r.tied)).toEqual([false, true, true, false]);
      expect(rows.map((r) => r.head_to_head_applied)).toEqual([false, false, false, false]);
      expect(rows.map((r) => r.differential)).toEqual([3, 1, 1, -5]);
      expect(rows.map((r) => [r.wins, r.losses, r.played, r.remaining])).toEqual([[2, 1, 3, 0], [2, 1, 3, 0], [2, 1, 3, 0], [0, 3, 3, 0]]);
      expect(rows.map((r) => r.win_pct)).toEqual([0.667, 0.667, 0.667, 0]);
      // B's and C's opponents: A (2/3), the other one (2/3) and D (0).
      expect(rows[1].strength_of_schedule).toBe(0.444);
      expect(rows[3].strength_of_schedule).toBe(0.667);
      // Differential first: A (3) leads; B and C tie on differential (1) and
      // the head-to-head between just those two (B beat C) separates them,
      // so nothing is left for the coin flip.
      await settings(db, league, { tiebreaker: "differential" });
      const diffFirst = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect(diffFirst.map((r) => r.member_id)).toEqual([a, b, c, d]);
      expect(diffFirst.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
      expect(diffFirst.every((r) => !r.tied)).toBe(true);
      expect(diffFirst.map((r) => r.head_to_head_applied)).toEqual([false, true, true, false]);
    });

    it("head-to-head is taken among the coaches still tied when it is applied, and head_to_head_applied says so", async () => {
      const league = await seasonLeague(db, 4, "none");
      const [a, b, c, d] = league.order.map((p) => p.memberId);
      // A and B are 2-1 (A beat B), C and D are 1-2 (C beat D); every
      // winner_remaining is 1, so the differentials tie inside each pair.
      await setResults(league, [
        [a, b, 1],
        [a, c, 1],
        [d, a, 1],
        [b, c, 1],
        [b, d, 1],
        [c, d, 1],
      ]);
      const h2h = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect(h2h.map((r) => r.member_id)).toEqual([a, b, c, d]);
      expect(h2h.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
      expect(h2h.every((r) => !r.tied)).toBe(true);
      expect(h2h.map((r) => r.head_to_head_applied)).toEqual([true, true, true, true]);
      expect(h2h.map((r) => r.differential)).toEqual([1, 1, -1, -1]);

      await settings(db, league, { tiebreaker: "differential" });
      const same = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect(same.map((r) => r.member_id)).toEqual([a, b, c, d]);
      expect(same.map((r) => r.head_to_head_applied)).toEqual([true, true, true, true]);

      // A's win over C by 3 changes both differentials: with differential
      // first A (3) is above B (1) and D (-1) above C (-3) without any
      // head-to-head comparison; with head-to-head first the records still
      // decide both pairs, so C stays above D.
      await setResults(league, [[a, c, 3]]);
      const diffFirst = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect(diffFirst.map((r) => r.member_id)).toEqual([a, b, d, c]);
      expect(diffFirst.map((r) => r.differential)).toEqual([3, 1, -1, -3]);
      expect(diffFirst.map((r) => r.head_to_head_applied)).toEqual([false, false, false, false]);
      expect(diffFirst.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
      await settings(db, league, { tiebreaker: "head_to_head" });
      const h2hFirst = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect(h2hFirst.map((r) => r.member_id)).toEqual([a, b, c, d]);
      expect(h2hFirst.map((r) => r.differential)).toEqual([3, 1, -3, -1]);
      expect(h2hFirst.map((r) => r.head_to_head_applied)).toEqual([true, true, true, true]);

      // Same records (A and B 2-1, C and D 1-2, differentials tied inside
      // each pair) with the pair results reversed: the head-to-head standings
      // follow.
      await setResults(league, [
        [b, a, 1],
        [a, c, 1],
        [a, d, 1],
        [b, c, 1],
        [d, b, 1],
        [c, d, 1],
      ]);
      const flipped = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect(flipped.map((r) => r.member_id)).toEqual([b, a, c, d]);
      expect(flipped.map((r) => [r.wins, r.losses])).toEqual([[2, 1], [2, 1], [1, 2], [1, 2]]);
      expect(flipped.map((r) => r.differential)).toEqual([1, 1, -1, -1]);
      expect(flipped.map((r) => r.head_to_head_applied)).toEqual([true, true, true, true]);
    });

    it("counts only decided regular matches, ignores playoff matches, and excludes spectators who never played", async () => {
      const league = await seasonLeague(db, 3, "top_2");
      const spectatorUser = await createUser(db);
      await db.query("insert into public.league_members (league_id, user_id, role, team_name) values ($1, $2, 'coach', 'Watcher')", [league.leagueId, spectatorUser]);
      const spectator = await memberFor(db, league.leagueId, spectatorUser);
      const rows = await standingsAs(db, spectatorUser, league.leagueId);
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.member_id)).not.toContain(spectator.id);
      expect(rows.every((r) => r.wins === 0 && r.losses === 0 && r.played === 0 && r.remaining === 2 && r.win_pct === 0 && r.strength_of_schedule === 0)).toBe(true);
      // Nothing played: the coin flip orders everyone, all tied at rank 1.
      expect(rows.map((r) => r.member_id)).toEqual([...rows.map((r) => r.member_id)].sort());
      expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
      expect(rows.every((r) => r.tied)).toBe(true);

      await reportRegularSeason(db, league);
      const before = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect(before.every((r) => r.remaining === 0 && r.played === 2)).toBe(true);
      const [fin] = await expectBracket(db, league, "top_2");
      await report(db, league, fin.id, fin.away_member_id, 6);
      expect(await standingsAs(db, league.commissioner.userId, league.leagueId)).toEqual(before);
      // A match completed without a winner is not decided either.
      const [regular] = regularOf(await allMatches(db, league.leagueId));
      await db.query("update public.league_matches set winner_member_id = null where id = $1", [regular.id]);
      const undecided = await standingsAs(db, league.commissioner.userId, league.leagueId);
      expect(undecided.find((r) => r.member_id === regular.home_member_id)?.remaining).toBe(1);
      expect(undecided.find((r) => r.member_id === regular.away_member_id)?.played).toBe(1);
    });

    it("computes a 24-coach double round robin well under a second", async () => {
      const rng = mulberry32(2024);
      const commissioner = await createUser(db);
      const { rows } = await db.query<{ id: string }>(
        `insert into public.leagues (name, commissioner_id, max_coaches, draft_started, draft_completed, tiebreaker, playoff_format, schedule_format, custom_pool)
         values ('Big', $1, 24, true, true, 'head_to_head', 'none', 'double_round_robin', $2::jsonb) returning id`,
        [commissioner, FIXTURE_POOL],
      );
      const leagueId = rows[0].id;
      const members = Array.from({ length: 24 }, (_, i) => ({ id: randomUUID(), user_id: i === 0 ? commissioner : randomUUID(), position: i + 1 }));
      await db.query(
        `insert into public.league_members (id, league_id, user_id, role, team_name, draft_position)
         select m.id, $1, m.user_id, 'coach', 'Team ' || m.position, m.position
         from jsonb_to_recordset($2::jsonb) as m(id uuid, user_id uuid, position integer)`,
        [leagueId, JSON.stringify(members)],
      );
      const schedule = await db.query<{ round_number: number; match_number: number; home_member_id: string; away_member_id: string }>(
        "select * from public._schedule_rows($1::uuid[], 'double_round_robin')",
        [members.map((m) => m.id)],
      );
      expect(schedule.rows).toHaveLength(552);
      await db.query(
        `insert into public.league_matches (league_id, round_number, match_number, home_member_id, away_member_id, status, winner_member_id, winner_remaining)
         select $1, m.round_number, m.match_number, m.home_member_id, m.away_member_id, 'completed', m.winner_member_id, m.winner_remaining
         from jsonb_to_recordset($2::jsonb) as m(round_number integer, match_number integer, home_member_id uuid, away_member_id uuid, winner_member_id uuid, winner_remaining integer)`,
        [
          leagueId,
          JSON.stringify(
            schedule.rows.map((s) => ({
              ...s,
              winner_member_id: rng() < 0.5 ? s.home_member_id : s.away_member_id,
              winner_remaining: rng() < 0.3 ? null : 1 + Math.floor(rng() * 6),
            })),
          ),
        ],
      );
      const started = performance.now();
      const standings = await standingsAs(db, commissioner, leagueId);
      const elapsed = performance.now() - started;
      expect(standings).toHaveLength(24);
      expect(standings.map((s) => s.seed)).toEqual(members.map((_, i) => i + 1));
      expect(standings.every((s) => s.played === 46 && s.remaining === 0)).toBe(true);
      expect(elapsed, `league_standings took ${elapsed.toFixed(0)} ms`).toBeLessThan(1000);
    });
  });

  describe("comparison precision (shared with computeStandings)", () => {
    // Hand-built leagues where comparing percentages at 3 decimals, the
    // precision both implementations report, decides the order: two exact
    // ratios that differ only past the third decimal count as equal, and a
    // mean that sits exactly on a rounding boundary rounds up on both sides.

    it("two coaches whose strength of schedule differs by less than 0.0005 are a coin-flip tie in both implementations", async () => {
      // A and B are 1-1, never met, and every winner_remaining is null. A's
      // opponents finish 2-1 and 3-1 (mean 0.708333), B's 4-1 and 8-5
      // (0.707692): both print as .708, so the coin flip decides (B has the
      // smaller id) and the two share rank 6.
      for (const tiebreaker of ["head_to_head", "differential"] as const) {
        const [bId, aId] = [randomUUID(), randomUUID()].sort();
        const a = fixtureCoach("A", 1, aId);
        const b = fixtureCoach("B", 2, bId);
        const x = fixtureCoach("X", 3);
        const y = fixtureCoach("Y", 4);
        const z = fixtureCoach("Z", 5);
        const w = fixtureCoach("W", 6);
        const f1 = fixtureCoach("F1", 7);
        const f2 = fixtureCoach("F2", 8);
        const f3 = fixtureCoach("F3", 9);
        const members = [a, b, x, y, z, w, f1, f2, f3];
        const matches = decided([
          [a.id, x.id], [y.id, a.id],
          [b.id, z.id], [w.id, b.id],
          [x.id, f2.id], [x.id, f3.id],
          [y.id, f2.id], [y.id, f3.id], [f1.id, y.id],
          [z.id, f2.id], [z.id, f2.id], [z.id, f3.id], [z.id, f3.id],
          [w.id, f2.id], [w.id, f2.id], [w.id, f2.id], [w.id, f2.id], [w.id, f3.id], [w.id, f3.id], [w.id, f3.id],
          [f1.id, w.id], [f1.id, w.id], [f1.id, w.id], [f1.id, w.id], [f1.id, w.id],
        ]);
        const league = await writeFixture(db, tiebreaker, "double_round_robin", members, matches);
        const sql = await standingsAs(db, league.commissioner, league.leagueId);
        expect(sql.map((r) => r.member_id), tiebreaker).toEqual([f1, z, y, x, w, b, a, f3, f2].map((m) => m.id));
        expect(sql.map((r) => r.rank), tiebreaker).toEqual([1, 2, 3, 4, 5, 6, 6, 8, 9]);
        expect(sql.map((r) => r.tied), tiebreaker).toEqual([false, false, false, false, false, true, true, false, false]);
        expect(sql.slice(5, 7).map((r) => [r.wins, r.losses, r.win_pct, r.strength_of_schedule]), tiebreaker).toEqual([[1, 1, 0.5, 0.708], [1, 1, 0.5, 0.708]]);
        expectMirror(sql, members, matches, tiebreaker, `strength of schedule collision, ${tiebreaker} first`);
      }
    });

    it("two coaches whose win percentages differ only past the third decimal tie on percentage in both implementations, so wins decide", async () => {
      // A is 10-17 (0.37037) and B 17-29 (0.36957): both print as .370, so
      // B's 17 wins seed B first whatever the exact ratios say. F1 (17-10,
      // .630) and F2 (29-17, .630) show the same at the top.
      const a = fixtureCoach("A", 1);
      const b = fixtureCoach("B", 2);
      const f1 = fixtureCoach("F1", 3);
      const f2 = fixtureCoach("F2", 4);
      const pairs: Array<[string, string]> = [];
      for (let i = 0; i < 27; i += 1) pairs.push(i < 10 ? [a.id, f1.id] : [f1.id, a.id]);
      for (let i = 0; i < 46; i += 1) pairs.push(i < 17 ? [b.id, f2.id] : [f2.id, b.id]);
      const members = [a, b, f1, f2];
      const matches = decided(pairs);
      const league = await writeFixture(db, "head_to_head", "double_round_robin", members, matches);
      const sql = await standingsAs(db, league.commissioner, league.leagueId);
      expect(sql.map((r) => [r.member_id, r.rank, r.tied, r.wins, r.win_pct])).toEqual([
        [f2.id, 1, false, 29, 0.63],
        [f1.id, 2, false, 17, 0.63],
        [b.id, 3, false, 17, 0.37],
        [a.id, 4, false, 10, 0.37],
      ]);
      expectMirror(sql, members, matches, "head_to_head", "win percentage collision");
    });

    it("a strength of schedule that sits exactly on a rounding boundary rounds up in both implementations", async () => {
      // A's opponents finish 1-2, 1-2, 1-2 and 1-3: the mean of three
      // repeating thirds and a quarter is exactly 0.3125, which the function's
      // numeric arithmetic and the mirror's nudged double both round to .313.
      // B, also 3-1, has the same mean from exact quarters and a half, so the
      // two are a coin-flip tie (A has the smaller id); a function that
      // rounded A's mean down would seed B above A.
      const [aId, bId] = [randomUUID(), randomUUID()].sort();
      const a = fixtureCoach("A", 1, aId);
      const b = fixtureCoach("B", 2, bId);
      const x = fixtureCoach("X", 3);
      const y = fixtureCoach("Y", 4);
      const z = fixtureCoach("Z", 5);
      const w = fixtureCoach("W", 6);
      const p = fixtureCoach("P", 7);
      const q = fixtureCoach("Q", 8);
      const r = fixtureCoach("R", 9);
      const s = fixtureCoach("S", 10);
      const t = fixtureCoach("T", 11);
      const u = fixtureCoach("U", 12);
      const v = fixtureCoach("V", 13);
      const g = fixtureCoach("G", 14);
      const h = fixtureCoach("H", 15);
      const members = [a, b, x, y, z, w, p, q, r, s, t, u, v, g, h];
      const matches = decided([
        [a.id, x.id], [a.id, y.id], [a.id, z.id], [w.id, a.id],
        [x.id, p.id], [q.id, x.id], [y.id, p.id], [q.id, y.id], [z.id, p.id], [q.id, z.id],
        [p.id, w.id], [q.id, w.id], [r.id, w.id],
        [b.id, s.id], [b.id, t.id], [b.id, u.id], [v.id, b.id],
        [s.id, g.id], [h.id, s.id], [h.id, s.id],
        [t.id, g.id], [h.id, t.id], [h.id, t.id],
        [u.id, g.id], [h.id, u.id], [h.id, u.id],
        [h.id, v.id],
      ]);
      const league = await writeFixture(db, "head_to_head", "double_round_robin", members, matches);
      const sql = await standingsAs(db, league.commissioner, league.leagueId);
      const aRow = sql.find((row) => row.member_id === a.id);
      const bRow = sql.find((row) => row.member_id === b.id);
      expect([aRow?.strength_of_schedule, bRow?.strength_of_schedule]).toEqual([0.313, 0.313]);
      expect([aRow?.wins, aRow?.losses, bRow?.wins, bRow?.losses]).toEqual([3, 1, 3, 1]);
      // H (7-0), Q (4-0) and R (1-0) lead; then A and B share rank 4.
      expect(sql.slice(3, 5).map((row) => [row.member_id, row.rank, row.tied])).toEqual([[a.id, 4, true], [b.id, 4, true]]);
      expectMirror(sql, members, matches, "head_to_head", "strength of schedule on a rounding boundary");
    });
  });

  describe("SQL / TypeScript parity", () => {
    const FIXTURES_PER_SETTING = 200;
    const seed = Number(process.env.PLAYOFFS_PARITY_SEED ?? 20260912);

    for (const tiebreaker of ["head_to_head", "differential"] as const) {
      it(`league_standings and computeStandings agree on ${FIXTURES_PER_SETTING} random fixtures with ${tiebreaker} first (seed ${seed})`, async () => {
        const rng = mulberry32(seed + (tiebreaker === "differential" ? 1 : 0));
        for (let i = 0; i < FIXTURES_PER_SETTING; i += 1) {
          const fixture = await randomFixture(db, rng, tiebreaker);
          const label = `fixture ${i} (${tiebreaker}, league ${fixture.leagueId})`;
          const sql = await standingsAs(db, fixture.commissioner, fixture.leagueId);
          expectMirror(sql, fixture.members, fixture.matches, tiebreaker, label);
        }
      });
    }
  });
});
