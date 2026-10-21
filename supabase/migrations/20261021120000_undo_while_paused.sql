-- PokeDrafts: an undo during a pause hands the turn back with one full clock.
--
-- undo_last_pick restarted the pick clock at now() even while the draft was
-- paused, and resume_draft then moves pick_started_at forward by the whole
-- pause (now() - draft_paused_at). So the part of the pause before the undo
-- was added to the restored turn: undo 45 seconds into a pause and a
-- 120-second clock showed 2:45 in the draft room and ran for 165 seconds
-- after the resume, for the room's auto-pick and for the server's sweep
-- (_auto_pick_expired_drafts, 20261020130000_draft_timer_sweep.sql) alike.
--
-- While the draft is paused the clock now restarts at the moment of the
-- pause (draft_paused_at), so the room shows the full clock, frozen, and the
-- turn gets exactly one full clock from the moment the draft resumes. Outside
-- a pause nothing changes: the clock restarts at now(), as before.
--
-- Idempotent: create or replace keeps the function's grant (authenticated).
-- Like every feature file it runs after the hardening file; re-running the
-- hardening file later puts back its own copy, so run this file after it.

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
  -- resume_draft adds the whole pause to pick_started_at, so a clock that
  -- restarts during a pause starts at the pause.
  update public.leagues
  set current_pick_number = v_pick.pick_number,
      pick_started_at = coalesce(v_league.draft_paused_at, now()),
      auto_pick_in_progress = false
  where id = v_league.id;
  return jsonb_build_object('pick_number', v_pick.pick_number, 'pokemon_name', v_pick.pokemon_name);
end;
$fn$;
