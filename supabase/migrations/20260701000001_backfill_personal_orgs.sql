-- Migration date: 2026-07-01
--
-- Feature R2 — Multi-tenant organizations + RBAC (data backfill).
--
-- Gives every pre-existing user a personal organization + owner membership,
-- then stamps org_id on their existing projects/documents/workflows/
-- tabular_reviews so nothing becomes invisible after the RBAC branch is added
-- to the access helpers and overview RPCs.
--
-- Idempotent: the personal-org insert is guarded by NOT EXISTS (and backed by
-- the unique partial index idx_organizations_personal_owner), the membership
-- insert by NOT EXISTS, and each org_id backfill by `where org_id is null`.
-- Re-running is a no-op. Rows with a null user_id (e.g. system workflows) are
-- deliberately left with a null org_id — they are global, not tenant-scoped.

-- 1. One personal org per existing user that lacks one.
insert into public.organizations (name, personal, created_by)
select
  coalesce(nullif(trim(up.display_name), ''), u.email, 'Personal'),
  true,
  u.id
from auth.users u
left join public.user_profiles up on up.user_id = u.id
where not exists (
  select 1
  from public.organizations o
  where o.created_by = u.id and o.personal
);

-- 2. Owner membership for each personal org.
insert into public.org_members (org_id, user_id, role)
select o.id, o.created_by, 'owner'
from public.organizations o
where o.personal
  and o.created_by is not null
  and not exists (
    select 1
    from public.org_members m
    where m.org_id = o.id and m.user_id = o.created_by
  );

-- 3. Backfill org_id on the four content tables from each row's owning user's
--    personal org. `where org_id is null` keeps this safe to re-run and never
--    clobbers a row already assigned to a (shared) org.
update public.projects p
set org_id = o.id
from public.organizations o
where o.personal and o.created_by = p.user_id
  and p.org_id is null;

update public.documents d
set org_id = o.id
from public.organizations o
where o.personal and o.created_by = d.user_id
  and d.org_id is null;

update public.workflows w
set org_id = o.id
from public.organizations o
where o.personal and o.created_by = w.user_id
  and w.user_id is not null
  and w.org_id is null;

update public.tabular_reviews tr
set org_id = o.id
from public.organizations o
where o.personal and o.created_by = tr.user_id
  and tr.org_id is null;
