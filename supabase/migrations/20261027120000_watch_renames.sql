-- PokeDrafts: Watch listings mark renames since approval, and approved leagues
-- that went private stay on the admin's list.
--
-- A listed league stays listed when its commissioner renames it or a coach
-- renames a team (the owner's choice, 2026-10-27, the same rule as for the
-- stream and the replays), but the admin's Watch listings page marks it
-- "Renamed since approval" with the new names, and the account menu counts it
-- until an admin keeps it listed (set_watch_listing true again) or unlists it
-- (docs/release-architecture.md section 16.7):
--   1. columns: leagues.name_changed_at and league_members.team_name_changed_at
--   2. triggers that stamp them whenever a name actually changes, whichever
--      function writes it (update_league_settings and rename_team today)
--   3. the admin's reads: _watch_renames (the names changed since a listed
--      league's review), site_admin_status (adds watch_renamed) and
--      list_watch_review (adds is_public and renamed, lists the renamed
--      leagues first among the listed ones, and also lists approved leagues
--      that are private now, so an admin can unlist one before it is public
--      again)
--   4. grants
--   5. post-apply report (select * from public._migration_report())
--
-- Renames from before this file ran are not marked: the stamps start empty.
-- A team that joins after its league's approval is not marked either; only a
-- rename is.
--
-- The whole file is idempotent (add column if not exists, create or replace,
-- drop trigger if exists). It replaces site_admin_status and list_watch_review
-- from 20261026120000_watch_review.sql, so re-run this file after any re-run
-- of that one.

------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------

-- When the league's name last changed; null: not since this file ran.
alter table public.leagues
  add column if not exists name_changed_at timestamptz;

-- When the team's name last changed; null: not since this file ran.
alter table public.league_members
  add column if not exists team_name_changed_at timestamptz;

------------------------------------------------------------------------------
-- 2. Triggers
------------------------------------------------------------------------------
-- Each runs before an update that sets the name column (update_league_settings
-- sets the league's name on every save, rename_team the team's on every
-- rename) and stamps the time only when the value changes, so saving the same
-- name marks nothing.

create or replace function public._stamp_league_name_change()
returns trigger
language plpgsql
set search_path = public, extensions
as $fn$
begin
  if new.name is distinct from old.name then
    new.name_changed_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists leagues_name_changed on public.leagues;
create trigger leagues_name_changed
  before update of name on public.leagues
  for each row execute function public._stamp_league_name_change();

create or replace function public._stamp_team_name_change()
returns trigger
language plpgsql
set search_path = public, extensions
as $fn$
begin
  if new.team_name is distinct from old.team_name then
    new.team_name_changed_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists league_members_team_name_changed on public.league_members;
create trigger league_members_team_name_changed
  before update of team_name on public.league_members
  for each row execute function public._stamp_team_name_change();

------------------------------------------------------------------------------
-- 3. The admin's reads
------------------------------------------------------------------------------

-- The names changed since an admin last reviewed a listed league:
-- { league: <the league's name changed>, teams: [<the current names of the
-- renamed teams, oldest rename first>] }, or null when none changed or the
-- league is not listed. A listed league with no review time (listed by hand
-- in the SQL editor) counts every stamped rename.
create or replace function public._watch_renames(p_league_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_since timestamptz;
  v_league_renamed boolean;
  v_teams jsonb;
begin
  select l.* into v_league from public.leagues l where l.id = p_league_id;
  if not found or not v_league.watch_listed then
    return null;
  end if;
  v_since := coalesce(v_league.watch_reviewed_at, '-infinity'::timestamptz);
  v_league_renamed := coalesce(v_league.name_changed_at > v_since, false);

  select coalesce(jsonb_agg(m.team_name order by m.team_name_changed_at, m.id), '[]'::jsonb)
  into v_teams
  from public.league_members m
  where m.league_id = v_league.id and m.team_name_changed_at > v_since;

  if not v_league_renamed and v_teams = '[]'::jsonb then
    return null;
  end if;
  return jsonb_build_object('league', v_league_renamed, 'teams', v_teams);
end;
$fn$;

-- The account menu's check: { admin: false } for everyone else, and for an
-- admin { admin: true, watch_waiting: <public leagues never reviewed>,
-- watch_renamed: <listed public leagues renamed since their review> }.
create or replace function public.site_admin_status()
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
begin
  if not public._is_site_admin() then
    return jsonb_build_object('admin', false);
  end if;
  return jsonb_build_object(
    'admin', true,
    'watch_waiting', (
      select count(*)::integer
      from public.leagues l
      where l.is_public and not l.watch_listed and l.watch_reviewed_at is null),
    'watch_renamed', (
      select count(*)::integer
      from public.leagues l
      where l.is_public and l.watch_listed and public._watch_renames(l.id) is not null));
end;
$fn$;

-- Every public league with its review state, and every listed league that is
-- private now, for the admin's Watch listings page: waiting (never reviewed)
-- first, then listed (renamed since review first), then unlisted, newest
-- league first within each. Per league: the name, when it was made, whether
-- it is public, the commissioner's team name, the coach count, the draft
-- state, the stream link and the replays, watch_listed, watch_reviewed_at and
-- the names changed since the review (renamed, from _watch_renames).
create or replace function public.list_watch_review()
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_leagues jsonb;
begin
  perform public._require_site_admin();

  select coalesce(jsonb_agg(s.row_json order by s.state, s.renamed desc, s.created_at desc, s.id), '[]'::jsonb)
  into v_leagues
  from (
    select l.id,
           l.created_at,
           case when l.watch_listed then 1 when l.watch_reviewed_at is null then 0 else 2 end as state,
           rn.renamed is not null as renamed,
           jsonb_build_object(
             'id', l.id,
             'name', l.name,
             'created_at', l.created_at,
             'is_public', l.is_public,
             'commissioner_team', (
               select m.team_name
               from public.league_members m
               where m.league_id = l.id and m.user_id = l.commissioner_id
               limit 1),
             'coach_count', (select count(*)::integer from public.league_members m where m.league_id = l.id),
             'max_coaches', l.max_coaches,
             'draft_started', coalesce(l.draft_started, false),
             'draft_completed', coalesce(l.draft_completed, false),
             'stream_url', l.stream_url,
             'replay_links', l.replay_links,
             'watch_listed', l.watch_listed,
             'watch_reviewed_at', l.watch_reviewed_at,
             'renamed', rn.renamed
           ) as row_json
    from public.leagues l
    cross join lateral (select public._watch_renames(l.id) as renamed) rn
    where l.is_public or l.watch_listed
  ) s;

  return jsonb_build_object('server_time', now(), 'leagues', v_leagues);
end;
$fn$;

------------------------------------------------------------------------------
-- 4. Grants
------------------------------------------------------------------------------
-- The two admin reads keep their grant to signed-in callers
-- (list_watch_review refuses everyone but a site admin; site_admin_status
-- answers anyone signed in). The helper and the two trigger functions are
-- internal. Supabase's default privileges hand every new function to anon and
-- authenticated, so everything is revoked first.

do $$
declare
  v_fn text;
  v_internal text[] := array[
    'public._watch_renames(uuid)',
    'public._stamp_league_name_change()',
    'public._stamp_team_name_change()'
  ];
  v_api text[] := array[
    'public.site_admin_status()',
    'public.list_watch_review()'
  ];
begin
  foreach v_fn in array v_internal loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;
  foreach v_fn in array v_api loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. Post-apply report
------------------------------------------------------------------------------
-- No rows means nothing is left to fix (docs/schema.md, "Verifying the
-- migration").

select * from public._migration_report();
