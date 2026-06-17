-- Migration date: 2026-06-06

-- OSS migration for the current backend/schema.sql diff.
--
-- This brings existing OSS Supabase databases in line with the updated fresh
-- schema: model preference columns, BYO provider expansion, per-version
-- document metadata, and CourtListener bulk lookup tables.

-- ---------------------------------------------------------------------------
-- User profiles
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column if not exists title_model text,
  add column if not exists mfa_on_login boolean not null default false,
  add column if not exists quote_model text;

-- ---------------------------------------------------------------------------
-- User API keys
-- ---------------------------------------------------------------------------

alter table public.user_api_keys
  drop constraint if exists user_api_keys_provider_check;

alter table public.user_api_keys
  add constraint user_api_keys_provider_check
  check (provider in ('claude', 'gemini', 'openai', 'openrouter', 'courtlistener'));

alter table public.user_api_keys enable row level security;

drop policy if exists user_api_keys_own on public.user_api_keys;

-- ---------------------------------------------------------------------------
-- Document metadata now lives on document_versions
-- ---------------------------------------------------------------------------

alter table public.document_versions
  add column if not exists filename text,
  add column if not exists file_type text,
  add column if not exists size_bytes integer,
  add column if not exists page_count integer;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_versions'
      and column_name = 'display_name'
  ) then
    update public.document_versions dv
    set filename = dv.display_name
    where (dv.filename is null or btrim(dv.filename) = '')
      and dv.display_name is not null
      and btrim(dv.display_name) <> '';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'filename'
  ) then
    update public.document_versions dv
    set filename = d.filename
    from public.documents d
    where dv.document_id = d.id
      and (dv.filename is null or btrim(dv.filename) = '')
      and d.filename is not null
      and btrim(d.filename) <> '';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'file_type'
  ) then
    update public.document_versions dv
    set file_type = coalesce(nullif(btrim(dv.file_type), ''), d.file_type)
    from public.documents d
    where dv.document_id = d.id
      and (dv.file_type is null or btrim(dv.file_type) = '');
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'size_bytes'
  ) then
    update public.document_versions dv
    set size_bytes = d.size_bytes
    from public.documents d
    where dv.document_id = d.id
      and dv.size_bytes is null
      and d.size_bytes is not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'page_count'
  ) then
    update public.document_versions dv
    set page_count = d.page_count
    from public.documents d
    where dv.document_id = d.id
      and dv.page_count is null
      and d.page_count is not null;
  end if;
end $$;

alter table public.document_versions
  drop column if exists display_name;

alter table public.documents
  drop column if exists filename,
  drop column if exists file_type,
  drop column if exists size_bytes,
  drop column if exists page_count,
  drop column if exists structure_tree;

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

drop policy if exists cl_citation_read on public.courtlistener_citation_index;

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

drop policy if exists cl_cluster_read on public.courtlistener_opinion_cluster_index;

revoke all on public.courtlistener_citation_index from anon, authenticated;
revoke all on public.courtlistener_opinion_cluster_index from anon, authenticated;
