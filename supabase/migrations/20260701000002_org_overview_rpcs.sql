-- Migration date: 2026-07-01
--
-- Feature R2 — Multi-tenant organizations + RBAC (list read-models).
--
-- The four "overview" RPCs re-implement the access logic in SQL for the list
-- views. access.ts now grants a third visibility branch — "row.org_id is in an
-- org the caller belongs to" — alongside "row owner" and "shared_with email".
-- If these RPCs are not updated in lockstep, org-shared rows would be readable
-- via the detail endpoints (which go through access.ts) but invisible in the
-- list views. This migration adds that org-membership branch to each.
--
-- Implemented as an inline EXISTS against org_members keyed on p_user_id, so no
-- new RPC parameter is needed and existing callers stay unchanged. `is_owner`
-- keeps meaning "row owner" (user_id = p_user_id) — org membership grants
-- visibility, not ownership.
--
-- create-or-replace only; safe to re-run.

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
  org_shared as (
    -- Workflows owned by someone else but living in an org the caller belongs
    -- to. Not editable by default (org members read; owners/admins manage via
    -- the detail endpoints), and excluded when already surfaced as owned/shared.
    select
      w.*,
      false as allow_edit,
      false as is_owner,
      nullif(trim(up.display_name), '') as shared_by_name,
      2 as sort_bucket
    from public.workflows w
    left join public.user_profiles up
      on up.user_id = w.user_id
    where w.is_system = false
      and w.org_id is not null
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
    vw.practice,
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
        and (
          p.user_id = p_user_id
          or (
            p.org_id is not null
            and exists (
              select 1 from public.org_members m
              where m.org_id = p.org_id and m.user_id = p_user_id
            )
          )
        )
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
       or (
        p.org_id is not null
        and p.user_id <> p_user_id
        and exists (
          select 1 from public.org_members m
          where m.org_id = p.org_id and m.user_id = p_user_id
        )
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
        or (
          p_project_id is null
          and tr.org_id is not null
          and tr.user_id <> p_user_id
          and exists (
            select 1 from public.org_members m
            where m.org_id = tr.org_id and m.user_id = p_user_id
          )
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
  order by vr.created_at desc
  -- Preserve the result cap added in 20260630000003.
  limit 1000;
$$;
