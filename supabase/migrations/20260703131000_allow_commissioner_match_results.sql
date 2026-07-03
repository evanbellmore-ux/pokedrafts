drop policy if exists "Commissioners can report match results"
  on public.league_matches;

create policy "Commissioners can report match results"
  on public.league_matches
  for update
  using (
    exists (
      select 1
      from public.leagues l
      where l.id = league_matches.league_id
        and l.commissioner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.leagues l
      where l.id = league_matches.league_id
        and l.commissioner_id = auth.uid()
    )
  );
