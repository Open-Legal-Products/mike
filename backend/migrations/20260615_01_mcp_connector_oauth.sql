-- Migration date: 2026-06-15
-- Adds OAuth metadata/state needed for HTTP MCP connectors that authorize via
-- OAuth 2.x instead of pasted bearer tokens.

ALTER TABLE public.user_mcp_connectors
  ADD COLUMN IF NOT EXISTS auth_type text NOT NULL DEFAULT 'none'
    CHECK (auth_type IN ('none', 'bearer', 'oauth'));

UPDATE public.user_mcp_connectors
SET auth_type = CASE
  WHEN encrypted_auth_config IS NOT NULL THEN 'bearer'
  ELSE 'none'
END
WHERE auth_type IS NULL OR auth_type = 'none';

ALTER TABLE public.user_mcp_oauth_tokens
  ADD COLUMN IF NOT EXISTS authorization_server text,
  ADD COLUMN IF NOT EXISTS token_endpoint text,
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS encrypted_client_secret text,
  ADD COLUMN IF NOT EXISTS client_secret_iv text,
  ADD COLUMN IF NOT EXISTS client_secret_tag text,
  ADD COLUMN IF NOT EXISTS resource text;

CREATE TABLE IF NOT EXISTS public.user_mcp_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES public.user_mcp_connectors(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE,
  encrypted_state_config text NOT NULL,
  state_config_iv text NOT NULL,
  state_config_tag text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_mcp_oauth_states_expires
  ON public.user_mcp_oauth_states(expires_at);

ALTER TABLE public.user_mcp_oauth_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_mcp_oauth_states FROM anon, authenticated;
