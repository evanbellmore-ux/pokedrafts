-- PokeDrafts: the pick clock runs out on the server too.
--
-- auto_pick_if_expired was only ever called from the draft room
-- (app/(app)/leagues/[leagueId]/draft/useDraftRoom.ts: once when a coach's
-- countdown reaches 0, then every 5 s), so when every coach closed the room
-- the clock ran out and nothing happened: the draft stalled until someone
-- opened it again. This file adds a sweep that pg_cron runs every minute and
-- that makes, in every live draft whose clock has run out, the pick the room
-- would have made:
--   1. _auto_pick_if_expired: the body of auto_pick_if_expired without the
--      caller checks, now shared by the room and the sweep (the pause
--      respected, the _lock_league lock, _best_available's choice, a skipped
--      turn when nothing is legal, _advance_or_finalize). auto_pick_if_expired
--      keeps its signature, checks and result, and the room keeps calling it.
--   2. _auto_pick_expired_drafts: the sweep
--   3. grants: both new functions are internal (no API grants)
--   4. schedule: with pg_cron enabled, the job pokedrafts-draft-timer runs the
--      sweep every minute and pokedrafts-draft-timer-cleanup deletes the two
--      jobs' run history older than seven days once a day. Without pg_cron the
--      file warns and schedules nothing: enable pg_cron (Integrations > Cron
--      in the dashboard), then run the file again.
--   5. result: one row saying whether the sweep is scheduled
--
-- The whole file is idempotent: create or replace keeps auto_pick_if_expired's
-- grant (authenticated), and cron.schedule replaces a job of the same name.
-- Like every feature file it runs after the hardening file. Re-running the
-- hardening file later puts back its own copy of auto_pick_if_expired, which
-- behaves the same, and leaves the sweep in place.

------------------------------------------------------------------------------
-- 1. The shared auto-pick
------------------------------------------------------------------------------

