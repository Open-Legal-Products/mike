-- Migration date: 2026-04-23

-- Migration: give each assistant-produced version of a document a
-- monotonic per-document version number (V1, V2, …). Only
-- `source = 'assistant_edit'` rows carry a number; the original upload
-- and the ephemeral user_accept/user_reject rows stay NULL. Numbers are
-- stable once written — accept/reject now overwrite bytes in place
-- rather than insert new rows, so the sequence never has gaps.

ALTER TABLE public.document_versions
  ADD COLUMN IF NOT EXISTS version_number integer;

-- Backfill: assign 1..N to the existing assistant_edit rows per doc,
-- ordered by created_at ascending. Safe to re-run (only writes NULLs).
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY document_id
      ORDER BY created_at ASC
    ) AS rn
  FROM public.document_versions
  WHERE source = 'assistant_edit'
)
UPDATE public.document_versions dv
SET version_number = n.rn
FROM numbered n
WHERE dv.id = n.id
  AND dv.version_number IS NULL;

CREATE INDEX IF NOT EXISTS document_versions_doc_vnum_idx
  ON public.document_versions (document_id, version_number);
