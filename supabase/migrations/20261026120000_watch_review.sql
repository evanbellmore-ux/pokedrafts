-- PokeDrafts: Watch listings a site admin approves, and the playoffs on /watch.
--
-- A public league's own page, /watch/<league id>, works as soon as its
-- commissioner makes the league public. The /watch list, which the landing
-- page and the navigation link to, shows a public league only once a site
-- admin has approved it, so a new account cannot put any stream or video on
-- it (docs/release-architecture.md section 16):
--   1. site_admins: the accounts that review listings. Row level security is
--      on and no policy or grant opens it, so only the SQL editor (or the
--      service role) reads or writes it
--   2. columns: leagues.watch_listed and watch_reviewed_at, and a partial
--      index for the list
--   3. the admin's functions: site_admin_status (the account menu's check),
--      list_watch_review (every public league with its review state) and
--      set_watch_listing (approve or unlist one)
--   4. the public reads: list_public_leagues lists approved public leagues
--      only and adds each league's playoff matches (round and status) for its
--      status line; get_public_league adds each match's bracket links
--      (feeds_match_id, feeds_slot) for the bracket, and watch_listed
--   5. grants
--   6. post-apply report (select * from public._migration_report())
--
-- Approval sticks: a listed league stays listed when its commissioner
-- changes the stream or the replays, and when it goes private and public
-- again; an admin can unlist it at any time, and an unlisted league stays
-- off the list until an admin lists it again. Existing public leagues start
-- unreviewed, so the list is empty until an admin approves them.
--
-- The whole file is idempotent (create table / add column / create index if
-- not exists, create or replace). It replaces the two public reads that
-- 20261022120000_public_leagues.sql created, so re-run this file after any
-- re-run of that one, or /watch would list every public league again.

------------------------------------------------------------------------------
-- 1. Site admins
------------------------------------------------------------------------------

-- Add an account with its email (Authentication > Users in the dashboard):
--   insert into public.site_admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
create table if not exists public.site_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.site_admins enable row level security;

-- Supabase's default privileges hand every new table to the API roles.
revoke all on table public.site_admins from public, anon, authenticated;

------------------------------------------------------------------------------
-- 2. Columns and index
------------------------------------------------------------------------------

-- Listed on /watch (an admin approved it). Only set_watch_listing writes it.
alter table public.leagues
  add column if not exists watch_listed boolean not null default false;

-- When an admin last listed or unlisted the league; null: never reviewed.
alter table public.leagues
  add column if not exists watch_reviewed_at timestamptz;

-- list_public_leagues reads only the listed public rows.
create index if not exists leagues_watch_listed_idx on public.leagues (id) where is_public and watch_listed;

------------------------------------------------------------------------------
-- 3. The admin's functions
------------------------------------------------------------------------------

create or replace function public._is_site_admin()
returns boolean
language sql stable security definer
set search_path = public, extensions
as $fn$
  select exists (select 1 from public.site_admins a where a.user_id = auth.uid())
$fn$;

create or replace function public._require_site_admin()
returns void
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
begin
  perform public._caller_uid();
  if not public._is_site_admin() then
    perform public._fail('Only a site admin can review Watch listings.', 'not_site_admin');
  end if;
end;
$fn$;

-- The account menu's check: { admin: false } for everyone else, and for an
-- admin { admin: true, watch_waiting: <public leagues never reviewed> }.
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
      where l.is_public and not l.watch_listed and l.watch_reviewed_at is null));
end;
$fn$;

-- Every public league with its review state, for the admin's Watch listings
-- page: waiting (never reviewed) first, then listed, then unlisted, newest
-- league first within each. Per league: the name, when it was made, the
-- commissioner's team name, the coach count, the draft state, the stream
-- link and the replays, watch_listed and watch_reviewed_at.
create or replace function public.list_watch_review()
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_leagues jsonb;
begin
  perform public._require_site_admin();

  select coalesce(jsonb_agg(s.row_json order by s.state, s.created_at desc, s.id), '[]'::jsonb)
  into v_leagues
  from (
    select l.id,
           l.created_at,
           case when l.watch_listed then 1 when l.watch_reviewed_at is null then 0 else 2 end as state,
           jsonb_build_object(
             'id', l.id,
             'name', l.name,
             'created_at', l.created_at,
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
             'watch_reviewed_at', l.watch_reviewed_at
           ) as row_json
    from public.leagues l
    where l.is_public
  ) s;

  return jsonb_build_object('server_time', now(), 'leagues', v_leagues);
end;
$fn$;

