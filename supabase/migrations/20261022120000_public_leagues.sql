-- PokeDrafts: public leagues with an attached stream and replay links.
--
-- A commissioner can make a league public (off by default), attach its live
-- stream (a Twitch channel, or a YouTube channel or live video) and list
-- replay links (Twitch videos and clips, YouTube videos). Anyone, signed out
-- included, can then find the league on /watch and follow it on
-- /watch/<league id>: the stream next to a read-only draft board and the
-- standings (docs/release-architecture.md section 15):
--   1. columns: leagues.is_public, stream_url and replay_links, their checks
--      and a partial index for the public list
--   2. update_league_public_page: the commissioner's one write
--   3. reads for everyone: list_public_leagues and get_public_league build a
--      public league's safe fields as JSON. A private league reads as null,
--      and neither function returns a coach's user id, an invite code, the
--      draft pool or the draft chat
--   4. grants
--   5. post-apply report (select * from public._migration_report())
--
-- No policy changes: every table keeps its member-only select policy, so a
-- signed-out visitor still reads no table directly; the two read functions
-- are security definer and pick the fields themselves.
--
-- The stored links are the normalized forms that app/lib/watch/stream-links.ts
-- writes (the Settings card turns whatever a commissioner pastes into one of
-- them); the checks below accept nothing else:
--   stream  https://www.twitch.tv/<login>
--           https://www.youtube.com/channel/<UC channel id>
--           https://www.youtube.com/@<handle>
--           https://www.youtube.com/watch?v=<video id>
--   replay  https://www.twitch.tv/videos/<id>[?t=<h>h<m>m<s>s]
--           https://clips.twitch.tv/<clip slug>
--           https://www.youtube.com/watch?v=<video id>[&t=<seconds>s]
--
-- The whole file is idempotent (add column if not exists, guarded checks,
-- create or replace). Like every feature file it runs after the hardening
-- file; re-running the hardening file leaves this file's columns, functions
-- and grants alone (its policy loop and grant lists name only its own).

------------------------------------------------------------------------------
-- 0. Session-scoped helpers (pg_temp is dropped automatically at disconnect)
------------------------------------------------------------------------------

-- Adds a check constraint by name. If existing rows violate it, the constraint
-- is added as NOT VALID (enforced for new writes only) and a warning is raised.
-- Same helper as the hardening file; pg_temp does not persist between files.
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
-- 1. Columns, checks and index
------------------------------------------------------------------------------

