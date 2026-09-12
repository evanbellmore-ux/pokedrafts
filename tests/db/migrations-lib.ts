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
export const BASE_MIGRATION = "00000000000000_base_schema.sql";

export type MigrationFile = { name: string; sql: string };

export function readMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

// Everything a fresh Supabase project provides that the migrations rely on:
// the API roles, pgcrypto in the "extensions" schema, auth.users + auth.uid(),
// the realtime publication, a stub storage schema and Supabase's default grants
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
