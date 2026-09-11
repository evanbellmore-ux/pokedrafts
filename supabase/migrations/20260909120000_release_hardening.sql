-- PokeDrafts release hardening.
--
-- Implements sections 4, 5 and 6 of docs/release-architecture.md:
--   1. new columns (draft pause tracking)
--   2. data fixes (role sync, trims, clamps, duplicate members, and a copy of
--      the draft format onto every format-based league's custom_pool, checked
--      against the same pool rules as update_league_pool)
--   3. constraints (added only when missing)
--   4. indexes
--   5. realtime publication membership
--   6. sprites storage bucket + public read policy
--   7. drop the legacy timer functions
--   8. helper + RPC functions (security definer)
--   9. complete RLS policy set (drop everything, recreate)
--  10. function grants
--  11. post-apply report (select * from public._migration_report())
--
-- The whole file is idempotent: applying it twice succeeds and leaves the
-- database in the same state.

------------------------------------------------------------------------------
-- 0. Session-scoped helpers (pg_temp is dropped automatically at disconnect)
------------------------------------------------------------------------------

create or replace function pg_temp.pd_unique_cols(p_table regclass)
returns table (index_name regclass, constraint_name name, is_deferrable boolean, cols text[])
language sql stable as $helper$
  select i.indexrelid::regclass,
         c.conname,
         coalesce(c.condeferrable, false),
         (
           select array_agg(a.attname::text order by a.attname)
           from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
           where k.ord <= i.indnkeyatts
         )
  from pg_index i
  left join pg_constraint c on c.conindid = i.indexrelid and c.contype in ('u', 'p')
  where i.indrelid = p_table
    and i.indisunique
    and i.indpred is null
    and i.indexprs is null;
$helper$;

create or replace function pg_temp.pd_unique_exists(p_table regclass, p_cols text[])
returns boolean language sql stable as $helper$
  select exists (
    select 1 from pg_temp.pd_unique_cols(p_table) u
    where u.cols = (select array_agg(x order by x) from unnest(p_cols) x)
  );
$helper$;

create or replace function pg_temp.pd_index_exists(p_table regclass, p_cols text[])
returns boolean language sql stable as $helper$
  select exists (
    select 1
    from pg_index i
    where i.indrelid = p_table
      and i.indpred is null
      and i.indexprs is null
      and i.indnkeyatts >= array_length(p_cols, 1)
      and (
        select array_agg(a.attname::text order by k.ord)
        from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
        where k.ord <= array_length(p_cols, 1)
      ) = p_cols
  );
$helper$;

-- Adds a unique constraint when no unique index already covers the same
-- column set. If existing rows violate it, warns and skips instead of failing.
create or replace function pg_temp.pd_add_unique(p_table regclass, p_name text, p_cols text[])
returns void language plpgsql as $helper$
begin
  if pg_temp.pd_unique_exists(p_table, p_cols) then
    return;
  end if;
  if exists (select 1 from pg_constraint where conrelid = p_table and conname = p_name) then
    return;
  end if;
  begin
    execute format('alter table %s add constraint %I unique (%s)',
      p_table, p_name, (select string_agg(quote_ident(c), ', ') from unnest(p_cols) c));
  exception
    when unique_violation then
      raise warning 'PokeDrafts: could not add unique constraint % on % because existing rows violate it. Clean the duplicates and re-run this migration.', p_name, p_table;
  end;
end;
$helper$;

-- Adds a check constraint by name. If existing rows violate it, the constraint
-- is added as NOT VALID (enforced for new writes only) and a warning is raised.
create or replace function pg_temp.pd_add_check(p_table regclass, p_name text, p_expr text)
returns void language plpgsql as $helper$
begin
  if exists (select 1 from pg_constraint where conrelid = p_table and conname = p_name) then
    return;
  end if;
  begin
    execute format('alter table %s add constraint %I check (%s)', p_table, p_name, p_expr);
  exception
    when check_violation then
      execute format('alter table %s add constraint %I check (%s) not valid', p_table, p_name, p_expr);
      raise warning 'PokeDrafts: constraint % on % was added as NOT VALID because existing rows violate it (%). Fix the rows, then run: alter table % validate constraint %;', p_name, p_table, p_expr, p_table, p_name;
  end;
end;
$helper$;

------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------

alter table public.leagues
  add column if not exists draft_paused_at timestamptz;

alter table public.leagues
  add column if not exists draft_paused_total_seconds integer not null default 0;

alter table public.draft_formats
  alter column created_by set default auth.uid();

------------------------------------------------------------------------------
-- 2. Data fixes
------------------------------------------------------------------------------

-- Historical typo.
update public.league_members
set role = 'commissioner'
where lower(trim(role)) = 'commisioner';

-- leagues.commissioner_id is the single source of truth; role is display-only.
update public.league_members m
set role = case when l.commissioner_id = m.user_id then 'commissioner' else 'coach' end
from public.leagues l
where l.id = m.league_id
  and m.role is distinct from (case when l.commissioner_id = m.user_id then 'commissioner' else 'coach' end);

-- Trim team names and cap them at 40 characters; blank becomes null.
update public.league_members
set team_name = nullif(left(trim(team_name), 40), '')
where team_name is distinct from nullif(left(trim(team_name), 40), '');

-- League names: 1..60 characters.
update public.leagues
set name = coalesce(nullif(left(trim(name), 60), ''), 'Untitled League')
where name is distinct from coalesce(nullif(left(trim(name), 60), ''), 'Untitled League');

-- Draft format names: 1..60 characters, like league names (the pool builder
-- caps them at 60; a direct insert did not).
update public.draft_formats
set name = coalesce(nullif(left(trim(name), 60), ''), 'Untitled format')
where name is distinct from coalesce(nullif(left(trim(name), 60), ''), 'Untitled format');

-- Two helpers from section 8 (functions) are created here, ahead of it, so
-- the next data fix can validate pools the way update_league_pool does
-- instead of carrying a second, more lenient parser.

-- Raises P0001 with a user-facing message and a snake_case code in DETAIL.
-- The one place in this file that raises an error itself.
create or replace function public._fail(p_message text, p_code text)
returns void
language plpgsql
as $fn$
begin
  raise exception using message = p_message, detail = p_code, errcode = 'P0001';
end;
$fn$;

-- The pool contract (docs/release-architecture.md section 5): a list of 1 to
-- 2000 entries, each an object with a non-empty name of at most 80 characters
-- (unique in the list, case-insensitively, after trimming), integer points 1
-- to 20 (a number or a string of digits) and, when present, a tier equal to
-- 21 - points. Returns the normalized entries [{name, points, tier}] in the
-- order given, or raises invalid_pool / invalid_points / invalid_tier /
-- duplicate_pokemon naming the first offending entry. Every pool a league
-- stores passes through here: update_league_pool, the format copies taken by
-- create_league / update_league_settings / reset_league_pool (_format_pool),
-- and the backfill below.
create or replace function public._validate_pool(p_pokemon jsonb)
returns jsonb
language plpgsql immutable
set search_path = public, extensions
as $fn$
declare
  v_count integer;
  v_entry jsonb;
  v_name text;
  v_points_raw text;
  v_points integer;
  v_tier_raw text;
  v_duplicate text;
  v_entries jsonb;
begin
  if p_pokemon is null or jsonb_typeof(p_pokemon) <> 'array' then
    perform public._fail('The pool must include a list of Pokémon.', 'invalid_pool');
  end if;
  v_count := jsonb_array_length(p_pokemon);
  if v_count < 1 or v_count > 2000 then
    perform public._fail('A pool needs between 1 and 2000 Pokémon.', 'invalid_pool');
  end if;

  for v_entry in select e from jsonb_array_elements(p_pokemon) e loop
    if jsonb_typeof(v_entry) <> 'object' then
      perform public._fail('Every pool entry needs a name and points.', 'invalid_pool');
    end if;
    v_name := trim(coalesce(v_entry ->> 'name', ''));
    if v_name = '' or char_length(v_name) > 80 then
      perform public._fail('Every pool entry needs a name of at most 80 characters.', 'invalid_pool');
    end if;
    v_points_raw := trim(both '"' from coalesce((v_entry -> 'points')::text, ''));
    if v_points_raw !~ '^[0-9]{1,3}$' then
      perform public._fail(format('"%s" needs integer points between 1 and 20.', v_name), 'invalid_points');
    end if;
    v_points := v_points_raw::integer;
    if v_points < 1 or v_points > 20 then
      perform public._fail(format('"%s" needs integer points between 1 and 20.', v_name), 'invalid_points');
    end if;
    v_tier_raw := trim(both '"' from coalesce((v_entry -> 'tier')::text, ''));
    if v_tier_raw <> '' and v_tier_raw <> 'null' and v_tier_raw <> (21 - v_points)::text then
      perform public._fail(format('"%s" has a tier that does not match its points.', v_name), 'invalid_tier');
    end if;
  end loop;

  -- Every entry is well formed now, so the expressions below are safe.
  select min(trim(e ->> 'name')) into v_duplicate
  from jsonb_array_elements(p_pokemon) e
  group by lower(trim(e ->> 'name'))
  having count(*) > 1
  order by 1
  limit 1;
  if v_duplicate is not null then
    perform public._fail(format('"%s" appears more than once in the pool.', v_duplicate), 'duplicate_pokemon');
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'name', trim(x.e ->> 'name'),
             'points', (trim(both '"' from (x.e -> 'points')::text))::integer,
             'tier', 21 - (trim(both '"' from (x.e -> 'points')::text))::integer)
           order by x.ord)
  into v_entries
  from jsonb_array_elements(p_pokemon) with ordinality as x(e, ord);
  return v_entries;
end;
$fn$;

-- Leagues that draft from a saved format used to read draft_formats.json live
-- (the pre-release client never wrote custom_pool for a format), so the
-- format's owner could change or delete the pool of a league they no longer
-- commission, even a finished one. From this release a league's pool is
-- always custom_pool (see _pool_json in section 8): copy the format onto every
-- league that still lacks a pool array, in the shape create_league and
-- reset_league_pool write (source "format" + draft_format_id), validated and
-- normalized by _validate_pool like every other pool. A league whose format
-- breaks the pool rules is skipped with a warning that names the entry, keeps
-- no pool, and is listed by _migration_report; fixing the format and
-- re-running this file copies it then. A started league whose format row is
-- already gone keeps an empty pool and is listed as well.
do $$
declare
  r record;
  v_entries jsonb;
  v_copied integer := 0;
  v_skipped integer := 0;
begin
  for r in
    select l.id, l.name, f.id as format_id, f.name as format_name, f.json
    from public.leagues l
    join public.draft_formats f on f.id = l.draft_format_id
    where jsonb_typeof(l.custom_pool -> 'pokemon') is distinct from 'array'
    order by l.created_at, l.id
  loop
    begin
      v_entries := public._validate_pool(r.json -> 'pokemon');
    exception
      when raise_exception then
        v_skipped := v_skipped + 1;
        raise warning 'PokeDrafts: league % (%) was not given a pool: its draft format "%" breaks the pool rules (%). Fix the format and re-run this file; select * from public._migration_report() lists it.', r.id, r.name, r.format_name, sqlerrm;
        continue;
    end;
    update public.leagues
    set custom_pool = jsonb_build_object(
          'version', '1.0',
          'leagueName', r.name,
          'pokemon', v_entries,
          'source', 'format',
          'draft_format_id', r.format_id)
    where id = r.id;
    v_copied := v_copied + 1;
  end loop;
  if v_copied > 0 then
    raise notice 'PokeDrafts: copied the draft format onto % league(s) (leagues.custom_pool); leagues no longer read draft_formats live.', v_copied;
  end if;
  if v_skipped > 0 then
    raise warning 'PokeDrafts: % league(s) kept no pool because their draft format breaks the pool rules; select * from public._migration_report() lists them.', v_skipped;
  end if;
end $$;

-- Numeric settings outside the documented ranges are clamped into them so the
-- check constraints in section 3 validate on live data. A check that had to be
-- added NOT VALID would otherwise block every later update of the violating
-- row (including a plain rename through update_league_settings).
do $$
declare
  v_n integer;
