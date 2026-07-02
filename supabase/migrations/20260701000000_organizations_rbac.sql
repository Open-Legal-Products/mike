-- Migration date: 2026-07-01
--
-- Feature R2 — Multi-tenant organizations + RBAC (schema).
--
-- The app has been per-user since the baseline: every data table carries a
-- `user_id` FK to auth.users and access is "row owner OR email in shared_with".
-- This migration introduces the tenant layer WITHOUT disturbing that anchor:
--
--   organizations  — a tenant. `personal = true` marks the one-per-user org
--                    every account gets automatically (so single-user usage is
--                    unchanged — content simply lands in the caller's personal
--                    org).
--   org_members    — (org_id, user_id, role) with role in owner/admin/member.
--                    This is the RBAC edge. `owner`/`admin` can manage the org
--                    and its members; `member` can read/create content.
--   teams / team_members — an intra-org grouping. Teams are a structural
--                    grouping today (membership + naming); finer team-scoped
--                    permissions are a deliberate future extension point.
--
-- `org_id` is added to projects/documents/workflows/tabular_reviews as a
-- NULLABLE FK with ON DELETE SET NULL. Nullable because:
--   * system workflows have a null user_id and must stay valid;
--   * `user_id` remains the hard ON DELETE CASCADE anchor, so account deletion
--     still works exactly as before — dropping an org must never orphan-delete
--     a user's rows, hence SET NULL rather than CASCADE here.
-- The backfill migration (20260701000001) populates org_id for existing rows.
--
-- RLS: every new table gets `enable row level security` + an explicit revoke of
-- anon/authenticated. The deny-all fallback policy from 20260524000000 only ran
-- over tables that existed then, so new tables MUST re-establish default-deny
-- themselves. The API runs as service_role (BYPASSRLS + the schema-wide grants
-- in 20260629000001), so it is unaffected; direct client roles get nothing.
--
-- SSO / SAML / SCIM: intentionally NOT implemented here. `organizations` is
-- shaped to grow future `sso_config` / `scim_token` columns and a future
-- `org_invitations` table; `org_members.role` is a text CHECK that can gain
-- roles without a table rewrite. Those are the documented extension points.
--
-- Does NOT edit any existing migration.

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- personal = the auto-provisioned one-per-user org. Enforced unique per user
  -- by idx_organizations_personal_owner below.
  personal boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  -- EXTENSION POINT (SSO/SCIM): future migrations may add e.g.
  --   sso_config jsonb, scim_token text, domain text
  -- here without touching app-layer authz.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One personal org per user. Partial unique so non-personal (shared) orgs a
-- user creates are unconstrained.
create unique index if not exists idx_organizations_personal_owner
  on public.organizations(created_by)
  where personal;

alter table public.organizations enable row level security;

-- ---------------------------------------------------------------------------
-- org_members — the RBAC edge
-- ---------------------------------------------------------------------------

create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- EXTENSION POINT (RBAC): additional roles (e.g. 'billing', 'viewer') can be
  -- added to this CHECK; app-layer helpers in access.ts gate on the value.
  role text not null default 'member'
    check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, user_id)
);

create index if not exists idx_org_members_user on public.org_members(user_id);
create index if not exists idx_org_members_org on public.org_members(org_id);

alter table public.org_members enable row level security;

-- ---------------------------------------------------------------------------
-- teams / team_members
-- ---------------------------------------------------------------------------

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, name)
);

create index if not exists idx_teams_org on public.teams(org_id);

alter table public.teams enable row level security;

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(team_id, user_id)
);

create index if not exists idx_team_members_user on public.team_members(user_id);
create index if not exists idx_team_members_team on public.team_members(team_id);

alter table public.team_members enable row level security;

-- ---------------------------------------------------------------------------
-- org_id on the four content tables (nullable + FK + index)
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.documents
  add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.workflows
  add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.tabular_reviews
  add column if not exists org_id uuid references public.organizations(id) on delete set null;

create index if not exists idx_projects_org on public.projects(org_id);
create index if not exists idx_documents_org on public.documents(org_id);
create index if not exists idx_workflows_org on public.workflows(org_id);
create index if not exists idx_tabular_reviews_org on public.tabular_reviews(org_id);

-- ---------------------------------------------------------------------------
-- handle_new_user: also provision a personal org + owner membership
-- ---------------------------------------------------------------------------
-- Extends the baseline trigger. Still swallows errors (returns new) so a failed
-- org insert never blocks signup — the backfill migration is idempotent and
-- will repair any user left without a personal org.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  insert into public.user_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  -- Personal organization (one per user, enforced by the partial unique index).
  if not exists (
    select 1 from public.organizations
    where created_by = new.id and personal
  ) then
    insert into public.organizations (name, personal, created_by)
    values (coalesce(new.email, 'Personal'), true, new.id)
    returning id into v_org_id;

    insert into public.org_members (org_id, user_id, role)
    values (v_org_id, new.id, 'owner')
    on conflict (org_id, user_id) do nothing;
  end if;

  return new;
exception when others then
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Direct client grant hardening for the new tables
-- ---------------------------------------------------------------------------

revoke all on public.organizations from anon, authenticated;
revoke all on public.org_members from anon, authenticated;
revoke all on public.teams from anon, authenticated;
revoke all on public.team_members from anon, authenticated;
