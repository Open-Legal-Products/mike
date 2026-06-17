-- Migration date: 2026-06-10

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS mfa_on_login boolean NOT NULL DEFAULT false;
