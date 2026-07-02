-- Migration date: 2026-07-01
--
-- R3 — Native DMS connectors (iManage / NetDocuments).
--
-- Per-user connector rows with encrypted OAuth credentials, mirroring the MCP
-- connector tables (20260629000000_upstream_feature_sync.sql) column-for-column
-- so the exact AES-256-GCM + per-row HKDF (`v2.`-packed) crypto and the
-- auth-code + refresh OAuth flow apply unchanged.
--
-- Security posture (identical to the MCP tables):
--   * RLS ENABLED on every table. The schema-wide deny-all
--     (20260524000000_rls_deny_all.sql) already ran, so a table created now
--     with RLS on and NO policy is default-deny for anon/authenticated.
--   * REVOKE ALL ... FROM anon, authenticated below removes table-level grants
--     too (BYPASSRLS on service_role skips policies, not GRANTs).
--   * service_role DML is auto-granted by the ALTER DEFAULT PRIVILEGES in
--     20260629000001_service_role_grants.sql, so the API (service_role) keeps
--     working while direct client roles are locked out.
--
-- Safe to re-run: every statement is guarded.

-- ---------------------------------------------------------------------------
-- dms_connectors
-- ---------------------------------------------------------------------------

create table if not exists public.dms_connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null
    check (kind in ('imanage', 'netdocuments', 'fake')),
  name text not null,
  base_url text not null,
  auth_type text not null default 'oauth'
    check (auth_type in ('oauth')),
  enabled boolean not null default true,
  encrypted_auth_config text,
  auth_config_iv text,
  auth_config_tag text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dms_connectors_user
  on public.dms_connectors(user_id);

alter table public.dms_connectors enable row level security;

-- ---------------------------------------------------------------------------
-- dms_connector_oauth_tokens (mirrors user_mcp_oauth_tokens)
-- ---------------------------------------------------------------------------

create table if not exists public.dms_connector_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references public.dms_connectors(id) on delete cascade,
  encrypted_access_token text,
  access_token_iv text,
  access_token_tag text,
  encrypted_refresh_token text,
  refresh_token_iv text,
  refresh_token_tag text,
  token_type text,
  scope text,
  expires_at timestamptz,
  authorization_server text,
  token_endpoint text,
  client_id text,
  encrypted_client_secret text,
  client_secret_iv text,
  client_secret_tag text,
  resource text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connector_id)
);

alter table public.dms_connector_oauth_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- dms_connector_oauth_states (mirrors user_mcp_oauth_states)
-- ---------------------------------------------------------------------------

create table if not exists public.dms_connector_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_id uuid not null references public.dms_connectors(id) on delete cascade,
  state_hash text not null unique,
  encrypted_state_config text not null,
  state_config_iv text not null,
  state_config_tag text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_dms_connector_oauth_states_expires
  on public.dms_connector_oauth_states(expires_at);

alter table public.dms_connector_oauth_states enable row level security;

-- ---------------------------------------------------------------------------
-- dms_document_links — round-trip mapping (document_id <-> external doc/version)
-- so exportDocument can push a Mike document back to the right DMS document.
-- ---------------------------------------------------------------------------

create table if not exists public.dms_document_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  connector_id uuid not null references public.dms_connectors(id) on delete cascade,
  dms_doc_id text not null,
  dms_version text,
  created_at timestamptz not null default now(),
  unique(document_id)
);

create index if not exists idx_dms_document_links_connector
  on public.dms_document_links(connector_id);

alter table public.dms_document_links enable row level security;

-- ---------------------------------------------------------------------------
-- Allow 'dms_import' as a document_versions.source (imported docs are
-- distinguishable from interactive uploads). Re-add the check with the extra
-- value; the constraint is additive, no existing rows are affected.
-- ---------------------------------------------------------------------------

alter table public.document_versions
  drop constraint if exists document_versions_source_check;
alter table public.document_versions
  add constraint document_versions_source_check
  check (source = any (array[
    'upload'::text,
    'user_upload'::text,
    'assistant_edit'::text,
    'user_accept'::text,
    'user_reject'::text,
    'generated'::text,
    'dms_import'::text
  ]));

-- ---------------------------------------------------------------------------
-- Direct client grant hardening for the new tables
-- ---------------------------------------------------------------------------

revoke all on public.dms_connectors from anon, authenticated;
revoke all on public.dms_connector_oauth_tokens from anon, authenticated;
revoke all on public.dms_connector_oauth_states from anon, authenticated;
revoke all on public.dms_document_links from anon, authenticated;
