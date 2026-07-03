alter table public.leagues
  add column if not exists free_agent_swap_limit integer not null default 3;

alter table public.leagues
  drop constraint if exists leagues_free_agent_swap_limit_check;

alter table public.leagues
  add constraint leagues_free_agent_swap_limit_check
  check (free_agent_swap_limit >= 0);

alter table public.league_members
  add column if not exists free_agent_swaps_used integer not null default 0;

alter table public.league_members
  drop constraint if exists league_members_free_agent_swaps_used_check;

alter table public.league_members
  add constraint league_members_free_agent_swaps_used_check
  check (free_agent_swaps_used >= 0);

drop policy if exists "Members can update their finalized team after draft"
  on public.drafted_teams;

create policy "Members can update their finalized team after draft"
  on public.drafted_teams
  for update
  using (
    exists (
      select 1
      from public.league_members lm
      join public.leagues l on l.id = lm.league_id
      where lm.id = drafted_teams.member_id
        and lm.league_id = drafted_teams.league_id
        and lm.user_id = auth.uid()
        and l.draft_completed = true
        and lm.free_agent_swaps_used < l.free_agent_swap_limit
    )
  )
  with check (
    exists (
      select 1
      from public.league_members lm
      join public.leagues l on l.id = lm.league_id
      where lm.id = drafted_teams.member_id
        and lm.league_id = drafted_teams.league_id
        and lm.user_id = auth.uid()
        and l.draft_completed = true
        and lm.free_agent_swaps_used < l.free_agent_swap_limit
    )
  );

drop policy if exists "Members can increment their free agent swap count"
  on public.league_members;

create policy "Members can increment their free agent swap count"
  on public.league_members
  for update
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.leagues l
      where l.id = league_members.league_id
        and l.draft_completed = true
        and league_members.free_agent_swaps_used < l.free_agent_swap_limit
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.leagues l
      where l.id = league_members.league_id
        and l.draft_completed = true
        and league_members.free_agent_swaps_used <= l.free_agent_swap_limit
    )
  );
