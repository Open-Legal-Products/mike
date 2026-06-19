-- Migration date: 2026-06-19

-- Adds the Matter OS knowledge base used by project workspaces and
-- project-chat knowledge tools. Rows with project_id null are personal
-- library entries; rows with project_id set are matter-scoped entries.

create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project_id uuid references public.projects(id) on delete cascade,
  library_origin_id uuid references public.knowledge_entries(id) on delete set null,
  entry_type text not null check (entry_type in (
    'fact',
    'party',
    'date',
    'clause',
    'position',
    'playbook',
    'source'
  )),
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  include_in_agent_context boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_entries_user_library_idx
  on public.knowledge_entries(user_id, updated_at desc)
  where project_id is null and status = 'active';

create index if not exists knowledge_entries_project_idx
  on public.knowledge_entries(project_id, updated_at desc)
  where project_id is not null and status = 'active';

create index if not exists knowledge_entries_library_origin_idx
  on public.knowledge_entries(library_origin_id);

alter table public.knowledge_entries enable row level security;

revoke all on public.knowledge_entries from anon, authenticated;
