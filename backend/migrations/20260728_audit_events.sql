-- Audit history of user actions, queried via the service-role backend only.
-- Like every other backend-owned table (see 20260508_01), the browser
-- anon/authenticated roles are revoked and RLS is enabled with no policies as
-- defense in depth. Without this, a hosted Supabase project's default ACLs
-- leave the whole table readable and writable with the public anon key — any
-- visitor could dump every user's email, chat titles and prompt excerpts, or
-- forge/delete audit rows.
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null,
  user_email text,
  action text not null,          -- chat.message | document.uploaded | document.generated | document.edited | workflow.applied | tabular.created | tabular.generated | export.chats | export.account | export.tabular
  status text not null default 'completed',  -- completed | cancelled | failed
  title text,
  surface text,                  -- assistant | project | tabular | workflows | account
  project_id uuid,
  chat_id uuid,
  document_id uuid,
  review_id uuid,
  model text,
  detail jsonb
);
create index if not exists audit_events_user_created on public.audit_events (user_id, created_at desc);
create index if not exists audit_events_project_created on public.audit_events (project_id, created_at desc);

-- Backend-only access: revoke the browser roles, enable RLS (no policies), and
-- grant the service_role the privileges the backend needs. The explicit grant
-- keeps a fresh plain-Postgres apply working even where service_role has no
-- default ACL for new tables.
revoke all on public.audit_events from anon, authenticated;
alter table public.audit_events enable row level security;
grant select, insert, update, delete on public.audit_events to service_role;
