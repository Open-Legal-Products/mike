-- Migration date: 2026-05-08

-- Migration: move user_profiles behind the backend API.
-- The frontend should use Supabase only for auth; profile reads and writes go
-- through /user/profile so internal fields cannot be mutated from the browser.

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile"
  ON public.user_profiles;

DROP POLICY IF EXISTS "Users can update their own profile"
  ON public.user_profiles;

REVOKE ALL PRIVILEGES ON TABLE public.user_profiles
  FROM anon, authenticated;
