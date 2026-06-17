-- Migration date: 2026-06-02

-- Migration: remove legacy document-level filename.
--
-- Before dropping the old column, copy any remaining legacy names onto
-- version rows that do not yet have their own filename/display value.
-- A later migration renames document_versions.display_name to filename.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'filename'
  ) THEN
    UPDATE public.document_versions dv
    SET display_name = d.filename
    FROM public.documents d
    WHERE dv.document_id = d.id
      AND (dv.display_name IS NULL OR btrim(dv.display_name) = '');

    ALTER TABLE public.documents
      DROP COLUMN filename;
  END IF;
END $$;
