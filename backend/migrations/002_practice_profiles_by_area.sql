-- Per-practice-area practice profiles.
--
-- Complements user_profiles.practice_profile (the general, always-injected
-- profile) with an area-keyed map, e.g.
--   { "Litigation": "...", "Commercial Contracts": "..." }
-- The profile for the active workflow's practice area is injected alongside the
-- general one, mirroring claude-for-legal's per-plugin CLAUDE.md files.
alter table public.user_profiles
  add column if not exists practice_profiles jsonb not null default '{}'::jsonb;
