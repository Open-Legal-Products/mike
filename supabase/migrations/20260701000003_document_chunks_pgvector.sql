-- Migration date: 2026-07-01
--
-- Feature R1 — RAG / semantic retrieval (pgvector-backed document chunks).
--
-- Stores the token-aware chunks + embeddings produced by the async embedding
-- worker (see apps/api/src/lib/rag/ingest.ts) so the `search_documents` chat
-- tool can run top-k cosine search over a user's / org's documents.
--
-- Access model — identical to every other content table:
--   * RLS is ENABLED with NO policy (default-deny). The deny-all fallback from
--     20260524000000 only covered tables that existed then, so a new table must
--     re-establish default-deny itself.
--   * anon/authenticated are revoked outright; the API runs as service_role
--     (BYPASSRLS + the schema-wide grants in 20260629000001) and enforces authz
--     in the app layer — the search RPC below is only ever handed the set of
--     document_ids the caller already has access to (scoped from the chat's
--     doc index), never the whole table.
--   * user_id is the ON DELETE CASCADE anchor (account deletion drops chunks).
--   * org_id mirrors documents.org_id (R2 multi-tenancy): nullable FK with
--     ON DELETE SET NULL, so dropping an org never orphan-deletes a user's rows.
--     The ingestion job copies org_id off the parent document so org members can
--     search shared documents, matching filterAccessibleDocumentIds().
--
-- Embedding dimension: pinned to 768 to match the default EMBEDDING_DIMENSION.
-- Every built-in adapter is configured to emit 768-dim vectors (Gemini
-- text-embedding-004 and Ollama nomic-embed-text are natively 768; OpenAI
-- text-embedding-3-* are asked for `dimensions: 768`). A single vector(N) column
-- has ONE fixed N and the HNSW index depends on it, so mixing models of
-- different native widths is unsafe — embedding_model is stored per row and the
-- search RPC filters on it so a model change is a hard boundary (re-embed via
-- scripts/backfillEmbeddings.ts). Changing the width requires a new migration.
--
-- Does NOT edit any existing migration.

create extension if not exists vector;

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version_id uuid not null references public.document_versions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Mirrors documents.org_id (nullable; SET NULL) so org members can search
  -- shared documents. Stamped from the parent document at ingest time.
  org_id uuid references public.organizations(id) on delete set null,
  chunk_index int not null,
  content text not null,
  -- 1-based page number parsed from the "## Page N" markers extractPdfMarkdown
  -- emits, so citations can carry {page, quote}. Null for DOCX (no pages).
  page int,
  token_count int,
  -- The embedding model that produced this row's vector. The search RPC filters
  -- on it so vectors of different models/dimensions are never mixed in one query.
  embedding_model text not null,
  embedding vector(768) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- One row per (version, chunk): the ingestion job deletes-by-version then
  -- re-inserts, so a retry can't create duplicates.
  unique (version_id, chunk_index)
);

-- Approximate-nearest-neighbour index for the cosine top-k search. HNSW builds
-- fine on an empty table and stays correct as rows are added.
create index if not exists idx_document_chunks_embedding
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists idx_document_chunks_document on public.document_chunks(document_id);
create index if not exists idx_document_chunks_version on public.document_chunks(version_id);
create index if not exists idx_document_chunks_user on public.document_chunks(user_id);
create index if not exists idx_document_chunks_org on public.document_chunks(org_id);

alter table public.document_chunks enable row level security;

-- Explicit service_role DML grant for parity with 20260629000001 (the default
-- privileges already cover it; this documents the intent at the table).
grant select, insert, update, delete on public.document_chunks to service_role;
revoke all on public.document_chunks from anon, authenticated;

-- ---------------------------------------------------------------------------
-- match_document_chunks — top-k cosine search
-- ---------------------------------------------------------------------------
-- Called by the search_documents tool as service_role. Authz is enforced by the
-- caller: p_document_ids is the pre-scoped set of documents the user can access
-- (built from the chat's doc index), so this function never reaches beyond it.
-- Filters on embedding_model so a model change can't return dimension-mismatched
-- rows. Ordered by cosine distance (<=> is pgvector's cosine operator).

create or replace function public.match_document_chunks(
  p_query_embedding vector,
  p_document_ids uuid[],
  p_model text,
  p_match_count int
)
returns table (
  document_id uuid,
  version_id uuid,
  chunk_index int,
  content text,
  page int,
  distance double precision
)
language sql
stable
as $$
  select
    c.document_id,
    c.version_id,
    c.chunk_index,
    c.content,
    c.page,
    (c.embedding <=> p_query_embedding)::double precision as distance
  from public.document_chunks c
  where c.document_id = any (p_document_ids)
    and c.embedding_model = p_model
  order by c.embedding <=> p_query_embedding
  limit greatest(1, p_match_count);
$$;
