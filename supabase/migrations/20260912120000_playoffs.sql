-- PokeDrafts: standings tiebreakers and single-elimination playoffs.
--
-- Implements section 12 of docs/release-architecture.md on top of
-- 20260909120000_release_hardening.sql:
--   1. columns: leagues.tiebreaker / playoff_format / champion_member_id,
--      league_matches.stage / winner_remaining / home_seed / away_seed /
--      feeds_match_id / feeds_slot, nullable playoff participants, and the
--      league_news news_type check extended with 'season'
--   2. helpers: the standings algorithm, bracket shapes, round names
--   3. changed functions: create_league (two new parameters; the 7-parameter
--      signature is dropped), update_league_settings, report_match_result
--      (a third parameter; the 2-parameter signature is dropped),
--      clear_match_result, generate_schedule, reset_draft
--   4. new functions: league_standings, generate_playoffs, clear_playoffs
--   5. data fix: a champion for finished leagues that have no playoffs
--   6. grants
--   7. post-apply report (select * from public._migration_report())
--
-- The whole file is idempotent: applying it twice succeeds and leaves the
-- database in the same state. It must run after the hardening file. Re-running
-- the hardening file later recreates the 7-parameter create_league and the
-- 2-parameter report_match_result next to the signatures this file creates,
-- which makes both names ambiguous for PostgREST, so re-run this file after
-- any re-run of the hardening file (README, "Applying migrations").

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

-- Adds a foreign key by name. If existing rows violate it, the constraint is
-- added as NOT VALID and a warning is raised, like pd_add_check.
create or replace function pg_temp.pd_add_fk(p_table regclass, p_name text, p_definition text)
returns void language plpgsql as $helper$
begin
  if exists (select 1 from pg_constraint where conrelid = p_table and conname = p_name) then
    return;
  end if;
  begin
    execute format('alter table %s add constraint %I %s', p_table, p_name, p_definition);
  exception
    when foreign_key_violation then
      execute format('alter table %s add constraint %I %s not valid', p_table, p_name, p_definition);
      raise warning 'PokeDrafts: constraint % on % was added as NOT VALID because existing rows violate it (%). Fix the rows, then run: alter table % validate constraint %;', p_name, p_table, p_definition, p_table, p_name;
  end;
end;
$helper$;

------------------------------------------------------------------------------
-- 1. Columns and constraints
------------------------------------------------------------------------------

alter table public.leagues
  add column if not exists tiebreaker text not null default 'head_to_head';

alter table public.leagues
  add column if not exists playoff_format text not null default 'none';

alter table public.leagues
  add column if not exists champion_member_id uuid;

alter table public.league_matches
  add column if not exists stage text not null default 'regular';

alter table public.league_matches
  add column if not exists winner_remaining integer;

alter table public.league_matches
  add column if not exists home_seed integer;

alter table public.league_matches
  add column if not exists away_seed integer;

alter table public.league_matches
  add column if not exists feeds_match_id uuid;

alter table public.league_matches
  add column if not exists feeds_slot text;

-- A playoff slot that is not decided yet has no coach.
alter table public.league_matches alter column home_member_id drop not null;
alter table public.league_matches alter column away_member_id drop not null;

-- Values outside the documented sets (only possible when a column was added
-- by hand before this file ran) fall back to the defaults so the checks below
-- validate instead of being added NOT VALID.
update public.leagues set tiebreaker = 'head_to_head'
where tiebreaker is null or tiebreaker not in ('head_to_head', 'differential');

update public.leagues set playoff_format = 'none'
where playoff_format is null or playoff_format not in ('none', 'top_2', 'top_4', 'top_6', 'top_8');

update public.league_matches set stage = 'regular'
where stage is null or stage not in ('regular', 'playoff');

select pg_temp.pd_add_check('public.leagues', 'leagues_tiebreaker_check', $c$tiebreaker in ('head_to_head', 'differential')$c$);
select pg_temp.pd_add_check('public.leagues', 'leagues_playoff_format_check', $c$playoff_format in ('none', 'top_2', 'top_4', 'top_6', 'top_8')$c$);
select pg_temp.pd_add_fk('public.leagues', 'leagues_champion_member_id_fkey',
  'foreign key (champion_member_id) references public.league_members(id) on delete set null');

select pg_temp.pd_add_check('public.league_matches', 'league_matches_stage_check', $c$stage in ('regular', 'playoff')$c$);
select pg_temp.pd_add_check('public.league_matches', 'league_matches_winner_remaining_check', $c$winner_remaining is null or winner_remaining between 1 and 12$c$);
select pg_temp.pd_add_check('public.league_matches', 'league_matches_feeds_slot_check', $c$feeds_slot is null or feeds_slot in ('home', 'away')$c$);
select pg_temp.pd_add_fk('public.league_matches', 'league_matches_feeds_match_id_fkey',
  'foreign key (feeds_match_id) references public.league_matches(id) on delete set null');

-- The self-referencing foreign key runs "set null" for every deleted match;
-- without an index each of those is a scan of the whole table, and a schedule
-- regeneration deletes hundreds of rows at once.
create index if not exists league_matches_feeds_match_id_idx
  on public.league_matches (feeds_match_id) where feeds_match_id is not null;

