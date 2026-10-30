-- Account deletion (docs/release-architecture.md section 18).
--
-- Before this file, deleting a person from Authentication > Users removed only
-- their draft chat messages (the one foreign key to auth.users) and left
-- everything else behind: the leagues they ran (leagues.commissioner_id has
-- no foreign key), their league_members rows and their draft formats. This
-- file lets a signed-in person delete their own account, and the owner delete
-- anyone's (an emailed request, or the leftovers of a dashboard deletion, with
-- _delete_account in the SQL editor), with the data that belongs to it, in one
-- transaction:
--
--   * Leagues they run where they are the only active coach are deleted, with
--     everything in them (members, invite, picks, teams, matches, news, chat
--     cascade from leagues).
--   * A league they run that has another active coach passes to the active
--     coach who joined it earliest, who becomes its commissioner (the owner's
--     choice; deleting the league would end it for everyone else).
--   * Their spot in a league whose draft has not started is removed, like
--     Leave league (a league they handed over included).
--   * Their team in a league whose draft has started stays, so the other
--     coaches keep their matches, standings, bracket and draft order (deleting
--     the member row would cascade to every match it played), but it no
--     longer points at them: user_id becomes a fresh random uuid that belongs
--     to nobody and account_deleted_at is set. Such a team cannot be made
--     commissioner.
--   * Their draft chat messages and the draft formats they saved are
--     deleted (each league keeps its own copy of its pool in custom_pool, and
--     leagues.draft_format_id is set null by its foreign key), and so is a
--     site_admins row (Watch listings, 20261026120000_watch_review.sql). A
--     league's public page settings (is_public, stream_url, replay_links,
--     watch_listed) belong to the league: they go with a deleted league and
--     stay with one that is handed over.
--   * Finally the auth.users row (Supabase cascades its identities, sessions
--     and refresh tokens), then the person's rows in auth.audit_log_entries,
--     which have no foreign key and carry their email and IP addresses.
--
-- Contents:
--   1. league_members.account_deleted_at
--   2. _account_plan: what deleting an account does to each of its leagues
--   3. account_deletion_preview, _delete_account, delete_account,
--      transfer_commissioner
--   4. grants
--   5. post-apply check (may this database's owner delete from auth.users and
--      auth.audit_log_entries?)
--
-- Idempotent: add column if not exists, drop-and-create for the internal
-- _account_plan (its row shape may change between versions of this file),
-- create or replace for the rest. It runs after the hardening file like every
-- feature migration; a re-run of the hardening file puts the old
-- transfer_commissioner back (without the deleted-account check), so re-run
-- this file after it.

------------------------------------------------------------------------------
-- 1. league_members.account_deleted_at
------------------------------------------------------------------------------
-- Null for every live coach. Set (with user_id replaced) when the coach
-- deleted their account and the team stayed in a league whose draft had
-- started.

alter table public.league_members add column if not exists account_deleted_at timestamptz;

------------------------------------------------------------------------------
-- 2. _account_plan
------------------------------------------------------------------------------
-- One row per league the person runs or belongs to, with what deleting the
-- account does to it (outcome):
--   delete_league  they run it and no other active coach is left
--   hand_over      they run it and another active coach is in it: heir is the
--                  active coach who joined earliest (joined_at, then member id)
--   remove_team    they coach in it and its draft has not started
--   keep_team      they coach in it and its draft has started
-- An active coach is a member row other than theirs whose account_deleted_at
-- is null and whose user still has a sign-in (an auth.users row):
-- league_members.user_id has no foreign key, so a row can outlive its account
-- (a dashboard deletion, or a deleted account's other device joining with a
-- token that has not expired yet), and handing a league to it would leave the
-- league to nobody. In a league they hand over, their own team (member_id) is
-- removed or kept by the same draft_started rule as in a league they only
-- coach in.
-- account_deletion_preview shows these rows and _delete_account (behind
-- delete_account) carries them out, so the confirm step and the deletion can
-- never disagree; the owner previews anyone's with
-- select * from public._account_plan('<id>').

drop function if exists public._account_plan(uuid);

