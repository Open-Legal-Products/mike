-- Migration date: 2026-05-28

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS title_model text,
  ADD COLUMN IF NOT EXISTS quote_model text;