create index if not exists leagues_champion_member_id_idx
  on public.leagues (champion_member_id) where champion_member_id is not null;

-- league_news.news_type gains 'season' (bracket set, championship won). The
-- inline check from the base schema is named league_news_news_type_check;
-- any check on that column that does not allow 'season' is replaced.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.league_news'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%news_type%'
      and pg_get_constraintdef(c.oid) not ilike '%season%'
  loop
    execute format('alter table public.league_news drop constraint %I', r.conname);
  end loop;
end $$;

select pg_temp.pd_add_check('public.league_news', 'league_news_news_type_check', $c$news_type in ('free_agent', 'match_result', 'season')$c$);

------------------------------------------------------------------------------
-- 2. Helpers
------------------------------------------------------------------------------
-- Conventions as in the hardening file: language plpgsql, security definer,
-- search_path = public, extensions; validation failures go through _fail.

-- Coaches a playoff format needs (0 for 'none').
create or replace function public._playoff_size(p_format text)
returns integer
language sql immutable
as $fn$
  select case p_format
    when 'top_2' then 2
    when 'top_4' then 4
    when 'top_6' then 6
    when 'top_8' then 8
    else 0
  end;
$fn$;

-- Playoff rounds are named by their distance from the final, never by their
-- round number: 0 rounds before the final is the Final, 1 the Semifinals, 2
-- the Quarterfinals (so the first round of a top_6 bracket, two matches with
-- two byes, is the Quarterfinals as section 12.4 names it).
create or replace function public._round_name(p_rounds_from_final integer)
returns text
language sql immutable
as $fn$
  select case coalesce(p_rounds_from_final, 0)
    when 0 then 'Final'
    when 1 then 'Semifinals'
    when 2 then 'Quarterfinals'
    else format('Round of %s', power(2, coalesce(p_rounds_from_final, 0) + 1)::integer)
  end;
$fn$;

-- The single-elimination shapes of section 12.4. round_offset counts from the
-- first playoff round; feeds_* name the match the winner advances to and the
-- side it fills; a null seed is a slot decided by an earlier round.
create or replace function public._bracket_rows(p_format text)
returns table (round_offset integer, match_number integer, home_seed integer, away_seed integer,
               feeds_round_offset integer, feeds_match_number integer, feeds_slot text)
language sql immutable
as $fn$
  select v.round_offset, v.match_number, v.home_seed, v.away_seed, v.feeds_round_offset, v.feeds_match_number, v.feeds_slot
  from (values
    ('top_2', 1, 1, 1, 2, null::integer, null::integer, null::text),
    ('top_4', 1, 1, 1, 4, 2, 1, 'home'),
    ('top_4', 1, 2, 2, 3, 2, 1, 'away'),
    ('top_4', 2, 1, null, null, null, null, null),
    ('top_6', 1, 1, 4, 5, 2, 1, 'away'),
    ('top_6', 1, 2, 3, 6, 2, 2, 'away'),
    ('top_6', 2, 1, 1, null, 3, 1, 'home'),
    ('top_6', 2, 2, 2, null, 3, 1, 'away'),
    ('top_6', 3, 1, null, null, null, null, null),
    ('top_8', 1, 1, 1, 8, 2, 1, 'home'),
    ('top_8', 1, 2, 4, 5, 2, 1, 'away'),
    ('top_8', 1, 3, 3, 6, 2, 2, 'home'),
    ('top_8', 1, 4, 2, 7, 2, 2, 'away'),
    ('top_8', 2, 1, null, null, 3, 1, 'home'),
    ('top_8', 2, 2, null, null, 3, 1, 'away'),
    ('top_8', 3, 1, null, null, null, null, null)
  ) as v(format, round_offset, match_number, home_seed, away_seed, feeds_round_offset, feeds_match_number, feeds_slot)
  where v.format = p_format
  order by v.round_offset, v.match_number;
$fn$;

