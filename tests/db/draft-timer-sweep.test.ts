// The server-side pick clock (20261020130000_draft_timer_sweep.sql): pg_cron
// runs _auto_pick_expired_drafts() every minute, so a draft whose clock runs
// out keeps moving when nobody has the draft room open. The sweep acts on
// every live draft in its database, so these tests run it in a database of
// their own, where the only leagues are the ones they make. The last block
// stands in for pg_cron with a stub cron schema and runs the file again, the
// way a project that enables pg_cron after applying the file would.
import { randomUUID } from "node:crypto";
import type { QueryResult } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asAuthenticatedNoSub,
  buildLeague,
  connect,
  count,
  createUser,
  expectRpcError,
  expectSqlState,
  expireTimer,
  leagueRow,
  onClockMember,
  rpc,
  rpcAs,
  runFullDraft,
  samplePool,
  teamFor,
  type Client,
  type LeagueFixture,
} from "./harness";
import { DRAFT_TIMER_SWEEP_MIGRATION, applyMigration, createDatabaseSql, createScaffolding, readMigrations } from "./migrations-lib";

const SWEEP_DB = "pokedrafts_timer_sweep";

type SweepRow = { league_id: string; picked: boolean; pokemon_name: string | null; skipped: boolean; draft_completed: boolean };
type AutoPickResult = Omit<SweepRow, "league_id">;
type CronJob = { jobid: string; jobname: string; schedule: string; command: string };

// The parts of pg_cron the file uses: the two tables, and cron.schedule's
// named form, which replaces the job of the same name for the same user.
const CRON_STUB_SQL = `
create schema cron;
create table cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  database text not null default current_database(),
  username text not null default current_user,
  active boolean not null default true,
  jobname text,
  unique (jobname, username)
);
create table cron.job_run_details (
  jobid bigint,
  runid bigserial primary key,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);
create function cron.schedule(p_name text, p_schedule text, p_command text)
returns bigint
language sql
as $$
  insert into cron.job (jobname, schedule, command)
  values (p_name, p_schedule, p_command)
  on conflict (jobname, username) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
`;

// One run of the sweep as the database owner with no signed-in user, which
// is how pg_cron runs it, keeping only the rows for the given leagues.
async function sweep(client: Client, ...leagues: LeagueFixture[]): Promise<SweepRow[]> {
  const { rows } = await client.query<SweepRow>("select * from public._auto_pick_expired_drafts()");
  const ids = new Set(leagues.map((league) => league.leagueId));
  return rows.filter((row) => ids.has(row.league_id));
}

function pickedRow(league: LeagueFixture, pokemonName: string): SweepRow {
  return { league_id: league.leagueId, picked: true, pokemon_name: pokemonName, skipped: false, draft_completed: false };
}

async function picksFor(client: Client, leagueId: string) {
  const { rows } = await client.query<{ pick_number: number; member_id: string; pokemon_name: string }>(
    "select pick_number, member_id, pokemon_name from public.draft_picks where league_id = $1 order by pick_number",
    [leagueId],
  );
  return rows;
}

async function startDraft(client: Client, league: LeagueFixture): Promise<void> {
  await rpcAs(client, league.commissioner.userId, "start_draft", { p_league_id: league.leagueId });
}

// Runs `fn` and returns the WARNING notices the server sent meanwhile.
async function collectWarnings(client: Client, fn: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const onNotice = (notice: { severity?: string; message?: string }) => {
    if (notice.severity === "WARNING") warnings.push(notice.message ?? "");
  };
  client.on("notice", onNotice);
  try {
    await fn();
  } finally {
    client.off("notice", onNotice);
  }
  return warnings;
}

// Runs the migration file the way the SQL editor does (one multi-statement
// query, one implicit transaction) and returns the row its closing select
// leaves behind, with the warnings it raised.
async function runFile(client: Client, sql: string): Promise<{ result: string; warnings: string[] }> {
  let result = "";
  const warnings = await collectWarnings(client, async () => {
    const results = (await client.query(sql)) as unknown as Array<QueryResult<{ draft_timer: string }>>;
    result = results[results.length - 1].rows[0].draft_timer;
  });
  return { result, warnings };
}

