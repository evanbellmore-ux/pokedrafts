// Review test: applies the hardening migration to a database that looks like
// the live project (base + the eight old migrations, the three legacy timer
// functions with their live signatures, an old get_server_time with a
// different return type, stray policies, a non-deferrable unique index on
// draft position, a differently named unique constraint, dirty data, format-
// based leagues that never had custom_pool written, and an unrelated table
// with its own policy that must survive). A second block
// applies the whole migration set as a NON-superuser that does not own the
// storage schema, the way the Supabase `postgres` role is.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import pg from "pg";
import { connect, type Client } from "./harness";
import { HARDENING_MIGRATION, PLAYOFFS_MIGRATION, applyMigration, createScaffolding, readMigrations } from "./migrations-lib";

const SIM_DB = "pokedrafts_live_sim";
const OWNER_DB = "pokedrafts_owner_sim";

function migrationNamed(name: string) {
  const migration = readMigrations().find((m) => m.name === name);
  if (!migration) throw new Error(`${name} not found`);
  return migration;
}

const hardeningMigration = () => migrationNamed(HARDENING_MIGRATION);
const playoffsMigration = () => migrationNamed(PLAYOFFS_MIGRATION);

type Notice = { message?: string; severity?: string };

function collectNotices(client: Client): Notice[] {
  const notices: Notice[] = [];
  client.on("notice", (n) => notices.push({ message: n.message, severity: n.severity }));
  return notices;
}

const LIVE_LIKE_SQL = `
-- Legacy RPCs exactly as the live OpenAPI lists them.
create function public.start_draft_timer(target_league_id uuid) returns void language plpgsql as $$ begin return; end $$;
create function public.advance_draft_timer(next_pick integer, target_league_id uuid) returns void language plpgsql as $$ begin return; end $$;
create function public.complete_draft_timer(final_pick integer, target_league_id uuid) returns void language plpgsql as $$ begin return; end $$;
create function public.get_server_time() returns text language sql stable as $$ select now()::text $$;

-- Policies the repo never knew about, on app tables and on draft_order.
create policy "Anyone can read leagues" on public.leagues for select using (true);
create policy "Legacy member insert" on public.league_members for insert with check (true);
create policy "Legacy order read" on public.draft_order for select using (true);
alter table public.draft_order enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;

-- A table outside the app list with its own policy: must not be touched.
create table public.unrelated_audit (id serial primary key, note text);
alter table public.unrelated_audit enable row level security;
create policy "keep me" on public.unrelated_audit for select using (true);

-- Existing constraints/indexes with other names.
create unique index league_members_position_legacy_idx on public.league_members (league_id, draft_position);
alter table public.drafted_teams add constraint legacy_team_unique unique (member_id, league_id);
create index draft_picks_legacy_idx on public.draft_picks (league_id, pick_number, created_at);
`;

type DirtySeed = {
  leagueId: string;
  commissioner: string;
  coach: string;
  badLeagueId: string;
  oddMatchId: string;
  formatId: string;
  legacyDoneLeagueId: string;
  legacyMalformedLeagueId: string;
  riggedFormatId: string;
  legacyRiggedLeagueId: string;
  riggedUnstartedLeagueId: string;
  orphanLeagueId: string;
};

