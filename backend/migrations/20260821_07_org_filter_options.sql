-- Migration date: 2026-08-21

-- Port org-membership visibility onto the two filter-options RPCs from the
-- 20260812_01 read-model batch.
--
-- 20260821_06 made the paginated list/ids/summary RPCs org-aware, but the
-- dropdown-option companions that ship alongside them were missed:
--   * get_project_filter_options — feeds the Practice and Owner dropdowns
--     above the projects table
--   * get_workflow_filter_options — feeds the practice/jurisdiction/language
--     dropdowns above the workflows list
-- Both compute their option sets from a "visible rows" predicate that still
-- only knew owner + email-share arms. The result was a visible seam for org
-- members: the list shows an org project, but its owner never appears in the
-- Owner filter and its practice never appears in the Practice filter — rows
-- you can see but cannot filter to.
--
-- The arms below are copied verbatim from the 20260821_06 predicates so the
-- option set and the list are computed from the same visible set. In the
-- workflows RPC the org rows are tagged source='shared', matching the
-- overview's bucketing decision (shared-with-me and shared-via-my-org are one
-- "shared" bucket from the caller's point of view), so p_scope filtering
-- stays consistent between the list and its dropdowns.

create or replace function public.get_project_filter_options(
  p_user_id text,
  p_user_email text default null
)
returns table (practices text[], owners jsonb)
language sql
stable
as $$
  with visible_projects as (
    select p.user_id, nullif(trim(p.practice), '') as practice
    from public.projects p
    where p.user_id::text = p_user_id
       or (
         coalesce(p_user_email, '') <> ''
         and p.user_id::text <> p_user_id
         and p.shared_with @> jsonb_build_array(p_user_email)
       )
       or (
         -- Org arm: same predicate as get_projects_overview (20260821_06),
         -- so the filter dropdowns and the list agree on what is visible.
         p.org_id is not null
         and p.user_id::text <> p_user_id
         and exists (
           select 1 from public.org_members m
           where m.org_id = p.org_id and m.user_id::text = p_user_id
         )
       )
  ),
  distinct_owners as (
    select distinct vp.user_id
    from visible_projects vp
  ),
  owner_options as (
    select
      o.user_id,
      case
        when o.user_id::text = p_user_id then 'Me'
        else coalesce(
          nullif(trim(up.display_name), ''),
          nullif(trim(up.email), ''),
          'Shared'
        )
      end as label
    from distinct_owners o
    left join public.user_profiles up
      on up.user_id::text = o.user_id::text
  )
  select
    coalesce(
      (select array_agg(distinct practice order by practice)
       from visible_projects
       where practice is not null),
      array[]::text[]
    ) as practices,
    coalesce(
      (select jsonb_agg(
          jsonb_build_object('value', user_id, 'label', label)
          order by label, user_id
       ) from owner_options),
      '[]'::jsonb
    ) as owners;
$$;

create or replace function public.get_workflow_filter_options(
  p_user_id text,
  p_user_email text default null,
  p_type text default null,
  p_scope text default 'all'
)
returns table (
  practices text[],
  languages text[],
  jurisdictions text[]
)
language sql
stable
as $$
  with owned as (
    select w.practice, w.language, w.jurisdictions, 'owned'::text as source
    from public.workflows w
    where w.user_id::text = p_user_id
      and (p_type is null or w.type = p_type)
  ),
  shared as (
    select w.practice, w.language, w.jurisdictions, 'shared'::text as source
    from public.workflow_shares ws
    join public.workflows w on w.id = ws.workflow_id
    where lower(ws.shared_with_email) = lower(coalesce(p_user_email, ''))
      and (p_type is null or w.type = p_type)
  ),
  org_shared as (
    -- Same org-membership arm as get_workflows_overview (20260821_06),
    -- including the workflow_shares NOT EXISTS dedup, so a row visible via
    -- both routes contributes its options exactly once. Tagged 'shared' to
    -- match the overview's scope bucketing.
    select w.practice, w.language, w.jurisdictions, 'shared'::text as source
    from public.workflows w
    where w.org_id is not null
      and (w.user_id is null or w.user_id::text <> p_user_id)
      and (p_type is null or w.type = p_type)
      and exists (
        select 1 from public.org_members m
        where m.org_id = w.org_id and m.user_id::text = p_user_id
      )
      and not exists (
        select 1 from public.workflow_shares ws
        where ws.workflow_id = w.id
          and lower(ws.shared_with_email) = lower(coalesce(p_user_email, ''))
      )
  ),
  visible as (
    select * from owned
    union all
    select * from shared
    union all
    select * from org_shared
  ),
  scoped as (
    select * from visible
    where coalesce(p_scope, 'all') = 'all' or source = p_scope
  )
  select
    coalesce(
      array_agg(distinct nullif(trim(practice), '') order by nullif(trim(practice), ''))
        filter (where nullif(trim(practice), '') is not null),
      array[]::text[]
    ) as practices,
    coalesce(
      array_agg(distinct nullif(trim(language), '') order by nullif(trim(language), ''))
        filter (where nullif(trim(language), '') is not null),
      array[]::text[]
    ) as languages,
    coalesce(
      (select array_agg(distinct jurisdiction order by jurisdiction)
       from scoped s
       cross join lateral unnest(coalesce(s.jurisdictions, array[]::text[])) jurisdiction
       where nullif(trim(jurisdiction), '') is not null),
      array[]::text[]
    ) as jurisdictions
  from scoped;
$$;
