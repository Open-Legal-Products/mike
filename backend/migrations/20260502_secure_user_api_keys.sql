-- Migration date: 2026-05-02

-- Migration: move BYO provider API keys into encrypted, server-only storage.
-- The backend encrypts values before writing them. RLS is enabled with no
-- client policies so browser Supabase clients cannot read key material.

CREATE TABLE IF NOT EXISTS public.user_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('claude', 'gemini', 'openai', 'openrouter', 'courtlistener')),
  encrypted_key text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user
  ON public.user_api_keys(user_id);

ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;

-- Legacy plaintext columns remain temporarily so the backend can migrate
-- existing users on first use, then clear each migrated value.
