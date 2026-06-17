-- Server-side MCP client connector storage.
-- Auth material is encrypted by the backend before insert. RLS is enabled with
-- no browser policies so only the service-role backend can read connector
-- URLs, encrypted auth config, token material, tool cache, and audit logs.

CREATE TABLE IF NOT EXISTS public.user_mcp_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  transport text NOT NULL DEFAULT 'streamable_http'
    CHECK (transport IN ('streamable_http')),
  server_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  tool_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  encrypted_auth_config text,
  auth_config_iv text,
  auth_config_tag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_mcp_connectors_user
  ON public.user_mcp_connectors(user_id);

ALTER TABLE public.user_mcp_connectors ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_mcp_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.user_mcp_connectors(id) ON DELETE CASCADE,
  encrypted_access_token text,
  access_token_iv text,
  access_token_tag text,
  encrypted_refresh_token text,
  refresh_token_iv text,
  refresh_token_tag text,
  token_type text,
  scope text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connector_id)
);

ALTER TABLE public.user_mcp_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_mcp_connector_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid NOT NULL REFERENCES public.user_mcp_connectors(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  openai_tool_name text NOT NULL,
  title text,
  description text,
  input_schema jsonb NOT NULL DEFAULT '{"type":"object","properties":{}}'::jsonb,
  output_schema jsonb,
  annotations jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  requires_confirmation boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connector_id, tool_name),
  UNIQUE(openai_tool_name)
);

CREATE INDEX IF NOT EXISTS idx_user_mcp_connector_tools_connector
  ON public.user_mcp_connector_tools(connector_id);

ALTER TABLE public.user_mcp_connector_tools ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_mcp_tool_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES public.user_mcp_connectors(id) ON DELETE CASCADE,
  tool_id uuid REFERENCES public.user_mcp_connector_tools(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  openai_tool_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  error_message text,
  duration_ms integer NOT NULL DEFAULT 0,
  result_size_chars integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_mcp_tool_audit_logs_user_created
  ON public.user_mcp_tool_audit_logs(user_id, created_at DESC);

ALTER TABLE public.user_mcp_tool_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_mcp_connectors FROM anon, authenticated;
REVOKE ALL ON public.user_mcp_oauth_tokens FROM anon, authenticated;
REVOKE ALL ON public.user_mcp_connector_tools FROM anon, authenticated;
REVOKE ALL ON public.user_mcp_tool_audit_logs FROM anon, authenticated;