create function public._account_plan(p_uid uuid)
returns table (
  league_id uuid,
  league_name text,
  draft_started boolean,
  member_id uuid,
  team_name text,
  heir_member_id uuid,
  heir_team_name text,
  outcome text
)
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
begin
  return query
  with mine as (
    select l.id, l.name, l.commissioner_id = p_uid as runs_it, coalesce(l.draft_started, false) as started
    from public.leagues l
    where l.commissioner_id = p_uid
       or l.id in (select lm.league_id from public.league_members lm where lm.user_id = p_uid)
  )
  select
    m.id,
    m.name,
    m.started,
    own.id,
    own.team_name,
    heir.id,
    heir.team_name,
    case
      when m.runs_it and heir.id is not null then 'hand_over'
      when m.runs_it then 'delete_league'
      when not m.started then 'remove_team'
      else 'keep_team'
    end
  from mine m
  left join public.league_members own on own.league_id = m.id and own.user_id = p_uid
  left join lateral (
    select o.id, o.team_name
    from public.league_members o
    where o.league_id = m.id and o.user_id <> p_uid and o.account_deleted_at is null
      and exists (select 1 from auth.users u where u.id = o.user_id)
    order by o.joined_at asc nulls last, o.id
    limit 1
  ) heir on m.runs_it
  order by m.name, m.id;
end;
$fn$;

------------------------------------------------------------------------------
-- 3. Functions
------------------------------------------------------------------------------

-- What deleting the caller's account would remove and keep, for the confirm
-- step. Read-only; _delete_account works from the same plan under the league
-- locks.
create or replace function public.account_deletion_preview()
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid;
  v_result jsonb;
begin
  v_uid := public._caller_uid();

  -- A league they hand over appears twice: in handed_over_leagues, and with
  -- their own team in removed_teams or kept_teams.
  select jsonb_build_object(
    'deleted_leagues', coalesce(jsonb_agg(jsonb_build_object('league_id', p.league_id, 'league_name', p.league_name) order by p.league_name, p.league_id) filter (where p.outcome = 'delete_league'), '[]'::jsonb),
    'handed_over_leagues', coalesce(jsonb_agg(jsonb_build_object('league_id', p.league_id, 'league_name', p.league_name, 'new_commissioner_team', p.heir_team_name) order by p.league_name, p.league_id) filter (where p.outcome = 'hand_over'), '[]'::jsonb),
    'removed_teams', coalesce(jsonb_agg(jsonb_build_object('league_id', p.league_id, 'league_name', p.league_name, 'team_name', p.team_name) order by p.league_name, p.league_id) filter (where p.outcome <> 'delete_league' and p.member_id is not null and not p.draft_started), '[]'::jsonb),
    'kept_teams', coalesce(jsonb_agg(jsonb_build_object('league_id', p.league_id, 'league_name', p.league_name, 'team_name', p.team_name) order by p.league_name, p.league_id) filter (where p.outcome <> 'delete_league' and p.member_id is not null and p.draft_started), '[]'::jsonb)
  )
  into v_result
  from public._account_plan(v_uid) p;

  return v_result || jsonb_build_object(
    'draft_formats', (select count(*)::integer from public.draft_formats f where f.created_by = v_uid),
    'chat_messages', (select count(*)::integer from public.draft_chat_messages c where c.user_id = v_uid),
    'site_admin', exists (select 1 from public.site_admins a where a.user_id = v_uid)
  );
end;
$fn$;

