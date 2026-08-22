-- Per-user appearance preference. Existing and new accounts remain in light
-- mode until the user explicitly enables Dark Mode.
alter table public.user_profiles
  add column if not exists dark_mode boolean not null default false;