-- Locks the league. When the draft is live, not paused and its clock has run
-- out (now() >= pick_started_at + pick_timer_seconds; a missing
-- pick_started_at counts as run out), drafts the best legal Pokémon for the
-- coach on the clock (_best_available: highest points, then name) through
-- _pick_internal or, when nothing is legal, skips the turn and the team keeps
-- an empty slot. Either way the next turn starts with a full clock, or the
-- draft finalizes after the last one. In any other state it changes nothing
-- and returns picked: false, which is also what a second caller gets after
-- waiting for the lock: it sees the clock the first caller restarted.
create or replace function public._auto_pick_if_expired(p_league_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_league public.leagues;
  v_on_clock uuid;
  v_best record;
  v_result jsonb;
  v_completed boolean;
begin
  v_league := public._lock_league(p_league_id);

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

-- The draft room's call, unchanged for the client: the caller must be signed
-- in (not_authenticated) and a member of the league (not_a_member). The league
-- is locked before the membership check, as before, so an unknown league is
-- league_not_found; _auto_pick_if_expired takes the same lock again, which
-- costs nothing inside one transaction.
create or replace function public.auto_pick_if_expired(p_league_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
begin
  v_uid := public._caller_uid();
  perform public._lock_league(p_league_id);
  perform public._member_for(p_league_id, v_uid);
  return public._auto_pick_if_expired(p_league_id);
end;
$fn$;

------------------------------------------------------------------------------
-- 2. The sweep
------------------------------------------------------------------------------

-- Run by pg_cron every minute as the database owner (section 4), and safe to
-- run by hand: select * from public._auto_pick_expired_drafts();
-- Takes the turn of every live, unpaused draft whose clock has run out through
-- _auto_pick_if_expired, so a coach's draft room and the sweep apply the same
-- rules under the same lock: whichever locks the league first makes the pick,
-- and the other sees the restarted clock and changes nothing. A league that
-- another transaction holds right now (a pick, a pause, the room's own
-- auto-pick) is left for the next run instead of making the sweep wait behind
-- it, and a league whose auto-pick fails is rolled back on its own with a
-- warning, so it cannot hold up the other drafts. A turn restarts its
-- league's clock at now(), the start of this run, so a league gets at most one
-- turn per run and the next coach always has a full clock. Returns one row per
-- turn taken (a pick, or a skipped turn when nothing was legal); no rows when
-- nothing was due.
create or replace function public._auto_pick_expired_drafts()
returns table (league_id uuid, picked boolean, pokemon_name text, skipped boolean, draft_completed boolean)
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  v_ids uuid[];
  v_id uuid;
  v_result jsonb;
begin
  -- The test _auto_pick_if_expired makes again under the lock.
  select coalesce(array_agg(l.id order by l.id), '{}'::uuid[])
  into v_ids
  from public.leagues l
  where coalesce(l.draft_started, false)
    and not coalesce(l.draft_completed, false)
    and l.draft_paused_at is null
    and (l.pick_started_at is null
         or now() >= l.pick_started_at + make_interval(secs => coalesce(l.pick_timer_seconds, 120)));

  foreach v_id in array v_ids loop
    begin
      perform 1 from public.leagues l where l.id = v_id for update skip locked;
      if not found then
        continue;
      end if;
      v_result := public._auto_pick_if_expired(v_id);
    exception
      when others then
        raise warning 'PokeDrafts: the auto-pick for league % failed (SQLSTATE %: %); that draft is unchanged and the next run tries again.', v_id, sqlstate, sqlerrm;
        continue;
    end;
    if (v_result ->> 'picked')::boolean or (v_result ->> 'skipped')::boolean then
      league_id := v_id;
      picked := (v_result ->> 'picked')::boolean;
      pokemon_name := v_result ->> 'pokemon_name';
      skipped := (v_result ->> 'skipped')::boolean;
      draft_completed := (v_result ->> 'draft_completed')::boolean;
      return next;
    end if;
  end loop;
end;
$fn$;

------------------------------------------------------------------------------
-- 3. Grants
------------------------------------------------------------------------------
-- Both functions are internal, like every _ helper: pg_cron runs the sweep as
-- the database owner and the API never calls either. Supabase's default
-- privileges hand every new function to anon and authenticated, so they are
-- revoked here. auto_pick_if_expired keeps the grant the hardening file gave
-- it (create or replace does not touch privileges).

do $$
declare
  v_fn text;
  v_internal text[] := array[
    'public._auto_pick_if_expired(uuid)',
    'public._auto_pick_expired_drafts()'
  ];
begin
  foreach v_fn in array v_internal loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 4. Schedule (pg_cron)
------------------------------------------------------------------------------
-- pg_cron is off on a Supabase project until it is enabled (Integrations >
-- Cron, or Database > Extensions > pg_cron). A job runs as the role that
-- scheduled it, the database owner here, and cron.schedule with a job name
-- replaces the job of that name (an upsert on the jobname and username), so
-- running this file again still leaves one of each. pg_cron adds
-- a row to cron.job_run_details for every run and never deletes them: about
-- 1,440 rows a day for a job that runs every minute, so the second job deletes
-- the two jobs' rows older than seven days once a day (04:17 UTC). Without
-- pg_cron nothing is scheduled and the draft room's own call is the only
-- auto-pick, as before this file.

do $$
begin
  if to_regprocedure('cron.schedule(text, text, text)') is null then
    raise warning 'PokeDrafts: pg_cron is not enabled, so a pick clock that runs out is only auto-picked while someone has the draft room open. Enable pg_cron (Integrations > Cron), then run this file again.';
    return;
  end if;
  perform cron.schedule('pokedrafts-draft-timer', '* * * * *',
    'select * from public._auto_pick_expired_drafts()');
  perform cron.schedule('pokedrafts-draft-timer-cleanup', '17 4 * * *',
    $cmd$delete from cron.job_run_details where jobid in (select jobid from cron.job where jobname in ('pokedrafts-draft-timer', 'pokedrafts-draft-timer-cleanup')) and end_time < now() - interval '7 days'$cmd$);
  raise notice 'PokeDrafts: pg_cron runs public._auto_pick_expired_drafts() every minute (job pokedrafts-draft-timer).';
end $$;

------------------------------------------------------------------------------
-- 5. Result
------------------------------------------------------------------------------
-- The SQL editor does not show notices reliably, so the file ends with a
-- select whose row is the result of running it.

select case
         when to_regprocedure('cron.schedule(text, text, text)') is null
           then 'Not scheduled: pg_cron is not enabled, so expired picks are only auto-picked while someone has the draft room open. Enable pg_cron (Integrations > Cron), then run this file again.'
         else 'Scheduled: pg_cron runs public._auto_pick_expired_drafts() every minute (job pokedrafts-draft-timer).'
       end as draft_timer;