-- The standings algorithm of section 12.3, without the membership check
-- (league_standings adds it; _generate_playoffs and the data fix below call
-- this directly). One SQL statement:
--   1. coaches: members with a draft position, plus anyone who appears in a
--      match of the league;
--   2. sides: every regular match twice (one row per coach), "decided" when
--      completed with a winner that is one of the two coaches;
--   3. base: wins, losses, played, remaining, differential
--      (+winner_remaining for wins, -winner_remaining for losses, null = 0);
--   4. win_pct = wins / played (0 when none), strength of schedule = mean
--      win_pct of the opponents in decided matches (0 when none);
--   5. the head-to-head group: coaches tied on (win_pct, wins) when
--      head-to-head is the league's first tiebreaker, coaches tied on
--      (win_pct, wins, differential) when differential comes first, so the
--      head-to-head record is always taken among the coaches still tied when
--      it is applied (ties inside ties);
--   6. order: win_pct desc, wins desc, first tiebreaker desc, second
--      tiebreaker desc, strength of schedule desc, member id (the coin flip).
-- Percentages (win, head-to-head, strength of schedule) are compared rounded
-- to 3 decimals, the precision this function returns and the standings table
-- shows, so two coaches never differ only in a digit nobody sees: 10-17
-- (.370) and 17-29 (.370) tie on percentage and wins decide, and two
-- strength-of-schedule means that both print as .708 leave the coin flip to
-- decide. The client mirror (computeStandings, roundPercentage in
-- app/lib/league/standings.ts) compares at the same 3 decimals, half up, and
-- tests/db/playoffs.test.ts holds both to those fixtures. Rounding is exact
-- here: every quotient is a numeric with at least 20 decimals, so a mean that
-- sits exactly on a boundary, such as (1/3 + 1/3 + 1/3 + 1/4) / 4 = 0.3125,
-- rounds up to .313 like the mirror's nudged double does. seed is the row
-- number of that order; rank is the smallest seed among coaches separated
-- only by the coin flip, and tied marks them. head_to_head_applied is true
-- for every coach of a head-to-head group whose records were not all equal.
create or replace function public._league_standings(p_league_id uuid)
returns table (
  member_id uuid,
  seed integer,
  rank integer,
  tied boolean,
  wins integer,
  losses integer,
  played integer,
  remaining integer,
  win_pct numeric,
  differential integer,
  strength_of_schedule numeric,
  head_to_head_applied boolean)
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_tiebreaker text;
begin
  select coalesce(l.tiebreaker, 'head_to_head') into v_tiebreaker
  from public.leagues l
  where l.id = p_league_id;
  if not found then
    return;
  end if;

  return query
  with coaches as (
    select lm.id
    from public.league_members lm
    where lm.league_id = p_league_id
      and (lm.draft_position is not null
           or exists (
             select 1 from public.league_matches m
             where m.league_id = p_league_id
               and (m.home_member_id = lm.id or m.away_member_id = lm.id)))
  ),
  regular as (
    select m.home_member_id, m.away_member_id, m.winner_member_id,
           coalesce(m.winner_remaining, 0) as margin,
           (m.status = 'completed'
            and m.winner_member_id is not null
            and (m.winner_member_id = m.home_member_id or m.winner_member_id = m.away_member_id)) as decided
    from public.league_matches m
    where m.league_id = p_league_id
      and m.stage = 'regular'
      and m.home_member_id is not null
      and m.away_member_id is not null
  ),
  sides as (
    select r.home_member_id as coach, r.away_member_id as opponent, r.decided,
           (r.decided and r.winner_member_id = r.home_member_id) as won, r.margin
    from regular r
    union all
    select r.away_member_id, r.home_member_id, r.decided,
           (r.decided and r.winner_member_id = r.away_member_id), r.margin
    from regular r
  ),
  base as (
    select c.id as coach,
           count(*) filter (where s.decided and s.won) as wins,
           count(*) filter (where s.decided and not s.won) as losses,
           count(*) filter (where s.decided) as played,
           count(*) filter (where s.coach is not null and not s.decided) as remaining,
           coalesce(sum(case when s.decided and s.won then s.margin when s.decided then -s.margin else 0 end), 0) as differential
    from coaches c
    left join sides s on s.coach = c.id
    group by c.id
  ),
  pct as (
    select b.coach, b.wins, b.losses, b.played, b.remaining, b.differential,
           case when b.played > 0 then b.wins::numeric / b.played else 0::numeric end as win_pct_exact
    from base b
  ),
  sos as (
    select p.coach,
           coalesce(avg(o.win_pct_exact), 0::numeric) as sos_exact
    from pct p
    left join sides s on s.coach = p.coach and s.decided
    left join pct o on o.coach = s.opponent
    group by p.coach
  ),
  grouped as (
    select p.coach, p.wins, p.losses, p.played, p.remaining, p.differential, p.win_pct_exact, x.sos_exact,
           round(p.win_pct_exact, 3)::text || '|' || p.wins::text
             || case when v_tiebreaker = 'differential' then '|' || p.differential::text else '' end as hkey
    from pct p
    join sos x on x.coach = p.coach
  ),
  h2h as (
    select g.coach,
           case when count(*) filter (where s.decided and gb.coach is not null) > 0
                then (count(*) filter (where s.decided and s.won and gb.coach is not null))::numeric
                     / count(*) filter (where s.decided and gb.coach is not null)
                else 0::numeric end as h2h_exact
    from grouped g
    left join sides s on s.coach = g.coach and s.decided
    left join grouped gb on gb.coach = s.opponent and gb.hkey = g.hkey
    group by g.coach
  ),
  keyed as (
    select g.coach, g.wins, g.losses, g.played, g.remaining, g.differential, g.win_pct_exact, g.sos_exact,
           round(g.win_pct_exact, 3) as pct_key,
           case when v_tiebreaker = 'differential' then g.differential::numeric else round(x.h2h_exact, 3) end as tb1,
           case when v_tiebreaker = 'differential' then round(x.h2h_exact, 3) else g.differential::numeric end as tb2,
           round(g.sos_exact, 3) as sos_key,
           max(round(x.h2h_exact, 3)) over (partition by g.hkey) <> min(round(x.h2h_exact, 3)) over (partition by g.hkey) as h2h_applied
    from grouped g
    join h2h x on x.coach = g.coach
  ),
  ordered as (
    select k.coach, k.wins, k.losses, k.played, k.remaining, k.differential, k.win_pct_exact, k.sos_exact, k.h2h_applied,
           row_number() over (order by k.pct_key desc, k.wins desc, k.tb1 desc, k.tb2 desc, k.sos_key desc, k.coach) as seed_no,
           dense_rank() over (order by k.pct_key desc, k.wins desc, k.tb1 desc, k.tb2 desc, k.sos_key desc) as tie_group
    from keyed k
  )
  select o.coach,
         o.seed_no::integer,
         (min(o.seed_no) over (partition by o.tie_group))::integer,
         (count(*) over (partition by o.tie_group)) > 1,
         o.wins::integer,
         o.losses::integer,
         o.played::integer,
         o.remaining::integer,
         round(o.win_pct_exact, 3),
         o.differential::integer,
         round(o.sos_exact, 3),
         o.h2h_applied
  from ordered o
  order by o.seed_no;