-- Lists (true) or unlists (false) a league on /watch. Works on any league;
-- only a public one appears. Returns { id, watch_listed, watch_reviewed_at }.
create or replace function public.set_watch_listing(p_league_id uuid, p_listed boolean)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_now timestamptz := now();
begin
  perform public._require_site_admin();
  if p_listed is null then
    perform public._fail('Choose whether the league is listed.', 'invalid_listing');
  end if;
  v_league := public._lock_league(p_league_id);

  update public.leagues
  set watch_listed = p_listed,
      watch_reviewed_at = v_now
  where id = v_league.id;

  return jsonb_build_object('id', v_league.id, 'watch_listed', p_listed, 'watch_reviewed_at', v_now);
end;
$fn$;

------------------------------------------------------------------------------
-- 4. The public reads
------------------------------------------------------------------------------

-- The /watch list: the 100 listed public leagues with the most recent
-- activity (the league's creation, its newest pick or news row), running
-- drafts first (started, not complete, not paused). Per league: the name, the
-- coach counts, the draft's progress (the coach on the clock and the clock's
-- deadline while it runs, the newest pick), the regular season's progress,
-- the playoff matches (round and status, in bracket order), the champion,
-- the stream link and the replays. Coaches appear by team name only.
-- `server_time` lets a page count the clock down.
create or replace function public.list_public_leagues()
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_leagues jsonb;
begin
  select coalesce(jsonb_agg(s.row_json order by s.running desc, s.last_activity desc nulls last, s.id), '[]'::jsonb)
  into v_leagues
  from (
    select l.id,
           r.running,
           greatest(l.created_at, lp.created_at, ln.created_at) as last_activity,
           jsonb_build_object(
             'id', l.id,
             'name', l.name,
             'coach_count', mc.coach_count,
             'drafting_count', mc.drafting_count,
             'max_coaches', l.max_coaches,
             'picks_per_team', l.picks_per_team,
             'current_pick_number', l.current_pick_number,
             'draft_started', coalesce(l.draft_started, false),
             'draft_completed', coalesce(l.draft_completed, false),
             'draft_paused', l.draft_paused_at is not null,
             'pick_deadline', case when r.running
                                then l.pick_started_at + make_interval(secs => l.pick_timer_seconds) end,
             'on_clock', case when r.running then (
                           select jsonb_build_object('team_name', m.team_name)
                           from public.league_members m
                           where m.id = public._snake_member(l.id, l.current_pick_number)) end,
             'last_pick', case when lp.pick_number is not null then jsonb_build_object(
                            'pick_number', lp.pick_number,
                            'pokemon_name', lp.pokemon_name,
                            'team_name', lp.team_name) end,
             'regular_played', ms.played,
             'regular_total', ms.total,
             'playoff_matches', pm.matches,
             'champion', (select jsonb_build_object('team_name', m.team_name)
                          from public.league_members m
                          where m.id = l.champion_member_id),
             'stream_url', l.stream_url,
             'replay_links', l.replay_links,
             'last_activity', greatest(l.created_at, lp.created_at, ln.created_at)
           ) as row_json
    from public.leagues l
    cross join lateral (
      select coalesce(l.draft_started, false)
             and not coalesce(l.draft_completed, false)
             and l.draft_paused_at is null as running
    ) r
    cross join lateral (
      select count(*)::integer as coach_count,
             count(*) filter (where m.draft_position is not null)::integer as drafting_count
      from public.league_members m
      where m.league_id = l.id
    ) mc
    left join lateral (
      select d.pick_number, d.pokemon_name, d.created_at, m.team_name
      from public.draft_picks d
      left join public.league_members m on m.id = d.member_id
      where d.league_id = l.id
      order by d.pick_number desc
      limit 1
    ) lp on true
    left join lateral (
      select max(n.created_at) as created_at
      from public.league_news n
      where n.league_id = l.id
    ) ln on true
    cross join lateral (
      select count(*) filter (where mt.stage = 'regular' and mt.status = 'completed')::integer as played,
             count(*) filter (where mt.stage = 'regular')::integer as total
      from public.league_matches mt
      where mt.league_id = l.id
    ) ms
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('round_number', mt.round_number, 'status', mt.status)
                                order by mt.round_number, mt.match_number), '[]'::jsonb) as matches
      from public.league_matches mt
      where mt.league_id = l.id and mt.stage = 'playoff'
    ) pm
    where l.is_public and l.watch_listed
    order by r.running desc, greatest(l.created_at, lp.created_at, ln.created_at) desc nulls last, l.id
    limit 100
  ) s;

  return jsonb_build_object('server_time', now(), 'leagues', v_leagues);
end;
$fn$;

