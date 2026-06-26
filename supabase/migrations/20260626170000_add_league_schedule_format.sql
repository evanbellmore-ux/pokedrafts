alter table public.leagues
  add column if not exists schedule_format text not null default 'round_robin';

alter table public.leagues
  drop constraint if exists leagues_schedule_format_check;

alter table public.leagues
  add constraint leagues_schedule_format_check
  check (schedule_format in ('round_robin', 'double_round_robin'));
