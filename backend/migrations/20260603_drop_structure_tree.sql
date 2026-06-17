-- Migration date: 2026-06-03

-- Remove unused document structure trees.
--
-- Safe to run before or after the document metadata migration because both
-- columns are optional and dropped conditionally.

ALTER TABLE public.document_versions
  DROP COLUMN IF EXISTS structure_tree;

ALTER TABLE public.documents
  DROP COLUMN IF EXISTS structure_tree;
