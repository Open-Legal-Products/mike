-- Upstream sync (a5fe6d6 "Sync workflow, asst extra input, excel + ppt support
-- and modal updates"): ports upstream's backend/migrations
-- 20260613_05 (get_workflows_overview update), 20260625_01 (workflow
-- metadata), 20260629_01 (open-source submission queue) plus the schema.sql
-- deltas that back this release (user_profiles.email mirror,
-- projects.practice, chat_messages.citations) onto the fork's uuid/org-aware
-- definitions from 20260701000002_org_overview_rpcs.sql.

-- ---------------------------------------------------------------------------
-- 1. user_profiles.email mirror (sharing checks stop scanning auth.users)
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column if not exists email text;

create unique index if not exists user_profiles_email_lower_unique
  on public.user_profiles (lower(email))
  where email is not null and btrim(email) <> '';

create index if not exists idx_user_profiles_email
  on public.user_profiles(email);

-- Backfill emails for existing users from auth.users.
update public.user_profiles up
set email = lower(u.email)
from auth.users u
where u.id = up.user_id
  and u.email is not null
  and (up.email is null or btrim(up.email) = '');

-- Keep the fork's personal-org provisioning while adopting upstream's email
-- mirroring on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  insert into public.user_profiles (user_id, email)
  values (new.id, lower(new.email))
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();

  -- Multi-tenant RBAC: provision a personal organization + owner membership so
  -- new content has a tenant to land in (one personal org per user, enforced by
  -- idx_organizations_personal_owner).
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
  -- Never block signup if the profile / org insert fails.
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. projects.practice + overview RPC exposure
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists practice text;

drop function if exists public.get_projects_overview(uuid, text);

create or replace function public.get_projects_overview(
  p_user_id uuid,
  p_user_email text default null
)
returns table (
  id uuid,
  user_id uuid,
  name text,
  cm_number text,
  practice text,
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
       or (
        p.org_id is not null
        and p.user_id <> p_user_id
        and exists (
          select 1 from public.org_members m
          where m.org_id = p.org_id and m.user_id = p_user_id
        )
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
    vp.practice,
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

-- ---------------------------------------------------------------------------
-- 3. chat_messages: annotations -> citations rename (guarded)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_messages'
      and column_name = 'annotations'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_messages'
      and column_name = 'citations'
  ) then
    alter table public.chat_messages
      rename column annotations to citations;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Workflow metadata (language / jurisdictions) — system workflows are now
--    generated from repository metadata and no longer stored as rows, so
--    is_system is dropped along with the legacy author/category columns.
-- ---------------------------------------------------------------------------

drop function if exists public.get_workflows_overview(uuid, text, text);

alter table public.workflows
  drop column if exists author,
  drop column if exists category,
  drop column if exists is_system,
  add column if not exists language text default 'English',
  add column if not exists jurisdictions text[] default array['General']::text[];

alter table public.workflows
  alter column language set default 'English',
  alter column practice set default 'General Transactions',
  alter column jurisdictions set default array['General']::text[];

update public.workflows
set
  language = coalesce(nullif(trim(language), ''), 'English'),
  practice = coalesce(nullif(trim(practice), ''), 'General Transactions'),
  jurisdictions = coalesce(jurisdictions, array['General']::text[])
where user_id is not null;

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
  language text,
  practice text,
  jurisdictions text[],
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
      w.id,
      w.user_id,
      w.title,
      w.type,
      w.prompt_md,
      w.columns_config,
      w.language,
      w.practice,
      w.jurisdictions,
      false as is_system,
      w.created_at,
      true as allow_edit,
      true as is_owner,
      null::text as shared_by_name,
      0 as sort_bucket
    from public.workflows w
    where w.user_id = p_user_id
      and (p_type is null or w.type = p_type)
  ),
  shared as (
    select
      w.id,
      w.user_id,
      w.title,
      w.type,
      w.prompt_md,
      w.columns_config,
      w.language,
      w.practice,
      w.jurisdictions,
      false as is_system,
      w.created_at,
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
  org_shared as (
    -- Workflows in an org the caller belongs to (read-only; edits stay
    -- owner/share-gated). Mirrors the org branch in lib/access.ts.
    select
      w.id,
      w.user_id,
      w.title,
      w.type,
      w.prompt_md,
      w.columns_config,
      w.language,
      w.practice,
      w.jurisdictions,
      false as is_system,
      w.created_at,
      false as allow_edit,
      false as is_owner,
      nullif(trim(up.display_name), '') as shared_by_name,
      2 as sort_bucket
    from public.workflows w
    left join public.user_profiles up
      on up.user_id = w.user_id
    where w.org_id is not null
      and (w.user_id is null or w.user_id <> p_user_id)
      and (p_type is null or w.type = p_type)
      and exists (
        select 1 from public.org_members m
        where m.org_id = w.org_id and m.user_id = p_user_id
      )
      and not exists (
        select 1 from public.workflow_shares ws
        where ws.workflow_id = w.id
          and lower(ws.shared_with_email) = lower(coalesce(p_user_email, ''))
      )
  ),
  visible_workflows as (
    select * from owned
    union all
    select * from shared
    union all
    select * from org_shared
  )
  select
    vw.id,
    vw.user_id,
    vw.title,
    vw.type,
    vw.prompt_md,
    vw.columns_config,
    vw.language,
    vw.practice,
    vw.jurisdictions,
    vw.is_system,
    vw.created_at,
    vw.allow_edit,
    vw.is_owner,
    vw.shared_by_name
  from visible_workflows vw
  order by vw.sort_bucket asc, vw.created_at desc
  -- Preserve the result cap added in 20260630000003.
  limit 1000;
$$;

-- ---------------------------------------------------------------------------
-- 5. Open-source workflow submission queue (upstream 20260629_01)
-- ---------------------------------------------------------------------------

create table if not exists public.workflow_open_source_submissions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  submitted_by_user_id uuid not null references auth.users(id) on delete cascade,
  submitter_email text,
  submitter_name text,
  contributor_mode text not null default 'anonymous',
  status text not null default 'pending',
  snapshot jsonb not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid,
  review_notes text,
  constraint workflow_open_source_submissions_status_check
    check (status in ('pending', 'approved', 'rejected')),
  constraint workflow_open_source_submissions_contributor_mode_check
    check (contributor_mode in ('named', 'anonymous'))
);

create unique index if not exists idx_workflow_open_source_submissions_pending
  on public.workflow_open_source_submissions(workflow_id, submitted_by_user_id)
  where status = 'pending';

create index if not exists idx_workflow_open_source_submissions_reviewer_queue
  on public.workflow_open_source_submissions(status, submitted_at desc);

create index if not exists idx_workflow_open_source_submissions_submitter
  on public.workflow_open_source_submissions(submitted_by_user_id, submitted_at desc);

alter table public.workflow_open_source_submissions enable row level security;

revoke all on public.workflow_open_source_submissions from anon, authenticated;
