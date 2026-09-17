// Review probes for the playoffs migration (round 3, backend track):
//   1. does the parity generator in playoffs.test.ts actually exercise every
//      tiebreaker (the same seed and rng call order, so the same 400 fixtures)?
//   2. how long do league_standings and the calls that run it several times
//      (the last regular result, a settings reseed, generate_playoffs) take on
//      a 24-coach double round robin?
//   3. does the file apply to a database shaped like the live project before
//      the hardening file ran (a news_type check under a different name, a
//      hand-added playoff_format column with a value outside the set, a
//      finished league without playoffs)?
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeStandings, roundPercentage, tiebreakerSteps } from "../../app/lib/league/standings";
import { asUser, connect, createUser, rpcAs, type Client } from "./harness";
import { HARDENING_MIGRATION, PLAYOFFS_MIGRATION, applyMigration, createDatabaseSql, createScaffolding, readMigrations } from "./migrations-lib";

type Tiebreaker = "head_to_head" | "differential";
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

const FIXTURE_POOL = JSON.stringify({ version: "1.0", leagueName: "Fixture", pokemon: [{ name: "Mon001", points: 1, tier: 20 }] });

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

// Same rng call order as randomFixture in playoffs.test.ts, so the same
// fixtures come out for the same seed. The rows are not written: only the
// generator's tie structure is measured here.
function randomFixtureShape(rng: () => number, scheduleRows: (ids: string[], format: string) => Promise<Array<{ round_number: number; match_number: number; home_member_id: string; away_member_id: string }>>): Promise<{ members: FixtureMember[]; matches: FixtureMatch[] }> {
  return (async () => {
    const n = 3 + Math.floor(rng() * 7);
    const scheduleFormat = rng() < 0.5 ? "round_robin" : "double_round_robin";
    const members: FixtureMember[] = [];
    for (let i = 0; i < n; i += 1) {
      members.push({ id: randomUUID(), team_name: `Team ${i + 1}`, draft_position: i + 1 });
    }
    if (rng() < 0.3) {
      members.push({ id: randomUUID(), team_name: "Spectator", draft_position: null });
    }
    const playing = members.filter((m) => m.draft_position !== null);
    const schedule = await scheduleRows(playing.map((m) => m.id), scheduleFormat);
    const matches: FixtureMatch[] = schedule.map((s) => {
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
    return { members, matches };
  })();
}

type Step = "head_to_head" | "differential" | "strength_of_schedule" | "coin_flip";

// Which step separated each consecutive pair that is tied on percentage and
// wins, following the refinement of section 12.3 exactly.
function separatingSteps(members: FixtureMember[], matches: FixtureMatch[], tiebreaker: Tiebreaker): Step[] {
  const playing = members.filter((m) => m.draft_position !== null);
  const rows = computeStandings(playing, matches, tiebreaker);
  const completed = matches
    .filter((m) => m.stage === "regular" && m.status === "completed" && m.winner_member_id)
    .map((m) => ({ winner: m.winner_member_id!, loser: m.winner_member_id === m.home_member_id ? m.away_member_id : m.home_member_id }));
  const h2h = (id: string, group: Set<string>) => {
    let wins = 0;
    let games = 0;
    for (const m of completed) {
      if (m.winner === id && group.has(m.loser)) {
        wins += 1;
        games += 1;
      } else if (m.loser === id && group.has(m.winner)) {
        games += 1;
      }
    }
    return games > 0 ? roundPercentage(wins / games) : 0;
  };
  const steps: Step[] = [];
  for (let i = 0; i + 1 < rows.length; i += 1) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a.winPercentage !== b.winPercentage || a.wins !== b.wins) continue;
    let group = rows.filter((r) => r.winPercentage === a.winPercentage && r.wins === a.wins);
    for (const step of tiebreakerSteps(tiebreaker)) {
      if (step === "coin_flip") {
        steps.push("coin_flip");
        break;
      }
      const ids = new Set(group.map((r) => r.member.id));
      const key = (r: (typeof rows)[number]) =>
        step === "head_to_head" ? h2h(r.member.id, ids) : step === "differential" ? r.differential : r.strengthOfSchedule;
      if (key(a) !== key(b)) {
        steps.push(step);
        break;
      }
      group = group.filter((r) => key(r) === key(a));
    }
  }
  return steps;
}

