-- Migration date: 2026-04-21

-- Migration: DOCX editing with tracked changes.
-- Adds per-edit Accept/Reject state and a pointer to the document's current version.
-- Assumes document_versions table already exists (see separate migration).

-- 1. Broaden document_versions.source to include 'user_reject'.
ALTER TABLE public.document_versions
  DROP CONSTRAINT IF EXISTS document_versions_source_check;

ALTER TABLE public.document_versions
  ADD CONSTRAINT document_versions_source_check
  CHECK (source = ANY (ARRAY[
    'upload'::text,
    'assistant_edit'::text,
    'user_accept'::text,
    'user_reject'::text,
    'generated'::text
  ]));

-- 2. Point each document at its currently active version (null = original upload).
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS current_version_id uuid
  REFERENCES public.document_versions(id) ON DELETE SET NULL;

-- 3. Per-edit registry. One row per tracked change proposed by the assistant.
--    change_id is the w:id written into document.xml so Accept/Reject can
--    locate the specific w:ins/w:del pair on the latest version.
CREATE TABLE IF NOT EXISTS public.document_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chat_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  version_id uuid NOT NULL REFERENCES public.document_versions(id) ON DELETE CASCADE,
  change_id text NOT NULL,
  deleted_text text NOT NULL DEFAULT '',
  inserted_text text NOT NULL DEFAULT '',
  context_before text,
  context_after text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS document_edits_document_id_idx
  ON public.document_edits (document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS document_edits_message_id_idx
  ON public.document_edits (chat_message_id);

CREATE INDEX IF NOT EXISTS document_edits_version_id_idx
  ON public.document_edits (version_id);
