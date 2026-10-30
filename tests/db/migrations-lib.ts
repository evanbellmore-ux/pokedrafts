// Pure helpers shared by the global setup and the migration tests. This file
// must not import from "vitest" because the global setup runs outside a worker.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type pg from "pg";

export const DB_USER = "postgres";
export const DB_PASSWORD = "postgres";
export const DB_NAME = "pokedrafts_test";

export const MIGRATIONS_DIR = resolve(process.cwd(), "supabase", "migrations");
export const HARDENING_MIGRATION = "20260909120000_release_hardening.sql";
// Feature migrations sort after the hardening file and are applied in filename order.
export const PLAYOFFS_MIGRATION = "20260912120000_playoffs.sql";
export const POOL_BUILDER_MIGRATION = "20260916120000_pool_builder.sql";
export const EXECUTION_MIGRATION = "20261013120000_castmirror_execution_private.sql";
export const EXECUTION_RULES_MIGRATION = "20261014224500_castmirror_raid_rules_pool_versions.sql";
export const RAID_REVIEW_MIGRATION = "20261015120000_castmirror_raid_reviews.sql";
export const EXECUTION_TIMEOUT_MIGRATION = "20261015143000_castmirror_request_timeout.sql";
export const JOIN_DRAFT_ORDER_MIGRATION = "20261020120000_join_league_draft_order.sql";
export const SMALL_SPRITES_MIGRATION = "20261020121000_small_pokemon_sprites.sql";
export const DRAFT_TIMER_SWEEP_MIGRATION = "20261020130000_draft_timer_sweep.sql";
export const UNDO_WHILE_PAUSED_MIGRATION = "20261021120000_undo_while_paused.sql";
export const PUBLIC_LEAGUES_MIGRATION = "20261022120000_public_leagues.sql";
export const WATCH_REVIEW_MIGRATION = "20261026120000_watch_review.sql";
export const ACCOUNT_DELETION_MIGRATION = "20261026130000_account_deletion.sql";
export const WATCH_RENAMES_MIGRATION = "20261027120000_watch_renames.sql";
export const BASE_MIGRATION = "00000000000000_base_schema.sql";

export type MigrationFile = { name: string; sql: string };

// Supabase databases are UTF8. An embedded cluster initialised on Windows
// inherits the OS code page (WIN1252) instead, and a database created from
// template1 inherits that, which cannot store every character in the Pokémon
// dataset (Nidoran♀). template0 lets a test database choose the project's
// encoding whatever the cluster default is; the locale stays the cluster's
// (UTF8 is allowed with any locale on Windows, and with the C or a UTF-8
// locale elsewhere).
export function createDatabaseSql(name: string): string {
  return `create database ${name} encoding 'UTF8' template template0`;
}

export function readMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

// Everything a fresh Supabase project provides that the migrations rely on:
// the API roles, pgcrypto in the "extensions" schema, auth.users + auth.uid(),
// GoTrue's auth.audit_log_entries (its columns, no foreign key to users), the
// realtime publication, a stub storage schema and Supabase's default grants
// on public.
export const SCAFFOLDING_SQL = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
create table if not exists auth.audit_log_entries (
  instance_id uuid,
  id uuid primary key,
  payload json,
  created_at timestamptz,
  ip_address varchar(64) not null default ''
);
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text
);

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export async function createScaffolding(client: pg.Client): Promise<void> {
  await client.query(SCAFFOLDING_SQL);
}

// Mirrors `supabase db push`: each file runs in its own transaction.
export async function applyMigration(client: pg.Client, migration: MigrationFile): Promise<void> {
  await client.query("begin");
  try {
    await client.query(migration.sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Migration ${migration.name} failed: ${message}`, { cause: error });
  }
}

export async function applyAllMigrations(client: pg.Client): Promise<MigrationFile[]> {
  const migrations = readMigrations();
  for (const migration of migrations) {
    await applyMigration(client, migration);
  }
  return migrations;
}
