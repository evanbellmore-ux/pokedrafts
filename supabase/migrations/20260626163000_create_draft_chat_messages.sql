create table if not exists public.draft_chat_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  member_id uuid not null references public.league_members(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists draft_chat_messages_league_created_idx
  on public.draft_chat_messages (league_id, created_at);

alter table public.draft_chat_messages enable row level security;

drop policy if exists "League members can read draft chat messages"
  on public.draft_chat_messages;

create policy "League members can read draft chat messages"
  on public.draft_chat_messages
  for select
  using (
    exists (
      select 1
      from public.league_members lm
      where lm.league_id = draft_chat_messages.league_id
        and lm.user_id = auth.uid()
    )
  );

drop policy if exists "League members can send draft chat messages"
  on public.draft_chat_messages;

create policy "League members can send draft chat messages"
  on public.draft_chat_messages
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.league_members lm
      where lm.id = draft_chat_messages.member_id
        and lm.league_id = draft_chat_messages.league_id
        and lm.user_id = auth.uid()
    )
  );

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table public.draft_chat_messages;
  end if;
exception
  when duplicate_object then null;
end $$;
