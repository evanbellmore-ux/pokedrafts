-- A coach who joins a league whose draft order is already set joins that order
-- at the end. Before this, join_league inserted every new coach without a
-- draft_position, and start_draft only drafts positioned members
-- (_positioned_members), so anyone who joined after the commissioner saved
-- the order silently became a spectator, and once the draft started the only
-- fix was Reset draft.
--
-- Before any order exists the new coach still has no position, as before: the
-- commissioner sets the whole order with set_draft_order. A coach the
-- commissioner leaves out of the order on purpose keeps no position.
-- join_league locks the league row (_lock_league) before reading the highest
-- position, so concurrent joins take consecutive positions, and the
-- (league_id, draft_position) key stays unique.
--
-- Idempotent: create or replace keeps the function's grants (authenticated).

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
  v_last_position integer;
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

  -- The end of the draft order when one is set; null (no order yet) otherwise.
  select max(lm.draft_position) into v_last_position
  from public.league_members lm
  where lm.league_id = v_league.id;

  insert into public.league_members (league_id, user_id, role, team_name, draft_position)
  values (v_league.id, v_uid, 'coach', v_team, v_last_position + 1);

  update public.league_invites set used_count = used_count + 1 where id = v_invite.id;

  return v_league.id;
end;
$fn$;
