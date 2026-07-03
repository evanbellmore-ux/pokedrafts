do $$
declare
  target_table text;
  constraint_record record;
begin
  if to_regclass('public.leagues') is null then
    raise exception 'public.leagues does not exist. Apply the base PokeDrafts schema or run this migration against the Supabase project that already has the leagues table.';
  end if;

  foreach target_table in array array[
    'league_members',
    'league_invites',
    'draft_picks',
    'drafted_teams',
    'draft_chat_messages',
    'league_matches'
  ]
  loop
    if to_regclass('public.' || target_table) is null then
      continue;
    end if;

    for constraint_record in
      select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
        and rel.relname = target_table
        and con.contype = 'f'
        and con.confrelid = 'public.leagues'::regclass
        and exists (
          select 1
          from unnest(con.conkey) key_attnum
          join pg_attribute att
            on att.attrelid = con.conrelid
           and att.attnum = key_attnum
          where att.attname = 'league_id'
        )
    loop
      execute format(
        'alter table public.%I drop constraint %I',
        target_table,
        constraint_record.conname
      );
    end loop;

    execute format(
      'alter table public.%I add constraint %I foreign key (league_id) references public.leagues(id) on delete cascade',
      target_table,
      target_table || '_league_id_fkey'
    );
  end loop;
end $$;

drop policy if exists "Commissioners can delete leagues"
  on public.leagues;

create policy "Commissioners can delete leagues"
  on public.leagues
  for delete
  using (
    commissioner_id = auth.uid()
    or exists (
      select 1
      from public.league_members lm
      where lm.league_id = leagues.id
        and lm.user_id = auth.uid()
        and lower(trim(lm.role)) in ('commissioner', 'commisioner')
    )
  );
