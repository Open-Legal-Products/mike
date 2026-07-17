-- ROSS-130: controlled-beta acknowledgement and metadata-only security audit.

alter table public.user_profiles
  add column if not exists beta_data_boundary_version text,
  add column if not exists beta_data_boundary_acknowledged_at timestamptz;

create table if not exists public.security_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  constraint security_audit_event_type_format
    check (event_type ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  constraint security_audit_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists security_audit_events_actor_time_idx
  on public.security_audit_events (actor_user_id, occurred_at desc);
create index if not exists security_audit_events_type_time_idx
  on public.security_audit_events (event_type, occurred_at desc);

alter table public.security_audit_events enable row level security;
revoke all on table public.security_audit_events from anon, authenticated;

-- Audit events are service-role-only and contain metadata, never prompt or
-- document bodies, credentials, signed URLs, or access tokens.
