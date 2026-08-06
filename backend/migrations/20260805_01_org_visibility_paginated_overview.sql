-- Migration date: 2026-08-05

-- Restore org-membership visibility in the PAGINATED tabular-reviews
-- overview — the overload the API actually calls.
--
-- Background: get_tabular_reviews_overview exists as two Postgres
-- OVERLOADS — a legacy 3-argument version (p_user_id, p_user_email,
-- p_project_id) and the 9-argument paginated version added by
-- 20260726_01. In Postgres these are two completely independent
-- functions that merely share a name; CREATE OR REPLACE on one never
-- touches the other, and PostgREST picks whichever overload's named
-- parameters match the RPC call. The backend route always passes all
-- nine named arguments (see lib/tabularReviewsOverview.ts), so only the
-- 9-argument overload is ever executed by the API.
--
-- 20260717_03 added the org-membership visibility branch ("rows whose
-- org_id is in an org the caller belongs to") — but only to the legacy
-- 3-argument overload. That was a no-op for the API: the 9-argument
-- overload that actually backs GET /tabular-review kept the old
-- owner/shared_with-only predicate, so on migrated installs org-shared
-- reviews stayed invisible in list views even though the detail
-- endpoints (which go through access.ts) allowed them. Fresh installs
-- bootstrap from schema.sql, which already has the org branch in the
-- 9-argument version — so fresh and migrated databases silently
-- diverged.
--
-- This migration re-declares both overloads exactly as schema.sql
-- defines them, converging the two install paths:
--   * the 9-argument version gains the org-membership arm in both the
--     accessible_projects CTE (org colleague's project => its in-project
--     reviews are visible) and the visible_reviews row filter (org-tagged
--     standalone/global rows are visible to fellow org members);
--   * the 3-argument version becomes the thin delegating wrapper from
--     schema.sql, replacing 20260717_03's divergent full-body copy, so
--     there is once again a single source of truth for the predicate.
--
-- As in 20260717_03: org membership grants visibility, not ownership
-- (is_owner still means user_id = p_user_id), and org_members.user_id
-- is a uuid while content tables store user_id as text, hence the
-- ::text casts.
--
-- Signatures are unchanged, so create-or-replace only; safe to re-run.

create or replace function public.get_tabular_reviews_overview(
  p_user_id text,
  p_user_email text,
  p_project_id text,
  p_scope text,
  p_limit integer,
  p_offset integer,
  p_search_term text,
  p_sort_key text,
  p_sort_direction text
)
returns table (
  id uuid,
  project_id uuid,
  user_id text,
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
        and p.shared_with @> jsonb_build_array(p_user_email)
      )
       or (
        p.org_id is not null
        and p.user_id <> p_user_id
        and exists (
          select 1 from public.org_members m
          where m.org_id = p.org_id and m.user_id::text = p_user_id
        )
      )
  ),
  visible_reviews as (
    select tr.*
    from public.tabular_reviews tr
    where (p_project_id is null or tr.project_id::text = p_project_id)
      and (
        coalesce(p_scope, 'all') = 'all'
        or (p_scope = 'in-project' and tr.project_id is not null)
        or (p_scope = 'standalone' and tr.project_id is null)
      )
      and (
        p_search_term is null
        or p_search_term = ''
        or lower(tr.title) like
          '%' ||
          replace(
            replace(
              replace(lower(p_search_term), '\', '\\'),
              '%',
              '\%'
            ),
            '_',
            '\_'
          ) ||
          '%'
          escape '\'
      )
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
          and tr.shared_with @> jsonb_build_array(p_user_email)
        )
        or (
          p_project_id is null
          and tr.org_id is not null
          and tr.user_id <> p_user_id
          and exists (
            select 1 from public.org_members m
            where m.org_id = tr.org_id and m.user_id::text = p_user_id
          )
        )
      )
  ),
  cell_document_counts as (
    select
      tc.review_id,
      count(distinct tc.document_id)::integer as document_count
    from public.tabular_cells tc
    where tc.review_id in (
      select vr.id
      from visible_reviews vr
      where jsonb_typeof(vr.document_ids) is distinct from 'array'
    )
    group by tc.review_id
  ),
  review_document_counts as (
    select
      vr.id,
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
    rdc.document_count
  from visible_reviews vr
  join review_document_counts rdc
    on rdc.id = vr.id
  order by
    case
      when p_sort_key = 'name' and p_sort_direction = 'asc' then lower(coalesce(vr.title, ''))
      else null
    end asc,
    case
      when p_sort_key = 'name' and p_sort_direction = 'desc' then lower(coalesce(vr.title, ''))
      else null
    end desc,
    case
      when p_sort_key = 'columns' and p_sort_direction = 'asc' then jsonb_array_length(coalesce(vr.columns_config, '[]'::jsonb))
      else null
    end asc,
    case
      when p_sort_key = 'columns' and p_sort_direction = 'desc' then jsonb_array_length(coalesce(vr.columns_config, '[]'::jsonb))
      else null
    end desc,
    case
      when p_sort_key = 'documents' and p_sort_direction = 'asc' then rdc.document_count
      else null
    end asc,
    case
      when p_sort_key = 'documents' and p_sort_direction = 'desc' then rdc.document_count
      else null
    end desc,
    case
      when p_sort_key = 'created' and p_sort_direction = 'asc' then vr.created_at
      else null
    end asc,
    case
      when p_sort_key = 'created' and p_sort_direction = 'desc' then vr.created_at
      else null
    end desc,
    vr.created_at desc,
    vr.id asc
  limit greatest(coalesce(p_limit, 20), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.get_tabular_reviews_overview(
  p_user_id text,
  p_user_email text default null,
  p_project_id text default null
)
returns table (
  id uuid,
  project_id uuid,
  user_id text,
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
  select *
  from public.get_tabular_reviews_overview(
    p_user_id,
    p_user_email,
    p_project_id,
    'all',
    2147483647,
    0,
    null,
    'created',
    'desc'
  );
$$;
