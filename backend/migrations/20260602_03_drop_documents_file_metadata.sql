-- Migration date: 2026-06-02

-- Destructive follow-up migration: remove legacy document-level file metadata.
--
-- Run this only after application code writes file_type, size_bytes,
-- and page_count to document_versions and reads those values
-- from the active version.

DO $$
DECLARE
  documents_file_metadata_count integer;
BEGIN
  SELECT count(*)
  INTO documents_file_metadata_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'documents'
    AND column_name IN (
      'file_type',
      'size_bytes',
      'page_count'
    );

  IF documents_file_metadata_count = 3 THEN
    ALTER TABLE public.document_versions
      ADD COLUMN IF NOT EXISTS file_type text,
      ADD COLUMN IF NOT EXISTS size_bytes integer,
      ADD COLUMN IF NOT EXISTS page_count integer;

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
      );
  END IF;

  IF documents_file_metadata_count > 0 THEN
    ALTER TABLE public.documents
      DROP COLUMN IF EXISTS file_type,
      DROP COLUMN IF EXISTS size_bytes,
      DROP COLUMN IF EXISTS page_count;
  END IF;
END $$;