async function cronJobs(client: Client): Promise<CronJob[]> {
  const { rows } = await client.query<CronJob>("select jobid::text as jobid, jobname, schedule, command from cron.job order by jobname");
  return rows;
}

describe("draft timer sweep", () => {
  let admin: Client;
  let db: Client;

  beforeAll(async () => {
    admin = await connect();
    await admin.query(`drop database if exists ${SWEEP_DB}`);
    await admin.query(createDatabaseSql(SWEEP_DB));
    db = await connect(SWEEP_DB);
    await createScaffolding(db);
    for (const migration of readMigrations()) {
      await applyMigration(db, migration);
    }
  });

  afterAll(async () => {
    await db.end();
    await admin.query(`drop database if exists ${SWEEP_DB}`);
    await admin.end();
  });

  it("takes the turn in a draft nobody has open, as the database owner with no signed-in user", async () => {
    const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
    await startDraft(db, league);
    expect(await sweep(db, league)).toEqual([]);

    await expireTimer(db, league.leagueId);
    expect(await sweep(db, league)).toEqual([pickedRow(league, "Mon001")]);
    expect(await picksFor(db, league.leagueId)).toEqual([{ pick_number: 1, member_id: league.commissioner.memberId, pokemon_name: "Mon001" }]);
    const row = await leagueRow(db, league.leagueId);
    expect(row.current_pick_number).toBe(2);
    expect(Math.abs(new Date(row.pick_started_at as string).getTime() - Date.now())).toBeLessThan(10_000);

    // The next coach starts with a full clock, so a run right away does nothing.
    expect(await sweep(db, league)).toEqual([]);
    expect((await onClockMember(db, league.leagueId)).memberId).toBe(league.coaches[0].memberId);
  });

  it("leaves alone a running clock, a paused draft, a draft that has not started and a finished one", async () => {
    const running = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    await startDraft(db, running);

    const paused = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    await startDraft(db, paused);
    await rpcAs(db, paused.commissioner.userId, "pause_draft", { p_league_id: paused.leagueId });
    await expireTimer(db, paused.leagueId);

    const notStarted = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    await expireTimer(db, notStarted.leagueId);

    const finished = await buildLeague(db, { coaches: 1, picksPerTeam: 1, pool: samplePool(4) });
    await runFullDraft(db, finished);
    await expireTimer(db, finished.leagueId);

    expect(await sweep(db, running, paused, notStarted, finished)).toEqual([]);
    for (const league of [running, paused, notStarted]) {
      expect(await count(db, "draft_picks", "league_id = $1", [league.leagueId])).toBe(0);
    }
    expect(await count(db, "draft_picks", "league_id = $1", [finished.leagueId])).toBe(2);

    // Resuming moves the clock on by the length of the pause, so a clock that
    // had run out before the pause is still out and the next run takes the turn.
    await rpcAs(db, paused.commissioner.userId, "resume_draft", { p_league_id: paused.leagueId });
    expect(await sweep(db, paused)).toEqual([pickedRow(paused, "Mon001")]);
  });

  it("takes a turn that an undo handed back during a pause once one full clock has run after the resume", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pickTimerSeconds: 120, pool: samplePool(8) });
    const commissioner = league.commissioner.userId;
    await startDraft(db, league);
    await rpcAs(db, commissioner, "make_pick", { p_league_id: league.leagueId, p_pokemon_name: "Mon003" });
    await rpcAs(db, commissioner, "pause_draft", { p_league_id: league.leagueId });
    // Paused for 45 seconds before the undo hands pick 1 back.
    await db.query("update public.leagues set draft_paused_at = draft_paused_at - interval '45 seconds' where id = $1", [league.leagueId]);
    await rpcAs(db, commissioner, "undo_last_pick", { p_league_id: league.leagueId });
    expect(await sweep(db, league)).toEqual([]);

    await rpcAs(db, commissioner, "resume_draft", { p_league_id: league.leagueId });
    // 110 of the 120 seconds after the resume: still the coach's turn.
    await db.query("update public.leagues set pick_started_at = pick_started_at - interval '110 seconds' where id = $1", [league.leagueId]);
    expect(await sweep(db, league)).toEqual([]);
    // 121 seconds: the clock has run out, so the sweep picks.
    await db.query("update public.leagues set pick_started_at = pick_started_at - interval '11 seconds' where id = $1", [league.leagueId]);
    expect(await sweep(db, league)).toEqual([pickedRow(league, "Mon001")]);
  });

  it("drives a whole draft to the same teams as the draft room's auto-pick, skipped turn and finalization included", async () => {
    // 2 teams, 2 picks, budget 10, pool 9/9/1/5: A takes 9, B takes 9 then 1,
    // and A cannot afford the 5 left, so the last turn is skipped and the
    // draft finalizes with an empty slot on A's team.
    const pool = [
      { name: "Nine A", points: 9, tier: 12 },
      { name: "Nine B", points: 9, tier: 12 },
      { name: "One", points: 1, tier: 20 },
      { name: "Five", points: 5, tier: 16 },
    ];
    const bySweep = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 10, pool });
    const byRoom = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pointBudget: 10, pool });
    await startDraft(db, bySweep);
    await startDraft(db, byRoom);

    const sweepRows: SweepRow[] = [];
    const roomResults: AutoPickResult[] = [];
    for (let turn = 0; turn < 4; turn += 1) {
      // Only one of the two clocks is out whenever the sweep runs.
      await expireTimer(db, bySweep.leagueId);
      sweepRows.push(...(await sweep(db, bySweep, byRoom)));
      await expireTimer(db, byRoom.leagueId);
      roomResults.push(await rpcAs<AutoPickResult>(db, byRoom.coaches[0].userId, "auto_pick_if_expired", { p_league_id: byRoom.leagueId }));
    }

    expect(sweepRows.map((row) => row.league_id)).toEqual(Array(4).fill(bySweep.leagueId));
    expect(sweepRows.map((row) => row.pokemon_name)).toEqual(["Nine A", "Nine B", "One", null]);
    expect(sweepRows[3]).toEqual({ league_id: bySweep.leagueId, picked: false, pokemon_name: null, skipped: true, draft_completed: true });
    expect(sweepRows.map(({ picked, pokemon_name, skipped, draft_completed }) => ({ picked, pokemon_name, skipped, draft_completed }))).toEqual(roomResults);

    for (const [index, member] of ["A", "B"].entries()) {
      const fromSweep = await teamFor(db, bySweep.leagueId, bySweep.order[index].memberId);
      const fromRoom = await teamFor(db, byRoom.leagueId, byRoom.order[index].memberId);
      expect(fromSweep.pokemon, `team ${member}`).toEqual(fromRoom.pokemon);
      expect(fromSweep.total_points, `team ${member}`).toBe(fromRoom.total_points);
    }
    expect((await teamFor(db, bySweep.leagueId, bySweep.order[0].memberId)).pokemon.map((p) => p.name)).toEqual(["Nine A"]);
    expect(await count(db, "league_matches", "league_id = $1", [bySweep.leagueId])).toBe(1);
    expect((await leagueRow(db, bySweep.leagueId)).draft_completed).toBe(true);

    // A finished draft is never touched again.
    await expireTimer(db, bySweep.leagueId);
    expect(await sweep(db, bySweep)).toEqual([]);
  });

  it("takes one turn in every expired draft in a single run", async () => {
    const leagues: LeagueFixture[] = [];
    for (let i = 0; i < 3; i += 1) {
      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
      await startDraft(db, league);
      await expireTimer(db, league.leagueId);
      leagues.push(league);
    }
    const rows = await sweep(db, ...leagues);
    expect(rows.map((row) => row.league_id).sort()).toEqual(leagues.map((league) => league.leagueId).sort());
    expect(rows.every((row) => row.picked && row.pokemon_name === "Mon001")).toBe(true);
    for (const league of leagues) {
      expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(2);
    }
  });

  it("leaves a league another transaction holds for the next run instead of waiting for it", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    await startDraft(db, league);
    await expireTimer(db, league.leagueId);
    const holder = await connect(SWEEP_DB);
    const sweeper = await connect(SWEEP_DB);
    try {
      // A sweep that waited for the lock would be cancelled and fail the test.
      await sweeper.query("set statement_timeout = '5s'");
      await holder.query("begin");
      await holder.query("select 1 from public.leagues where id = $1 for update", [league.leagueId]);
      expect(await sweep(sweeper, league)).toEqual([]);
      await holder.query("commit");
      expect(await sweep(sweeper, league)).toEqual([pickedRow(league, "Mon001")]);
    } finally {
      await holder.end();
      await sweeper.end();
    }
  });

  it("rolls back a league whose auto-pick fails, with a warning, and still takes the other drafts' turns", async () => {
    const healthy = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    const broken = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    await startDraft(db, healthy);
    await startDraft(db, broken);
    // A row already holds the broken league's current pick number, so its
    // auto-pick fails on the draft_picks (league_id, pick_number) key.
    await db.query(
      "insert into public.draft_picks (league_id, member_id, pokemon_name, points, tier, pick_number) values ($1, $2, 'Stray', 1, 20, 1)",
      [broken.leagueId, broken.commissioner.memberId],
    );
    await expireTimer(db, healthy.leagueId);
    await expireTimer(db, broken.leagueId);

    try {
      const warnings = await collectWarnings(db, async () => {
        expect(await sweep(db, healthy, broken)).toEqual([pickedRow(healthy, "Mon001")]);
      });
      const brokenWarnings = warnings.filter((warning) => warning.includes(broken.leagueId));
      expect(brokenWarnings).toHaveLength(1);
      expect(brokenWarnings[0]).toContain("SQLSTATE 23505");
      expect((await leagueRow(db, broken.leagueId)).current_pick_number).toBe(1);
      expect(await picksFor(db, broken.leagueId)).toEqual([{ pick_number: 1, member_id: broken.commissioner.memberId, pokemon_name: "Stray" }]);
    } finally {
      // Removed even when an assertion above fails, so the league does not
      // fail every later run in this file.
      await db.query("delete from public.draft_picks where league_id = $1", [broken.leagueId]);
    }

    // Once the stray row is gone, the next run takes the turn.
    expect(await sweep(db, broken)).toEqual([pickedRow(broken, "Mon001")]);
  });

  it("makes one pick when a coach's draft room and the sweep race for the same turn", async () => {
    const league = await buildLeague(db, { coaches: 2, picksPerTeam: 2, pool: samplePool(12) });
    await startDraft(db, league);
    await expireTimer(db, league.leagueId);
    const connA = await connect(SWEEP_DB);
    const connB = await connect(SWEEP_DB);
    try {
      const [rows, room] = await Promise.all([
        sweep(connA, league),
        rpcAs<AutoPickResult>(connB, league.coaches[0].userId, "auto_pick_if_expired", { p_league_id: league.leagueId }),
      ]);
      expect(rows.length + (room.picked ? 1 : 0)).toBe(1);
      expect(await count(db, "draft_picks", "league_id = $1", [league.leagueId])).toBe(1);
      expect((await leagueRow(db, league.leagueId)).current_pick_number).toBe(2);
    } finally {
      await connA.end();
      await connB.end();
    }
  });

  it("is internal, and auto_pick_if_expired keeps its checks and result for the client", async () => {
    const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
    await startDraft(db, league);
    await expireTimer(db, league.leagueId);
    const coach = league.coaches[0].userId;

    await expectSqlState(rpcAs(db, coach, "_auto_pick_expired_drafts"), "42501");
    await expectSqlState(asAnon(db, (c) => c.query("select * from public._auto_pick_expired_drafts()")), "42501");
    await expectSqlState(rpcAs(db, coach, "_auto_pick_if_expired", { p_league_id: league.leagueId }), "42501");

    await expectRpcError(asAuthenticatedNoSub(db, (c) => rpc(c, "auto_pick_if_expired", { p_league_id: league.leagueId })), "not_authenticated");
    await expectRpcError(rpcAs(db, coach, "auto_pick_if_expired", { p_league_id: randomUUID() }), "league_not_found");
    await expectRpcError(rpcAs(db, await createUser(db), "auto_pick_if_expired", { p_league_id: league.leagueId }), "not_a_member");
    expect(await count(db, "draft_picks", "league_id = $1", [league.leagueId])).toBe(0);

    expect(await rpcAs<AutoPickResult>(db, coach, "auto_pick_if_expired", { p_league_id: league.leagueId })).toEqual({
      picked: true,
      pokemon_name: "Mon001",
      skipped: false,
      draft_completed: false,
    });
  });

  describe("schedule", () => {
    const file = () => {
      const migration = readMigrations().find((m) => m.name === DRAFT_TIMER_SWEEP_MIGRATION);
      if (!migration) throw new Error("draft timer migration missing");
      return migration.sql;
    };

    it("without pg_cron the file applies, warns and says in its result that nothing is scheduled", async () => {
      const { result, warnings } = await runFile(db, file());
      expect(result).toMatch(/^Not scheduled: pg_cron is not enabled/);
      expect(warnings).toEqual([expect.stringContaining("pg_cron is not enabled")]);
      expect((await db.query("select 1 from pg_namespace where nspname = 'cron'")).rowCount).toBe(0);
    });

    it("once pg_cron is enabled, running the file again schedules the sweep every minute and the cleanup daily, one job each", async () => {
      await db.query(CRON_STUB_SQL);
      const first = await runFile(db, file());
      expect(first.result).toBe("Scheduled: pg_cron runs public._auto_pick_expired_drafts() every minute (job pokedrafts-draft-timer).");
      expect(first.warnings).toEqual([]);
      const jobs = await cronJobs(db);
      expect(jobs.map(({ jobname, schedule, command }) => ({ jobname, schedule, command }))).toEqual([
        { jobname: "pokedrafts-draft-timer", schedule: "* * * * *", command: "select * from public._auto_pick_expired_drafts()" },
        { jobname: "pokedrafts-draft-timer-cleanup", schedule: "17 4 * * *", command: expect.stringContaining("delete from cron.job_run_details") },
      ]);

      const again = await runFile(db, file());
      expect(again.result).toBe(first.result);
      expect(await cronJobs(db)).toEqual(jobs);
    });

    it("the scheduled commands run: the sweep takes a turn, the cleanup deletes only the two jobs' history older than seven days", async () => {
      const jobs = await cronJobs(db);
      const timer = jobs.find((job) => job.jobname === "pokedrafts-draft-timer");
      const cleanup = jobs.find((job) => job.jobname === "pokedrafts-draft-timer-cleanup");
      if (!timer || !cleanup) throw new Error("the draft timer jobs are not scheduled");

      const league = await buildLeague(db, { coaches: 1, picksPerTeam: 2, pool: samplePool(8) });
      await startDraft(db, league);
      await expireTimer(db, league.leagueId);
      const { rows } = await db.query<SweepRow>(timer.command);
      expect(rows.filter((row) => row.league_id === league.leagueId)).toEqual([pickedRow(league, "Mon001")]);

      const other = (await db.query<{ jobid: string }>("select cron.schedule('someone-else', '0 0 * * *', 'select 1')::text as jobid")).rows[0].jobid;
      await db.query(
        `insert into cron.job_run_details (jobid, status, return_message, start_time, end_time) values
           ($1, 'succeeded', 'timer old', now() - interval '8 days', now() - interval '8 days'),
           ($1, 'succeeded', 'timer recent', now() - interval '1 hour', now() - interval '1 hour'),
           ($2, 'succeeded', 'cleanup old', now() - interval '8 days', now() - interval '8 days'),
           ($3, 'succeeded', 'other old', now() - interval '30 days', now() - interval '30 days')`,
        [timer.jobid, cleanup.jobid, other],
      );
      await db.query(cleanup.command);
      const left = await db.query<{ return_message: string }>("select return_message from cron.job_run_details order by return_message");
      expect(left.rows.map((row) => row.return_message)).toEqual(["other old", "timer recent"]);
    });
  });
});