-- One public league for /watch/<id>, listed or not, or null when the league
-- does not exist or is not public (a private league reads exactly like a
-- missing one). The league's settings and draft state, the coach on the
-- clock while the draft runs, the coaches (member id, team name, draft
-- position), every pick, the rosters, the matches with their bracket links,
-- the standings (league_standings without the member check), the stream
-- link, the replays, whether it is listed on /watch, the sprite and types of
-- every Pokémon on the board or a roster, and `server_time`.
create or replace function public.get_public_league(p_league_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_on_clock uuid;
  v_names text[];
begin
  select l.* into v_league from public.leagues l where l.id = p_league_id and l.is_public;
  if not found then
    return null;
  end if;

  if coalesce(v_league.draft_started, false) and not coalesce(v_league.draft_completed, false) then
    v_on_clock := public._snake_member(v_league.id, v_league.current_pick_number);
  end if;

  select array_agg(distinct x.name) into v_names
  from (
    select d.pokemon_name as name from public.draft_picks d where d.league_id = v_league.id
    union all
    select e ->> 'name'
    from public.drafted_teams t
    cross join lateral jsonb_array_elements(case when jsonb_typeof(t.pokemon) = 'array' then t.pokemon else '[]'::jsonb end) e
    where t.league_id = v_league.id
  ) x
  where x.name is not null;

  return jsonb_build_object(
    'id', v_league.id,
    'name', v_league.name,
    'max_coaches', v_league.max_coaches,
    'point_budget', v_league.point_budget,
    'picks_per_team', v_league.picks_per_team,
    'pick_timer_seconds', v_league.pick_timer_seconds,
    'draft_started', coalesce(v_league.draft_started, false),
    'draft_completed', coalesce(v_league.draft_completed, false),
    'current_pick_number', v_league.current_pick_number,
    'pick_started_at', v_league.pick_started_at,
    'draft_paused_at', v_league.draft_paused_at,
    'on_clock_member_id', v_on_clock,
    'schedule_format', v_league.schedule_format,
    'playoff_format', v_league.playoff_format,
    'tiebreaker', v_league.tiebreaker,
    'champion_member_id', v_league.champion_member_id,
    'stream_url', v_league.stream_url,
    'replay_links', v_league.replay_links,
    'watch_listed', v_league.watch_listed,
    'server_time', now(),
    'coaches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id,
               'team_name', m.team_name,
               'draft_position', m.draft_position)
             order by m.draft_position nulls last, m.joined_at, m.id), '[]'::jsonb)
      from public.league_members m
      where m.league_id = v_league.id),
    'picks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'pick_number', d.pick_number,
               'member_id', d.member_id,
               'pokemon_name', d.pokemon_name,
               'points', d.points)
             order by d.pick_number), '[]'::jsonb)
      from public.draft_picks d
      where d.league_id = v_league.id),
    'teams', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'member_id', t.member_id,
               'pokemon', t.pokemon,
               'total_points', t.total_points)
             order by t.member_id), '[]'::jsonb)
      from public.drafted_teams t
      where t.league_id = v_league.id),
    'matches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', mt.id,
               'round_number', mt.round_number,
               'match_number', mt.match_number,
               'stage', mt.stage,
               'status', mt.status,
               'home_member_id', mt.home_member_id,
               'away_member_id', mt.away_member_id,
               'winner_member_id', mt.winner_member_id,
               'winner_remaining', mt.winner_remaining,
               'home_seed', mt.home_seed,
               'away_seed', mt.away_seed,
               'feeds_match_id', mt.feeds_match_id,
               'feeds_slot', mt.feeds_slot)
             order by mt.round_number, mt.match_number), '[]'::jsonb)
      from public.league_matches mt
      where mt.league_id = v_league.id),
    'standings', (
      select coalesce(jsonb_agg(to_jsonb(st) order by st.seed), '[]'::jsonb)
      from public._league_standings(v_league.id) st),
    'pokemon', public._public_pokemon(coalesce(v_names, '{}'))
  );
end;
$fn$;

------------------------------------------------------------------------------
-- 5. Grants
------------------------------------------------------------------------------
-- The admin's three functions are for signed-in callers (two of them refuse
-- everyone but a site admin; site_admin_status answers anyone signed in).
-- The two public reads keep their grants to everyone, signed out included.
-- The helpers are internal. Supabase's default privileges hand every new
-- function to anon and authenticated, so everything is revoked first.

do $$
declare
  v_fn text;
  v_internal text[] := array[
    'public._is_site_admin()',
    'public._require_site_admin()'
  ];
  v_api text[] := array[
    'public.site_admin_status()',
    'public.list_watch_review()',
    'public.set_watch_listing(uuid, boolean)'
  ];
  v_public text[] := array[
    'public.list_public_leagues()',
    'public.get_public_league(uuid)'
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

------------------------------------------------------------------------------
-- 6. Post-apply report
------------------------------------------------------------------------------
-- No rows means nothing is left to fix (docs/schema.md, "Verifying the
-- migration").

select * from public._migration_report();