async function seedDirtyData(client: Client): Promise<DirtySeed> {
  const users = await client.query<{ id: string }>("insert into auth.users (email) values ('c@x'), ('k@x') returning id");
  const commissioner = users.rows[0].id;
  const coach = users.rows[1].id;
  const league = await client.query<{ id: string }>(
    `insert into public.leagues (name, commissioner_id, max_coaches)
     values ($1, $2, 8) returning id`,
    ["  " + "A very long league name that certainly exceeds the sixty character limit set by the check".padEnd(90, "x") + "  ", commissioner],
  );
  const leagueId = league.rows[0].id;
  await client.query(
    `insert into public.league_members (league_id, user_id, role, team_name, joined_at) values
       ($1, $2, 'Commisioner ', '   ', now() - interval '2 hours'),
       ($1, $2, 'coach', 'dup that owns nothing', now() - interval '1 hour'),
       ($1, $3, 'coach', $4, now())`,
    [leagueId, commissioner, coach, "  " + "t".repeat(60) + "  "],
  );
  // A league whose max_coaches is out of range: the migration clamps it (2) so the check validates.
  const bad = await client.query<{ id: string }>(
    "insert into public.leagues (name, commissioner_id, max_coaches) values ('Bad', $1, 1) returning id",
    [coach],
  );
  // Duplicate pokemon picks in one league: the unique constraint must be skipped with a warning.
  const member = await client.query<{ id: string }>(
    "select id from public.league_members where league_id = $1 and user_id = $2 order by joined_at limit 1",
    [leagueId, commissioner],
  );
  await client.query(
    `insert into public.draft_picks (league_id, member_id, pokemon_name, points, tier, pick_number) values
       ($1, $2, 'Pikachu', 5, 16, 1), ($1, $2, 'Pikachu', 5, 16, 2)`,
    [leagueId, member.rows[0].id],
  );
  // A match with a status the new check does not allow and no data fix can
  // guess: forces the NOT VALID path for league_matches_status_check.
  const coachMember = await client.query<{ id: string }>(
    "select id from public.league_members where league_id = $1 and user_id = $2 limit 1",
    [leagueId, coach],
  );
  const oddMatch = await client.query<{ id: string }>(
    `insert into public.league_matches (league_id, round_number, match_number, home_member_id, away_member_id, status)
     values ($1, 1, 1, $2, $3, 'postponed') returning id`,
    [leagueId, member.rows[0].id, coachMember.rows[0].id],
  );
  // Format-based leagues as the pre-release client left them: custom_pool null
  // (or not a pool at all) with draft_format_id set, so the pool was read from
  // draft_formats live. One finished its draft, one never started. The format
  // is messy in the ways the old builder tolerated (an untrimmed name,
  // string-typed points, an explicit null tier) but passes the pool rules.
  const format = await client.query<{ id: string }>(
    "insert into public.draft_formats (name, json, created_by) values ('Legacy format', $1, null) returning id",
    [
      JSON.stringify({
        version: "1.0",
        leagueName: "Legacy",
        pokemon: [
          { name: " Eevee ", points: "3" },
          { name: "Pikachu", points: 5, tier: 16 },
          { name: "Mew", points: 20, tier: null },
        ],
      }),
    ],
  );
  const formatId = format.rows[0].id;
  const legacyDone = await client.query<{ id: string }>(
    `insert into public.leagues (name, commissioner_id, draft_format_id, custom_pool, draft_started, draft_completed)
     values ('Legacy done', $1, $2, null, true, true) returning id`,
    [commissioner, formatId],
  );
  const legacyMalformed = await client.query<{ id: string }>(
    `insert into public.leagues (name, commissioner_id, draft_format_id, custom_pool)
     values ('Legacy malformed', $1, $2, '{}'::jsonb) returning id`,
    [commissioner, formatId],
  );
  // A format that breaks the pool rules (a 0-point entry): the backfill must
  // not copy it. One league on it started its draft, one never did.
  const riggedFormat = await client.query<{ id: string }>(
    "insert into public.draft_formats (name, json, created_by) values ('Rigged format', $1, null) returning id",
    [JSON.stringify({ pokemon: [{ name: "Pikachu", points: 5 }, { name: "Freebie", points: 0 }] })],
  );
  const riggedFormatId = riggedFormat.rows[0].id;
  const legacyRigged = await client.query<{ id: string }>(
    `insert into public.leagues (name, commissioner_id, draft_format_id, custom_pool, draft_started, draft_completed)
     values ('Legacy rigged', $1, $2, null, true, false) returning id`,
    [commissioner, riggedFormatId],
  );
  const riggedUnstarted = await client.query<{ id: string }>(
    `insert into public.leagues (name, commissioner_id, draft_format_id, custom_pool)
     values ('Rigged unstarted', $1, $2, null) returning id`,
    [commissioner, riggedFormatId],
  );
  // A started league whose format row is already gone: nothing left to copy.
  const orphan = await client.query<{ id: string }>(
    `insert into public.leagues (name, commissioner_id, draft_format_id, custom_pool, draft_started, draft_completed)
     values ('Orphan', $1, null, null, true, false) returning id`,
    [commissioner],
  );
  return {
    leagueId,
    commissioner,
    coach,
    badLeagueId: bad.rows[0].id,
    oddMatchId: oddMatch.rows[0].id,
    formatId,
    legacyDoneLeagueId: legacyDone.rows[0].id,
    legacyMalformedLeagueId: legacyMalformed.rows[0].id,
    riggedFormatId,
    legacyRiggedLeagueId: legacyRigged.rows[0].id,
    riggedUnstartedLeagueId: riggedUnstarted.rows[0].id,
    orphanLeagueId: orphan.rows[0].id,
  };
}

