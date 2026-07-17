-- Migration date: 2026-06-29
--
-- Upstream feature sync: brings an existing fork database (created from the
-- 2026-05-21 baseline plus the fork's hardening migrations) up to the schema
-- in apps/api/schema.sql after merging upstream willchen96/mike (through
-- 93f921b): MFA, MCP connectors, CourtListener bulk indexes, model/quote/legal
-- preferences, document-version file metadata + soft delete, and the list
-- "overview" read-model functions.
--
-- Safe to re-run: every statement is guarded (IF NOT EXISTS / OR REPLACE /
-- DO-block existence checks). The overview functions are defined against the
-- fork's uuid user_id columns (upstream shipped them assuming text user_id).

-- ---------------------------------------------------------------------------
-- user_profiles: model + feature preferences
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column if not exists title_model text,
  add column if not exists quote_model text,
  add column if not exists mfa_on_login boolean not null default false,
  add column if not exists legal_research_us boolean not null default true;

-- ---------------------------------------------------------------------------
-- user_api_keys: allow the openrouter and courtlistener providers
-- ---------------------------------------------------------------------------

alter table public.user_api_keys
  drop constraint if exists user_api_keys_provider_check;
alter table public.user_api_keys
  add constraint user_api_keys_provider_check
  check (provider in ('claude', 'gemini', 'openai', 'openrouter', 'courtlistener'));

alter table public.user_api_keys enable row level security;

-- ---------------------------------------------------------------------------
-- MCP connectors
-- ---------------------------------------------------------------------------

create table if not exists public.user_mcp_connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  transport text not null default 'streamable_http'
    check (transport in ('streamable_http')),
  server_url text not null,
  auth_type text not null default 'none'
    check (auth_type in ('none', 'bearer', 'oauth')),
  enabled boolean not null default true,
  tool_policy jsonb not null default '{}'::jsonb,
  encrypted_auth_config text,
  auth_config_iv text,
  auth_config_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_mcp_connectors_user
  on public.user_mcp_connectors(user_id);

alter table public.user_mcp_connectors enable row level security;

create table if not exists public.user_mcp_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references public.user_mcp_connectors(id) on delete cascade,
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

alter table public.user_mcp_oauth_tokens enable row level security;

create table if not exists public.user_mcp_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_id uuid not null references public.user_mcp_connectors(id) on delete cascade,
  state_hash text not null unique,
  encrypted_state_config text not null,
  state_config_iv text not null,
  state_config_tag text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_mcp_oauth_states_expires
  on public.user_mcp_oauth_states(expires_at);

alter table public.user_mcp_oauth_states enable row level security;

create table if not exists public.user_mcp_connector_tools (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references public.user_mcp_connectors(id) on delete cascade,
  tool_name text not null,
  openai_tool_name text not null,
  title text,
  description text,
  input_schema jsonb not null default '{"type":"object","properties":{}}'::jsonb,
  output_schema jsonb,
  annotations jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  requires_confirmation boolean not null default false,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connector_id, tool_name),
  unique(openai_tool_name)
);

create index if not exists idx_user_mcp_connector_tools_connector
  on public.user_mcp_connector_tools(connector_id);

alter table public.user_mcp_connector_tools enable row level security;

create table if not exists public.user_mcp_tool_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connector_id uuid not null references public.user_mcp_connectors(id) on delete cascade,
  tool_id uuid references public.user_mcp_connector_tools(id) on delete set null,
  tool_name text not null,
  openai_tool_name text not null,
  status text not null check (status in ('ok', 'error')),
  error_message text,
  duration_ms integer not null default 0,
  result_size_chars integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_mcp_tool_audit_logs_user_created
  on public.user_mcp_tool_audit_logs(user_id, created_at desc);

alter table public.user_mcp_tool_audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- document_versions: file metadata + soft delete
-- (storage moved onto versions; display_name renamed to filename)
-- ---------------------------------------------------------------------------

alter table public.document_versions
  alter column storage_path drop not null;

alter table public.document_versions
  add column if not exists filename text,
  add column if not exists file_type text,
  add column if not exists size_bytes integer,
  add column if not exists page_count integer,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

-- Preserve any existing display_name values before dropping the column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_versions'
      and column_name = 'display_name'
  ) then
    update public.document_versions
      set filename = display_name
      where filename is null and display_name is not null;
    alter table public.document_versions drop column display_name;
  end if;
