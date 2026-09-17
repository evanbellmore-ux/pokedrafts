-- PokeDrafts: Pool Builder v2 dataset table.
--
-- Implements section 13.4 of docs/release-architecture.md on top of
-- 20260909120000_release_hardening.sql and 20260912120000_playoffs.sql:
--   1. table: public.pokemon, one row per distinct, usable Pokémon (default
--      forms, Megas, regional and gender forms, other battle-relevant forms)
--      with its stats, types, tags, game availability and Pokédex numbers;
--      bst is a stored generated column
--   2. indexes: (species_id), (bst), GIN on tags and on games
--   3. row level security: select for authenticated only
--   4. grants: read-only for the client (no anon access, no client writes)
--   5. _migration_report() extended with the table's unique constraints
--   6. post-apply report (select * from public._migration_report())
--
-- The table is generated, never typed: scripts/build-pokemon-data.mjs writes
-- data/pokemon/pokemon.json and scripts/seed-pokemon.ts (npm run seed:pokemon)
-- loads it with the service-role key, the table's only writer. This file does
-- not load any data; until the seed runs the Pool Builder shows its empty
-- state and the rest of the app keeps reading pokemon_dex. pokemon_dex and
-- pokemon_forms are left untouched; a later cleanup drops them.
--
-- The whole file is idempotent: applying it twice succeeds and leaves the
-- database in the same state. It must run after the playoffs file. Section 5
-- re-creates _migration_report(), which the hardening file also creates, so
-- re-running the hardening file later reverts the report to its own body until
-- this file runs again: re-run this file after any re-run of the hardening
-- file, in filename order with the other feature files (README, "Applying
-- migrations").

------------------------------------------------------------------------------
-- 0. Session-scoped helpers (pg_temp is dropped automatically at disconnect)
------------------------------------------------------------------------------
-- The same helpers as the hardening file, for a public.pokemon that already
-- existed before this file ran (created by hand from the architecture
-- document, say) and lacks a constraint that create table if not exists
-- cannot add.

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
-- 1. The dataset table
------------------------------------------------------------------------------
-- Column notes (docs/release-architecture.md 13.4):
--   id            PokéAPI pokemon id, stable across rebuilds
--   species_id    national dex number; forms share their species' number
--   slug          PokéAPI pokemon name, e.g. 'charizard-mega-x'
--   display_name  the app's prose convention, e.g. 'Mega Charizard X',
--                 'Alolan Raichu', 'Rotom (Wash)', 'Indeedee (Female)'
--   form_kind     the row's relation to its species
--   form_label    'Mega X', 'Alolan', 'Wash', 'Female'; null for default
--   type1/type2   the capitalised app spelling used by pokemon_dex and
--                 TYPE_OVERRIDES ('Fire', 'Flying')
--   bst           the six base stats summed, generated and stored
--   tags          legendary, sub_legendary, restricted, mythical, paradox,
--                 ultra_beast; forms inherit their species' tags
--   games         game keys the row is available in (champions,
--                 scarlet_violet, legends_za, sword_shield, ...)
--   dex_numbers   entry numbers per Pokédex, { "paldea": 12, "champions": 6 }
--   sprite_url    PokéAPI official artwork, rendered with a plain img

create table if not exists public.pokemon (
  id integer primary key,
  species_id integer not null,
  slug text not null unique,
  display_name text not null unique,
  species_name text not null,
  form_kind text not null check (form_kind in ('default', 'mega', 'regional', 'gender', 'other')),
  form_label text,
  type1 text not null,
  type2 text,
  hp smallint not null,
  attack smallint not null,
  defense smallint not null,
  special_attack smallint not null,
  special_defense smallint not null,
  speed smallint not null,
  bst smallint generated always as (hp + attack + defense + special_attack + special_defense + speed) stored,
  generation smallint not null check (generation between 1 and 9),
  tags text[] not null default '{}',
  games text[] not null default '{}',
  dex_numbers jsonb not null default '{}',
  sprite_url text,
  updated_at timestamptz not null default now()
);

-- The constraints above, for a table that already existed without them
-- (no-ops on a table this file created). The unique ones are what
-- _migration_report() checks in section 5.
select pg_temp.pd_add_unique('public.pokemon', 'pokemon_slug_key', array['slug']);
select pg_temp.pd_add_unique('public.pokemon', 'pokemon_display_name_key', array['display_name']);
select pg_temp.pd_add_check('public.pokemon', 'pokemon_form_kind_check',
  $c$form_kind in ('default', 'mega', 'regional', 'gender', 'other')$c$);
select pg_temp.pd_add_check('public.pokemon', 'pokemon_generation_check', $c$generation between 1 and 9$c$);

------------------------------------------------------------------------------
-- 2. Indexes
------------------------------------------------------------------------------
-- The builder filters by stat total and by tag or game membership, and the
-- dex lookups group forms under their species.

create index if not exists pokemon_species_id_idx on public.pokemon (species_id);
create index if not exists pokemon_bst_idx on public.pokemon (bst);
create index if not exists pokemon_tags_idx on public.pokemon using gin (tags);
create index if not exists pokemon_games_idx on public.pokemon using gin (games);

------------------------------------------------------------------------------
-- 3. Row level security
------------------------------------------------------------------------------
-- Reference data like pokemon_dex: any signed-in user reads every row, anon
-- reads nothing, and no policy allows a write. Every policy on the table is
-- dropped first so re-running the file leaves exactly this one.

do $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'pokemon'
  loop
    execute format('drop policy if exists %I on public.pokemon', r.policyname);
  end loop;
end $$;

alter table public.pokemon enable row level security;

create policy "Signed-in users can read the dataset"
  on public.pokemon for select
  to authenticated
  using (true);

------------------------------------------------------------------------------
-- 4. Grants
------------------------------------------------------------------------------
-- The table is read-only for the client: select for authenticated, nothing
-- for anon, and no insert, update or delete for either. Supabase's default
-- privileges hand every new table to anon and authenticated in full, so the
-- revoke below is what makes a direct write fail with 42501 before RLS is
-- even consulted; the service role, which the seed script uses, keeps its
-- privileges. scripts/lib/client-contract.mjs reads this section: a bare
-- 'public.<table>' entry names a read-only table, while the API functions
-- the other files grant are 'public.<name>(' entries; this file adds none.

do $$
declare
  v_table text;
  v_read_only text[] := array[
    'public.pokemon'
  ];
begin
  foreach v_table in array v_read_only loop
    execute format('revoke all on table %s from public, anon, authenticated', v_table);
    execute format('grant select on table %s to authenticated', v_table);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant select, insert, update, delete on table %s to service_role', v_table);
    end if;
  end loop;
end $$;

drop function if exists pg_temp.pd_add_check(regclass, text, text);
drop function if exists pg_temp.pd_add_unique(regclass, text, text[]);
drop function if exists pg_temp.pd_unique_exists(regclass, text[]);
drop function if exists pg_temp.pd_unique_cols(regclass);

------------------------------------------------------------------------------
-- 5. Post-apply report function
------------------------------------------------------------------------------
-- The hardening file's _migration_report() lists, among other things, the
-- unique constraints a migration had to skip because of duplicate rows. This
-- is the same function, body for body, with public.pokemon's two unique
-- constraints added to that list (and the action naming this file, which
-- adds them back through section 1), so a re-run reports the new table like
-- the others. Keep it in step with the hardening file: a change there has to
-- be copied here, and a re-run of the hardening file replaces this body until
-- this file is re-run after it.
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
      ('public.pokemon_dex', array['dex_number']),
      -- Pool Builder v2 (20260916120000_pool_builder.sql, section 1).
      ('public.pokemon', array['slug']),
      ('public.pokemon', array['display_name'])
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
    action := case
      when r.tbl = 'public.pokemon' then 'remove the duplicate rows, then re-run 20260916120000_pool_builder.sql'
      else 'remove the duplicate rows, then re-run 20260909120000_release_hardening.sql'
    end;
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
-- 6. Post-apply report
------------------------------------------------------------------------------
-- The dataset is loaded by npm run seed:pokemon (docs/release-architecture.md
-- 13.9), not by this file, so an empty table right after applying it is the
-- expected state rather than a fault: a notice says so instead of a report
-- row. Then the same health check as the other files, ending with the select
-- so the Supabase SQL editor shows that list as the result of running this
-- file (no rows = nothing to do).

do $$
declare
  v_rows bigint;
  v_n integer;
begin
  select count(*) into v_rows from public.pokemon;
  if v_rows = 0 then
    raise notice 'PokeDrafts: public.pokemon is empty. Run npm run seed:pokemon (service-role key in .env.scripts) to load data/pokemon/pokemon.json; until then the Pool Builder shows its empty state and the app keeps reading pokemon_dex.';
  else
    raise notice 'PokeDrafts: public.pokemon holds % row(s).', v_rows;
  end if;
  select count(*) into v_n from public._migration_report();
  if v_n = 0 then
    raise notice 'PokeDrafts: pool builder migration applied with nothing left to fix (select * from public._migration_report() returns no rows).';
  else
    raise warning 'PokeDrafts: % item(s) need attention. Re-check any time with: select * from public._migration_report();', v_n;
  end if;
end $$;

select * from public._migration_report();
