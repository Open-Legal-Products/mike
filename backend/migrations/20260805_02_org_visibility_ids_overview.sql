-- Migration date: 2026-08-05

-- Mirror the org-membership visibility branch into
-- get_tabular_review_ids_overview.
--
-- 20260727_01 introduced this RPC as a lightweight companion to
-- get_tabular_reviews_overview for the bulk "select all matching"
-- action behind GET /tabular-review/ids: it returns only id + owning
-- user for the entire filtered set, duplicating the visibility
-- predicate rather than delegating (SQL has no clean way to share a CTE
-- across two function definitions). Its header carried an explicit
-- warning: if the access rules in get_tabular_reviews_overview's
-- visible_reviews CTE ever change, mirror the change here too.
--
-- The organizations work (20260717_03 and, for the paginated overload,
-- 20260805_01) changed exactly those rules — a third visibility branch,
-- "rows tagged with an org the caller belongs to", alongside "row
-- owner" and "shared_with email" — but this RPC was never updated, in
-- the migration or in schema.sql. The symptom is subtle: an org member
-- SEES a colleague's org-shared reviews in the list (paginated
-- overview), but "select all matching" quietly omits them, because the
-- ids RPC computes a smaller visible set. Bulk actions then operate on
-- fewer rows than the user believes they selected.
--
-- This migration adds the same two org-membership arms the paginated
-- overview uses, keeping the two predicates in lockstep:
--   * accessible_projects: projects whose org_id is in an org the
--     caller belongs to (EXISTS against org_members) — in-project
--     reviews of org colleagues;
--   * the row filter: org-tagged reviews owned by someone else, visible
--     in the global list (p_project_id is null).
--
-- The function body below is byte-identical to schema.sql's, so fresh
-- installs (bootstrapped from schema.sql) and migrated installs end up
-- with the same definition. As elsewhere: org membership grants
-- visibility, not ownership, and org_members.user_id is a uuid while
-- content tables store user_id as text, hence the ::text casts.
--
-- Signature is unchanged, so create-or-replace only; safe to re-run.

create or replace function public.get_tabular_review_ids_overview(
  p_user_id text,
  p_user_email text,
  p_project_id text,
  p_scope text,
  p_search_term text,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  user_id text
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
  )
  select tr.id, tr.user_id
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
  order by tr.created_at desc, tr.id asc
  limit greatest(coalesce(p_limit, 1000), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
