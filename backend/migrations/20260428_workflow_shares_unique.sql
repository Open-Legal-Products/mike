-- Migration date: 2026-04-28

-- Migration: enforce one share row per (workflow, recipient email) so
-- re-sharing to the same person updates the existing row instead of
-- creating duplicates. Without this, DELETE only removes one of N copies
-- and the recipient retains access after the owner thinks they revoked.

-- Collapse any existing duplicates first, keeping the most recent row.
delete from public.workflow_shares a
using public.workflow_shares b
where a.workflow_id = b.workflow_id
  and a.shared_with_email = b.shared_with_email
  and a.created_at < b.created_at;

-- Add the unique constraint only if it is not already present (ADD CONSTRAINT
-- has no IF NOT EXISTS form, so re-running the bare statement would error).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workflow_shares_workflow_email_unique'
      and conrelid = 'public.workflow_shares'::regclass
  ) then
    alter table public.workflow_shares
        add constraint workflow_shares_workflow_email_unique
        unique (workflow_id, shared_with_email);
  end if;
end $$;
