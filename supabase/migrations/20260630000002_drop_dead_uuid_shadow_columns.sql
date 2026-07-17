-- Reconcile migration-built DBs with schema.sql.
--
-- 20260521000001_user_id_uuid_phase1.sql added uuid shadow columns
-- (user_id_uuid / shared_by_user_id_uuid) intended for a 3-phase backfill swap.
-- That plan was abandoned: 20260524000003_user_id_uuid.sql instead converts the
-- columns in place (ALTER COLUMN user_id TYPE uuid USING user_id::uuid), so the
-- shadow columns were never referenced and are dead. schema.sql (the source of
-- truth for fresh installs) never had them, so any migration-built DB carried 9
-- dead columns that fresh installs don't — a drift. Drop them here.
--
-- History-preserving (the phase1 migration is left intact) and idempotent
-- (drop column if exists), so this is safe whether or not phase1 ever ran.

alter table public.projects              drop column if exists user_id_uuid;
alter table public.project_subfolders    drop column if exists user_id_uuid;
alter table public.documents             drop column if exists user_id_uuid;
alter table public.workflows             drop column if exists user_id_uuid;
alter table public.hidden_workflows      drop column if exists user_id_uuid;
alter table public.workflow_shares       drop column if exists shared_by_user_id_uuid;
alter table public.chats                 drop column if exists user_id_uuid;
alter table public.tabular_reviews       drop column if exists user_id_uuid;
alter table public.tabular_review_chats  drop column if exists user_id_uuid;
