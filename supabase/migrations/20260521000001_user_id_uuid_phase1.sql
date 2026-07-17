-- Phase 1 of user_id text → uuid migration.
-- Adds uuid shadow columns alongside the existing text columns.
-- ADD COLUMN without a default or NOT NULL is metadata-only in Postgres 11+ — no table rewrite, no lock.
--
-- Phase 2 (separate migration, separate deploy):
--   Backfill: UPDATE table SET user_id_uuid = user_id::uuid WHERE user_id_uuid IS NULL
--   Run in batches of ~5000 rows outside the migration system to avoid long transactions.
--
-- Phase 3 (after backfill is complete and app writes to both columns):
--   SET NOT NULL, DROP old column, RENAME new column — with lock_timeout = '5s' guard.

alter table public.projects
  add column if not exists user_id_uuid uuid;

alter table public.project_subfolders
  add column if not exists user_id_uuid uuid;

alter table public.documents
  add column if not exists user_id_uuid uuid;

alter table public.workflows
  add column if not exists user_id_uuid uuid;

alter table public.hidden_workflows
  add column if not exists user_id_uuid uuid;

alter table public.workflow_shares
  add column if not exists shared_by_user_id_uuid uuid;

alter table public.chats
  add column if not exists user_id_uuid uuid;

alter table public.tabular_reviews
  add column if not exists user_id_uuid uuid;

alter table public.tabular_review_chats
  add column if not exists user_id_uuid uuid;