describe("review r3: parity generator coverage", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  for (const tiebreaker of ["head_to_head", "differential"] as const) {
    it(`the 200 ${tiebreaker}-first fixtures of the default seed reach every tiebreaker`, async () => {
      const seed = Number(process.env.PLAYOFFS_PARITY_SEED ?? 20260912);
      const rng = mulberry32(seed + (tiebreaker === "differential" ? 1 : 0));
      const scheduleRows = async (ids: string[], format: string) =>
        (await db.query<{ round_number: number; match_number: number; home_member_id: string; away_member_id: string }>("select * from public._schedule_rows($1::uuid[], $2)", [ids, format])).rows;
      const perFixture = { any: 0, head_to_head: 0, differential: 0, strength_of_schedule: 0, coin_flip: 0 };
      const pairs = { head_to_head: 0, differential: 0, strength_of_schedule: 0, coin_flip: 0 };
      let secondaryReached = 0;
      for (let i = 0; i < 200; i += 1) {
        const { members, matches } = await randomFixtureShape(rng, scheduleRows);
        const steps = separatingSteps(members, matches, tiebreaker);
        if (steps.length > 0) perFixture.any += 1;
        const seen = new Set(steps);
        for (const step of seen) perFixture[step] += 1;
        for (const step of steps) pairs[step] += 1;
        const secondary = tiebreaker === "head_to_head" ? "differential" : "head_to_head";
        if (seen.has(secondary) || seen.has("strength_of_schedule") || seen.has("coin_flip")) secondaryReached += 1;
      }
      console.log(`COVERAGE ${tiebreaker} first: fixtures with a tie past wins=${perFixture.any}/200; fixtures separated by head_to_head=${perFixture.head_to_head}, differential=${perFixture.differential}, strength_of_schedule=${perFixture.strength_of_schedule}, coin_flip=${perFixture.coin_flip}; pairs h2h=${pairs.head_to_head} diff=${pairs.differential} sos=${pairs.strength_of_schedule} coin=${pairs.coin_flip}; fixtures past the first tiebreaker=${secondaryReached}`);
      expect(perFixture.head_to_head).toBeGreaterThan(0);
      expect(perFixture.differential).toBeGreaterThan(0);
      expect(perFixture.strength_of_schedule).toBeGreaterThan(0);
      expect(perFixture.coin_flip).toBeGreaterThan(0);
    });
  }
});