describe("hardening migration on a live-like database", () => {
  let admin: Client;
  let sim: Client;
  let notices: Notice[];
  let seed: Awaited<ReturnType<typeof seedDirtyData>>;

  beforeAll(async () => {
    admin = await connect();
    await admin.query(`drop database if exists ${SIM_DB}`);
    await admin.query(`create database ${SIM_DB}`);
    sim = await connect(SIM_DB);
    notices = collectNotices(sim);
    await createScaffolding(sim);
    const migrations = readMigrations();
    for (const migration of migrations) {
      if (migration.name === HARDENING_MIGRATION) break;
      await applyMigration(sim, migration);
    }
    await sim.query(LIVE_LIKE_SQL);
    seed = await seedDirtyData(sim);
    notices.length = 0;
    await applyMigration(sim, hardeningMigration());
  });

  afterAll(async () => {
    await sim.end();
    await admin.query(`drop database if exists ${SIM_DB}`);
    await admin.end();
  });

  it("drops the legacy timer functions by their live signatures and replaces get_server_time", async () => {
    const { rows } = await sim.query<{ proname: string; rettype: string }>(
      `select p.proname, pg_get_function_result(p.oid) as rettype from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('start_draft_timer', 'advance_draft_timer', 'complete_draft_timer', 'get_server_time')`,
    );
    expect(rows).toEqual([{ proname: "get_server_time", rettype: "timestamp with time zone" }]);
  });

  it("removes stray policies on app tables and draft_order but leaves other tables alone", async () => {
    const { rows } = await sim.query<{ tablename: string; policyname: string }>(
      "select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2",
    );
    const names = rows.map((r) => `${r.tablename}.${r.policyname}`);
    expect(names).not.toContain("leagues.Anyone can read leagues");
    expect(names).not.toContain("league_members.Legacy member insert");
    expect(names).not.toContain("draft_order.Legacy order read");
    expect(names).not.toContain("leagues.Commissioners can delete leagues");
    expect(names).toContain("unrelated_audit.keep me");
    expect(rows.filter((r) => r.tablename !== "unrelated_audit")).toHaveLength(16);
  });

  it("replaces a non-deferrable unique index on draft position and reuses an existing unique constraint under another name", async () => {
    const { rows } = await sim.query<{ conname: string; condeferrable: boolean; condeferred: boolean }>(
      `select conname, condeferrable, condeferred from pg_constraint
       where conrelid = 'public.league_members'::regclass and contype = 'u' order by 1`,
    );
    expect(rows).toEqual([
      { conname: "league_members_league_id_draft_position_key", condeferrable: true, condeferred: true },
      { conname: "league_members_league_id_user_id_key", condeferrable: false, condeferred: false },
    ]);
    const teams = await sim.query<{ conname: string }>(
      "select conname from pg_constraint where conrelid = 'public.drafted_teams'::regclass and contype = 'u' order by 1",
    );
    expect(teams.rows.map((r) => r.conname)).toEqual(["legacy_team_unique"]);
    const idx = await sim.query("select 1 from pg_class where relname = 'league_members_position_legacy_idx'");
    expect(idx.rowCount).toBe(0);
  });

  it("fixes the data before adding constraints", async () => {
    const members = await sim.query<{ user_id: string; role: string; team_name: string | null }>(
      "select user_id, role, team_name from public.league_members where league_id = $1 order by joined_at",
      [seed.leagueId],
    );
    expect(members.rows).toHaveLength(2);
    expect(members.rows[0]).toEqual({ user_id: seed.commissioner, role: "commissioner", team_name: null });
    expect(members.rows[1].role).toBe("coach");
    expect(members.rows[1].team_name).toBe("t".repeat(40));
    const league = await sim.query<{ name: string }>("select name from public.leagues where id = $1", [seed.leagueId]);
    expect(league.rows[0].name).toHaveLength(60);
  });

  it("copies the draft format onto legacy format-based leagues, validated and normalized, so no league reads draft_formats live any more", async () => {
    const expected = {
      version: "1.0",
      source: "format",
      draft_format_id: seed.formatId,
      pokemon: [
        { name: "Eevee", points: 3, tier: 18 },
        { name: "Pikachu", points: 5, tier: 16 },
        { name: "Mew", points: 20, tier: 1 },
      ],
    };
    const { rows } = await sim.query<{ custom_pool: Record<string, unknown> }>(
      "select custom_pool from public.leagues where id = any($1) order by name",
      [[seed.legacyDoneLeagueId, seed.legacyMalformedLeagueId]],
    );
    expect(rows.map((r) => r.custom_pool)).toEqual([
      { ...expected, leagueName: "Legacy done" },
      { ...expected, leagueName: "Legacy malformed" },
    ]);
    expect(notices.some((n) => (n.message ?? "").includes("copied the draft format onto 2 league(s)"))).toBe(true);
    // The leagues on the format that breaks the pool rules were skipped, not
    // given a lenient copy with a 0-point entry.
    const skipped = await sim.query<{ custom_pool: unknown }>("select custom_pool from public.leagues where id = any($1)", [
      [seed.legacyRiggedLeagueId, seed.riggedUnstartedLeagueId],
    ]);
    expect(skipped.rows.map((r) => r.custom_pool)).toEqual([null, null]);

    // The finished league now ignores its format row: the owner's rewrite (and
    // deletion) changes nothing for free-agent moves.
    await sim.query("update public.draft_formats set json = $1 where id = $2", [JSON.stringify({ pokemon: [{ name: "Freebie", points: 0 }] }), seed.formatId]);
    const pool = await sim.query<{ name: string; points: number }>("select name, points from public._league_pool($1) order by points desc", [seed.legacyDoneLeagueId]);
    expect(pool.rows).toEqual([
      { name: "Mew", points: 20 },
      { name: "Pikachu", points: 5 },
      { name: "Eevee", points: 3 },
    ]);
    await sim.query("delete from public.draft_formats where id = $1", [seed.formatId]);
    const after = await sim.query<{ draft_format_id: string | null; n: number }>(
      "select draft_format_id, jsonb_array_length(custom_pool -> 'pokemon') as n from public.leagues where id = $1",
      [seed.legacyDoneLeagueId],
    );
    expect(after.rows[0]).toEqual({ draft_format_id: null, n: 3 });
  });

  it("skips the draft_picks pokemon unique constraint with a warning when duplicates exist, clamps league settings, and adds an unfixable check NOT VALID", async () => {
    const warnings = notices.filter((n) => n.severity === "WARNING").map((n) => n.message ?? "");
    expect(warnings.some((w) => w.includes("draft_picks_league_id_pokemon_name_key"))).toBe(true);
    expect(warnings.some((w) => w.includes("league_matches_status_check") && w.includes("NOT VALID"))).toBe(true);
    expect(warnings.some((w) => w.includes("clamped out-of-range settings") && w.includes("1 league(s)"))).toBe(true);
    // The leagues on the format that breaks the pool rules kept no pool; the
    // warning names each league, the format and the offending entry.
    for (const name of ["Legacy rigged", "Rigged unstarted"]) {
      expect(
        warnings.some((w) => w.includes(`(${name}) was not given a pool`) && w.includes('"Rigged format"') && w.includes('"Freebie" needs integer points between 1 and 20.')),
        name,
      ).toBe(true);
    }
    expect(warnings.some((w) => w.includes("2 league(s) kept no pool"))).toBe(true);
    // The closing summary repeats every open item and points at the report function.
    expect(warnings.some((w) => w.includes("need attention") && w.includes("_migration_report"))).toBe(true);
    const cons = await sim.query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint
       where conname in ('draft_picks_league_id_pokemon_name_key', 'leagues_max_coaches_check', 'draft_picks_league_id_pick_number_key', 'league_matches_status_check')`,
    );
    const byName = new Map(cons.rows.map((r) => [r.conname, r.convalidated]));
    expect(byName.has("draft_picks_league_id_pokemon_name_key")).toBe(false);
    expect(byName.get("draft_picks_league_id_pick_number_key")).toBe(true);
    // max_coaches was clamped, so its check validated; the match status could not be guessed.
    expect(byName.get("leagues_max_coaches_check")).toBe(true);
    expect(byName.get("league_matches_status_check")).toBe(false);
  });

  it("clamps out-of-range league settings so the commissioner can still change the league through the RPC", async () => {
    const bad = await sim.query<{ max_coaches: number }>("select max_coaches from public.leagues where id = $1", [seed.badLeagueId]);
    expect(bad.rows[0].max_coaches).toBe(2);
    await sim.query("begin");
    try {
      await sim.query("select set_config('request.jwt.claim.sub', $1, true)", [seed.coach]);
      await sim.query("set local role authenticated");
      const { rows } = await sim.query<{ result: { name: string; max_coaches: number } }>(
        "select public.update_league_settings($1, $2::jsonb) as result",
        [seed.badLeagueId, JSON.stringify({ name: "Renamed" })],
      );
      expect(rows[0].result).toMatchObject({ name: "Renamed", max_coaches: 2 });
    } finally {
      await sim.query("rollback");
    }
  });

  it("_migration_report lists the skipped unique, the NOT VALID check (whose rows reject every update until fixed and validated) and every league without a pool, with the reason", async () => {
    const report = await sim.query<{ severity: string; item: string; detail: string; action: string }>(
      "select * from public._migration_report() order by item",
    );
    const byItem = new Map(report.rows.map((r) => [r.item, r]));
    expect([...byItem.keys()].sort()).toEqual(
      [
        "constraint league_matches_status_check on public.league_matches",
        `league ${seed.legacyRiggedLeagueId} (Legacy rigged)`,
        `league ${seed.orphanLeagueId} (Orphan)`,
        `league ${seed.riggedUnstartedLeagueId} (Rigged unstarted)`,
        "unique (league_id, pokemon_name) on public.draft_picks",
      ].sort(),
    );
    // A league that started its draft before this release and whose format
    // row is gone has nothing left to draft or pick free agents from.
    const orphan = byItem.get(`league ${seed.orphanLeagueId} (Orphan)`)!;
    expect(orphan.severity).toBe("warning");
    expect(orphan.detail).toContain("started its draft but has no pool");
    expect(orphan.detail).toContain("deleted before this release");
    expect(orphan.action).toContain(`where id = '${seed.orphanLeagueId}'`);
    expect(orphan.action).toContain("reset_draft");
    // A started league whose format breaks the pool rules was skipped by the
    // backfill: the report names the entry and how to get the copy taken.
    const rigged = byItem.get(`league ${seed.legacyRiggedLeagueId} (Legacy rigged)`)!;
    expect(rigged.severity).toBe("warning");
    expect(rigged.detail).toContain("started its draft but has no pool");
    expect(rigged.detail).toContain('its draft format "Rigged format" breaks the pool rules ("Freebie" needs integer points between 1 and 20.)');
    expect(rigged.detail).toContain("no pick can be made");
    expect(rigged.action).toContain(`fix that entry in draft format ${seed.riggedFormatId}`);
    expect(rigged.action).toContain("re-run 20260909120000_release_hardening.sql");
    expect(rigged.action).toContain(`where id = '${seed.legacyRiggedLeagueId}'`);
    // An unstarted league on the same format is only kept from starting:
    // info, and the commissioner can resolve it from the Pool page.
    const unstarted = byItem.get(`league ${seed.riggedUnstartedLeagueId} (Rigged unstarted)`)!;
    expect(unstarted.severity).toBe("info");
    expect(unstarted.detail).toContain('its draft format "Rigged format" breaks the pool rules');
    expect(unstarted.detail).toContain("the draft cannot start");
    expect(unstarted.action).toContain("Reset to format");
    expect(report.rows.filter((r) => r.severity === "warning")).toHaveLength(4);
    const notValid = byItem.get("constraint league_matches_status_check on public.league_matches")!;
    expect(notValid.detail).toContain("23514");
    expect(notValid.action).toBe("fix the rows, then run: alter table public.league_matches validate constraint league_matches_status_check;");

    // Any update of the violating row fails, even one that leaves status alone ...
    let error: (Error & { code?: string }) | null = null;
    try {
      await sim.query("update public.league_matches set scheduled_at = now() where id = $1", [seed.oddMatchId]);
    } catch (e) {
      error = e as Error & { code?: string };
    }
    expect(error?.code).toBe("23514");
    // ... until the row is fixed and the constraint validated, as the report says.
    await sim.query("update public.league_matches set status = 'upcoming' where id = $1", [seed.oddMatchId]);
    await sim.query(notValid.action.replace(/^fix the rows, then run: /, ""));
    const again = await sim.query<{ item: string }>("select item from public._migration_report() order by item");
    expect(again.rows.map((r) => r.item).sort()).toEqual(
      [
        `league ${seed.legacyRiggedLeagueId} (Legacy rigged)`,
        `league ${seed.orphanLeagueId} (Orphan)`,
        `league ${seed.riggedUnstartedLeagueId} (Rigged unstarted)`,
        "unique (league_id, pokemon_name) on public.draft_picks",
      ].sort(),
    );
    // The report is an operator tool, not API surface.
    const exec = await sim.query<{ anon: boolean; authenticated: boolean }>(
      `select has_function_privilege('anon', 'public._migration_report()', 'execute') as anon,
              has_function_privilege('authenticated', 'public._migration_report()', 'execute') as authenticated`,
    );
    expect(exec.rows[0]).toEqual({ anon: false, authenticated: false });
  });

  it("does not add a redundant draft_picks (league_id, pick_number) index next to the legacy prefix index", async () => {
    const { rows } = await sim.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public' and tablename = 'draft_picks' order by 1",
    );
    expect(rows.map((r) => r.indexname)).not.toContain("draft_picks_league_id_pick_number_idx");
  });

  it("applies a second time on the same database without error, copies nothing again, and copies a skipped league's format once the format is fixed", async () => {
    notices.length = 0;
    await applyMigration(sim, hardeningMigration());
    const policies = await sim.query("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename <> 'unrelated_audit'");
    expect(policies.rows[0].n).toBe(16);
    const poolSizes = async () =>
      (
        await sim.query<{ name: string; n: number | null }>(
          "select name, jsonb_array_length(custom_pool -> 'pokemon') as n from public.leagues where id = any($1) order by name",
          [[seed.legacyDoneLeagueId, seed.legacyMalformedLeagueId, seed.legacyRiggedLeagueId, seed.riggedUnstartedLeagueId]],
        )
      ).rows;
    expect(await poolSizes()).toEqual([
      { name: "Legacy done", n: 3 },
      { name: "Legacy malformed", n: 3 },
      { name: "Legacy rigged", n: null },
      { name: "Rigged unstarted", n: null },
    ]);
    expect(notices.some((n) => (n.message ?? "").includes("copied the draft format"))).toBe(false);
    // The rigged leagues are skipped again, with the same warning.
    expect(notices.some((n) => n.severity === "WARNING" && (n.message ?? "").includes("2 league(s) kept no pool"))).toBe(true);

    // The operator fixes the format as the report says and re-runs the file:
    // both leagues get their copy and drop out of the report.
    await sim.query("update public.draft_formats set json = $1 where id = $2", [
      JSON.stringify({ pokemon: [{ name: "Pikachu", points: 5 }, { name: "Freebie", points: 1 }] }),
      seed.riggedFormatId,
    ]);
    notices.length = 0;
    await applyMigration(sim, hardeningMigration());
    expect(notices.some((n) => (n.message ?? "").includes("copied the draft format onto 2 league(s)"))).toBe(true);
    expect(notices.some((n) => (n.message ?? "").includes("kept no pool"))).toBe(false);
    expect(await poolSizes()).toEqual([
      { name: "Legacy done", n: 3 },
      { name: "Legacy malformed", n: 3 },
      { name: "Legacy rigged", n: 2 },
      { name: "Rigged unstarted", n: 2 },
    ]);
    const copied = await sim.query<{ custom_pool: Record<string, unknown> }>("select custom_pool from public.leagues where id = $1", [seed.legacyRiggedLeagueId]);
    expect(copied.rows[0].custom_pool).toEqual({
      version: "1.0",
      leagueName: "Legacy rigged",
      source: "format",
      draft_format_id: seed.riggedFormatId,
      pokemon: [
        { name: "Pikachu", points: 5, tier: 16 },
        { name: "Freebie", points: 1, tier: 20 },
      ],
    });
    const report = await sim.query<{ item: string }>("select item from public._migration_report() order by item");
    expect(report.rows.map((r) => r.item).sort()).toEqual([`league ${seed.orphanLeagueId} (Orphan)`, "unique (league_id, pokemon_name) on public.draft_picks"].sort());
  });

  it("the playoffs feature migration applies on top of the live-like database, degrades the same way, and its report repeats the open items", async () => {
    notices.length = 0;
    await applyMigration(sim, playoffsMigration());
    // The legacy match got the new columns with their defaults, playoff slots
    // may be empty, and the news check now allows 'season'.
    const match = await sim.query<{ stage: string; winner_remaining: number | null }>("select stage, winner_remaining from public.league_matches where id = $1", [seed.oddMatchId]);
    expect(match.rows[0]).toEqual({ stage: "regular", winner_remaining: null });
    const nullable = await sim.query<{ column_name: string; is_nullable: string }>(
      "select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'league_matches' and column_name in ('home_member_id', 'away_member_id')",
    );
    expect(nullable.rows).toHaveLength(2);
    expect(nullable.rows.every((r) => r.is_nullable === "YES")).toBe(true);
    const newsCheck = await sim.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'league_news_news_type_check'");
    expect(newsCheck.rows[0].def).toContain("'season'");
    // Nothing the playoffs file adds was left NOT VALID.
    const notValid = await sim.query<{ conname: string }>("select conname from pg_constraint where connamespace = 'public'::regnamespace and not convalidated");
    expect(notValid.rows).toEqual([]);
    // The closing summary lists the same open items the hardening report left.
    const warnings = notices.filter((n) => n.severity === "WARNING").map((n) => n.message ?? "");
    expect(warnings.some((w) => w.includes("2 item(s) need attention") && w.includes("_migration_report"))).toBe(true);
    // Exactly one create_league and one report_match_result remain.
    const fns = await sim.query<{ proname: string; n: number }>(
      "select proname, count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('create_league', 'report_match_result') group by 1 order by 1",
    );
    expect(fns.rows).toEqual([{ proname: "create_league", n: 1 }, { proname: "report_match_result", n: 1 }]);
  });
});

describe("whole migration set applied by a non-superuser owner (Supabase postgres role)", () => {
  let admin: Client;
  let db: Client;
  let notices: Notice[];

  beforeAll(async () => {
    admin = await connect();
    await admin.query(`drop database if exists ${OWNER_DB}`);
    await admin.query("drop role if exists app_owner");
    await admin.query("create role app_owner login password 'app_owner' nosuperuser nocreatedb nocreaterole");
    await admin.query(`create database ${OWNER_DB} owner app_owner`);
    const setup = await connect(OWNER_DB);
    try {
      await createScaffolding(setup);
      // What Supabase gives its postgres role: usage on auth/storage/extensions,
      // references on auth.users, ownership of the realtime publication, but
      // NOT ownership of storage.objects / storage.buckets.
      await setup.query(`
        grant usage on schema auth, storage, extensions to app_owner;
        grant references, select on auth.users to app_owner;
        grant execute on all functions in schema extensions to app_owner;
        alter publication supabase_realtime owner to app_owner;
        grant anon, authenticated, service_role to app_owner with admin option;
      `);
    } finally {
      await setup.end();
    }
    db = new pg.Client({ host: "127.0.0.1", port: inject("dbPort"), user: "app_owner", password: "app_owner", database: OWNER_DB });
    await db.connect();
    notices = collectNotices(db);
    for (const migration of readMigrations()) {
      await applyMigration(db, migration);
    }
  });

  afterAll(async () => {
    await db.end();
    await admin.query(`drop database if exists ${OWNER_DB}`);
    await admin.query("drop role if exists app_owner");
    await admin.end();
  });

  it("applies every migration without superuser rights", async () => {
    const su = await db.query<{ rolsuper: boolean }>("select rolsuper from pg_roles where rolname = current_user");
    expect(su.rows[0].rolsuper).toBe(false);
    const fns = await db.query("select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace");
    expect(fns.rows[0].n).toBeGreaterThanOrEqual(49);
    const pub = await db.query<{ tablename: string }>(
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1",
    );
    expect(pub.rows.map((r) => r.tablename)).toEqual([
      "draft_chat_messages", "draft_picks", "drafted_teams", "league_matches", "league_members", "league_news", "leagues",
    ]);
  });

  it("degrades to warnings when it cannot write the storage schema", async () => {
    const warnings = notices.filter((n) => n.severity === "WARNING").map((n) => n.message ?? "");
    expect(warnings.some((w) => w.includes("sprites bucket"))).toBe(true);
    expect(warnings.some((w) => w.includes("sprites read policy"))).toBe(true);
    // The report cannot read storage.buckets as this role either, and says so instead of failing.
    const report = await db.query<{ severity: string; item: string }>("select severity, item from public._migration_report()");
    expect(report.rows).toEqual([{ severity: "info", item: "storage" }]);
  });
});
