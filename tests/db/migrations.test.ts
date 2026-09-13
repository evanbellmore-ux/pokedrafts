import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, type Client } from "./harness";
import {
  BASE_MIGRATION,
  HARDENING_MIGRATION,
  PLAYOFFS_MIGRATION,
  applyMigration,
  createScaffolding,
  readMigrations,
} from "./migrations-lib";

const FRESH_DB = "pokedrafts_fresh";

const API_FUNCTIONS = [
  "get_server_time",
  "create_league",
  "get_invite_preview",
  "join_league",
  "regenerate_invite",
  "rename_team",
  "leave_league",
  "remove_member",
  "transfer_commissioner",
  "update_league_settings",
  "update_league_pool",
  "reset_league_pool",
  "set_draft_order",
  "start_draft",
  "make_pick",
  "auto_pick_if_expired",
  "pause_draft",
  "resume_draft",
  "undo_last_pick",
  "force_pick",
  "finalize_draft",
  "reset_draft",
  "swap_free_agent",
  "undo_free_agent_move",
  "generate_schedule",
  "report_match_result",
  "clear_match_result",
  "is_league_member",
  "league_standings",
  "generate_playoffs",
  "clear_playoffs",
];

const APP_TABLES = [
  "leagues",
  "league_members",
  "league_invites",
  "draft_formats",
  "draft_picks",
  "drafted_teams",
  "league_matches",
  "league_news",
  "draft_chat_messages",
  "pokemon_dex",
  "pokemon_forms",
  "draft_order",
];

async function functionNames(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ proname: string }>(
    "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1",
  );
  return rows.map((r) => r.proname);
}