describe("review r3: league_standings and the calls that run it repeatedly at 24 coaches", () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db.end();
  });

  it("times the last regular result (bracket build), a settings reseed, generate_playoffs and league_standings on a 24-coach double round robin", async () => {
    const rng = mulberry32(77);
    const commissioner = await createUser(db);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.leagues (name, commissioner_id, max_coaches, draft_started, draft_completed, tiebreaker, playoff_format, schedule_format, custom_pool)
       values ('Big', $1, 24, true, true, 'head_to_head', 'top_8', 'double_round_robin', $2::jsonb) returning id`,
      [commissioner, FIXTURE_POOL],
    );
    const leagueId = rows[0].id;
    const members = Array.from({ length: 24 }, (_, i) => ({ id: randomUUID(), user_id: i === 0 ? commissioner : randomUUID(), position: i + 1 }));
    await db.query(
      `insert into public.league_members (id, league_id, user_id, role, team_name, draft_position)
       select m.id, $1, m.user_id, case when m.position = 1 then 'commissioner' else 'coach' end, 'Team ' || m.position, m.position
       from jsonb_to_recordset($2::jsonb) as m(id uuid, user_id uuid, position integer)`,
      [leagueId, JSON.stringify(members)],
    );
    const schedule = await db.query<{ round_number: number; match_number: number; home_member_id: string; away_member_id: string }>(
      "select * from public._schedule_rows($1::uuid[], 'double_round_robin')",
      [members.map((m) => m.id)],
    );
    expect(schedule.rows).toHaveLength(552);
    const withResults = schedule.rows.map((s, index) => ({
      ...s,
      last: index === schedule.rows.length - 1,
      winner_member_id: rng() < 0.5 ? s.home_member_id : s.away_member_id,
      winner_remaining: rng() < 0.3 ? null : 1 + Math.floor(rng() * 6),
    }));
    const inserted = await db.query<{ id: string; last: boolean }>(
      `insert into public.league_matches (league_id, round_number, match_number, home_member_id, away_member_id, status, winner_member_id, winner_remaining)
       select $1, m.round_number, m.match_number, m.home_member_id, m.away_member_id,
              case when m.last then 'upcoming' else 'completed' end,
              case when m.last then null else m.winner_member_id end,
              case when m.last then null else m.winner_remaining end
       from jsonb_to_recordset($2::jsonb) as m(round_number integer, match_number integer, home_member_id uuid, away_member_id uuid, winner_member_id uuid, winner_remaining integer, last boolean)
       returning id, (winner_member_id is null) as last`,
      [leagueId, JSON.stringify(withResults)],
    );
    const lastMatch = inserted.rows.find((r) => r.last)!;
    const lastRow = withResults[withResults.length - 1];

    const time = async (label: string, fn: () => Promise<unknown>) => {
      const started = performance.now();
      await fn();
      const elapsed = performance.now() - started;
      console.log(`TIMING 24 coaches: ${label}=${elapsed.toFixed(0)}ms`);
      return elapsed;
    };

    const standings = await time("league_standings", () =>
      asUser(db, commissioner, (c) => c.query("select * from public.league_standings(p_league_id => $1)", [leagueId])),
    );
    const lastResult = await time("report_match_result (last regular, builds top_8)", () =>
      rpcAs(db, commissioner, "report_match_result", { p_match_id: lastMatch.id, p_winner_member_id: lastRow.winner_member_id, p_winner_remaining: 3 }),
    );
    const playoffCount = await db.query("select count(*)::int as n from public.league_matches where league_id = $1 and stage = 'playoff'", [leagueId]);
    expect(playoffCount.rows[0].n).toBe(7);
    const reseed = await time("update_league_settings (tiebreaker change, reseed)", () =>
      rpcAs(db, commissioner, "update_league_settings", { p_league_id: leagueId, p_settings: { tiebreaker: "differential" } }),
    );
    const regenerate = await time("generate_playoffs", () => rpcAs(db, commissioner, "generate_playoffs", { p_league_id: leagueId }));
    const clearLast = await time("clear_match_result (last regular, deletes bracket)", () => rpcAs(db, commissioner, "clear_match_result", { p_match_id: lastMatch.id }));
    for (const elapsed of [standings, lastResult, reseed, regenerate, clearLast]) {
      expect(elapsed).toBeLessThan(2000);
    }
  });
});

describe("review r3: applying the playoffs file to a database shaped like the live project", () => {
  const FRESH_DB = "pokedrafts_review_r3";
  let admin: Client;

  beforeAll(async () => {
    admin = await connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  it("replaces a news_type check under any name, tolerates a hand-added playoff_format column with a value outside the set, and crowns finished leagues", async () => {
    await admin.query(`drop database if exists ${FRESH_DB}`);
    await admin.query(createDatabaseSql(FRESH_DB));
    const fresh = await connect(FRESH_DB);
    try {
      await createScaffolding(fresh);
      const migrations = readMigrations();
      // The live project: the base schema (and the eight legacy files) only.
      // Every file from the hardening on (playoffs, pool builder, whatever
      // comes next) is a release the simulated project has not applied yet.
      for (const migration of migrations) {
        if (migration.name >= HARDENING_MIGRATION) continue;
        await applyMigration(fresh, migration);
      }
      // A news_type check the project named by hand, a playoff_format column
      // someone added early with a value the file does not know, and a
      // finished league without a schedule format column value change.
      await fresh.query("alter table public.league_news rename constraint league_news_news_type_check to league_news_type_chk");
      await fresh.query("alter table public.leagues add column playoff_format text");
      const user = randomUUID();
      await fresh.query("insert into auth.users (id, email) values ($1, 'live@example.com')", [user]);
      const league = await fresh.query<{ id: string }>(
        "insert into public.leagues (name, commissioner_id, max_coaches, draft_started, draft_completed, playoff_format) values ('Live', $1, 4, true, true, 'top_3') returning id",
        [user],
      );
      const leagueId = league.rows[0].id;
      const memberIds = [randomUUID(), randomUUID(), randomUUID()];
      await fresh.query(
        `insert into public.league_members (id, league_id, user_id, role, team_name, draft_position) values
         ($2, $1, $5, 'commissioner', 'A', 1), ($3, $1, $6, 'coach', 'B', 2), ($4, $1, $7, 'coach', 'C', 3)`,
        [leagueId, ...memberIds, user, randomUUID(), randomUUID()],
      );
      await fresh.query(
        `insert into public.league_matches (league_id, round_number, match_number, home_member_id, away_member_id, status, winner_member_id) values
         ($1, 1, 1, $2, $3, 'completed', $2), ($1, 2, 1, $3, $4, 'completed', $3), ($1, 3, 1, $2, $4, 'completed', $4)`,
        [leagueId, ...memberIds],
      );
      await fresh.query("insert into public.draft_formats (name, json) values ('F', '{\"version\":\"1.0\",\"leagueName\":\"F\",\"pokemon\":[{\"name\":\"Mon001\",\"points\":1,\"tier\":20}]}'::jsonb)");
      await fresh.query("update public.leagues set custom_pool = (select json from public.draft_formats limit 1) where id = $1", [leagueId]);

      const hardening = migrations.find((m) => m.name === HARDENING_MIGRATION)!;
      const playoffs = migrations.find((m) => m.name === PLAYOFFS_MIGRATION)!;
      await applyMigration(fresh, hardening);
      await applyMigration(fresh, playoffs);

      const checks = await fresh.query<{ conname: string; def: string; convalidated: boolean }>(
        "select conname, pg_get_constraintdef(oid) as def, convalidated from pg_constraint where conrelid = 'public.league_news'::regclass and contype = 'c' order by 1",
      );
      const newsChecks = checks.rows.filter((c) => c.def.includes("news_type"));
      expect(newsChecks.map((c) => c.conname)).toEqual(["league_news_news_type_check"]);
      expect(newsChecks[0].def).toContain("'season'");
      expect(newsChecks[0].convalidated).toBe(true);

      const fixed = await fresh.query<{ playoff_format: string; tiebreaker: string; champion_member_id: string | null }>(
        "select playoff_format, tiebreaker, champion_member_id from public.leagues where id = $1",
        [leagueId],
      );
      expect(fixed.rows[0].playoff_format).toBe("none");
      expect(fixed.rows[0].tiebreaker).toBe("head_to_head");
      // A 1-1, B 1-1, C 1-1: head-to-head among the three is 1-1 each, no
      // differential, equal strength of schedule, so the coin flip (member id
      // order) names the champion.
      expect(fixed.rows[0].champion_member_id).toBe([...memberIds].sort()[0]);
      const notValid = await fresh.query("select conname from pg_constraint where connamespace = 'public'::regnamespace and not convalidated");
      expect(notValid.rows).toEqual([]);
      const report = await fresh.query("select * from public._migration_report()");
      expect(report.rows).toEqual([]);

      // Second application on top of the data: nothing changes.
      await applyMigration(fresh, playoffs);
      const again = await fresh.query<{ champion_member_id: string | null }>("select champion_member_id from public.leagues where id = $1", [leagueId]);
      expect(again.rows[0].champion_member_id).toBe(fixed.rows[0].champion_member_id);
    } finally {
      await fresh.end();
      await admin.query(`drop database if exists ${FRESH_DB}`);
    }
  });
});
