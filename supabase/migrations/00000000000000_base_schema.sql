-- PokeDrafts base schema.
--
-- Recreates every application table exactly as it exists in the live Supabase
-- project (introspected 2026-09-09). Every statement is `create ... if not
-- exists`, so this file is a no-op on the live project and a complete
-- bootstrap on an empty one. The eight incremental migrations that follow it
-- (20260626163000 .. 20260718120000) assume these tables exist.
--
-- Constraints, indexes, policies and functions are added by
-- 20260909120000_release_hardening.sql.

create extension if not exists pgcrypto;

-- Reusable, point-priced Pokémon lists saved from the pool builder.
create table if not exists public.draft_formats (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  json jsonb not null,
  created_by uuid,
  created_at timestamptz default now()
);

-- One draft league. `commissioner_id` is the single source of truth for who
-- runs the league.
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  commissioner_id uuid not null,
  max_coaches integer not null default 8,
  created_at timestamptz default now(),
  draft_format_id uuid references public.draft_formats(id) on delete set null,
  point_budget integer default 100,
  draft_started boolean default false,
  current_pick_number integer default 1,
  picks_per_team integer default 10,
  draft_completed boolean default false,
  pick_timer_seconds integer not null default 120,
  pick_started_at timestamptz default now(),
  auto_pick_in_progress boolean not null default false,
  custom_pool jsonb,
  schedule_format text not null default 'round_robin',
  free_agent_swap_limit integer not null default 3
);

-- Coaches in a league (the commissioner has a row too).
create table if not exists public.league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'coach',
  joined_at timestamptz default now(),
  team_name text,
  draft_position integer,
  free_agent_swaps_used integer not null default 0
);

-- Invite codes. One row per league in practice.
create table if not exists public.league_invites (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  invite_code text not null,
  max_uses integer not null default 1,
  used_count integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- Picks made during the live draft.
create table if not exists public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  member_id uuid references public.league_members(id) on delete cascade,
  pokemon_name text not null,
  points integer not null,
  tier integer not null,
  pick_number integer not null,
  created_at timestamptz default now()
);

-- Finalized rosters, materialized from draft_picks when the draft completes
-- and edited by free-agent moves afterwards.
create table if not exists public.drafted_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  member_id uuid references public.league_members(id) on delete cascade,
  pokemon jsonb not null,
  total_points integer not null default 0,
  created_at timestamptz default now()
);

-- Legacy table kept for parity with the live project. Unused by the app and
-- inaccessible through the API (RLS enabled, no policies).
create table if not exists public.draft_order (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.leagues(id) on delete cascade,
  member_id uuid references public.league_members(id) on delete cascade,
  pick_slot integer not null,
  created_at timestamptz default now()
);

-- Season schedule generated from the finalized draft.
create table if not exists public.league_matches (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  round_number integer not null,
  match_number integer not null,
  home_member_id uuid not null references public.league_members(id) on delete cascade,
  away_member_id uuid not null references public.league_members(id) on delete cascade,
  status text not null default 'upcoming',
  winner_member_id uuid references public.league_members(id) on delete set null,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

-- Draft-room chat (also created by 20260626163000, identical definition).
create table if not exists public.draft_chat_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  member_id uuid not null references public.league_members(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

-- League news feed (also created by 20260703130000, identical definition).
create table if not exists public.league_news (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  member_id uuid references public.league_members(id) on delete set null,
  news_type text not null check (news_type in ('free_agent', 'match_result')),
  message text not null check (char_length(message) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- National dex: names, sprites and types used by every Pokémon display.
create table if not exists public.pokemon_dex (
  id bigint generated by default as identity primary key,
  dex_number integer not null,
  name text not null,
  created_at timestamptz default now(),
  sprite_url text,
  type1 text,
  type2 text
);

-- Alternate forms (regional, mega, ...). Present in the live project; not yet
-- read by the app.
create table if not exists public.pokemon_forms (
  id bigint primary key,
  name text not null,
  base_dex_number integer,
  sprite_url text,
  pokeapi_slug text
);
