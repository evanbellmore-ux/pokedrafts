create table if not exists public.league_news (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  member_id uuid references public.league_members(id) on delete set null,
  news_type text not null check (news_type in ('free_agent', 'match_result')),
  message text not null check (char_length(message) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists league_news_league_created_idx
  on public.league_news (league_id, created_at desc);

alter table public.league_news enable row level security;

drop policy if exists "League members can read league news"
  on public.league_news;

create policy "League members can read league news"
  on public.league_news
  for select
  using (
    exists (
      select 1
      from public.league_members lm
      where lm.league_id = league_news.league_id
        and lm.user_id = auth.uid()
    )
  );

drop policy if exists "League members can create free agent news"
  on public.league_news;

create policy "League members can create free agent news"
  on public.league_news
  for insert
  with check (
    news_type = 'free_agent'
    and exists (
      select 1
      from public.league_members lm
      where lm.id = league_news.member_id
        and lm.league_id = league_news.league_id
        and lm.user_id = auth.uid()
    )
  );

drop policy if exists "Commissioners can create match result news"
  on public.league_news;

create policy "Commissioners can create match result news"
  on public.league_news
  for insert
  with check (
    news_type = 'match_result'
    and exists (
      select 1
      from public.leagues l
      where l.id = league_news.league_id
        and l.commissioner_id = auth.uid()
    )
  );
