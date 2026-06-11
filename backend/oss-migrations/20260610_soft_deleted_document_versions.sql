-- Keep document version tombstones after deleting version file bytes.
-- Deleted versions remain visible in history but are ignored by active-file
-- lookups and cannot be opened/downloaded/replaced.

alter table public.document_versions
  alter column storage_path drop not null;

alter table public.document_versions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists document_versions_active_document_id_idx
  on public.document_versions(document_id, created_at desc)
  where deleted_at is null;