end;
$$;

create index if not exists document_versions_active_document_id_idx
  on public.document_versions(document_id, created_at desc)
  where deleted_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'document_versions_doc_version_unique'
      and conrelid = 'public.document_versions'::regclass
  ) then
    alter table public.document_versions
      add constraint document_versions_doc_version_unique
      unique (document_id, version_number);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- List "overview" read models
-- (defined against the fork's uuid user_id columns)
-- ---------------------------------------------------------------------------

create or replace function public.get_workflows_overview(
  p_user_id uuid,
  p_user_email text default null,
  p_type text default null
)
returns table (
  id uuid,
  user_id uuid,
  title text,
  type text,
  prompt_md text,
  columns_config jsonb,
  practice text,
  is_system boolean,
  created_at timestamptz,
  allow_edit boolean,
  is_owner boolean,
  shared_by_name text
)
language sql
stable
as $$
  with owned as (
    select
      w.*,
      true as allow_edit,
      true as is_owner,
      null::text as shared_by_name,
      0 as sort_bucket
    from public.workflows w
    where w.user_id = p_user_id
      and w.is_system = false
      and (p_type is null or w.type = p_type)
  ),
  shared as (
    select
      w.*,
      ws.allow_edit,
      false as is_owner,
      nullif(trim(up.display_name), '') as shared_by_name,
      1 as sort_bucket
    from public.workflow_shares ws
    join public.workflows w
      on w.id = ws.workflow_id
    left join public.user_profiles up
      on up.user_id = ws.shared_by_user_id
    where lower(ws.shared_with_email) = lower(coalesce(p_user_email, ''))
      and (p_type is null or w.type = p_type)
  ),
  visible_workflows as (
    select * from owned
    union all
    select * from shared
  )
  select
    vw.id,
    vw.user_id,
    vw.title,
    vw.type,
    vw.prompt_md,
    vw.columns_config,
    vw.practice,
    vw.is_system,
    vw.created_at,
    vw.allow_edit,
    vw.is_owner,
    vw.shared_by_name
  from visible_workflows vw
  order by vw.sort_bucket asc, vw.created_at desc;
$$;

create or replace function public.get_chats_overview(
  p_user_id uuid,
  p_limit integer default null
)
returns table (
  id uuid,
  project_id uuid,
  user_id uuid,
  title text,
  created_at timestamptz
)
language sql
stable
as $$
  select
    c.id,
    c.project_id,
    c.user_id,
    c.title,
    c.created_at
  from public.chats c
  where c.user_id = p_user_id
     or exists (
      select 1
      from public.projects p
      where p.id = c.project_id
        and p.user_id = p_user_id
    )
  order by c.created_at desc
  limit case
    when p_limit is null then null
    else greatest(1, least(p_limit, 100))
  end;
$$;

create or replace function public.get_projects_overview(
  p_user_id uuid,
  p_user_email text default null
)
returns table (
  id uuid,
  user_id uuid,
  name text,
  cm_number text,
  shared_with jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  is_owner boolean,
  owner_display_name text,
  owner_email text,
  document_count integer,
  chat_count integer,
  review_count integer
)
language sql
stable
as $$
  with visible_projects as (
    select p.*
    from public.projects p
    where p.user_id = p_user_id
       or (
        coalesce(p_user_email, '') <> ''
        and p.user_id <> p_user_id
        and p.shared_with @> jsonb_build_array(lower(p_user_email))
      )
  ),
  document_counts as (
    select d.project_id, count(*)::integer as document_count
    from public.documents d
    where d.project_id in (select vp.id from visible_projects vp)
    group by d.project_id
  ),
  chat_counts as (
    select c.project_id, count(*)::integer as chat_count
    from public.chats c
    where c.project_id in (select vp.id from visible_projects vp)
    group by c.project_id
  ),
  review_counts as (
    select tr.project_id, count(*)::integer as review_count
    from public.tabular_reviews tr
    where tr.project_id in (select vp.id from visible_projects vp)
    group by tr.project_id
  )
  select
    vp.id,
    vp.user_id,
    vp.name,
    vp.cm_number,
    vp.shared_with,
    vp.created_at,
    vp.updated_at,
    vp.user_id = p_user_id as is_owner,
    nullif(trim(up.display_name), '') as owner_display_name,
    null::text as owner_email,
    coalesce(dc.document_count, 0) as document_count,
    coalesce(cc.chat_count, 0) as chat_count,
    coalesce(rc.review_count, 0) as review_count
  from visible_projects vp
  left join public.user_profiles up
    on up.user_id = vp.user_id
  left join document_counts dc
    on dc.project_id = vp.id
  left join chat_counts cc
    on cc.project_id = vp.id
  left join review_counts rc
    on rc.project_id = vp.id
  order by vp.created_at desc;
$$;

create or replace function public.get_tabular_reviews_overview(
  p_user_id uuid,
  p_user_email text default null,
  p_project_id text default null
)
returns table (
  id uuid,
  project_id uuid,
  user_id uuid,
  title text,
  columns_config jsonb,
  document_ids jsonb,
  workflow_id uuid,
  shared_with jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  is_owner boolean,
  document_count integer
)
language sql
stable
as $$
  with accessible_projects as (
    select p.id
    from public.projects p
    where p.user_id = p_user_id
       or (
        coalesce(p_user_email, '') <> ''
        and p.user_id <> p_user_id
        and p.shared_with @> jsonb_build_array(lower(p_user_email))
      )
  ),
  visible_reviews as (
    select tr.*
    from public.tabular_reviews tr
    where (p_project_id is null or tr.project_id::text = p_project_id)
      and (
        p_project_id is null
        or exists (
          select 1
          from accessible_projects ap
          where ap.id::text = p_project_id
        )
      )
      and (
        tr.user_id = p_user_id
        or (
          tr.project_id in (select ap.id from accessible_projects ap)
          and tr.user_id <> p_user_id
        )
        or (
          p_project_id is null
          and coalesce(p_user_email, '') <> ''
          and tr.user_id <> p_user_id
          and tr.shared_with @> jsonb_build_array(lower(p_user_email))
        )
      )
  ),
  cell_document_counts as (
    select
      tc.review_id,
      count(distinct tc.document_id)::integer as document_count
    from public.tabular_cells tc
    where tc.review_id in (select vr.id from visible_reviews vr)
    group by tc.review_id
  )
  select
    vr.id,
    vr.project_id,
    vr.user_id,
    vr.title,
    vr.columns_config,
    vr.document_ids,
    vr.workflow_id,
    vr.shared_with,
    vr.created_at,
    vr.updated_at,
    vr.user_id = p_user_id as is_owner,
    case
      when jsonb_typeof(vr.document_ids) = 'array'
        then (
          select count(distinct doc_id.value)::integer
          from jsonb_array_elements_text(vr.document_ids) as doc_id(value)
        )
      else coalesce(cdc.document_count, 0)
    end as document_count
  from visible_reviews vr
  left join cell_document_counts cdc
    on cdc.review_id = vr.id
  order by vr.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- CourtListener bulk-data indexes
-- ---------------------------------------------------------------------------

create table if not exists public.courtlistener_citation_index (
  id bigint primary key,
  volume text not null,
  reporter text not null,
  page text not null,
  type integer,
  cluster_id bigint not null,
  date_created timestamptz,
  date_modified timestamptz
);

create index if not exists courtlistener_citation_lookup_idx
  on public.courtlistener_citation_index(volume, reporter, page);

create index if not exists courtlistener_citation_cluster_idx
  on public.courtlistener_citation_index(cluster_id);

alter table public.courtlistener_citation_index enable row level security;

create table if not exists public.courtlistener_opinion_cluster_index (
  id bigint primary key,
  case_name text,
  case_name_short text,
  case_name_full text,
  slug text,
  date_filed date,
  citation_count integer,
  precedential_status text,
  filepath_pdf_harvard text,
  filepath_json_harvard text,
  docket_id bigint
);

alter table public.courtlistener_opinion_cluster_index enable row level security;

-- ---------------------------------------------------------------------------
-- Direct client grant hardening for the new tables
-- ---------------------------------------------------------------------------

revoke all on public.user_mcp_connectors from anon, authenticated;
revoke all on public.user_mcp_oauth_tokens from anon, authenticated;
revoke all on public.user_mcp_oauth_states from anon, authenticated;
revoke all on public.user_mcp_connector_tools from anon, authenticated;
revoke all on public.user_mcp_tool_audit_logs from anon, authenticated;
revoke all on public.courtlistener_citation_index from anon, authenticated;
revoke all on public.courtlistener_opinion_cluster_index from anon, authenticated;