-- The link shapes. Immutable, so the stream check can use the stream one.
create or replace function public._stream_url_ok(p_url text)
returns boolean
language sql immutable
set search_path = public, extensions
as $fn$
  select coalesce(char_length(p_url) <= 200 and (
           p_url ~ '^https://www\.twitch\.tv/[a-z0-9_]{1,25}$'
           or p_url ~ '^https://www\.youtube\.com/channel/UC[A-Za-z0-9_-]{22}$'
           or p_url ~ '^https://www\.youtube\.com/@[a-z0-9._-]{3,30}$'
           or p_url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$'), false)
$fn$;

create or replace function public._replay_url_ok(p_url text)
returns boolean
language sql immutable
set search_path = public, extensions
as $fn$
  select coalesce(char_length(p_url) <= 200 and (
           p_url ~ '^https://www\.twitch\.tv/videos/[0-9]{1,15}(\?t=[0-9]{1,2}h[0-9]{1,2}m[0-9]{1,2}s)?$'
           or p_url ~ '^https://clips\.twitch\.tv/[A-Za-z0-9_-]{1,100}$'
           or p_url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}(&t=[0-9]{1,6}s)?$'), false)
$fn$;

alter table public.leagues
  add column if not exists is_public boolean not null default false;

alter table public.leagues
  add column if not exists stream_url text;

-- [{ title, url, added_at }], in the commissioner's order. added_at is the
-- moment the link was first listed, kept across saves.
alter table public.leagues
  add column if not exists replay_links jsonb not null default '[]'::jsonb;

select pg_temp.pd_add_check('public.leagues', 'leagues_stream_url_check',
  $c$stream_url is null or public._stream_url_ok(stream_url)$c$);
select pg_temp.pd_add_check('public.leagues', 'leagues_replay_links_check',
  $c$case when jsonb_typeof(replay_links) = 'array' then jsonb_array_length(replay_links) <= 20 else false end$c$);

-- list_public_leagues reads only the public rows.
create index if not exists leagues_public_idx on public.leagues (id) where is_public;

------------------------------------------------------------------------------
-- 2. update_league_public_page
------------------------------------------------------------------------------

-- The commissioner's Public page card saves all three settings at once. The
-- stream link is trimmed (blank means none) and must be one of the stream
-- shapes above. The replay list is at most 20 entries of { title, url }: a
-- trimmed title of 1..80 characters and a replay link, each link once. A
-- link that was already listed keeps its added_at; a new one gets now().
-- Returns the three stored values.
create or replace function public.update_league_public_page(
  p_league_id uuid,
  p_is_public boolean,
  p_stream_url text,
  p_replay_links jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_stream text;
  v_input jsonb;
  v_links jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_url text;
  v_title text;
  v_added jsonb;
  v_seen text[] := '{}';
  v_index integer := 0;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);

  if p_is_public is null then
    perform public._fail('Choose whether the league is public.', 'invalid_public_setting');
  end if;

  v_stream := nullif(btrim(coalesce(p_stream_url, '')), '');
  if v_stream is not null and not public._stream_url_ok(v_stream) then
    perform public._fail('The stream must be a Twitch channel link, or a YouTube channel or live video link.', 'invalid_stream_link');
  end if;

  v_input := coalesce(p_replay_links, '[]'::jsonb);
  if jsonb_typeof(v_input) <> 'array' then
    perform public._fail('The replays must be a list of links.', 'invalid_replays');
  end if;
  if jsonb_array_length(v_input) > 20 then
    perform public._fail('A league can list at most 20 replays.', 'too_many_replays');
  end if;

  for v_entry in select e from jsonb_array_elements(v_input) e loop
    v_index := v_index + 1;
    if jsonb_typeof(v_entry) <> 'object' then
      perform public._fail(format('Replay %s is not a title and a link.', v_index), 'invalid_replays');
    end if;
    v_title := btrim(coalesce(v_entry ->> 'title', ''));
    if char_length(v_title) not between 1 and 80 then
      perform public._fail(format('Replay %s needs a title of 1 to 80 characters.', v_index), 'invalid_replay_title');
    end if;
    v_url := btrim(coalesce(v_entry ->> 'url', ''));
    if not public._replay_url_ok(v_url) then
      perform public._fail(format('Replay %s must be a Twitch video or clip, or a YouTube video.', v_index), 'invalid_replay_link');
    end if;
    if v_url = any(v_seen) then
      perform public._fail(format('Replay %s is already in the list.', v_index), 'duplicate_replay');
    end if;
    v_seen := v_seen || v_url;

    select e -> 'added_at' into v_added
    from jsonb_array_elements(v_league.replay_links) e
    where e ->> 'url' = v_url
    limit 1;
    v_links := v_links || jsonb_build_array(jsonb_build_object(
      'title', v_title,
      'url', v_url,
      'added_at', coalesce(v_added, to_jsonb(now()))));
  end loop;

  update public.leagues
  set is_public = p_is_public,
      stream_url = v_stream,
      replay_links = v_links
  where id = v_league.id;

  return jsonb_build_object('is_public', p_is_public, 'stream_url', v_stream, 'replay_links', v_links);
end;
$fn$;

------------------------------------------------------------------------------
-- 3. Reads for everyone
------------------------------------------------------------------------------

-- The key app/lib/pokemon normalizePokemonName builds, close enough for the
-- names a pool holds: lowercase, gender symbols as f / m, the accents of
-- Flabébé dropped, quotes, dots, colons, parentheses, spaces and hyphens
-- removed ("Rotom (Wash)" and "rotom-wash" are both rotomwash).
create or replace function public._pokemon_name_key(p_name text)
returns text
language sql immutable
set search_path = public, extensions
as $fn$
  select regexp_replace(lower(translate(coalesce(p_name, ''), 'éÉ♀♂', 'eEfm')), '[''’`.:()[:space:]-]', '', 'g')
$fn$;

-- Sprite and types for each name, from the Pool Builder dataset (`pokemon`)
-- and then the older `pokemon_dex`, as { name: { sprite_url, type1, type2 } }.
-- Signed-out visitors cannot read either table (the dex loader in the app
-- needs a session), so the public reads hand these over with the picks.
-- Exact display names take the unique index; only the rest are matched by
-- key. A name found nowhere is left out.
create or replace function public._public_pokemon(p_names text[])
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_found jsonb;
  v_rest text[];
  v_more jsonb;
begin
  select coalesce(jsonb_object_agg(p.display_name,
           jsonb_build_object('sprite_url', p.sprite_url, 'type1', p.type1, 'type2', p.type2)), '{}'::jsonb)
  into v_found
  from public.pokemon p
  where p.display_name = any(coalesce(p_names, '{}'));

  select array_agg(distinct n) into v_rest
  from unnest(coalesce(p_names, '{}')) n
  where n is not null and not (v_found ? n);
  if v_rest is null then
    return v_found;
  end if;

  with wanted as (
    select n as name, public._pokemon_name_key(n) as key from unnest(v_rest) n
  ),
  dataset as (
    select p.display_name as label, p.sprite_url, p.type1, p.type2,
           public._pokemon_name_key(p.display_name) as key, 0 as source
    from public.pokemon p
    union all
    select p.display_name, p.sprite_url, p.type1, p.type2, public._pokemon_name_key(p.slug), 1
    from public.pokemon p
    union all
    select d.name, d.sprite_url, d.type1, d.type2, public._pokemon_name_key(d.name), 2
    from public.pokemon_dex d
  ),
  matched as (
    select distinct on (w.name) w.name, d.sprite_url, d.type1, d.type2
    from wanted w
    join dataset d on d.key = w.key
    order by w.name, d.source, d.label
  )
  select coalesce(jsonb_object_agg(m.name,
           jsonb_build_object('sprite_url', m.sprite_url, 'type1', m.type1, 'type2', m.type2)), '{}'::jsonb)
  into v_more
  from matched m;

  return v_found || v_more;
end;
$fn$;

-- The /watch list: the 100 public leagues with the most recent activity
-- (the league's creation, its newest pick or news row), running drafts first
-- (started, not complete, not paused). Per league: the name, the coach
-- counts, the draft's progress (the coach on the clock and the clock's
-- deadline while it runs, the newest pick), the regular season's progress,
-- the champion, the stream link and the replays. Coaches appear by team name
-- only. `server_time` lets a page count the clock down.
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
    where l.is_public
    order by r.running desc, greatest(l.created_at, lp.created_at, ln.created_at) desc nulls last, l.id
    limit 100
  ) s;

  return jsonb_build_object('server_time', now(), 'leagues', v_leagues);
end;
$fn$;

-- One public league for /watch/<id>, or null when the league does not exist
-- or is not public (a private league reads exactly like a missing one). The
-- league's settings and draft state, the coach on the clock while the draft
-- runs, the coaches (member id, team name, draft position), every pick, the
-- rosters, the matches, the standings (league_standings without the member
-- check), the stream link, the replays, the sprite and types of every
-- Pokémon on the board or a roster, and `server_time`.
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
               'away_seed', mt.away_seed)
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
-- 4. Grants
------------------------------------------------------------------------------
-- update_league_public_page is for signed-in callers (its commissioner check
-- refuses everyone else). The two reads are for everyone, signed out
-- included, like get_invite_preview. The helpers are internal. Supabase's
-- default privileges hand every new function to anon and authenticated, so
-- everything is revoked first.

do $$
declare
  v_fn text;
  v_internal text[] := array[
    'public._stream_url_ok(text)',
    'public._replay_url_ok(text)',
    'public._pokemon_name_key(text)',
    'public._public_pokemon(text[])'
  ];
  v_api text[] := array[
    'public.update_league_public_page(uuid, boolean, text, jsonb)'
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

drop function if exists pg_temp.pd_add_check(regclass, text, text);

------------------------------------------------------------------------------
-- 5. Post-apply report
------------------------------------------------------------------------------
-- No rows means nothing is left to fix (docs/schema.md, "Verifying the
-- migration"); a leagues_stream_url_check or leagues_replay_links_check row
-- names a constraint that existing rows forced to NOT VALID.

select * from public._migration_report();
