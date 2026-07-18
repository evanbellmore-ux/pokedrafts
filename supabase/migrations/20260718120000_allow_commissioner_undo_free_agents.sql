drop policy if exists "Commissioners can restore finalized teams"
  on public.drafted_teams;

create policy "Commissioners can restore finalized teams"
  on public.drafted_teams
  for update
  using (
    exists (
      select 1
      from public.leagues l
      where l.id = drafted_teams.league_id
        and l.commissioner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.leagues l
      where l.id = drafted_teams.league_id
        and l.commissioner_id = auth.uid()
    )
  );

drop policy if exists "Commissioners can adjust free agent swap counts"
  on public.league_members;

create policy "Commissioners can adjust free agent swap counts"
  on public.league_members
  for update
  using (
    exists (
      select 1
      from public.leagues l
      where l.id = league_members.league_id
        and l.commissioner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.leagues l
      where l.id = league_members.league_id
        and l.commissioner_id = auth.uid()
    )
  );

drop policy if exists "Commissioners can delete free agent news"
  on public.league_news;

create policy "Commissioners can delete free agent news"
  on public.league_news
  for delete
  using (
    news_type = 'free_agent'
    and exists (
      select 1
      from public.leagues l
      where l.id = league_news.league_id
        and l.commissioner_id = auth.uid()
    )
  );
