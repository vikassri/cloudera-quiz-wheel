-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)

create table if not exists public.game_results (
  id bigint generated always as identity primary key,
  name text not null,
  mobile text not null,
  company text not null,
  topic text not null default 'Not recorded',
  topic_label text not null default 'Not recorded',
  topic_id text,
  score integer not null default 0 check (score >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  answered_count integer not null default 0 check (answered_count >= 0),
  completed_at bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists game_results_completed_at_idx
  on public.game_results (completed_at desc);

create index if not exists game_results_score_idx
  on public.game_results (score desc);

create table if not exists public.app_metadata (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_metadata (key, value)
values
  ('leaderboard', '{"entries":[]}'::jsonb),
  ('recent_player_ids', '{"entries":[]}'::jsonb)
on conflict (key) do nothing;

-- Optional: lock down direct client access (server uses service role key)
alter table public.game_results enable row level security;
alter table public.app_metadata enable row level security;