async function assertHardenedState(client: Client): Promise<void> {
  const names = await functionNames(client);
  for (const fn of API_FUNCTIONS) {
    expect(names, `function ${fn} should exist`).toContain(fn);
  }
  expect(names).not.toContain("start_draft_timer");
  expect(names).not.toContain("advance_draft_timer");
  expect(names).not.toContain("complete_draft_timer");

  const columns = await client.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'leagues'",
  );
  const columnNames = columns.rows.map((r) => r.column_name);
  expect(columnNames).toContain("draft_paused_at");
  expect(columnNames).toContain("draft_paused_total_seconds");
  expect(columnNames).toContain("tiebreaker");
  expect(columnNames).toContain("playoff_format");
  expect(columnNames).toContain("champion_member_id");

  const matchColumns = await client.query<{ column_name: string; is_nullable: string }>(
    "select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'league_matches'",
  );
  const nullable = new Map(matchColumns.rows.map((r) => [r.column_name, r.is_nullable === "YES"]));
  for (const column of ["stage", "winner_remaining", "home_seed", "away_seed", "feeds_match_id", "feeds_slot"]) {
    expect(nullable.has(column), `league_matches.${column} should exist`).toBe(true);
  }
  // Playoff slots are empty until the earlier round is decided.
  expect(nullable.get("home_member_id")).toBe(true);
  expect(nullable.get("away_member_id")).toBe(true);
  expect(nullable.get("stage")).toBe(false);

  // Exactly one signature each for the functions the playoffs file re-creates
  // with more parameters (a second one would make the name ambiguous).
  const signatures = await client.query<{ proname: string; args: string }>(
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('create_league', 'report_match_result')
     order by 1`,
  );
  expect(signatures.rows).toEqual([
    { proname: "create_league", args: "p_name text, p_team_name text, p_max_coaches integer, p_draft_format_id uuid, p_point_budget integer, p_picks_per_team integer, p_pick_timer_seconds integer, p_playoff_format text, p_tiebreaker text" },
    { proname: "report_match_result", args: "p_match_id uuid, p_winner_member_id uuid, p_winner_remaining integer" },
  ]);

  const constraints = await client.query<{ conname: string }>(
    "select conname from pg_constraint where connamespace = 'public'::regnamespace",
  );
  const constraintNames = constraints.rows.map((r) => r.conname);
  for (const name of [
    "league_members_league_id_user_id_key",
    "league_members_role_check",
    "league_members_team_name_check",
    "league_members_league_id_draft_position_key",
    "draft_picks_league_id_pokemon_name_key",
    "draft_picks_league_id_pick_number_key",
    "drafted_teams_league_id_member_id_key",
    "league_invites_invite_code_key",
    "league_matches_status_check",
    "league_matches_league_id_round_number_match_number_key",
    "leagues_max_coaches_check",
    "leagues_point_budget_check",
    "leagues_picks_per_team_check",
    "leagues_pick_timer_seconds_check",
    "leagues_free_agent_swap_limit_check",
    "leagues_name_check",
    "draft_formats_name_check",
    "draft_formats_json_check",
    "pokemon_dex_dex_number_key",
    "leagues_tiebreaker_check",
    "leagues_playoff_format_check",
    "leagues_champion_member_id_fkey",
    "league_matches_stage_check",
    "league_matches_winner_remaining_check",
    "league_matches_feeds_slot_check",
    "league_matches_feeds_match_id_fkey",
    "league_news_news_type_check",
  ]) {
    expect(constraintNames, `constraint ${name} should exist`).toContain(name);
  }

  const newsCheck = await client.query<{ def: string }>(
    "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'league_news_news_type_check'",
  );
  expect(newsCheck.rows[0].def).toContain("'season'");
  const validated = await client.query("select conname from pg_constraint where connamespace = 'public'::regnamespace and not convalidated");
  expect(validated.rows).toEqual([]);

  const deferrable = await client.query<{ condeferrable: boolean; condeferred: boolean }>(
    "select condeferrable, condeferred from pg_constraint where conname = 'league_members_league_id_draft_position_key'",
  );
  expect(deferrable.rows[0]).toEqual({ condeferrable: true, condeferred: true });

  const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
    "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)",
    [APP_TABLES],
  );
  expect(rls.rows).toHaveLength(APP_TABLES.length);
  for (const row of rls.rows) {
    expect(row.relrowsecurity, `${row.relname} should have RLS enabled`).toBe(true);
  }

  const policies = await client.query<{ tablename: string; policyname: string }>(
    "select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2",
  );
  const byTable = new Map<string, string[]>();
  for (const row of policies.rows) {
    byTable.set(row.tablename, [...(byTable.get(row.tablename) ?? []), row.policyname]);
  }
  expect(byTable.get("leagues")).toHaveLength(2);
  expect(byTable.get("league_members")).toHaveLength(1);
  expect(byTable.get("league_invites")).toHaveLength(1);
  expect(byTable.get("draft_formats")).toHaveLength(4);
  expect(byTable.get("draft_picks")).toHaveLength(1);
  expect(byTable.get("drafted_teams")).toHaveLength(1);
  expect(byTable.get("league_matches")).toHaveLength(1);
  expect(byTable.get("league_news")).toHaveLength(1);
  expect(byTable.get("draft_chat_messages")).toHaveLength(2);
  expect(byTable.get("pokemon_dex")).toHaveLength(1);
  expect(byTable.get("pokemon_forms")).toHaveLength(1);
  expect(byTable.has("draft_order")).toBe(false);

  const publication = await client.query<{ tablename: string }>(
    "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'",
  );
  const published = publication.rows.map((r) => r.tablename);
  for (const table of ["draft_chat_messages", "draft_picks", "leagues", "league_members", "league_matches", "league_news", "drafted_teams"]) {
    expect(published, `${table} should be in supabase_realtime`).toContain(table);
  }

  const bucket = await client.query<{ public: boolean }>("select public from storage.buckets where id = 'sprites'");
  expect(bucket.rows[0]?.public).toBe(true);
  const storagePolicy = await client.query(
    "select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Public read access to sprites'",
  );
  expect(storagePolicy.rowCount).toBe(1);

  const formatDefault = await client.query<{ column_default: string }>(
    "select column_default from information_schema.columns where table_schema = 'public' and table_name = 'draft_formats' and column_name = 'created_by'",
  );
  expect(formatDefault.rows[0].column_default).toBe("auth.uid()");

  const formatIndex = await client.query(
    "select 1 from pg_indexes where schemaname = 'public' and tablename = 'leagues' and indexname = 'leagues_draft_format_id_idx'",
  );
  expect(formatIndex.rowCount).toBe(1);

  // Nothing was skipped or left NOT VALID on a clean database.
  const report = await client.query("select * from public._migration_report()");
  expect(report.rows, "the post-apply report should be empty").toEqual([]);
}

describe("migrations", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  it("ship a base schema first, the hardening migration after the eight legacy files, and the playoffs feature migration last", () => {
    const migrations = readMigrations();
    expect(migrations[0].name).toBe(BASE_MIGRATION);
    expect(migrations[9].name).toBe(HARDENING_MIGRATION);
    expect(migrations[migrations.length - 1].name).toBe(PLAYOFFS_MIGRATION);
    expect(migrations).toHaveLength(11);
  });

  it("the shared test database was migrated by the global setup", async () => {
    await assertHardenedState(admin);
  });

  it("apply on an empty database, and the hardening and playoffs migrations are idempotent", async () => {
    await admin.query(`drop database if exists ${FRESH_DB}`);
    await admin.query(`create database ${FRESH_DB}`);
    const fresh = await connect(FRESH_DB);
    try {
      await createScaffolding(fresh);
      const migrations = readMigrations();
      for (const migration of migrations) {
        await applyMigration(fresh, migration);
      }
      await assertHardenedState(fresh);

      // Base schema is a no-op on a migrated database.
      await applyMigration(fresh, migrations[0]);
      // The hardening and the playoffs file applied a second time, in filename
      // order, succeed and leave the same state (the hardening re-creates the
      // 7-parameter create_league, which the playoffs file drops again).
      const hardening = migrations.find((m) => m.name === HARDENING_MIGRATION);
      const playoffs = migrations.find((m) => m.name === PLAYOFFS_MIGRATION);
      if (!hardening || !playoffs) throw new Error("hardening or playoffs migration missing");
      await applyMigration(fresh, hardening);
      await applyMigration(fresh, playoffs);
      await assertHardenedState(fresh);
      // The playoffs file alone is idempotent as well.
      await applyMigration(fresh, playoffs);
      await assertHardenedState(fresh);

      const policyCount = await fresh.query("select count(*)::int as n from pg_policies where schemaname = 'public'");
      expect(policyCount.rows[0].n).toBe(16);
    } finally {
      await fresh.end();
      await admin.query(`drop database if exists ${FRESH_DB}`);
    }
  });

  it("revokes internal helpers and grants the API to authenticated (and anon where documented)", async () => {
    const { rows } = await admin.query<{ fn: string; anon: boolean; authenticated: boolean }>(`
      select p.proname as fn,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    `);
    const byName = new Map(rows.map((r) => [r.fn, r]));
    for (const fn of API_FUNCTIONS) {
      expect(byName.get(fn)?.authenticated, `${fn} should be executable by authenticated`).toBe(true);
    }
    for (const fn of ["get_server_time", "get_invite_preview", "is_league_member"]) {
      expect(byName.get(fn)?.anon, `${fn} should be executable by anon`).toBe(true);
    }
    for (const fn of ["create_league", "make_pick", "swap_free_agent", "join_league"]) {
      expect(byName.get(fn)?.anon, `${fn} should not be executable by anon`).toBe(false);
    }
    for (const row of rows) {
      if (row.fn.startsWith("_")) {
        expect(row.anon, `${row.fn} should be internal`).toBe(false);
        expect(row.authenticated, `${row.fn} should be internal`).toBe(false);
      }
    }
  });
});