begin
  update public.leagues
  set max_coaches = least(greatest(max_coaches, 2), 24),
      point_budget = case when point_budget is null then null else least(greatest(point_budget, 1), 10000) end,
      picks_per_team = case when picks_per_team is null then null else least(greatest(picks_per_team, 1), 30) end,
      pick_timer_seconds = least(greatest(pick_timer_seconds, 10), 3600),
      free_agent_swap_limit = greatest(free_agent_swap_limit, 0)
  where max_coaches not between 2 and 24
     or point_budget not between 1 and 10000
     or picks_per_team not between 1 and 30
     or pick_timer_seconds not between 10 and 3600
     or free_agent_swap_limit < 0;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    raise warning 'PokeDrafts: clamped out-of-range settings (max_coaches 2..24, point_budget 1..10000, picks_per_team 1..30, pick_timer_seconds 10..3600, free_agent_swap_limit >= 0) on % league(s).', v_n;
  end if;
end $$;

-- Duplicate memberships created by the old non-atomic join flow: keep the
-- earliest row per (league, user) and drop later duplicates that own nothing.
delete from public.league_members dup
using public.league_members keep
where keep.league_id = dup.league_id
  and keep.user_id = dup.user_id
  and keep.id <> dup.id
  and (coalesce(keep.joined_at, 'epoch'::timestamptz), keep.id) < (coalesce(dup.joined_at, 'epoch'::timestamptz), dup.id)
  and not exists (select 1 from public.draft_picks p where p.member_id = dup.id)
  and not exists (select 1 from public.drafted_teams t where t.member_id = dup.id)
  and not exists (select 1 from public.league_matches x where x.home_member_id = dup.id or x.away_member_id = dup.id or x.winner_member_id = dup.id)
  and not exists (select 1 from public.league_news n where n.member_id = dup.id)
  and not exists (select 1 from public.draft_chat_messages c where c.member_id = dup.id);

------------------------------------------------------------------------------
-- 3. Constraints
------------------------------------------------------------------------------

-- league_members
select pg_temp.pd_add_unique('public.league_members', 'league_members_league_id_user_id_key', array['league_id', 'user_id']);
select pg_temp.pd_add_check('public.league_members', 'league_members_role_check', $c$role in ('commissioner', 'coach')$c$);
select pg_temp.pd_add_check('public.league_members', 'league_members_team_name_check', $c$team_name is null or char_length(team_name) between 1 and 40$c$);

-- (league_id, draft_position) must be unique AND deferrable so set_draft_order
-- can reorder in one statement. Replace any non-deferrable version.
do $$
declare
  r record;
  v_ok boolean := false;
begin
  for r in
    select * from pg_temp.pd_unique_cols('public.league_members')
    where cols = array['draft_position', 'league_id']
  loop
    if r.constraint_name is not null and r.is_deferrable then
      v_ok := true;
    elsif r.constraint_name is not null then
      execute format('alter table public.league_members drop constraint %I', r.constraint_name);
    else
      execute format('drop index %s', r.index_name);
    end if;
  end loop;

  if not v_ok then
    begin
      alter table public.league_members
        add constraint league_members_league_id_draft_position_key
        unique (league_id, draft_position) deferrable initially deferred;
    exception
      when unique_violation then
        raise warning 'PokeDrafts: could not add league_members_league_id_draft_position_key because some league has duplicate draft positions. Fix them (Settings > draft order) and re-run this migration.';
    end;
  end if;
end $$;

-- draft_picks
select pg_temp.pd_add_unique('public.draft_picks', 'draft_picks_league_id_pokemon_name_key', array['league_id', 'pokemon_name']);
select pg_temp.pd_add_unique('public.draft_picks', 'draft_picks_league_id_pick_number_key', array['league_id', 'pick_number']);

-- drafted_teams
select pg_temp.pd_add_unique('public.drafted_teams', 'drafted_teams_league_id_member_id_key', array['league_id', 'member_id']);

-- league_invites
select pg_temp.pd_add_unique('public.league_invites', 'league_invites_invite_code_key', array['invite_code']);

-- league_matches
select pg_temp.pd_add_check('public.league_matches', 'league_matches_status_check', $c$status in ('upcoming', 'completed')$c$);
select pg_temp.pd_add_unique('public.league_matches', 'league_matches_league_id_round_number_match_number_key', array['league_id', 'round_number', 'match_number']);

-- leagues
select pg_temp.pd_add_check('public.leagues', 'leagues_max_coaches_check', $c$max_coaches between 2 and 24$c$);
select pg_temp.pd_add_check('public.leagues', 'leagues_point_budget_check', $c$point_budget is null or point_budget between 1 and 10000$c$);
select pg_temp.pd_add_check('public.leagues', 'leagues_picks_per_team_check', $c$picks_per_team is null or picks_per_team between 1 and 30$c$);
select pg_temp.pd_add_check('public.leagues', 'leagues_pick_timer_seconds_check', $c$pick_timer_seconds between 10 and 3600$c$);
select pg_temp.pd_add_check('public.leagues', 'leagues_free_agent_swap_limit_check', $c$free_agent_swap_limit >= 0$c$);
select pg_temp.pd_add_check('public.leagues', 'leagues_name_check', $c$char_length(name) between 1 and 60$c$);

-- draft_formats: names like league names; json must be an object carrying a
-- pokemon array of at most 2000 entries (the shape the pool builder writes).
-- The entry-level rules (points 1..20, unique names, tier) are checked by
-- _validate_pool when a format is copied onto a league.
select pg_temp.pd_add_check('public.draft_formats', 'draft_formats_name_check', $c$char_length(name) between 1 and 60$c$);
select pg_temp.pd_add_check('public.draft_formats', 'draft_formats_json_check',
  $c$jsonb_typeof("json") = 'object' and (case when jsonb_typeof("json" -> 'pokemon') = 'array' then jsonb_array_length("json" -> 'pokemon') <= 2000 else false end)$c$);

-- pokemon_dex: the seed script upserts on dex_number.
select pg_temp.pd_add_unique('public.pokemon_dex', 'pokemon_dex_dex_number_key', array['dex_number']);

------------------------------------------------------------------------------
-- 4. Indexes
------------------------------------------------------------------------------

do $$
begin
  if not pg_temp.pd_index_exists('public.league_members', array['league_id']) then
    create index league_members_league_id_idx on public.league_members (league_id);
  end if;
  if not pg_temp.pd_index_exists('public.league_members', array['user_id']) then
    create index league_members_user_id_idx on public.league_members (user_id);
  end if;
  if not pg_temp.pd_index_exists('public.draft_picks', array['league_id', 'pick_number']) then
    create index draft_picks_league_id_pick_number_idx on public.draft_picks (league_id, pick_number);
  end if;
  if not pg_temp.pd_index_exists('public.league_matches', array['league_id']) then
    create index league_matches_league_id_idx on public.league_matches (league_id);
  end if;
  if not pg_temp.pd_index_exists('public.league_news', array['league_id', 'created_at']) then
    create index league_news_league_created_idx on public.league_news (league_id, created_at desc);
  end if;
  -- The draft_formats select policy looks up the leagues that use a format.
  if not pg_temp.pd_index_exists('public.leagues', array['draft_format_id']) then
    create index leagues_draft_format_id_idx on public.leagues (draft_format_id);
  end if;
end $$;

