-- Migration date: 2026-08-21

-- Chat permission parity (schema + backfill).
--
-- Chats were the one content table left out of the org/RBAC schema
-- (20260816_01): no org_id, no shared_with. That made them the only resource
-- family still on the pre-RBAC "row owner or nothing" model — a standalone
-- chat could never be shared, and the access helpers/overview RPC could not
-- derive the same role ladder they derive for projects and tabular reviews.
--
-- This migration gives `chats` the same two columns the other content tables
-- carry, with the same semantics:
--
--   org_id      — nullable FK with ON DELETE SET NULL. `user_id` remains the
--                 hard CASCADE anchor, so account deletion is unchanged and
--                 dropping an org never orphan-deletes chats.
--   shared_with — per-chat email share list, so standalone chats
--                 (project_id null) can be shared directly, exactly like
--                 `tabular_reviews.shared_with`. Emails are written
--                 lowercased by the API from day one, so no normalization
--                 backfill will ever be needed for this column.
--
-- Backfill matches what `resolveContentOrgId` does at creation time: a chat
-- inside a project inherits the project's org; everything else lands in the
-- owner's personal org. Stamping standalone chats with the personal org keeps
-- them private — a personal org has exactly one member — so org visibility
-- only ever flows through project membership, never from a bare chat row.
--
-- Idempotent: column adds are IF NOT EXISTS, both backfills are guarded by
-- `where org_id is null`. Re-running is a no-op.

alter table public.chats
  add column if not exists org_id uuid references public.organizations(id) on delete set null;
alter table public.chats
  add column if not exists shared_with jsonb not null default '[]'::jsonb;

create index if not exists idx_chats_org on public.chats(org_id);

-- 1. Project chats inherit the project's org (creation-time semantics).
update public.chats c
set org_id = p.org_id
from public.projects p
where p.id = c.project_id
  and p.org_id is not null
  and c.org_id is null;

-- 2. Everything else — standalone chats, or chats whose project has no org —
--    lands in the owner's personal org.
update public.chats c
set org_id = o.id
from public.organizations o
where o.personal and o.created_by = c.user_id
  and c.org_id is null;