-- Deletes one account and the data that belongs to it (see the top of this
-- file), whoever asks: delete_account passes the caller, and the owner calls
-- it from the SQL editor for an emailed request or to tidy up after a
-- dashboard deletion (docs/release-architecture.md section 18.7). It needs no
-- caller (auth.uid() may be null), works for an id whose auth.users row is
-- already gone, and is revoked from every API role. Returns what it did:
-- sign_in_deleted is false when no auth.users row had that id, which is how a
-- mistyped id shows.
create or replace function public._delete_account(p_uid uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
declare
  r record;
  v_email text;
  v_deleted_leagues integer := 0;
  v_handed_over integer := 0;
  v_removed_teams integer := 0;
  v_kept_teams integer := 0;
  v_formats integer;
  v_messages integer;
  v_admin integer;
  v_users integer;
  v_audit integer := 0;
begin
  if p_uid is null then
    perform public._fail('Give the id of the account to delete.', 'account_id_required');
  end if;

  -- Read before the row goes: the audit log names the person by email too.
  select u.email into v_email from auth.users u where u.id = p_uid;

  -- Every league the plan touches, locked in id order: the league RPCs lock
  -- one league row first, so they serialize with this call (an heir cannot
  -- leave or be removed halfway), and two deletions that share leagues
  -- cannot deadlock.
  perform 1
  from public.leagues l
  where l.commissioner_id = p_uid
     or l.id in (select lm.league_id from public.league_members lm where lm.user_id = p_uid)
  order by l.id
  for update;

  -- First, so the counts match the preview (the league deletions below
  -- would cascade some of these rows away uncounted).
  delete from public.draft_chat_messages where user_id = p_uid;
  get diagnostics v_messages = row_count;

  delete from public.draft_formats where created_by = p_uid;
  get diagnostics v_formats = row_count;

  -- It would also cascade from auth.users; deleted here so the result says
  -- so, and so an id without a sign-in loses it too.
  delete from public.site_admins where user_id = p_uid;
  get diagnostics v_admin = row_count;

  for r in select * from public._account_plan(p_uid) loop
    if r.outcome = 'delete_league' then
      delete from public.leagues where id = r.league_id;
      v_deleted_leagues := v_deleted_leagues + 1;
      continue;
    end if;

    if r.outcome = 'hand_over' then
      -- What transfer_commissioner does: the heir's user runs the league and
      -- every row's role follows commissioner_id.
      update public.leagues l
      set commissioner_id = h.user_id
      from public.league_members h
      where l.id = r.league_id and h.id = r.heir_member_id;
      update public.league_members
      set role = case when id = r.heir_member_id then 'commissioner' else 'coach' end
      where league_id = r.league_id
        and role is distinct from (case when id = r.heir_member_id then 'commissioner' else 'coach' end);
      v_handed_over := v_handed_over + 1;
    end if;

    -- Their own team, in a league they handed over as much as in one they
    -- coach in: gone before the draft, kept and unlinked once it started.
    if r.member_id is not null then
      if r.draft_started then
        update public.league_members
        set user_id = gen_random_uuid(), account_deleted_at = now()
        where id = r.member_id;
        v_kept_teams := v_kept_teams + 1;
      else
        delete from public.league_members where id = r.member_id;
        v_removed_teams := v_removed_teams + 1;
      end if;
    end if;
  end loop;

  -- The sign-in itself. If the role that owns this function may not delete
  -- from auth.users, nothing above is kept either: the error rolls the whole
  -- call back. Section 5 below reports that case when the file is applied.
  begin
    delete from auth.users where id = p_uid;
    get diagnostics v_users = row_count;
  exception when insufficient_privilege then
    perform public._fail(
      'Account deletion is not available right now. Nothing was deleted; please try again later.',
      'account_deletion_unavailable'
    );
  end;

  -- The sign-in history GoTrue keeps when its audit log is on: payload is
  -- json naming the person by id (actor_id, or traits.user_id) and by email
  -- (actor_username, or traits.user_email), and each row holds an IP address.
  -- After the auth.users row, so a token refresh racing this call cannot
  -- leave a newer row behind. A missing privilege refuses the whole deletion,
  -- like auth.users: the privacy policy promises the email goes.
  if to_regclass('auth.audit_log_entries') is not null then
    begin
      delete from auth.audit_log_entries a
      where a.payload ->> 'actor_id' = p_uid::text
         or a.payload -> 'traits' ->> 'user_id' = p_uid::text
         or (
           v_email is not null
           and (
             lower(a.payload ->> 'actor_username') = lower(v_email)
             or lower(a.payload -> 'traits' ->> 'user_email') = lower(v_email)
           )
         );
      get diagnostics v_audit = row_count;
    exception when insufficient_privilege then
      perform public._fail(
        'Account deletion is not available right now. Nothing was deleted; please try again later.',
        'account_deletion_unavailable'
      );
    end;
  end if;

  return jsonb_build_object(
    'deleted_leagues', v_deleted_leagues,
    'handed_over_leagues', v_handed_over,
    'removed_teams', v_removed_teams,
    'kept_teams', v_kept_teams,
    'draft_formats', v_formats,
    'chat_messages', v_messages,
    'site_admin', v_admin > 0,
    'sign_in_deleted', v_users > 0,
    'audit_log_entries', v_audit
  );
end;
$fn$;

-- Deletes the caller's own account: _delete_account for auth.uid(), so the
-- self-service and the owner's deletion can never drift apart.
create or replace function public.delete_account()
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $fn$
begin
  return public._delete_account(public._caller_uid());
end;
$fn$;

-- The hardening file's transfer_commissioner, plus the deleted-account check:
-- a team whose coach deleted their account belongs to nobody, and neither does
-- a member row whose user has no auth.users row any more (league_members has
-- no foreign key to it), so making either commissioner would leave the league
-- without anyone who can run it.
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
  if v_member.account_deleted_at is not null
     or not exists (select 1 from auth.users u where u.id = v_member.user_id) then
    perform public._fail('That coach no longer has an account, so they cannot run the league.', 'member_account_deleted');
  end if;
  update public.leagues set commissioner_id = v_member.user_id where id = v_league.id;
  update public.league_members
  set role = case when id = v_member.id then 'commissioner' else 'coach' end
  where league_id = v_league.id
    and role is distinct from (case when id = v_member.id then 'commissioner' else 'coach' end);
end;
$fn$;

------------------------------------------------------------------------------
-- 4. Grants
------------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_internal text[] := array[
    'public._account_plan(uuid)',
    'public._delete_account(uuid)'
  ];
  v_api text[] := array[
    'public.account_deletion_preview()',
    'public.delete_account()',
    'public.transfer_commissioner(uuid, uuid)'
  ];
begin
  foreach v_fn in array v_internal loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;
  -- Deleting any account is the owner's alone (the SQL editor's postgres
  -- role owns it): not even the service role behind the seed scripts.
  revoke all on function public._delete_account(uuid) from service_role;
  foreach v_fn in array v_api loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. Post-apply check
