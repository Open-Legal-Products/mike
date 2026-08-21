-- Migration date: 2026-08-21

-- get_chats_overview: align the list predicate with ensureChatAccess.
--
-- The overview RPCs re-implement the access helpers' logic in SQL; the two
-- must stay in lockstep or rows become readable via the detail endpoints but
-- invisible in the list views (see 20260816_03's header). The chats RPC was
-- the one list still out of lockstep with its detail route: it took no email,
-- so a caller could open a chat by URL through a project share
-- (GET /chat/:id → 200 via checkProjectAccess's shared_with branch) that
-- never appeared in GET /chat.
--
-- Now that chats carry shared_with + org_id (20260821_10), the predicate is
-- the same four-branch shape as the other content RPCs, mirroring
-- ensureChatAccess exactly:
--
--   1. chat owner;
--   2. caller's email in the chat's own shared_with (standalone-chat shares);
--   3. caller is a member of the chat's own org (a no-op for standalone
--      chats, which are stamped with the owner's single-member personal org);
--   4. the chat's project is accessible (project owner, project shared_with,
--      or project-org membership) — the same three branches as
--      get_projects_overview.
--
-- The signature changes (p_user_email added, is_owner returned), so the old
-- function is dropped rather than overloaded — one caller exists
-- (GET /chat), and a leftover 3-arg overload would be a trap for PostgREST
-- named-argument resolution.
--
-- Disclosed behaviour change: chats inside projects merely *shared with* the
-- caller (branch 4's shared_with arm) now appear in the global list; they
-- were previously reachable by URL but deliberately unlisted.

drop function if exists public.get_chats_overview(text, integer, integer);

create or replace function public.get_chats_overview(
  p_user_id text,
  p_user_email text default null,
  p_limit integer default null,
  p_offset integer default 0
)
returns table (
  id uuid,
  project_id uuid,
  user_id text,
  title text,
  created_at timestamptz,
  project_name text,
  is_owner boolean
)
language sql
stable
as $$
  select
    c.id,
    c.project_id,
    c.user_id::text as user_id,
    c.title,
    c.created_at,
    p.name as project_name,
    (c.user_id::text = p_user_id) as is_owner
  from public.chats c
  left join public.projects p on p.id = c.project_id
  where c.user_id::text = p_user_id
     or (
       coalesce(p_user_email, '') <> ''
       and c.user_id::text <> p_user_id
       and c.shared_with @> jsonb_build_array(p_user_email)
     )
     or (
       c.org_id is not null
       and c.user_id::text <> p_user_id
       and exists (
         select 1 from public.org_members m
         where m.org_id = c.org_id and m.user_id::text = p_user_id
       )
     )
     or (
       p.id is not null
       and (
         p.user_id::text = p_user_id
         or (
           coalesce(p_user_email, '') <> ''
           and p.shared_with @> jsonb_build_array(p_user_email)
         )
         or (
           p.org_id is not null
           and exists (
             select 1 from public.org_members m
             where m.org_id = p.org_id and m.user_id::text = p_user_id
           )
         )
       )
     )
  order by c.created_at desc, c.id asc
  limit case
    when p_limit is null then null
    else greatest(1, least(p_limit, 100))
  end
  offset greatest(coalesce(p_offset, 0), 0);
$$;