------------------------------------------------------------------------------
-- 5. Realtime
------------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and puballtables) then
    return;
  end if;
  foreach v_table in array array['draft_picks', 'leagues', 'league_members', 'league_matches', 'league_news', 'drafted_teams'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      exception
        when duplicate_object then null;
        when insufficient_privilege then
          raise warning 'PokeDrafts: could not add public.% to supabase_realtime (insufficient privilege). Add it from Database > Replication in the dashboard.', v_table;
      end;
    end if;
  end loop;
end $$;

------------------------------------------------------------------------------
-- 6. Storage: public "sprites" bucket
------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage')
     or to_regclass('storage.buckets') is null then
    return;
  end if;
  begin
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('sprites', 'sprites', true)
      on conflict (id) do update set public = true
    $sql$;
  exception
    when insufficient_privilege then
      raise warning 'PokeDrafts: could not create the sprites bucket (insufficient privilege). Create a public bucket named "sprites" from Storage in the dashboard.';
  end;
  if to_regclass('storage.objects') is not null then
    begin
      execute 'drop policy if exists "Public read access to sprites" on storage.objects';
      execute $sql$
        create policy "Public read access to sprites"
          on storage.objects
          for select
          using (bucket_id = 'sprites')
      $sql$;
    exception
      when insufficient_privilege then
        raise warning 'PokeDrafts: could not create the sprites read policy on storage.objects (insufficient privilege). Add a public SELECT policy for bucket "sprites" from Storage > Policies.';
    end;
  end if;
end $$;

------------------------------------------------------------------------------
-- 7. Legacy timer functions (any signature)
------------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('start_draft_timer', 'advance_draft_timer', 'complete_draft_timer')
  loop
    execute format('drop function %s', r.signature);
  end loop;
end $$;

-- get_server_time existed before with an unknown return type.
drop function if exists public.get_server_time();

------------------------------------------------------------------------------
-- 8. Functions
------------------------------------------------------------------------------
-- Conventions: language plpgsql, security definer, search_path = public,
-- extensions (pgcrypto lives in "extensions" on Supabase). Validation failures
-- raise P0001 with a user-facing message and a snake_case code in DETAIL
-- through _fail. _fail and _validate_pool are created in section 2, ahead of
-- the data fix that needs them.

create or replace function public._caller_uid()
returns uuid
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    perform public._fail('You must be logged in to do that.', 'not_authenticated');
  end if;
  return v_uid;
end;
$fn$;

-- Used by RLS policies. Security definer so league_members policies do not
-- recurse into themselves.
create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null or p_league_id is null then
    return false;
  end if;
  return exists (
    select 1 from public.league_members lm
    where lm.league_id = p_league_id and lm.user_id = v_uid
  );
end;
$fn$;

create or replace function public._lock_league(p_league_id uuid)
returns public.leagues
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
begin
  select l.* into v_league from public.leagues l where l.id = p_league_id for update;
  if not found then
    perform public._fail('League not found.', 'league_not_found');
  end if;
  return v_league;
end;
$fn$;

create or replace function public._league_commissioner_check(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
begin
  v_uid := public._caller_uid();
  if not exists (select 1 from public.leagues l where l.id = p_league_id and l.commissioner_id = v_uid) then
    perform public._fail('Only the commissioner can do that.', 'not_commissioner');
  end if;
end;
$fn$;

create or replace function public._member_for(p_league_id uuid, p_user_id uuid)
returns public.league_members
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_member public.league_members;
begin
  select lm.* into v_member
  from public.league_members lm
  where lm.league_id = p_league_id and lm.user_id = p_user_id
  order by lm.joined_at nulls last, lm.id
  limit 1;
  if not found then
    perform public._fail('You are not a coach in this league.', 'not_a_member');
  end if;
  return v_member;
end;
$fn$;

create or replace function public._validate_team_name(p_team_name text)
returns text
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_name text;
begin
  v_name := trim(coalesce(p_team_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    perform public._fail('Team names must be between 1 and 40 characters.', 'invalid_team_name');
  end if;
  return v_name;
end;
$fn$;

create or replace function public._visible_format(p_format_id uuid, p_user_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
begin
  return exists (
    select 1 from public.draft_formats f
    where f.id = p_format_id and (f.created_by = p_user_id or f.created_by is null)
  );
end;
$fn$;

-- A raw pokemon array as rows, for reading leagues.custom_pool. Everything the
-- functions store there has passed _validate_pool, so this leniency is only
-- for a list put on the row by hand (see _migration_report): malformed
-- entries are skipped, duplicate names collapse to the most expensive entry,
-- and anything that is not an array is an empty pool.
create or replace function public._pool_rows(p_pokemon jsonb)
returns table (name text, points integer, tier integer)
language plpgsql immutable
set search_path = public, extensions
as $fn$
begin
  return query
  select distinct on (lower(trim(e ->> 'name')))
         trim(e ->> 'name'),
         (e ->> 'points')::integer,
         coalesce(
           case when (e ->> 'tier') ~ '^-?[0-9]{1,6}$' then (e ->> 'tier')::integer end,
           21 - (e ->> 'points')::integer)
  from jsonb_array_elements(case when jsonb_typeof(p_pokemon) = 'array' then p_pokemon else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object'
    and coalesce(trim(e ->> 'name'), '') <> ''
    and coalesce(e ->> 'points', '') ~ '^[0-9]{1,6}$'
  order by lower(trim(e ->> 'name')), (e ->> 'points')::integer desc;
end;
$fn$;

-- The pool a league drafts from, as raw JSON: always leagues.custom_pool.
-- draft_formats is never read here. A format-based league carries a copy of
-- its format in custom_pool (source "format"; written by create_league,
-- update_league_settings and reset_league_pool, and backfilled in section 2),
-- so whoever owns the format row (possibly a former commissioner) cannot
-- change or delete what a league drafts from, before or after its draft.
create or replace function public._pool_json(p_league_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_pool jsonb;
begin
  select case when jsonb_typeof(l.custom_pool -> 'pokemon') = 'array' then l.custom_pool -> 'pokemon' end
  into v_pool
  from public.leagues l
  where l.id = p_league_id;
  return coalesce(v_pool, '[]'::jsonb);
end;
$fn$;

-- The effective pool as rows.
create or replace function public._league_pool(p_league_id uuid)
returns table (name text, points integer, tier integer)
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
begin
  return query
  select p.name, p.points, p.tier
  from public._pool_rows(public._pool_json(p_league_id)) p;
end;
$fn$;

-- A draft format as the value leagues.custom_pool stores, or null when the
-- format row does not exist. The list goes through _validate_pool, exactly
-- like a pool sent to update_league_pool: a format that breaks the pool rules
-- (points outside 1..20, a name over 80 characters, a tier that contradicts
-- its points, duplicate names, more than 2000 entries) is refused with the
-- same code and a message that names the format, so create_league,
-- update_league_settings and reset_league_pool never store a copy that the
-- draft would misprice or that every coach would download for nothing.
create or replace function public._format_pool(p_format_id uuid, p_league_name text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_format public.draft_formats;
  v_entries jsonb;
  v_message text;
  v_code text;
begin
  if p_format_id is null then
    return null;
  end if;
  select f.* into v_format from public.draft_formats f where f.id = p_format_id;
  if not found then
    return null;
  end if;
  begin
    v_entries := public._validate_pool(v_format.json -> 'pokemon');
  exception
    when raise_exception then
      get stacked diagnostics v_message = message_text, v_code = pg_exception_detail;
      perform public._fail(
        format('The draft format "%s" cannot be used as a pool: %s', v_format.name, v_message),
        coalesce(nullif(v_code, ''), 'invalid_pool'));
  end;
  return jsonb_build_object(
    'version', '1.0',
    'leagueName', p_league_name,
    'pokemon', v_entries,
    'source', 'format',
    'draft_format_id', p_format_id);
end;
$fn$;

create or replace function public._positioned_members(p_league_id uuid)
returns uuid[]
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(lm.id order by lm.draft_position, lm.id), '{}'::uuid[])
  into v_ids
  from public.league_members lm
  where lm.league_id = p_league_id and lm.draft_position is not null;
  return v_ids;
end;
$fn$;

-- The member on the clock for a pick number (snake order over draft_position).
create or replace function public._snake_member(p_league_id uuid, p_pick_number integer)
returns uuid
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_ids uuid[];
  v_n integer;
  v_round integer;
  v_index integer;
begin
  v_ids := public._positioned_members(p_league_id);
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 or p_pick_number is null or p_pick_number < 1 then
    return null;
  end if;
  v_round := (p_pick_number - 1) / v_n;
  v_index := (p_pick_number - 1) % v_n;
  if v_round % 2 = 1 then
    v_index := v_n - 1 - v_index;
  end if;
  return v_ids[v_index + 1];
end;
$fn$;

-- Budget rule shared by _pick_legal and _best_available: the pick fits the
-- remaining budget, and what is left still covers every empty slot at the
-- cheapest pool price. A pure SQL function so the planner can inline it into
-- a filter.
create or replace function public._budget_fits(p_points integer, p_remaining integer, p_slots_after integer, p_min integer)
returns boolean
language sql immutable
as $fn$
  select p_points <= p_remaining and (p_remaining - p_points) >= p_slots_after * p_min;
$fn$;

-- Budget rule for one candidate pick of p_points.
create or replace function public._pick_legal(p_league_id uuid, p_member_id uuid, p_points integer)
returns boolean
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_budget integer;
  v_picks integer;
  v_spent integer;
  v_count integer;
  v_remaining integer;
  v_slots_after integer;
  v_min integer;
begin
  select coalesce(l.point_budget, 100), coalesce(l.picks_per_team, 10)
  into v_budget, v_picks
  from public.leagues l where l.id = p_league_id;
  if not found then
    return false;
  end if;
  select coalesce(sum(d.points), 0), count(*)
  into v_spent, v_count
  from public.draft_picks d
  where d.league_id = p_league_id and d.member_id = p_member_id;
  if v_count >= v_picks then
    return false;
  end if;
  v_remaining := v_budget - v_spent;
  v_slots_after := v_picks - v_count - 1;
  select coalesce(min(p.points), 0) into v_min from public._league_pool(p_league_id) p;
  return public._budget_fits(p_points, v_remaining, v_slots_after, v_min);
end;
$fn$;

-- Best legal undrafted Pokémon for a member: highest points, then name.
-- The pool is parsed once: the member's budget state is computed up front and
-- the budget rule runs as a SQL filter, so the cost is linear in the pool size.
-- (Calling _pick_legal per row re-parsed the whole pool for every candidate,
-- which took ~14 s for 2000 entries while holding the league lock.)
create or replace function public._best_available(p_league_id uuid, p_member_id uuid)
returns table (name text, points integer, tier integer)
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_budget integer;
  v_picks integer;
  v_spent integer;
  v_count integer;
  v_remaining integer;
  v_slots_after integer;
begin
  select coalesce(l.point_budget, 100), coalesce(l.picks_per_team, 10)
  into v_budget, v_picks
  from public.leagues l where l.id = p_league_id;
  if not found then
    return;
  end if;
  select coalesce(sum(d.points), 0), count(*)
  into v_spent, v_count
  from public.draft_picks d
  where d.league_id = p_league_id and d.member_id = p_member_id;
  if v_count >= v_picks then
    return;
  end if;
  v_remaining := v_budget - v_spent;
  v_slots_after := v_picks - v_count - 1;

  return query
  with pool as materialized (
    select p.name, p.points, p.tier
    from public._league_pool(p_league_id) p
  ),
  floor_price as (
    select coalesce(min(p.points), 0) as min_points from pool p
  )
  select p.name, p.points, p.tier
  from pool p
  cross join floor_price f
  where public._budget_fits(p.points, v_remaining, v_slots_after, f.min_points)
    and not exists (
      select 1 from public.draft_picks d
      where d.league_id = p_league_id and lower(d.pokemon_name) = lower(p.name))
  order by p.points desc, p.name asc
  limit 1;
end;
$fn$;

create or replace function public._roster_total(p_roster jsonb)
returns integer
language plpgsql immutable
as $fn$
declare
  v_total integer;
begin
  if p_roster is null or jsonb_typeof(p_roster) <> 'array' then
    return 0;
  end if;
  select coalesce(sum((e ->> 'points')::integer), 0)
  into v_total
  from jsonb_array_elements(p_roster) e
  where jsonb_typeof(e) = 'object' and coalesce(e ->> 'points', '') ~ '^[0-9]{1,6}$';
  return v_total;
end;
$fn$;

-- Circle-method round robin, identical to app/lib/league/schedule.ts.
create or replace function public._schedule_rows(p_member_ids uuid[], p_format text)
returns table (round_number integer, match_number integer, home_member_id uuid, away_member_id uuid)
language plpgsql immutable
as $fn$
declare
  v_start uuid[];
  v_rot uuid[];
  v_n integer;
  v_first_rounds integer;
  v_pass integer;
  v_passes integer;
  v_r integer;
  v_i integer;
  v_m integer;
  v_a uuid;
  v_b uuid;
begin
  v_start := coalesce(p_member_ids, '{}'::uuid[]);
  if coalesce(array_length(v_start, 1), 0) < 2 then
    return;
  end if;
  if array_length(v_start, 1) % 2 = 1 then
    v_start := array_append(v_start, null::uuid);
  end if;
  v_n := array_length(v_start, 1);
  v_first_rounds := v_n - 1;
  v_passes := case when p_format = 'double_round_robin' then 2 else 1 end;

  for v_pass in 0 .. v_passes - 1 loop
    v_rot := v_start;
    for v_r in 0 .. v_first_rounds - 1 loop
      v_m := 0;
      for v_i in 0 .. (v_n / 2) - 1 loop
        v_a := v_rot[v_i + 1];
        v_b := v_rot[v_n - v_i];
        if v_a is not null and v_b is not null then
          v_m := v_m + 1;
          round_number := v_pass * v_first_rounds + v_r + 1;
          match_number := v_m;
          if (v_r % 2 = 0) = (v_pass = 0) then
            home_member_id := v_a;
            away_member_id := v_b;
          else
            home_member_id := v_b;
            away_member_id := v_a;
          end if;
          return next;
        end if;
      end loop;
      v_rot := v_rot[1:1] || v_rot[v_n:v_n] || v_rot[2:v_n - 1];
    end loop;
  end loop;
end;
$fn$;

-- 10 characters from A-Z 2-9 without the ambiguous I, O, 0 and 1.
create or replace function public._new_invite_code()
returns text
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text := '';
  v_i integer;
begin
  v_bytes := gen_random_bytes(10);
  for v_i in 0 .. 9 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$fn$;

create or replace function public._create_invite(p_league_id uuid, p_max_uses integer)
returns text
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_code text;
  v_try integer;
begin
  for v_try in 1 .. 20 loop
    v_code := public._new_invite_code();
    begin
      insert into public.league_invites (league_id, invite_code, max_uses, used_count)
      values (p_league_id, v_code, greatest(coalesce(p_max_uses, 1), 1), 0);
      return v_code;
    exception
      when unique_violation then
        null;
    end;
  end loop;
  perform public._fail('Could not generate an invite code, please try again.', 'invite_generation_failed');
  return null;
end;
$fn$;

-- Replaces a league's invite code in place. The newest invite row is kept
-- (any extra rows are removed) and gets a fresh code, used_count = 0,
-- expires_at = null and max_uses in step with the coach limit; a league with
-- no invite row gets a new one through _create_invite. Every link handed out
-- before the call stops working at once, so the caller has to reshare the new
-- one. Runs under the league lock the caller already holds; used by
-- regenerate_invite (on request) and remove_member (so a removed coach cannot
-- walk back in with the link they were invited with).
create or replace function public._rotate_invite(p_league_id uuid, p_max_uses integer)
returns text
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_keep uuid;
  v_code text;
  v_try integer;
begin
  select i.id into v_keep
  from public.league_invites i
  where i.league_id = p_league_id
  order by i.created_at desc nulls last, i.id
  limit 1;

  if v_keep is null then
    return public._create_invite(p_league_id, p_max_uses);
  end if;

  delete from public.league_invites i where i.league_id = p_league_id and i.id <> v_keep;

  for v_try in 1 .. 20 loop
    v_code := public._new_invite_code();
    begin
      update public.league_invites
      set invite_code = v_code,
          used_count = 0,
          max_uses = greatest(coalesce(p_max_uses, 1), 1),
          expires_at = null
      where id = v_keep;
      return v_code;
    exception
      when unique_violation then
        null;
    end;
  end loop;
  perform public._fail('Could not generate an invite code, please try again.', 'invite_generation_failed');
  return null;
end;
$fn$;

-- Reads an integer setting from a jsonb object and validates its range.
create or replace function public._setting_int(p_settings jsonb, p_key text, p_min integer, p_max integer, p_code text, p_message text)
returns integer
language plpgsql stable
as $fn$
declare
  v_raw text;
  v_value integer;
begin
  if p_settings -> p_key is null or jsonb_typeof(p_settings -> p_key) = 'null' then
    perform public._fail(p_message, p_code);
  end if;
  v_raw := trim(both '"' from (p_settings -> p_key)::text);
  if v_raw !~ '^-?[0-9]{1,9}$' then
    perform public._fail(p_message, p_code);
  end if;
  v_value := v_raw::integer;
  if v_value < p_min or v_value > p_max then
    perform public._fail(p_message, p_code);
  end if;
  return v_value;
end;
$fn$;

-- Advances the clock after a consumed turn, or finalizes on the last one.
create or replace function public._advance_or_finalize(p_league_id uuid, p_current integer)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_positioned integer;
  v_picks integer;
  v_total integer;
begin
  v_positioned := coalesce(array_length(public._positioned_members(p_league_id), 1), 0);
  select coalesce(l.picks_per_team, 10) into v_picks from public.leagues l where l.id = p_league_id;
  v_total := v_positioned * v_picks;
  if p_current >= v_total then
    perform public._finalize_draft(p_league_id);
    return true;
  end if;
  update public.leagues
  set current_pick_number = p_current + 1,
      pick_started_at = now(),
      auto_pick_in_progress = false
  where id = p_league_id;
  return false;
end;
$fn$;

-- Materializes drafted_teams from draft_picks, regenerates the schedule and
-- marks the draft complete. Idempotent.
create or replace function public._finalize_draft(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_ids uuid[];
  v_member uuid;
  v_pokemon jsonb;
  v_total integer;
begin
  select l.* into v_league from public.leagues l where l.id = p_league_id for update;
  if not found then
    perform public._fail('League not found.', 'league_not_found');
  end if;
  v_ids := public._positioned_members(p_league_id);

  foreach v_member in array v_ids loop
    select coalesce(jsonb_agg(
             jsonb_build_object('name', d.pokemon_name, 'points', d.points, 'tier', d.tier, 'pick_number', d.pick_number)
             order by d.pick_number), '[]'::jsonb),
           coalesce(sum(d.points), 0)
    into v_pokemon, v_total
    from public.draft_picks d
    where d.league_id = p_league_id and d.member_id = v_member;

    update public.drafted_teams t
    set pokemon = v_pokemon, total_points = v_total
    where t.league_id = p_league_id and t.member_id = v_member;
    if not found then
      insert into public.drafted_teams (league_id, member_id, pokemon, total_points)
      values (p_league_id, v_member, v_pokemon, v_total);
    end if;
  end loop;

  delete from public.league_matches m where m.league_id = p_league_id;
  insert into public.league_matches (league_id, round_number, match_number, home_member_id, away_member_id, status)
  select p_league_id, s.round_number, s.match_number, s.home_member_id, s.away_member_id, 'upcoming'
  from public._schedule_rows(v_ids, coalesce(v_league.schedule_format, 'round_robin')) s;

  update public.leagues
  set draft_completed = true,
      auto_pick_in_progress = false,
      draft_paused_at = null
  where id = p_league_id;
end;
$fn$;

-- Shared pick logic for make_pick, force_pick and auto_pick_if_expired. The
-- caller has already locked the league row.
create or replace function public._pick_internal(p_league_id uuid, p_member_id uuid, p_pokemon_name text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_pool record;
  v_count integer;
  v_pick integer;
  v_completed boolean;
begin
  select l.* into v_league from public.leagues l where l.id = p_league_id;

  select p.name, p.points, p.tier into v_pool
  from public._league_pool(p_league_id) p
  where lower(p.name) = lower(trim(coalesce(p_pokemon_name, '')))
  limit 1;
  if not found then
    perform public._fail('That Pokémon is not in this league''s draft pool.', 'pokemon_not_in_pool');
  end if;

  if exists (
    select 1 from public.draft_picks d
    where d.league_id = p_league_id and lower(d.pokemon_name) = lower(v_pool.name)
  ) then
    perform public._fail('That Pokémon has already been drafted.', 'pokemon_already_drafted');
  end if;

  select count(*) into v_count
  from public.draft_picks d
  where d.league_id = p_league_id and d.member_id = p_member_id;
  if v_count >= coalesce(v_league.picks_per_team, 10) then
    perform public._fail('That team''s roster is already full.', 'roster_full');
  end if;

  if not public._pick_legal(p_league_id, p_member_id, v_pool.points) then
    perform public._fail('That Pokémon does not fit the remaining budget.', 'over_budget');
  end if;

  v_pick := coalesce(v_league.current_pick_number, 1);
  insert into public.draft_picks (league_id, member_id, pokemon_name, points, tier, pick_number)
  values (p_league_id, p_member_id, v_pool.name, v_pool.points, v_pool.tier, v_pick);

  v_completed := public._advance_or_finalize(p_league_id, v_pick);
  return jsonb_build_object('pick_number', v_pick, 'pokemon_name', v_pool.name, 'draft_completed', v_completed);
end;
$fn$;

----------------------------------------------------------------------------
-- Public API
----------------------------------------------------------------------------

create or replace function public.get_server_time()
returns timestamptz
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
begin
  return now();
end;
$fn$;

create or replace function public.create_league(
  p_name text,
  p_team_name text,
  p_max_coaches integer,
  p_draft_format_id uuid default null,
  p_point_budget integer default 100,
  p_picks_per_team integer default 10,
  p_pick_timer_seconds integer default 120)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_name text;
  v_team text;
  v_max integer;
  v_budget integer;
  v_picks integer;
  v_timer integer;
  v_league_id uuid;
begin
  v_uid := public._caller_uid();
  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    perform public._fail('League names must be between 1 and 60 characters.', 'invalid_name');
  end if;
  v_team := public._validate_team_name(p_team_name);
  v_max := coalesce(p_max_coaches, 8);
  if v_max < 2 or v_max > 24 then
    perform public._fail('A league needs between 2 and 24 coaches.', 'invalid_max_coaches');
  end if;
  v_budget := coalesce(p_point_budget, 100);
  if v_budget < 1 or v_budget > 10000 then
    perform public._fail('The point budget must be between 1 and 10000.', 'invalid_point_budget');
  end if;
  v_picks := coalesce(p_picks_per_team, 10);
  if v_picks < 1 or v_picks > 30 then
    perform public._fail('Picks per team must be between 1 and 30.', 'invalid_picks_per_team');
  end if;
  v_timer := coalesce(p_pick_timer_seconds, 120);
  if v_timer < 10 or v_timer > 3600 then
    perform public._fail('The pick timer must be between 10 and 3600 seconds.', 'invalid_pick_timer');
  end if;
  if p_draft_format_id is not null and not public._visible_format(p_draft_format_id, v_uid) then
    perform public._fail('That draft format is not available.', 'format_not_found');
  end if;

  -- A chosen format is copied onto the league now (see _pool_json): from here
  -- on the league's pool is custom_pool, whoever owns the format row.
  insert into public.leagues (
    name, commissioner_id, max_coaches, draft_format_id, point_budget, picks_per_team,
    pick_timer_seconds, draft_started, draft_completed, current_pick_number, auto_pick_in_progress,
    custom_pool)
  values (
    v_name, v_uid, v_max, p_draft_format_id, v_budget, v_picks,
    v_timer, false, false, 1, false,
    public._format_pool(p_draft_format_id, v_name))
  returning id into v_league_id;

  insert into public.league_members (league_id, user_id, role, team_name)
  values (v_league_id, v_uid, 'commissioner', v_team);

  perform public._create_invite(v_league_id, v_max - 1);
  return v_league_id;
end;
$fn$;

create or replace function public.get_invite_preview(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_invite public.league_invites;
  v_league public.leagues;
  v_count integer;
  v_invalid jsonb;
begin
  v_uid := auth.uid();
  v_invalid := jsonb_build_object(
    'league_id', null, 'league_name', null, 'coach_count', null, 'max_coaches', null,
    'draft_started', null, 'draft_completed', null, 'already_member', false, 'invite_valid', false);

  select i.* into v_invite
  from public.league_invites i
  where upper(trim(i.invite_code)) = upper(trim(coalesce(p_code, '')))
  order by i.created_at desc nulls last, i.id
  limit 1;
  if not found then
    return v_invalid;
  end if;

  select l.* into v_league from public.leagues l where l.id = v_invite.league_id;
  if not found then
    return v_invalid;
  end if;

  select count(*) into v_count from public.league_members lm where lm.league_id = v_league.id;

  return jsonb_build_object(
    'league_id', v_league.id,
    'league_name', v_league.name,
    'coach_count', v_count,
    'max_coaches', v_league.max_coaches,
    'draft_started', coalesce(v_league.draft_started, false),
    'draft_completed', coalesce(v_league.draft_completed, false),
    'already_member', v_uid is not null and exists (
      select 1 from public.league_members lm where lm.league_id = v_league.id and lm.user_id = v_uid),
    'invite_valid', v_invite.expires_at is null or v_invite.expires_at > now());
end;
$fn$;

create or replace function public.join_league(p_code text, p_team_name text)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_league_id uuid;
  v_league public.leagues;
  v_invite public.league_invites;
  v_count integer;
  v_team text;
begin
  v_uid := public._caller_uid();

  select i.league_id into v_league_id
  from public.league_invites i
  where upper(trim(i.invite_code)) = upper(trim(coalesce(p_code, '')))
  order by i.created_at desc nulls last, i.id
  limit 1;
  if not found then
    perform public._fail('That invite link is not valid.', 'invite_invalid');
  end if;

  v_league := public._lock_league(v_league_id);

  select i.* into v_invite
  from public.league_invites i
  where i.league_id = v_league.id
    and upper(trim(i.invite_code)) = upper(trim(coalesce(p_code, '')))
  order by i.created_at desc nulls last, i.id
  limit 1
  for update;
  if not found or (v_invite.expires_at is not null and v_invite.expires_at <= now()) then
    perform public._fail('That invite link is not valid.', 'invite_invalid');
  end if;

  if exists (select 1 from public.league_members lm where lm.league_id = v_league.id and lm.user_id = v_uid) then
    return v_league.id;
  end if;

  if coalesce(v_league.draft_started, false) then
    perform public._fail('This league''s draft has already started.', 'draft_already_started');
  end if;

  select count(*) into v_count from public.league_members lm where lm.league_id = v_league.id;
  if v_count >= v_league.max_coaches then
    perform public._fail('This league is full.', 'league_full');
  end if;

  v_team := public._validate_team_name(p_team_name);

  insert into public.league_members (league_id, user_id, role, team_name)
  values (v_league.id, v_uid, 'coach', v_team);

  update public.league_invites set used_count = used_count + 1 where id = v_invite.id;

  return v_league.id;
end;
$fn$;

create or replace function public.regenerate_invite(p_league_id uuid)
returns text
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  return public._rotate_invite(v_league.id, v_league.max_coaches - 1);
end;
$fn$;

create or replace function public.rename_team(p_league_id uuid, p_team_name text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_member public.league_members;
  v_team text;
begin
  v_uid := public._caller_uid();
  perform public._lock_league(p_league_id);
  v_member := public._member_for(p_league_id, v_uid);
  v_team := public._validate_team_name(p_team_name);
  update public.league_members set team_name = v_team where id = v_member.id;
end;
$fn$;

create or replace function public.leave_league(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_league public.leagues;
  v_member public.league_members;
begin
  v_uid := public._caller_uid();
  v_league := public._lock_league(p_league_id);
  v_member := public._member_for(p_league_id, v_uid);
  if v_league.commissioner_id = v_uid then
    perform public._fail('The commissioner cannot leave the league. Transfer the league first.', 'commissioner_cannot_leave');
  end if;
  if coalesce(v_league.draft_started, false) then
    perform public._fail('You cannot leave a league after its draft has started.', 'draft_already_started');
  end if;
  delete from public.league_members where id = v_member.id;
end;
$fn$;

create or replace function public.remove_member(p_league_id uuid, p_member_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_league public.leagues;
  v_member public.league_members;
begin
  v_uid := public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if coalesce(v_league.draft_started, false) then
    perform public._fail('Coaches cannot be removed after the draft has started.', 'draft_already_started');
  end if;
  select lm.* into v_member from public.league_members lm where lm.id = p_member_id and lm.league_id = v_league.id;
  if not found then
    perform public._fail('That coach is not in this league.', 'member_not_found');
  end if;
  if v_member.user_id = v_uid then
    perform public._fail('You cannot remove yourself from your own league.', 'cannot_remove_self');
  end if;
  delete from public.league_members where id = v_member.id;
  -- The removed coach holds the league's invite link. Rotate the code in the
  -- same transaction so that link is dead the moment they are gone (the
  -- commissioner reshares the new one to whoever should still get in).
  perform public._rotate_invite(v_league.id, v_league.max_coaches - 1);
end;
$fn$;

create or replace function public.transfer_commissioner(p_league_id uuid, p_member_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_league public.leagues;
  v_member public.league_members;
begin
  v_uid := public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  select lm.* into v_member from public.league_members lm where lm.id = p_member_id and lm.league_id = v_league.id;
  if not found then
    perform public._fail('That coach is not in this league.', 'member_not_found');
  end if;
  if v_member.user_id = v_uid then
    perform public._fail('You are already the commissioner.', 'already_commissioner');
  end if;
  update public.leagues set commissioner_id = v_member.user_id where id = v_league.id;
  update public.league_members
  set role = case when id = v_member.id then 'commissioner' else 'coach' end
  where league_id = v_league.id
    and role is distinct from (case when id = v_member.id then 'commissioner' else 'coach' end);
end;
$fn$;

create or replace function public.update_league_settings(p_league_id uuid, p_settings jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_league public.leagues;
  v_key text;
  v_started boolean;
  v_count integer;
  v_name text;
  v_max integer;
  v_budget integer;
  v_picks integer;
  v_timer integer;
  v_swaps integer;
  v_format text;
  v_format_id uuid;
  v_replace_pool boolean := false;
begin
  v_uid := public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    perform public._fail('Settings must be an object.', 'invalid_settings');
  end if;
  for v_key in select k from jsonb_object_keys(p_settings) k loop
    if v_key not in ('name', 'max_coaches', 'point_budget', 'picks_per_team', 'pick_timer_seconds',
                     'free_agent_swap_limit', 'schedule_format', 'draft_format_id') then
      perform public._fail(format('Unknown setting "%s".', v_key), 'unknown_setting');
    end if;
  end loop;

  v_started := coalesce(v_league.draft_started, false);
  v_name := v_league.name;
  v_max := v_league.max_coaches;
  v_budget := v_league.point_budget;
  v_picks := v_league.picks_per_team;
  v_timer := v_league.pick_timer_seconds;
  v_swaps := v_league.free_agent_swap_limit;
  v_format := v_league.schedule_format;
  v_format_id := v_league.draft_format_id;

  if p_settings ? 'name' then
    v_name := trim(coalesce(p_settings ->> 'name', ''));
    if char_length(v_name) < 1 or char_length(v_name) > 60 then
      perform public._fail('League names must be between 1 and 60 characters.', 'invalid_name');
    end if;
  end if;

  if p_settings ? 'max_coaches' then
    v_max := public._setting_int(p_settings, 'max_coaches', 2, 24, 'invalid_max_coaches', 'A league needs between 2 and 24 coaches.');
    select count(*) into v_count from public.league_members lm where lm.league_id = v_league.id;
    if v_max < v_count then
      perform public._fail(format('This league already has %s coaches.', v_count), 'max_coaches_below_members');
    end if;
    if v_started and v_max is distinct from v_league.max_coaches then
      perform public._fail('The number of coaches is locked once the draft has started.', 'locked_during_draft');
    end if;
  end if;

  if p_settings ? 'point_budget' then
    v_budget := public._setting_int(p_settings, 'point_budget', 1, 10000, 'invalid_point_budget', 'The point budget must be between 1 and 10000.');
    if v_started and v_budget is distinct from v_league.point_budget then
      perform public._fail('The point budget is locked once the draft has started.', 'locked_during_draft');
    end if;
  end if;

  if p_settings ? 'picks_per_team' then
    v_picks := public._setting_int(p_settings, 'picks_per_team', 1, 30, 'invalid_picks_per_team', 'Picks per team must be between 1 and 30.');
    if v_started and v_picks is distinct from v_league.picks_per_team then
      perform public._fail('Picks per team is locked once the draft has started.', 'locked_during_draft');
    end if;
  end if;

  if p_settings ? 'pick_timer_seconds' then
    v_timer := public._setting_int(p_settings, 'pick_timer_seconds', 10, 3600, 'invalid_pick_timer', 'The pick timer must be between 10 and 3600 seconds.');
  end if;

  if p_settings ? 'free_agent_swap_limit' then
    v_swaps := public._setting_int(p_settings, 'free_agent_swap_limit', 0, 1000, 'invalid_swap_limit', 'The free agent swap limit must be 0 or more.');
  end if;

  if p_settings ? 'schedule_format' then
    v_format := p_settings ->> 'schedule_format';
    if v_format is null or v_format not in ('round_robin', 'double_round_robin') then
      perform public._fail('Choose a valid schedule format.', 'invalid_schedule_format');
    end if;
  end if;

  if p_settings ? 'draft_format_id' then
    if jsonb_typeof(p_settings -> 'draft_format_id') = 'null' then
      v_format_id := null;
    else
      begin
        v_format_id := (p_settings ->> 'draft_format_id')::uuid;
      exception
        when invalid_text_representation then
          perform public._fail('That draft format is not available.', 'format_not_found');
      end;
    end if;
    if v_format_id is distinct from v_league.draft_format_id then
      -- Only a change has to be visible to the caller. The settings form
      -- echoes the league's current draft_format_id back on every save, and
      -- after transfer_commissioner that format may be private to the previous
      -- commissioner (the new one only reads it through league membership), so
      -- the unchanged value is always accepted.
      if v_format_id is not null and not public._visible_format(v_format_id, v_uid) then
        perform public._fail('That draft format is not available.', 'format_not_found');
      end if;
      if v_started then
        perform public._fail('The draft format is locked once the draft has started.', 'locked_during_draft');
      end if;
      -- The pool becomes a copy of the new format (null when the format is
      -- removed). A pool set with update_league_pool is replaced as well.
      v_replace_pool := true;
    end if;
  end if;

  update public.leagues
  set name = v_name,
      max_coaches = v_max,
      point_budget = v_budget,
      picks_per_team = v_picks,
      pick_timer_seconds = v_timer,
      free_agent_swap_limit = v_swaps,
      schedule_format = v_format,
      draft_format_id = v_format_id,
      custom_pool = case when v_replace_pool then public._format_pool(v_format_id, v_name) else custom_pool end
  where id = v_league.id
  returning * into v_league;

  -- Keep the informational invite counter in step with the coach limit.
  update public.league_invites set max_uses = greatest(v_max - 1, 1)
  where league_id = v_league.id and max_uses is distinct from greatest(v_max - 1, 1);

  return to_jsonb(v_league);
end;
$fn$;

create or replace function public.update_league_pool(p_league_id uuid, p_pool jsonb)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_entries jsonb;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if coalesce(v_league.draft_started, false) then
    perform public._fail('The draft pool is locked once the draft has started.', 'draft_already_started');
  end if;
  if p_pool is null or jsonb_typeof(p_pool) <> 'object' then
    perform public._fail('The pool must include a list of Pokémon.', 'invalid_pool');
  end if;
  -- The pool contract lives in _validate_pool, shared with the format copies.
  v_entries := public._validate_pool(p_pool -> 'pokemon');

  -- Only the validated entries are stored. The client's version string is
  -- ignored and leagueName is capped like a league name, so the row every
  -- coach downloads (and receives over realtime) stays small.
  update public.leagues
  set custom_pool = jsonb_build_object(
        'version', '1.0',
        'leagueName', coalesce(nullif(left(trim(p_pool ->> 'leagueName'), 60), ''), v_league.name),
        'pokemon', v_entries)
  where id = v_league.id;
end;
$fn$;

create or replace function public.reset_league_pool(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if coalesce(v_league.draft_started, false) then
    perform public._fail('The draft pool is locked once the draft has started.', 'draft_already_started');
  end if;
  -- Back to the league's draft format: a fresh copy of what the format holds
  -- right now, taken because the commissioner asked for it and checked by
  -- _validate_pool on the way (a format that breaks the pool rules is refused
  -- and the current pool stays). Without a format the league has no pool
  -- until update_league_pool sets one.
  update public.leagues
  set custom_pool = public._format_pool(v_league.draft_format_id, v_league.name)
  where id = v_league.id;
end;
$fn$;

create or replace function public.set_draft_order(p_league_id uuid, p_member_ids uuid[])
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_n integer;
  v_distinct integer;
  v_in_league integer;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if coalesce(v_league.draft_started, false) then
    perform public._fail('The draft order is locked once the draft has started.', 'draft_already_started');
  end if;
  v_n := coalesce(array_length(p_member_ids, 1), 0);
  if v_n < 2 then
    perform public._fail('Pick at least two coaches for the draft order.', 'not_enough_coaches');
  end if;
  if exists (select 1 from unnest(p_member_ids) x where x is null) then
    perform public._fail('One of the coaches in the draft order is not in this league.', 'member_not_found');
  end if;
  select count(distinct x) into v_distinct from unnest(p_member_ids) x;
  if v_distinct <> v_n then
    perform public._fail('Each coach can only appear once in the draft order.', 'duplicate_member');
  end if;
  select count(*) into v_in_league
  from public.league_members lm
  where lm.league_id = v_league.id and lm.id = any (p_member_ids);
  if v_in_league <> v_n then
    perform public._fail('One of the coaches in the draft order is not in this league.', 'member_not_found');
  end if;

  update public.league_members lm
  set draft_position = (
    select o.ord::integer
    from unnest(p_member_ids) with ordinality as o(id, ord)
    where o.id = lm.id)
  where lm.league_id = v_league.id;
end;
$fn$;

create or replace function public.start_draft(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_positioned integer;
  v_pool_size integer;
  v_min integer;
  v_picks integer;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if coalesce(v_league.draft_started, false) then
    perform public._fail('The draft has already started.', 'draft_already_started');
  end if;
  v_positioned := coalesce(array_length(public._positioned_members(p_league_id), 1), 0);
  if v_positioned < 2 then
    perform public._fail('Set a draft order with at least two coaches before starting.', 'not_enough_coaches');
  end if;
  v_picks := coalesce(v_league.picks_per_team, 10);
  select count(*), coalesce(min(p.points), 0) into v_pool_size, v_min from public._league_pool(p_league_id) p;
  if v_pool_size < v_positioned * v_picks then
    perform public._fail(format('The draft pool needs at least %s Pokémon for %s coaches.', v_positioned * v_picks, v_positioned), 'pool_too_small');
  end if;
  if v_picks * v_min > coalesce(v_league.point_budget, 100) then
    perform public._fail('The point budget cannot fit a full roster of the cheapest Pokémon.', 'budget_too_small');
  end if;

  -- The pool is leagues.custom_pool as configured (a format-based league has
  -- carried a copy of its format since it was chosen, see _pool_json), so
  -- there is nothing to freeze here and draft_formats is never read once the
  -- draft is live.

  -- A draft that has not started cannot own picks or teams.
  delete from public.draft_picks d where d.league_id = v_league.id;
  delete from public.drafted_teams t where t.league_id = v_league.id;

  update public.leagues
  set draft_started = true,
      draft_completed = false,
      current_pick_number = 1,
      pick_started_at = now(),
      auto_pick_in_progress = false,
      draft_paused_at = null,
      draft_paused_total_seconds = 0
  where id = v_league.id;
end;
$fn$;

create or replace function public.make_pick(p_league_id uuid, p_pokemon_name text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_league public.leagues;
  v_member public.league_members;
  v_on_clock uuid;
begin
  v_uid := public._caller_uid();
  v_league := public._lock_league(p_league_id);
  -- Membership before any draft-state check: an outsider armed with a league
  -- id gets not_a_member and learns nothing about the draft.
  v_member := public._member_for(p_league_id, v_uid);
  if not coalesce(v_league.draft_started, false) then
    perform public._fail('The draft has not started yet.', 'draft_not_started');
  end if;
  if coalesce(v_league.draft_completed, false) then
    perform public._fail('The draft is already complete.', 'draft_completed');
  end if;
  if v_league.draft_paused_at is not null then
    perform public._fail('The draft is paused.', 'draft_paused');
  end if;
  v_on_clock := public._snake_member(p_league_id, coalesce(v_league.current_pick_number, 1));
  if v_on_clock is null or v_on_clock <> v_member.id then
    perform public._fail('It is not your turn to pick.', 'not_your_turn');
  end if;
  return public._pick_internal(p_league_id, v_member.id, p_pokemon_name);
end;
$fn$;

create or replace function public.auto_pick_if_expired(p_league_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_league public.leagues;
  v_on_clock uuid;
  v_best record;
  v_result jsonb;
  v_completed boolean;
begin
  v_uid := public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._member_for(p_league_id, v_uid);

  if not coalesce(v_league.draft_started, false)
     or coalesce(v_league.draft_completed, false)
     or v_league.draft_paused_at is not null
     or (v_league.pick_started_at is not null
         and now() < v_league.pick_started_at + make_interval(secs => coalesce(v_league.pick_timer_seconds, 120))) then
    return jsonb_build_object('picked', false, 'pokemon_name', null::text, 'skipped', false,
                              'draft_completed', coalesce(v_league.draft_completed, false));
  end if;

  v_on_clock := public._snake_member(p_league_id, coalesce(v_league.current_pick_number, 1));
  if v_on_clock is null then
    return jsonb_build_object('picked', false, 'pokemon_name', null::text, 'skipped', false,
                              'draft_completed', coalesce(v_league.draft_completed, false));
  end if;

  select b.name, b.points, b.tier into v_best from public._best_available(p_league_id, v_on_clock) b;
  if not found then
    v_completed := public._advance_or_finalize(p_league_id, coalesce(v_league.current_pick_number, 1));
    return jsonb_build_object('picked', false, 'pokemon_name', null::text, 'skipped', true,
                              'draft_completed', v_completed);
  end if;

  v_result := public._pick_internal(p_league_id, v_on_clock, v_best.name);
  return jsonb_build_object('picked', true, 'pokemon_name', v_result ->> 'pokemon_name', 'skipped', false,
                            'draft_completed', (v_result ->> 'draft_completed')::boolean);
end;
$fn$;

create or replace function public.pause_draft(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if not coalesce(v_league.draft_started, false) then
    perform public._fail('The draft has not started yet.', 'draft_not_started');
  end if;
  if coalesce(v_league.draft_completed, false) then
    perform public._fail('The draft is already complete.', 'draft_completed');
  end if;
  if v_league.draft_paused_at is not null then
    perform public._fail('The draft is already paused.', 'already_paused');
  end if;
  update public.leagues set draft_paused_at = now() where id = v_league.id;
end;
$fn$;

create or replace function public.resume_draft(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_paused interval;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if v_league.draft_paused_at is null then
    perform public._fail('The draft is not paused.', 'not_paused');
  end if;
  v_paused := now() - v_league.draft_paused_at;
  update public.leagues
  set pick_started_at = coalesce(pick_started_at, now()) + v_paused,
      draft_paused_total_seconds = draft_paused_total_seconds + greatest(0, floor(extract(epoch from v_paused)))::integer,
      draft_paused_at = null
  where id = v_league.id;
end;
$fn$;

create or replace function public.undo_last_pick(p_league_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_pick public.draft_picks;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if not coalesce(v_league.draft_started, false) then
    perform public._fail('The draft has not started yet.', 'draft_not_started');
  end if;
  if coalesce(v_league.draft_completed, false) then
    perform public._fail('The draft is already complete.', 'draft_completed');
  end if;
  select d.* into v_pick
  from public.draft_picks d
  where d.league_id = v_league.id
  order by d.pick_number desc
  limit 1
  for update;
  if not found then
    perform public._fail('There is no pick to undo.', 'no_picks');
  end if;
  delete from public.draft_picks where id = v_pick.id;
  update public.leagues
  set current_pick_number = v_pick.pick_number,
      pick_started_at = now(),
      auto_pick_in_progress = false
  where id = v_league.id;
  return jsonb_build_object('pick_number', v_pick.pick_number, 'pokemon_name', v_pick.pokemon_name);
end;
$fn$;

create or replace function public.force_pick(p_league_id uuid, p_pokemon_name text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_on_clock uuid;
  v_best record;
  v_completed boolean;
  v_result jsonb;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if not coalesce(v_league.draft_started, false) then
    perform public._fail('The draft has not started yet.', 'draft_not_started');
  end if;
  if coalesce(v_league.draft_completed, false) then
    perform public._fail('The draft is already complete.', 'draft_completed');
  end if;
  if v_league.draft_paused_at is not null then
    perform public._fail('The draft is paused.', 'draft_paused');
  end if;
  v_on_clock := public._snake_member(p_league_id, coalesce(v_league.current_pick_number, 1));
  if v_on_clock is null then
    perform public._fail('No coach is on the clock.', 'not_enough_coaches');
  end if;

  if p_pokemon_name is null or trim(p_pokemon_name) = '' then
    select b.name, b.points, b.tier into v_best from public._best_available(p_league_id, v_on_clock) b;
    if not found then
      v_completed := public._advance_or_finalize(p_league_id, coalesce(v_league.current_pick_number, 1));
      return jsonb_build_object('pick_number', coalesce(v_league.current_pick_number, 1), 'pokemon_name', null::text,
                                'draft_completed', v_completed, 'skipped', true);
    end if;
    v_result := public._pick_internal(p_league_id, v_on_clock, v_best.name);
  else
    v_result := public._pick_internal(p_league_id, v_on_clock, p_pokemon_name);
  end if;
  return v_result || jsonb_build_object('skipped', false);
end;
$fn$;

create or replace function public.finalize_draft(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_ids uuid[];
  v_picks integer;
  v_total integer;
  v_short integer;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if not coalesce(v_league.draft_started, false) then
    perform public._fail('The draft has not started yet.', 'draft_not_started');
  end if;
  if coalesce(v_league.draft_completed, false)
     and exists (select 1 from public.drafted_teams t where t.league_id = v_league.id) then
    perform public._fail('The draft is already complete.', 'draft_completed');
  end if;
  v_ids := public._positioned_members(p_league_id);
  if coalesce(array_length(v_ids, 1), 0) < 2 then
    perform public._fail('At least two coaches need a draft position.', 'not_enough_coaches');
  end if;
  v_picks := coalesce(v_league.picks_per_team, 10);
  v_total := array_length(v_ids, 1) * v_picks;

  select count(*) into v_short
  from unnest(v_ids) m(id)
  where (select count(*) from public.draft_picks d where d.league_id = v_league.id and d.member_id = m.id) < v_picks;

  if v_short > 0 and coalesce(v_league.current_pick_number, 1) < v_total then
    perform public._fail('The draft is not finished yet.', 'draft_incomplete');
  end if;

  perform public._finalize_draft(p_league_id);
end;
$fn$;

create or replace function public.reset_draft(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  delete from public.league_news n where n.league_id = v_league.id;
  delete from public.league_matches m where m.league_id = v_league.id;
  delete from public.drafted_teams t where t.league_id = v_league.id;
  delete from public.draft_picks d where d.league_id = v_league.id;
  update public.league_members set free_agent_swaps_used = 0
  where league_id = v_league.id and free_agent_swaps_used <> 0;
  update public.leagues
  set draft_started = false,
      draft_completed = false,
      current_pick_number = 1,
      pick_started_at = now(),
      auto_pick_in_progress = false,
      draft_paused_at = null,
      draft_paused_total_seconds = 0
  where id = v_league.id;
  -- custom_pool is left as it is, whether it is a copy of a format or a pool
  -- set with update_league_pool: a league never follows a format live, so the
  -- commissioner pulls a format's current list with reset_league_pool.
end;
$fn$;

create or replace function public.swap_free_agent(p_league_id uuid, p_drop_name text, p_add_name text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_league public.leagues;
  v_member public.league_members;
  v_team public.drafted_teams;
  v_add record;
  v_roster jsonb;
  v_drop_entry jsonb;
  v_drop_index integer;
  v_new_entry jsonb;
  v_new_roster jsonb;
  v_new_total integer;
  v_news public.league_news;
  v_team_label text;
  v_message text;
begin
  v_uid := public._caller_uid();
  v_league := public._lock_league(p_league_id);
  -- Membership before the draft-state check, as in make_pick.
  v_member := public._member_for(p_league_id, v_uid);
  if not coalesce(v_league.draft_completed, false) then
    perform public._fail('Free agent moves open after the draft is complete.', 'draft_not_completed');
  end if;

  perform t.id from public.drafted_teams t where t.league_id = v_league.id order by t.id for update;

  select t.* into v_team
  from public.drafted_teams t
  where t.league_id = v_league.id and t.member_id = v_member.id
  order by t.created_at nulls last, t.id
  limit 1;
  if not found then
    perform public._fail('Your team has not been finalized yet.', 'no_team');
  end if;

  if v_member.free_agent_swaps_used >= v_league.free_agent_swap_limit then
    perform public._fail('You have used all of your free agent swaps.', 'no_swaps_left');
  end if;

  select p.name, p.points, p.tier into v_add
  from public._league_pool(p_league_id) p
  where lower(p.name) = lower(trim(coalesce(p_add_name, '')))
  limit 1;
  if not found then
    perform public._fail('That Pokémon is not in this league''s draft pool.', 'pokemon_not_in_pool');
  end if;

  if exists (
    select 1
    from public.drafted_teams t, jsonb_array_elements(case when jsonb_typeof(t.pokemon) = 'array' then t.pokemon else '[]'::jsonb end) e
    where t.league_id = v_league.id and lower(trim(e ->> 'name')) = lower(v_add.name)
  ) then
    perform public._fail('That Pokémon is already on a team.', 'pokemon_owned');
  end if;

  v_roster := case when jsonb_typeof(v_team.pokemon) = 'array' then v_team.pokemon else '[]'::jsonb end;
  v_new_entry := jsonb_build_object('name', v_add.name, 'points', v_add.points, 'tier', v_add.tier,
                                    'pick_number', null::integer, 'acquired', 'free_agent');

  if p_drop_name is not null and trim(p_drop_name) <> '' then
    select o.e, (o.ord - 1)::integer into v_drop_entry, v_drop_index
    from jsonb_array_elements(v_roster) with ordinality as o(e, ord)
    where lower(trim(o.e ->> 'name')) = lower(trim(p_drop_name))
    limit 1;
    if not found then
      perform public._fail('That Pokémon is not on your roster.', 'not_on_roster');
    end if;
    v_new_roster := jsonb_set(v_roster, array[v_drop_index::text], v_new_entry);
  else
    if jsonb_array_length(v_roster) >= coalesce(v_league.picks_per_team, 10) then
      perform public._fail('Your roster is full. Choose a Pokémon to drop.', 'roster_full');
    end if;
    v_new_roster := v_roster || jsonb_build_array(v_new_entry);
  end if;

  v_new_total := public._roster_total(v_new_roster);
  if v_new_total > coalesce(v_league.point_budget, 100) then
    perform public._fail('That move would put your team over the point budget.', 'over_budget');
  end if;

  update public.drafted_teams set pokemon = v_new_roster, total_points = v_new_total where id = v_team.id;
  update public.league_members set free_agent_swaps_used = free_agent_swaps_used + 1 where id = v_member.id;

  v_team_label := coalesce(nullif(trim(v_member.team_name), ''), 'A team');
  if v_drop_entry is null then
    v_message := format('%s added %s.', v_team_label, v_add.name);
  else
    v_message := format('%s added %s and dropped %s.', v_team_label, v_add.name, v_drop_entry ->> 'name');
  end if;

  insert into public.league_news (league_id, member_id, news_type, message, metadata)
  values (
    v_league.id, v_member.id, 'free_agent', left(v_message, 500),
    jsonb_build_object(
      'added', v_add.name,
      'dropped', v_drop_entry ->> 'name',
      'team_id', v_team.id,
      'before_pokemon', v_roster,
      'after_pokemon', v_new_roster,
      'previous_free_agent_swaps_used', v_member.free_agent_swaps_used,
      'next_free_agent_swaps_used', v_member.free_agent_swaps_used + 1))
  returning * into v_news;

  return to_jsonb(v_news);
end;
$fn$;

create or replace function public.undo_free_agent_move(p_news_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_news public.league_news;
  v_league public.leagues;
  v_member public.league_members;
  v_team public.drafted_teams;
  v_before jsonb;
  v_after jsonb;
  v_current jsonb;
  v_previous integer;
begin
  perform public._caller_uid();
  select n.* into v_news from public.league_news n where n.id = p_news_id and n.news_type = 'free_agent';
  if not found then
    perform public._fail('That free agent move no longer exists.', 'news_not_found');
  end if;
  v_league := public._lock_league(v_news.league_id);
  perform public._league_commissioner_check(v_league.id);

  select n.* into v_news from public.league_news n where n.id = p_news_id for update;
  if v_news.member_id is null then
    perform public._fail('The coach for that move is no longer in the league.', 'member_not_found');
  end if;
  select lm.* into v_member from public.league_members lm where lm.id = v_news.member_id for update;
  if not found then
    perform public._fail('The coach for that move is no longer in the league.', 'member_not_found');
  end if;
  perform t.id from public.drafted_teams t where t.league_id = v_league.id order by t.id for update;

  if exists (
    select 1 from public.league_news n
    where n.league_id = v_league.id
      and n.member_id = v_news.member_id
      and n.news_type = 'free_agent'
      and (n.created_at > v_news.created_at or (n.created_at = v_news.created_at and n.id > v_news.id))
  ) then
    perform public._fail('Only the latest free agent move for a team can be undone.', 'not_latest_move');
  end if;

  select t.* into v_team
  from public.drafted_teams t
  where t.league_id = v_league.id and t.member_id = v_member.id
  order by t.created_at nulls last, t.id
  limit 1;
  if not found then
    perform public._fail('That team has no finalized roster.', 'no_team');
  end if;

  v_before := v_news.metadata -> 'before_pokemon';
  v_after := v_news.metadata -> 'after_pokemon';
  if v_before is null or jsonb_typeof(v_before) <> 'array' or v_after is null or jsonb_typeof(v_after) <> 'array' then
    perform public._fail('That move cannot be undone automatically.', 'invalid_news');
  end if;
  v_current := case when jsonb_typeof(v_team.pokemon) = 'array' then v_team.pokemon else '[]'::jsonb end;
  if v_current <> v_after then
    perform public._fail('The roster has changed since that move, so it cannot be undone.', 'roster_changed');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_before) b
    where exists (
      select 1
      from public.drafted_teams t, jsonb_array_elements(case when jsonb_typeof(t.pokemon) = 'array' then t.pokemon else '[]'::jsonb end) e
      where t.league_id = v_league.id
        and t.id <> v_team.id
        and lower(trim(e ->> 'name')) = lower(trim(b ->> 'name')))
  ) then
    perform public._fail('A Pokémon from that move is now on another team, so it cannot be undone.', 'pokemon_owned');
  end if;

  v_previous := case
    when (v_news.metadata ->> 'previous_free_agent_swaps_used') ~ '^[0-9]{1,6}$'
      then (v_news.metadata ->> 'previous_free_agent_swaps_used')::integer
    else greatest(0, v_member.free_agent_swaps_used - 1)
  end;

  update public.drafted_teams set pokemon = v_before, total_points = public._roster_total(v_before) where id = v_team.id;
  update public.league_members set free_agent_swaps_used = v_previous where id = v_member.id;
  delete from public.league_news where id = v_news.id;
end;
$fn$;

create or replace function public.generate_schedule(p_league_id uuid, p_format text, p_randomize boolean, p_discard_results boolean default false)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_ids uuid[];
  v_n integer;
  v_i integer;
  v_j integer;
  v_tmp uuid;
  v_count integer;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if not coalesce(v_league.draft_completed, false) then
    perform public._fail('The schedule can be generated after the draft is complete.', 'draft_not_completed');
  end if;
  if p_format is null or p_format not in ('round_robin', 'double_round_robin') then
    perform public._fail('Choose a valid schedule format.', 'invalid_schedule_format');
  end if;
  v_ids := public._positioned_members(p_league_id);
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n < 2 then
    perform public._fail('At least two coaches need a draft position.', 'not_enough_coaches');
  end if;
  if exists (select 1 from public.league_matches m where m.league_id = v_league.id and m.status = 'completed') then
    if not coalesce(p_discard_results, false) then
      perform public._fail('Results have already been reported. Discard them to regenerate the schedule.', 'results_exist');
    end if;
    delete from public.league_news n where n.league_id = v_league.id and n.news_type = 'match_result';
  end if;

  if coalesce(p_randomize, false) then
    for v_i in reverse v_n .. 2 loop
      v_j := 1 + floor(random() * v_i)::integer;
      if v_j > v_i then
        v_j := v_i;
      end if;
      v_tmp := v_ids[v_i];
      v_ids[v_i] := v_ids[v_j];
      v_ids[v_j] := v_tmp;
    end loop;
  end if;

  update public.leagues set schedule_format = p_format where id = v_league.id;
  delete from public.league_matches m where m.league_id = v_league.id;
  insert into public.league_matches (league_id, round_number, match_number, home_member_id, away_member_id, status)
  select v_league.id, s.round_number, s.match_number, s.home_member_id, s.away_member_id, 'upcoming'
  from public._schedule_rows(v_ids, p_format) s;
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

create or replace function public.report_match_result(p_match_id uuid, p_winner_member_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_match public.league_matches;
  v_league public.leagues;
  v_loser uuid;
  v_winner_name text;
  v_loser_name text;
begin
  perform public._caller_uid();
  select m.* into v_match from public.league_matches m where m.id = p_match_id;
  if not found then
    perform public._fail('That match no longer exists.', 'match_not_found');
  end if;
  v_league := public._lock_league(v_match.league_id);
  perform public._league_commissioner_check(v_league.id);
  -- Re-read under the league lock. generate_schedule holds the same lock and
  -- deletes every match before reinserting the schedule, so the row read above
  -- can be gone by the time the lock is granted. Without this check the news
  -- insert below would store a row with a null match_id that nothing can clear.
  select m.* into v_match from public.league_matches m where m.id = p_match_id for update;
  if not found or v_match.league_id is distinct from v_league.id then
    perform public._fail('That match no longer exists.', 'match_not_found');
  end if;

  if p_winner_member_id is null or p_winner_member_id not in (v_match.home_member_id, v_match.away_member_id) then
    perform public._fail('The winner must be one of the two teams in the match.', 'invalid_winner');
  end if;
  v_loser := case when p_winner_member_id = v_match.home_member_id then v_match.away_member_id else v_match.home_member_id end;

  update public.league_matches set status = 'completed', winner_member_id = p_winner_member_id where id = v_match.id;

  select coalesce(nullif(trim(lm.team_name), ''), 'Unnamed Team') into v_winner_name from public.league_members lm where lm.id = p_winner_member_id;
  select coalesce(nullif(trim(lm.team_name), ''), 'Unnamed Team') into v_loser_name from public.league_members lm where lm.id = v_loser;

  delete from public.league_news n
  where n.league_id = v_league.id and n.news_type = 'match_result' and n.metadata ->> 'match_id' = v_match.id::text;

  insert into public.league_news (league_id, member_id, news_type, message, metadata)
  values (
    v_league.id, p_winner_member_id, 'match_result',
    left(format('%s defeated %s in Round %s.', coalesce(v_winner_name, 'Unnamed Team'), coalesce(v_loser_name, 'Unnamed Team'), v_match.round_number), 500),
    jsonb_build_object(
      'match_id', v_match.id,
      'winner_member_id', p_winner_member_id,
      'loser_member_id', v_loser,
      'round_number', v_match.round_number,
      'match_number', v_match.match_number));
end;
$fn$;

create or replace function public.clear_match_result(p_match_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_match public.league_matches;
  v_league public.leagues;
begin
  perform public._caller_uid();
  select m.* into v_match from public.league_matches m where m.id = p_match_id;
  if not found then
    perform public._fail('That match no longer exists.', 'match_not_found');
  end if;
  v_league := public._lock_league(v_match.league_id);
  perform public._league_commissioner_check(v_league.id);
  -- Same re-read as report_match_result: a schedule regenerated while this
  -- call waited for the league lock has replaced the match.
  select m.* into v_match from public.league_matches m where m.id = p_match_id for update;
  if not found or v_match.league_id is distinct from v_league.id then
    perform public._fail('That match no longer exists.', 'match_not_found');
  end if;
  update public.league_matches set status = 'upcoming', winner_member_id = null where id = v_match.id;
  delete from public.league_news n
  where n.league_id = v_league.id and n.news_type = 'match_result' and n.metadata ->> 'match_id' = v_match.id::text;
end;
$fn$;

----------------------------------------------------------------------------
-- Triggers
----------------------------------------------------------------------------
-- draft_chat_messages is the one league table the browser inserts into
-- directly (the draft room chat). The insert policy pins user_id and member_id
-- to the caller, but PostgREST accepts any column the client sends, so id and
-- created_at are assigned here on every insert: a message cannot carry a
-- chosen id or a timestamp that sorts it above (or below) the real
-- conversation. Client values are ignored rather than rejected, so the room's
-- insert().select() keeps working unchanged and gets the server row back.
create or replace function public._chat_message_defaults()
returns trigger
language plpgsql
set search_path = public, extensions
as $fn$
begin
  new.id := gen_random_uuid();
  new.created_at := now();
  return new;
end;
$fn$;

drop trigger if exists draft_chat_messages_defaults on public.draft_chat_messages;
create trigger draft_chat_messages_defaults
  before insert on public.draft_chat_messages
  for each row execute function public._chat_message_defaults();

-- Post-apply health check: lists what this migration could not enforce on the
-- existing data (constraints skipped because of duplicates or added NOT VALID)
-- and any realtime or storage piece it could not create. No rows means the
-- database matches docs/schema.md. Not exposed to the API; run it as the
-- database owner: select * from public._migration_report();
create or replace function public._migration_report()
returns table (severity text, item text, detail text, action text)
language plpgsql stable
set search_path = public, extensions
as $fn$
declare
  r record;
  v_reason text;
  v_state text;
  v_effect text;
begin
  -- Check constraints added NOT VALID: new writes are checked, but a row that
  -- still violates one cannot be updated at all (SQLSTATE 23514).
  for r in
    select format('%I.%I', n.nspname, cl.relname) as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.connamespace = 'public'::regnamespace
      and not c.convalidated
    order by 1, 2
  loop
    severity := 'warning';
    item := format('constraint %s on %s', r.conname, r.tbl);
    detail := format('added NOT VALID because existing rows violate %s; those rows cannot be updated (SQLSTATE 23514) until they are fixed', r.def);
    action := format('fix the rows, then run: alter table %s validate constraint %I;', r.tbl, r.conname);
    return next;
  end loop;

  -- Unique constraints skipped because existing rows contain duplicates.
  for r in
    select e.tbl, e.cols
    from (values
      ('public.league_members', array['league_id', 'user_id']),
      ('public.league_members', array['league_id', 'draft_position']),
      ('public.draft_picks', array['league_id', 'pokemon_name']),
      ('public.draft_picks', array['league_id', 'pick_number']),
      ('public.drafted_teams', array['league_id', 'member_id']),
      ('public.league_invites', array['invite_code']),
      ('public.league_matches', array['league_id', 'round_number', 'match_number']),
      ('public.pokemon_dex', array['dex_number'])
    ) as e(tbl, cols)
    where to_regclass(e.tbl) is not null
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = to_regclass(e.tbl)
          and i.indisunique
          and i.indpred is null
          and i.indexprs is null
          and (
            select array_agg(a.attname::text order by a.attname)
            from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
            where k.ord <= i.indnkeyatts
          ) = (select array_agg(x order by x) from unnest(e.cols) x))
    order by 1, 2
  loop
    severity := 'warning';
    item := format('unique (%s) on %s', array_to_string(r.cols, ', '), r.tbl);
    detail := 'missing: existing rows contain duplicates, so the migration skipped it';
    action := 'remove the duplicate rows, then re-run 20260909120000_release_hardening.sql';
    return next;
  end loop;

  -- Realtime publication membership (skipped when the publication is FOR ALL TABLES).
  if exists (select 1 from pg_publication p where p.pubname = 'supabase_realtime' and not p.puballtables) then
    for r in
      select t.tbl
      from unnest(array['draft_picks', 'leagues', 'league_members', 'league_matches', 'league_news', 'drafted_teams']) as t(tbl)
      where not exists (
        select 1 from pg_publication_tables p
        where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = t.tbl)
      order by 1
    loop
      severity := 'warning';
      item := format('realtime: public.%s', r.tbl);
      detail := 'not in the supabase_realtime publication, so live updates for it never reach the app';
      action := format('Database > Replication in the dashboard, or run: alter publication supabase_realtime add table public.%I;', r.tbl);
      return next;
    end loop;
  end if;

  -- Storage: the public sprites bucket and its read policy.
  if to_regclass('storage.buckets') is not null then
    begin
      if not exists (select 1 from storage.buckets b where b.id = 'sprites' and coalesce(b.public, false)) then
        severity := 'warning';
        item := 'storage: bucket "sprites"';
        detail := 'missing or not public, so Pokémon sprites cannot be served';
        action := 'create a public bucket named "sprites" from Storage in the dashboard, then upload the <dex_number>.png files';
        return next;
      end if;
      if to_regclass('storage.objects') is not null and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'Public read access to sprites') then
        severity := 'warning';
        item := 'storage: policy "Public read access to sprites"';
        detail := 'missing on storage.objects, so files in the sprites bucket are not publicly readable';
        action := 'Storage > Policies in the dashboard: add a public SELECT policy for bucket "sprites"';
        return next;
      end if;
    exception
      when insufficient_privilege then
        severity := 'info';
        item := 'storage';
        detail := 'could not inspect storage.buckets with this role';
        action := 'check in the dashboard that a public bucket named "sprites" exists with a public read policy';
        return next;
    end;
  end if;

  -- Leagues that have no pool to draft or pick free agents from. Before this
  -- release a format-based league read its format row live; section 2 copies
  -- the format onto the league, but cannot when the row was already deleted
  -- or when the format breaks the pool rules (_validate_pool). A started or
  -- finished league without a pool is broken (no pick, no free-agent pickup)
  -- and is a warning; a league that has not started is only kept from
  -- starting and is info. An unstarted league whose format passes the rules
  -- now is not listed: "Reset to format" on the Pool page copies it.
  for r in
    select l.id, l.name,
           coalesce(l.draft_started, false) as started,
           coalesce(l.draft_completed, false) as completed,
           f.id as format_id, f.name as format_name, f.json as format_json
    from public.leagues l
    left join public.draft_formats f on f.id = l.draft_format_id
    where coalesce(
            case when jsonb_typeof(l.custom_pool -> 'pokemon') = 'array' then jsonb_array_length(l.custom_pool -> 'pokemon') end,
            0) = 0
      and (coalesce(l.draft_started, false) or f.id is not null)
    order by l.created_at, l.id
  loop
    v_reason := null;
    if r.format_id is not null then
      begin
        perform public._validate_pool(r.format_json -> 'pokemon');
      exception
        when raise_exception then
          v_reason := sqlerrm;
      end;
      if v_reason is null and not r.started then
        continue;
      end if;
    end if;
    v_state := case when r.completed then 'finished its draft' else 'started its draft' end;
    v_effect := case when r.completed then 'free-agent moves cannot add Pokémon' else 'no pick can be made' end;
    severity := case when r.started then 'warning' else 'info' end;
    item := format('league %s (%s)', r.id, r.name);
    detail := case
      when not r.started then
        format('has no pool: its draft format "%s" breaks the pool rules (%s), so the draft cannot start', r.format_name, v_reason)
      when r.format_id is null then
        format('%s but has no pool (its draft format was deleted before this release copied it onto the league), so %s', v_state, v_effect)
      when v_reason is not null then
        format('%s but has no pool: its draft format "%s" breaks the pool rules (%s), so %s', v_state, r.format_name, v_reason, v_effect)
      else
        format('%s but has no pool: its draft format "%s" was not copied onto the league yet, so %s', v_state, r.format_name, v_effect)
    end;
    action := case
      when v_reason is not null and not r.started then
        format('fix that entry in draft format %s (pool builder, or update public.draft_formats set json = ... where id = ''%s''), then have the commissioner use "Reset to format" on the Pool page (reset_league_pool) or set a pool there', r.format_id, r.format_id)
      when v_reason is not null then
        format('fix that entry in draft format %s (pool builder, or update public.draft_formats set json = ... where id = ''%s''), then re-run 20260909120000_release_hardening.sql, which copies the format; or put the list back with: update public.leagues set custom_pool = jsonb_build_object(''version'', ''1.0'', ''leagueName'', name, ''pokemon'', ''[{"name": "...", "points": 1, "tier": 20}]''::jsonb) where id = ''%s''', r.format_id, r.format_id, r.id)
      when r.format_id is not null then
        're-run 20260909120000_release_hardening.sql, which copies the format now that it passes the pool rules'
      else
        format(
          'put the list back with: update public.leagues set custom_pool = jsonb_build_object(''version'', ''1.0'', ''leagueName'', name, ''pokemon'', ''[{"name": "...", "points": 1, "tier": 20}]''::jsonb) where id = ''%s''; or have the commissioner run reset_draft and choose a pool again',
          r.id)
    end;
    return next;
  end loop;

  return;
end;
$fn$;

------------------------------------------------------------------------------
-- 9. Row level security
------------------------------------------------------------------------------

do $$
declare
  r record;
  v_table text;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('leagues', 'league_members', 'league_invites', 'draft_formats', 'draft_picks',
                        'drafted_teams', 'league_matches', 'league_news', 'draft_chat_messages',
                        'pokemon_dex', 'pokemon_forms', 'draft_order')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;

  foreach v_table in array array['leagues', 'league_members', 'league_invites', 'draft_formats', 'draft_picks',
                                 'drafted_teams', 'league_matches', 'league_news', 'draft_chat_messages',
                                 'pokemon_dex', 'pokemon_forms', 'draft_order'] loop
    execute format('alter table public.%I enable row level security', v_table);
  end loop;
end $$;

-- leagues: members read, commissioners delete. Writes go through functions.
create policy "Members can view their leagues"
  on public.leagues for select
  using (public.is_league_member(leagues.id));

create policy "Commissioners can delete their leagues"
  on public.leagues for delete
  using (commissioner_id = auth.uid());

-- league_members: members read every coach in their league.
create policy "Members can view league coaches"
  on public.league_members for select
  using (public.is_league_member(league_members.league_id));

-- league_invites: commissioner only. Joiners use get_invite_preview/join_league.
create policy "Commissioners can view invites"
  on public.league_invites for select
  using (exists (
    select 1 from public.leagues l
    where l.id = league_invites.league_id and l.commissioner_id = auth.uid()));

-- draft_formats: own rows, unowned (shared) rows, and the format behind any
-- league the caller belongs to, since coaches read their league's pool through
-- the leagues -> draft_formats embed. Signed-in users only.
create policy "Users can view their own and shared formats"
  on public.draft_formats for select
  to authenticated
  using (
    created_by = auth.uid()
    or created_by is null
    or exists (
      select 1 from public.leagues l
      where l.draft_format_id = draft_formats.id
        and public.is_league_member(l.id)));

create policy "Users can create their own formats"
  on public.draft_formats for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "Users can update their own formats"
  on public.draft_formats for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "Users can delete their own formats"
  on public.draft_formats for delete
  to authenticated
  using (created_by = auth.uid());

-- Draft, roster, schedule and news rows: members read, functions write.
create policy "Members can view draft picks"
  on public.draft_picks for select
  using (public.is_league_member(draft_picks.league_id));

create policy "Members can view drafted teams"
  on public.drafted_teams for select
  using (public.is_league_member(drafted_teams.league_id));

create policy "Members can view league matches"
  on public.league_matches for select
  using (public.is_league_member(league_matches.league_id));

create policy "Members can view league news"
  on public.league_news for select
  using (public.is_league_member(league_news.league_id));

-- Chat: members read; members insert as themselves.
create policy "Members can read draft chat messages"
  on public.draft_chat_messages for select
  using (public.is_league_member(draft_chat_messages.league_id));

create policy "Members can send draft chat messages"
  on public.draft_chat_messages for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.league_members lm
      where lm.id = draft_chat_messages.member_id
        and lm.league_id = draft_chat_messages.league_id
        and lm.user_id = auth.uid()));

-- Reference data: any signed-in user.
create policy "Signed-in users can read the dex"
  on public.pokemon_dex for select
  to authenticated
  using (true);

create policy "Signed-in users can read forms"
  on public.pokemon_forms for select
  to authenticated
  using (true);

-- draft_order: RLS enabled, no policies (inaccessible).

------------------------------------------------------------------------------
-- 10. Grants
------------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_internal text[] := array[
    'public._fail(text, text)',
    'public._validate_pool(jsonb)',
    'public._caller_uid()',
    'public._lock_league(uuid)',
    'public._league_commissioner_check(uuid)',
    'public._member_for(uuid, uuid)',
    'public._validate_team_name(text)',
    'public._visible_format(uuid, uuid)',
    'public._pool_rows(jsonb)',
    'public._pool_json(uuid)',
    'public._league_pool(uuid)',
    'public._format_pool(uuid, text)',
    'public._positioned_members(uuid)',
    'public._snake_member(uuid, integer)',
    'public._budget_fits(integer, integer, integer, integer)',
    'public._pick_legal(uuid, uuid, integer)',
    'public._best_available(uuid, uuid)',
    'public._migration_report()',
    'public._roster_total(jsonb)',
    'public._schedule_rows(uuid[], text)',
    'public._new_invite_code()',
    'public._create_invite(uuid, integer)',
    'public._rotate_invite(uuid, integer)',
    'public._setting_int(jsonb, text, integer, integer, text, text)',
    'public._advance_or_finalize(uuid, integer)',
    'public._finalize_draft(uuid)',
    'public._pick_internal(uuid, uuid, text)',
    'public._chat_message_defaults()'
  ];
  v_api text[] := array[
    'public.create_league(text, text, integer, uuid, integer, integer, integer)',
    'public.join_league(text, text)',
    'public.regenerate_invite(uuid)',
    'public.rename_team(uuid, text)',
    'public.leave_league(uuid)',
    'public.remove_member(uuid, uuid)',
    'public.transfer_commissioner(uuid, uuid)',
    'public.update_league_settings(uuid, jsonb)',
    'public.update_league_pool(uuid, jsonb)',
    'public.reset_league_pool(uuid)',
    'public.set_draft_order(uuid, uuid[])',
    'public.start_draft(uuid)',
    'public.make_pick(uuid, text)',
    'public.auto_pick_if_expired(uuid)',
    'public.pause_draft(uuid)',
    'public.resume_draft(uuid)',
    'public.undo_last_pick(uuid)',
    'public.force_pick(uuid, text)',
    'public.finalize_draft(uuid)',
    'public.reset_draft(uuid)',
    'public.swap_free_agent(uuid, text, text)',
    'public.undo_free_agent_move(uuid)',
    'public.generate_schedule(uuid, text, boolean, boolean)',
    'public.report_match_result(uuid, uuid)',
    'public.clear_match_result(uuid)'
  ];
  v_public text[] := array[
    'public.get_server_time()',
    'public.get_invite_preview(text)',
    'public.is_league_member(uuid)'
  ];
begin
  foreach v_fn in array v_internal loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;
  foreach v_fn in array v_api loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
  foreach v_fn in array v_public loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to authenticated, anon', v_fn);
  end loop;
end $$;

drop function if exists pg_temp.pd_add_check(regclass, text, text);
drop function if exists pg_temp.pd_add_unique(regclass, text, text[]);
drop function if exists pg_temp.pd_index_exists(regclass, text[]);
drop function if exists pg_temp.pd_unique_exists(regclass, text[]);
drop function if exists pg_temp.pd_unique_cols(regclass);

------------------------------------------------------------------------------
-- 11. Post-apply report
------------------------------------------------------------------------------
-- Everything above degrades to a WARNING instead of failing. Summarize what
-- still needs attention for psql/CLI users, and end with a select so the
-- Supabase SQL editor shows the same list as the result of running this file
-- (no rows = nothing to do). It can be re-run at any time.

do $$
declare
  r record;
  v_n integer := 0;
begin
  for r in select * from public._migration_report() loop
    v_n := v_n + 1;
    raise warning 'PokeDrafts: [%] % - %. Action: %', r.severity, r.item, r.detail, r.action;
  end loop;
  if v_n = 0 then
    raise notice 'PokeDrafts: release hardening applied with nothing left to fix (select * from public._migration_report() returns no rows).';
  else
    raise warning 'PokeDrafts: % item(s) need attention. Re-check any time with: select * from public._migration_report();', v_n;
  end if;
end $$;

select * from public._migration_report();
