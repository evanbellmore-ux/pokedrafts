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
    )
  );
