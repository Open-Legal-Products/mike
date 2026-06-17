-- Migration date: 2026-04-23

-- Migration: persist the actual w:ins / w:del numeric ids alongside the
-- logical change_id. Accept/Reject needs these to locate the wrapper
-- elements inside document.xml; change_id is our own opaque label and
-- never lands in the file.

ALTER TABLE public.document_edits
  ADD COLUMN IF NOT EXISTS del_w_id text,
  ADD COLUMN IF NOT EXISTS ins_w_id text;
