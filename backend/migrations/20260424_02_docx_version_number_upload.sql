-- Migration date: 2026-04-24

-- Migration: number the original upload as V1 so assistant edits start at V2.
-- Before: upload rows had version_number NULL, assistant_edit rows started at 1.
-- After: every row in document_versions has a monotonic per-document V# with
--        the upload as V1.

-- Guard: this shift is not naturally idempotent (re-running would bump the
-- numbers again). An unnumbered upload row is the signal that the migration
-- has not run yet; once every upload row is numbered there is nothing to do.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.document_versions
    WHERE source = 'upload' AND version_number IS NULL
  ) THEN
    -- 1. Shift existing assistant_edit + user_upload numbers up by 1 so they no
    --    longer collide with the upload's new V1. Done first so we don't violate
    --    any uniqueness constraint while the upload row still lacks a number.
    UPDATE public.document_versions
    SET version_number = version_number + 1
    WHERE source IN ('assistant_edit', 'user_upload')
      AND version_number IS NOT NULL;

    -- 2. Backfill every upload row's version_number to 1.
    UPDATE public.document_versions
    SET version_number = 1
    WHERE source = 'upload'
      AND version_number IS NULL;
  END IF;
END $$;
