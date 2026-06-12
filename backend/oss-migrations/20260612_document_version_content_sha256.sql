-- Tamper-evidence: store a SHA-256 hex digest of each version's file bytes
-- at write time so exports can prove a file matches what the workspace held.
-- Nullable — rows written before this migration stay unhashed until their
-- bytes are next rewritten (in-place edit resolution or version replace).

alter table public.document_versions
  add column if not exists content_sha256 text;
