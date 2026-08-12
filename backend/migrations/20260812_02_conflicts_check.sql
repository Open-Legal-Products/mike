-- Restricted conflicts-check records and review history.
--
-- These tables are deliberately backend-only. The service-role API scopes
-- every query by owner_user_id; browser roles have no direct privileges and
-- RLS has no permissive policies as a second line of defence.
create table if not exists public.conflict_records (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  client_name text not null,
  matter_name text,
  parties jsonb not null default '[]'::jsonb check (jsonb_typeof(parties) = 'array'),
  affiliates jsonb not null default '[]'::jsonb check (jsonb_typeof(affiliates) = 'array'),
  search_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conflict_records_owner_created
  on public.conflict_records (owner_user_id, created_at desc);

create table if not exists public.conflict_searches (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  search_input jsonb not null check (jsonb_typeof(search_input) = 'object'),
  matched_record_ids uuid[] not null default '{}',
  result_count integer not null default 0 check (result_count >= 0),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'cleared', 'conflict_found')),
  reviewer_notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conflict_searches_owner_created
  on public.conflict_searches (owner_user_id, created_at desc);

create table if not exists public.conflict_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  actor_user_id uuid not null,
  action text not null check (action in ('record.created', 'search.performed', 'review.decided')),
  record_id uuid,
  search_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists conflict_audit_owner_created
  on public.conflict_audit_events (owner_user_id, created_at desc);

revoke all on public.conflict_records from anon, authenticated;
revoke all on public.conflict_searches from anon, authenticated;
revoke all on public.conflict_audit_events from anon, authenticated;
alter table public.conflict_records enable row level security;
alter table public.conflict_searches enable row level security;
alter table public.conflict_audit_events enable row level security;
grant select, insert, update, delete on public.conflict_records to service_role;
grant select, insert, update, delete on public.conflict_searches to service_role;
grant select, insert, update, delete on public.conflict_audit_events to service_role;
