-- Per-user committee definitions managed from Account > Model Preferences.
alter table public.user_profiles
  add column if not exists model_committees jsonb not null default '[]'::jsonb;