end;
$fn$;

-- True when the league has regular matches and every one of them is decided.
create or replace function public._regular_season_complete(p_league_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
begin
  return exists (
           select 1 from public.league_matches m
           where m.league_id = p_league_id and m.stage = 'regular')
     and not exists (
           select 1 from public.league_matches m
           where m.league_id = p_league_id and m.stage = 'regular'
             and (m.status <> 'completed' or m.winner_member_id is null));
end;
$fn$;

-- True once any playoff match has a result.
create or replace function public._playoffs_started(p_league_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
begin
  return exists (
    select 1 from public.league_matches m
    where m.league_id = p_league_id and m.stage = 'playoff' and m.status = 'completed');
end;
$fn$;

-- The last regular round number (0 without a schedule). Playoff rounds
-- continue after it, so (league_id, round_number, match_number) stays unique.
create or replace function public._last_regular_round(p_league_id uuid)
returns integer
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_last integer;
begin
  select coalesce(max(m.round_number), 0) into v_last
  from public.league_matches m
  where m.league_id = p_league_id and m.stage = 'regular';
  return v_last;
end;
$fn$;

-- Removes the bracket: every playoff match, the match_result news of those
-- matches, every season news row, and the champion. Runs under the league
-- lock the caller holds.
create or replace function public._delete_playoffs(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
begin
  delete from public.league_news n
  where n.league_id = p_league_id
    and (n.news_type = 'season'
         or (n.news_type = 'match_result'
             and exists (
               select 1 from public.league_matches m
               where m.league_id = p_league_id and m.stage = 'playoff'
                 and m.id::text = n.metadata ->> 'match_id')));
  delete from public.league_matches m where m.league_id = p_league_id and m.stage = 'playoff';
  update public.leagues set champion_member_id = null
  where id = p_league_id and champion_member_id is not null;
end;
$fn$;

-- The top seed becomes the champion (leagues without playoffs).
create or replace function public._crown_top_seed(p_league_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_top uuid;
begin
  select s.member_id into v_top from public._league_standings(p_league_id) s where s.seed = 1;
  update public.leagues set champion_member_id = v_top
  where id = p_league_id and champion_member_id is distinct from v_top;
end;
$fn$;

-- Replaces the bracket with a fresh one seeded from the standings. The caller
-- holds the league lock. With playoff_format 'none' the bracket is removed
-- and 0 returned. A format that needs more coaches than play raises
-- not_enough_coaches when p_strict, and otherwise leaves the league without a
-- bracket and returns 0 (the last regular result of a small league is still
-- recorded; the commissioner picks a smaller format in Settings, which then
-- generates the bracket). Inserts the 'season' news row "The playoff bracket
-- is set." with metadata { kind: 'bracket', playoff_format, seeds: [{ seed,
-- member_id }] }.
create or replace function public._generate_playoffs(p_league_id uuid, p_strict boolean default true)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_size integer;
  v_playing integer;
  v_base integer;
  v_count integer;
  v_seeds jsonb;
begin
  select l.* into v_league from public.leagues l where l.id = p_league_id;
  if not found then
    perform public._fail('League not found.', 'league_not_found');
  end if;
  v_size := public._playoff_size(v_league.playoff_format);
  if v_size = 0 then
    perform public._delete_playoffs(p_league_id);
    return 0;
  end if;

  select count(*) into v_playing from public._league_standings(p_league_id) s;
  if v_playing < v_size then
    if p_strict then
      perform public._fail(
        format('Top %s playoffs need at least %s coaches; this league has %s. Choose a smaller playoff format in Settings.', v_size, v_size, v_playing),
        'not_enough_coaches');
    end if;
    perform public._delete_playoffs(p_league_id);
    return 0;
  end if;

  perform public._delete_playoffs(p_league_id);
  v_base := public._last_regular_round(p_league_id);

  insert into public.league_matches (
    league_id, round_number, match_number, home_member_id, away_member_id, status, stage, home_seed, away_seed)
  select p_league_id, v_base + b.round_offset, b.match_number, sh.member_id, sa.member_id, 'upcoming', 'playoff',
         b.home_seed, b.away_seed
  from public._bracket_rows(v_league.playoff_format) b
  left join public._league_standings(p_league_id) sh on sh.seed = b.home_seed
  left join public._league_standings(p_league_id) sa on sa.seed = b.away_seed;
  get diagnostics v_count = row_count;

  update public.league_matches m
  set feeds_match_id = t.id,
      feeds_slot = b.feeds_slot
  from public._bracket_rows(v_league.playoff_format) b
  join public.league_matches t
    on t.league_id = p_league_id and t.stage = 'playoff'
   and t.round_number = v_base + b.feeds_round_offset and t.match_number = b.feeds_match_number
  where m.league_id = p_league_id and m.stage = 'playoff'
    and m.round_number = v_base + b.round_offset and m.match_number = b.match_number
    and b.feeds_round_offset is not null;

  select jsonb_agg(jsonb_build_object('seed', s.seed, 'member_id', s.member_id) order by s.seed)
  into v_seeds
  from public._league_standings(p_league_id) s
  where s.seed <= v_size;

  insert into public.league_news (league_id, member_id, news_type, message, metadata)
  values (
    p_league_id, null, 'season', 'The playoff bracket is set.',
    jsonb_build_object('kind', 'bracket', 'playoff_format', v_league.playoff_format, 'seeds', coalesce(v_seeds, '[]'::jsonb)));

  return v_count;
end;
$fn$;

------------------------------------------------------------------------------
-- 3. Public API
------------------------------------------------------------------------------

-- The standings of section 12.3 for a member of the league.
create or replace function public.league_standings(p_league_id uuid)
returns table (
  member_id uuid,
  seed integer,
  rank integer,
  tied boolean,
  wins integer,
  losses integer,
  played integer,
  remaining integer,
  win_pct numeric,
  differential integer,
  strength_of_schedule numeric,
  head_to_head_applied boolean)
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
begin
  v_uid := public._caller_uid();
  if not exists (select 1 from public.leagues l where l.id = p_league_id) then
    perform public._fail('League not found.', 'league_not_found');
  end if;
  perform public._member_for(p_league_id, v_uid);
  return query select * from public._league_standings(p_league_id);
end;
$fn$;

-- The old 7-parameter signature must not survive next to the new one:
-- PostgREST could not choose between them for a call that omits the new
-- parameters.
drop function if exists public.create_league(text, text, integer, uuid, integer, integer, integer);

create or replace function public.create_league(
  p_name text,
  p_team_name text,
  p_max_coaches integer,
  p_draft_format_id uuid default null,
  p_point_budget integer default 100,
  p_picks_per_team integer default 10,
  p_pick_timer_seconds integer default 120,
  p_playoff_format text default 'top_4',
  p_tiebreaker text default 'head_to_head')
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
  v_playoff_format text;
  v_tiebreaker text;
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
  v_playoff_format := coalesce(p_playoff_format, 'top_4');
  if v_playoff_format not in ('none', 'top_2', 'top_4', 'top_6', 'top_8') then
    perform public._fail('Choose a valid playoff format.', 'invalid_playoff_format');
  end if;
  v_tiebreaker := coalesce(p_tiebreaker, 'head_to_head');
  if v_tiebreaker not in ('head_to_head', 'differential') then
    perform public._fail('Choose a valid tiebreaker.', 'invalid_tiebreaker');
  end if;
  if p_draft_format_id is not null and not public._visible_format(p_draft_format_id, v_uid) then
    perform public._fail('That draft format is not available.', 'format_not_found');
  end if;

  -- A chosen format is copied onto the league now (see _pool_json): from here
  -- on the league's pool is custom_pool, whoever owns the format row.
  insert into public.leagues (
    name, commissioner_id, max_coaches, draft_format_id, point_budget, picks_per_team,
    pick_timer_seconds, draft_started, draft_completed, current_pick_number, auto_pick_in_progress,
    custom_pool, playoff_format, tiebreaker)
  values (
    v_name, v_uid, v_max, p_draft_format_id, v_budget, v_picks,
    v_timer, false, false, 1, false,
    public._format_pool(p_draft_format_id, v_name), v_playoff_format, v_tiebreaker)
  returning id into v_league_id;

  insert into public.league_members (league_id, user_id, role, team_name)
  values (v_league_id, v_uid, 'commissioner', v_team);

  perform public._create_invite(v_league_id, v_max - 1);
  return v_league_id;
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
  v_playoff_format text;
  v_tiebreaker text;
  v_format_changed boolean := false;
  v_playoffs_changed boolean := false;
  v_size integer;
  v_playing integer;
begin
  v_uid := public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    perform public._fail('Settings must be an object.', 'invalid_settings');
  end if;
  for v_key in select k from jsonb_object_keys(p_settings) k loop
    if v_key not in ('name', 'max_coaches', 'point_budget', 'picks_per_team', 'pick_timer_seconds',
                     'free_agent_swap_limit', 'schedule_format', 'draft_format_id',
                     'playoff_format', 'tiebreaker') then
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
  v_playoff_format := v_league.playoff_format;
  v_tiebreaker := v_league.tiebreaker;

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

  if p_settings ? 'playoff_format' then
    v_playoff_format := p_settings ->> 'playoff_format';
    if v_playoff_format is null or v_playoff_format not in ('none', 'top_2', 'top_4', 'top_6', 'top_8') then
      perform public._fail('Choose a valid playoff format.', 'invalid_playoff_format');
    end if;
  end if;

  if p_settings ? 'tiebreaker' then
    v_tiebreaker := p_settings ->> 'tiebreaker';
    if v_tiebreaker is null or v_tiebreaker not in ('head_to_head', 'differential') then
      perform public._fail('Choose a valid tiebreaker.', 'invalid_tiebreaker');
    end if;
  end if;

  -- The playoff settings: echoing the current values is always fine. A change
  -- is refused once a playoff result exists (the bracket would have to be
  -- reseeded under reported results); a top_N format needs N playing coaches
  -- once the draft has fixed who plays.
  v_format_changed := v_playoff_format is distinct from v_league.playoff_format;
  v_playoffs_changed := v_format_changed or v_tiebreaker is distinct from v_league.tiebreaker;
  if v_playoffs_changed and public._playoffs_started(v_league.id) then
    perform public._fail('Playoff results have already been reported. Clear the bracket before changing the playoff settings.', 'playoffs_started');
  end if;
  if v_started and v_format_changed then
    v_size := public._playoff_size(v_playoff_format);
    select count(*) into v_playing from public._league_standings(v_league.id) s;
    if v_size > v_playing then
      perform public._fail(
        format('Top %s playoffs need at least %s coaches; this league has %s.', v_size, v_size, v_playing),
        'not_enough_coaches');
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
      custom_pool = case when v_replace_pool then public._format_pool(v_format_id, v_name) else custom_pool end,
      playoff_format = v_playoff_format,
      tiebreaker = v_tiebreaker
  where id = v_league.id
  returning * into v_league;

  -- Keep the informational invite counter in step with the coach limit.
  update public.league_invites set max_uses = greatest(v_max - 1, 1)
  where league_id = v_league.id and max_uses is distinct from greatest(v_max - 1, 1);

  -- Once the regular season is complete a changed playoff setting reseeds
  -- the bracket, or, without playoffs, re-crowns the top seed. A changed
  -- format passed the playing-count check above, so the strict rebuild never
  -- fails; a tiebreaker changed on its own is held to nothing more than the
  -- last regular result was (_generate_playoffs non-strict): in a league that
  -- cannot fill its format it is saved and the league stays without a
  -- bracket, instead of being refused over a format the commissioner did not
  -- touch.
  if v_playoffs_changed
     and coalesce(v_league.draft_completed, false)
     and public._regular_season_complete(v_league.id) then
    if v_playoff_format = 'none' then
      perform public._delete_playoffs(v_league.id);
      perform public._crown_top_seed(v_league.id);
    else
      perform public._generate_playoffs(v_league.id, v_format_changed);
    end if;
    select l.* into v_league from public.leagues l where l.id = v_league.id;
  end if;

  return to_jsonb(v_league);
end;
$fn$;

-- Builds the bracket for a league that finished its regular season before this
-- release (normally report_match_result builds it with the last result).
create or replace function public.generate_playoffs(p_league_id uuid)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
begin
  perform public._caller_uid();
  v_league := public._lock_league(p_league_id);
  perform public._league_commissioner_check(p_league_id);
  if not coalesce(v_league.draft_completed, false) then
    perform public._fail('The playoffs can be set up after the draft is complete.', 'draft_not_completed');
  end if;
  if v_league.playoff_format = 'none' then
    perform public._fail('This league has no playoffs. Choose a playoff format in Settings first.', 'no_playoffs');
  end if;
  if not public._regular_season_complete(v_league.id) then
    perform public._fail('Every regular season match needs a result before the playoffs can start.', 'regular_season_incomplete');
  end if;
  if public._playoffs_started(v_league.id) then
    perform public._fail('Playoff results have already been reported. Clear the bracket to start the playoffs over.', 'playoffs_started');
  end if;
  return public._generate_playoffs(v_league.id, true);
end;
$fn$;

-- Removes the bracket, its results and news, and the champion. Allowed even
-- when playoff results exist; the UI confirms first. A league without
-- playoffs has no bracket to remove, and its champion is the top seed by
-- rule (the last regular result crowns it), so the call leaves it crowned:
-- the same seed 1 the data fix in section 4 would otherwise restore on the
-- next run of this file.
create or replace function public.clear_playoffs(p_league_id uuid)
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
  perform public._delete_playoffs(v_league.id);
  if v_league.playoff_format = 'none' and public._regular_season_complete(v_league.id) then
    perform public._crown_top_seed(v_league.id);
  end if;
end;
$fn$;

-- The old 2-parameter signature would make the name ambiguous next to the
-- new one (see create_league above).
drop function if exists public.report_match_result(uuid, uuid);

create or replace function public.report_match_result(p_match_id uuid, p_winner_member_id uuid, p_winner_remaining integer default null)
returns void
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_match public.league_matches;
  v_league public.leagues;
  v_fed public.league_matches;
  v_loser uuid;
  v_winner_name text;
  v_loser_name text;
  v_winner_seed integer;
  v_last_round integer;
  v_round_label text;
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

  if p_winner_remaining is not null and (p_winner_remaining < 1 or p_winner_remaining > 12) then
    perform public._fail('The winner''s Pokémon left standing must be between 1 and 12.', 'invalid_score');
  end if;
  if v_match.stage = 'playoff' and (v_match.home_member_id is null or v_match.away_member_id is null) then
    perform public._fail('That playoff match is waiting for an earlier round to finish.', 'match_not_ready');
  end if;
  if v_match.stage = 'regular' and public._playoffs_started(v_league.id) then
    perform public._fail('Playoff results have already been reported. Edit the playoff results first, or clear the bracket to change the regular season.', 'playoffs_started');
  end if;
  if p_winner_member_id is null
     or (p_winner_member_id is distinct from v_match.home_member_id and p_winner_member_id is distinct from v_match.away_member_id) then
    perform public._fail('The winner must be one of the two teams in the match.', 'invalid_winner');
  end if;
  v_loser := case when p_winner_member_id = v_match.home_member_id then v_match.away_member_id else v_match.home_member_id end;

  if v_match.stage = 'playoff' and v_match.feeds_match_id is not null then
    select m.* into v_fed from public.league_matches m where m.id = v_match.feeds_match_id for update;
    if found and v_fed.status = 'completed' then
      perform public._fail('A later playoff round has already been decided. Clear that result first.', 'later_round_decided');
    end if;
  end if;

  update public.league_matches
  set status = 'completed', winner_member_id = p_winner_member_id, winner_remaining = p_winner_remaining
  where id = v_match.id;

  select coalesce(nullif(trim(lm.team_name), ''), 'Unnamed Team') into v_winner_name from public.league_members lm where lm.id = p_winner_member_id;
  select coalesce(nullif(trim(lm.team_name), ''), 'Unnamed Team') into v_loser_name from public.league_members lm where lm.id = v_loser;

  if v_match.stage = 'playoff' then
    select coalesce(max(m.round_number), v_match.round_number) into v_last_round
    from public.league_matches m where m.league_id = v_league.id and m.stage = 'playoff';
    v_round_label := 'the ' || public._round_name(v_last_round - v_match.round_number);
  else
    v_round_label := format('Round %s', v_match.round_number);
  end if;

  delete from public.league_news n
  where n.league_id = v_league.id and n.news_type = 'match_result' and n.metadata ->> 'match_id' = v_match.id::text;

  insert into public.league_news (league_id, member_id, news_type, message, metadata)
  values (
    v_league.id, p_winner_member_id, 'match_result',
    left(format('%s defeated %s in %s.', coalesce(v_winner_name, 'Unnamed Team'), coalesce(v_loser_name, 'Unnamed Team'), v_round_label), 500),
    jsonb_build_object(
      'match_id', v_match.id,
      'winner_member_id', p_winner_member_id,
      'loser_member_id', v_loser,
      'round_number', v_match.round_number,
      'match_number', v_match.match_number,
      'stage', v_match.stage,
      'winner_remaining', p_winner_remaining));

  if v_match.stage = 'regular' then
    -- The last regular result builds the bracket, or crowns the top seed when
    -- the league has no playoffs; a changed regular result reseeds it (no
    -- playoff result exists, see above).
    if public._regular_season_complete(v_league.id) then
      if v_league.playoff_format = 'none' then
        perform public._delete_playoffs(v_league.id);
        perform public._crown_top_seed(v_league.id);
      else
        perform public._generate_playoffs(v_league.id, false);
      end if;
    end if;
    return;
  end if;

  -- A playoff result: the winner advances, or wins the championship.
  v_winner_seed := case when p_winner_member_id = v_match.home_member_id then v_match.home_seed else v_match.away_seed end;
  if v_match.feeds_match_id is not null then
    if v_match.feeds_slot = 'away' then
      update public.league_matches
      set away_member_id = p_winner_member_id, away_seed = v_winner_seed
      where id = v_match.feeds_match_id;
    else
      update public.league_matches
      set home_member_id = p_winner_member_id, home_seed = v_winner_seed
      where id = v_match.feeds_match_id;
    end if;
    return;
  end if;

  update public.leagues set champion_member_id = p_winner_member_id where id = v_league.id;
  delete from public.league_news n
  where n.league_id = v_league.id and n.news_type = 'season' and n.metadata ->> 'kind' = 'champion';
  insert into public.league_news (league_id, member_id, news_type, message, metadata)
  values (
    v_league.id, p_winner_member_id, 'season',
    left(format('%s won the championship.', coalesce(v_winner_name, 'Unnamed Team')), 500),
    jsonb_build_object('kind', 'champion', 'member_id', p_winner_member_id, 'match_id', v_match.id));
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
  v_fed public.league_matches;
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

  if v_match.stage = 'regular' and public._playoffs_started(v_league.id) then
    perform public._fail('Playoff results have already been reported. Clear the bracket before changing the regular season.', 'playoffs_started');
  end if;
  if v_match.stage = 'playoff' and v_match.feeds_match_id is not null then
    select m.* into v_fed from public.league_matches m where m.id = v_match.feeds_match_id for update;
    if found and v_fed.status = 'completed' then
      perform public._fail('A later playoff round has already been decided. Clear that result first.', 'later_round_decided');
    end if;
  end if;

  update public.league_matches
  set status = 'upcoming', winner_member_id = null, winner_remaining = null
  where id = v_match.id;
  delete from public.league_news n
  where n.league_id = v_league.id and n.news_type = 'match_result' and n.metadata ->> 'match_id' = v_match.id::text;

  if v_match.stage = 'regular' then
    -- The regular season is no longer complete: no bracket, no champion.
    perform public._delete_playoffs(v_league.id);
    return;
  end if;

  if v_match.feeds_match_id is not null then
    -- The slot the winner had filled opens again.
    if v_match.feeds_slot = 'away' then
      update public.league_matches
      set away_member_id = null, away_seed = null
      where id = v_match.feeds_match_id and away_member_id is not distinct from v_match.winner_member_id;
    else
      update public.league_matches
      set home_member_id = null, home_seed = null
      where id = v_match.feeds_match_id and home_member_id is not distinct from v_match.winner_member_id;
    end if;
    return;
  end if;

  -- The final: no champion yet.
  update public.leagues set champion_member_id = null where id = v_league.id;
  delete from public.league_news n
  where n.league_id = v_league.id and n.news_type = 'season' and n.metadata ->> 'kind' = 'champion';
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

  -- A new schedule starts the season over: the bracket (deleted with every
  -- other match below), the season news and the champion go with it.
  delete from public.league_news n where n.league_id = v_league.id and n.news_type = 'season';
  update public.leagues set schedule_format = p_format, champion_member_id = null where id = v_league.id;
  delete from public.league_matches m where m.league_id = v_league.id;
  insert into public.league_matches (league_id, round_number, match_number, home_member_id, away_member_id, status, stage)
  select v_league.id, s.round_number, s.match_number, s.home_member_id, s.away_member_id, 'upcoming', 'regular'
  from public._schedule_rows(v_ids, p_format) s;
  get diagnostics v_count = row_count;
  return v_count;
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
      draft_paused_total_seconds = 0,
      champion_member_id = null
  where id = v_league.id;
  -- custom_pool is left as it is, whether it is a copy of a format or a pool
  -- set with update_league_pool: a league never follows a format live, so the
  -- commissioner pulls a format's current list with reset_league_pool.
end;
$fn$;

------------------------------------------------------------------------------
-- 4. Data fix
------------------------------------------------------------------------------
-- Leagues without playoffs whose regular season was already complete when
-- this file ran have a champion from now on: the top seed. Leagues that
-- already carry one, or that have a bracket, are left alone, so re-running
-- the file changes nothing.

do $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select l.id
    from public.leagues l
    where l.playoff_format = 'none'
      and coalesce(l.draft_completed, false)
      and l.champion_member_id is null
      and exists (select 1 from public.league_matches m where m.league_id = l.id and m.stage = 'regular')
      and not exists (select 1 from public.league_matches m where m.league_id = l.id and m.stage = 'playoff')
      and public._regular_season_complete(l.id)
    order by l.created_at, l.id
  loop
    perform public._crown_top_seed(r.id);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    raise notice 'PokeDrafts: named the top seed champion of % finished league(s) without playoffs (leagues.champion_member_id).', v_n;
  end if;
end $$;

------------------------------------------------------------------------------
-- 5. Grants
------------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_internal text[] := array[
    'public._playoff_size(text)',
    'public._round_name(integer)',
    'public._bracket_rows(text)',
    'public._league_standings(uuid)',
    'public._regular_season_complete(uuid)',
    'public._playoffs_started(uuid)',
    'public._last_regular_round(uuid)',
    'public._delete_playoffs(uuid)',
    'public._crown_top_seed(uuid)',
    'public._generate_playoffs(uuid, boolean)'
  ];
  v_api text[] := array[
    'public.league_standings(uuid)',
    'public.create_league(text, text, integer, uuid, integer, integer, integer, text, text)',
    'public.update_league_settings(uuid, jsonb)',
    'public.generate_playoffs(uuid)',
    'public.clear_playoffs(uuid)',
    'public.report_match_result(uuid, uuid, integer)',
    'public.clear_match_result(uuid)',
    'public.generate_schedule(uuid, text, boolean, boolean)',
    'public.reset_draft(uuid)'
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

drop function if exists pg_temp.pd_add_check(regclass, text, text);
drop function if exists pg_temp.pd_add_fk(regclass, text, text);

------------------------------------------------------------------------------
-- 6. Post-apply report
------------------------------------------------------------------------------
-- The hardening file's health check still describes what is left to fix
-- (constraints added NOT VALID, skipped uniques, realtime, storage, leagues
-- without a pool). Ending with the same select shows that list as the result
-- of running this file in the SQL editor; no rows means nothing to do.

do $$
declare
  v_n integer;
begin
  select count(*) into v_n from public._migration_report();
  if v_n = 0 then
    raise notice 'PokeDrafts: playoffs migration applied with nothing left to fix (select * from public._migration_report() returns no rows).';
  else
    raise warning 'PokeDrafts: % item(s) need attention. Re-check any time with: select * from public._migration_report();', v_n;
  end if;
end $$;

select * from public._migration_report();