------------------------------------------------------------------------------
-- _delete_account runs as the owner of this file's functions (the role that
-- applies it: postgres in the Supabase SQL editor) and deletes from
-- auth.users and auth.audit_log_entries. Say so now if that role may not,
-- instead of when the first person tries to delete their account. The select
-- shows the same facts as the result of running this file in the SQL editor:
-- every column must be true.

do $$
declare
  v_users boolean := has_table_privilege('auth.users', 'delete');
  -- has_table_privilege(oid, ...) is null for a missing table (to_regclass).
  v_audit boolean := coalesce(has_table_privilege(to_regclass('auth.audit_log_entries'), 'delete'), true);
begin
  if v_users and v_audit then
    raise notice 'PokeDrafts: account deletion is ready (% may delete from auth.users and auth.audit_log_entries).', current_user;
  end if;
  if not v_users then
    raise warning 'PokeDrafts: % may not delete from auth.users, so delete_account will refuse with account_deletion_unavailable. Apply this file as the postgres role (the Supabase SQL editor does).', current_user;
  end if;
  if not v_audit then
    raise warning 'PokeDrafts: % may not delete from auth.audit_log_entries, so delete_account will refuse with account_deletion_unavailable. Apply this file as the postgres role (the Supabase SQL editor does).', current_user;
  end if;
end $$;

select
  has_table_privilege('auth.users', 'delete') as owner_can_delete_auth_users,
  coalesce(has_table_privilege(to_regclass('auth.audit_log_entries'), 'delete'), true) as owner_can_delete_auth_audit_log,
  has_function_privilege('authenticated', 'public.delete_account()', 'execute') as signed_in_users_can_delete_their_account,
  not has_function_privilege('service_role', 'public._delete_account(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public._delete_account(uuid)', 'execute')
    and not has_function_privilege('anon', 'public._delete_account(uuid)', 'execute') as only_the_owner_can_delete_any_account;
