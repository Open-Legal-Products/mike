-- Migration date: 2026-06-02

-- Add per-version file metadata.
--
-- documents is the stable container. document_versions owns the bytes for each
-- version, so file metadata that describes those bytes belongs here too.
--
-- Safe to run before application code changes: this only adds nullable columns
-- and backfills them from the parent document.

ALTER TABLE public.document_versions
  ADD COLUMN IF NOT EXISTS file_type text,
  ADD COLUMN IF NOT EXISTS size_bytes integer,
  ADD COLUMN IF NOT EXISTS page_count integer;

-- Guarded backfill: documents.{file_type, size_bytes, page_count} were later
-- dropped (20260602_03_drop_documents_file_metadata.sql) and no longer exist
-- in a database bootstrapped from the current schema.sql, where there are no
-- rows to backfill anyway. Only run the backfill where the historical columns
-- are still present, so this file applies cleanly both to deployments of its
-- era and on top of schema.sql (which CI does as a schema-drift smoke test).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'file_type'
  ) THEN
    EXECUTE $sql$
      UPDATE public.document_versions dv
      SET
        file_type = COALESCE(NULLIF(btrim(dv.file_type), ''), d.file_type),
        size_bytes = COALESCE(dv.size_bytes, d.size_bytes),
        page_count = COALESCE(dv.page_count, d.page_count)
      FROM public.documents d
      WHERE dv.document_id = d.id
        AND (
          dv.file_type IS NULL
          OR btrim(dv.file_type) = ''
          OR dv.size_bytes IS NULL
          OR dv.page_count IS NULL
        )
    $sql$;
  END IF;
END $$;
