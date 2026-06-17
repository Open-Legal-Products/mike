-- Migration date: 2026-05-17

-- Persist selected document rows independently from generated cells.
-- This lets project-based tabular reviews keep an explicit document list even
-- when the review has no columns/cells or all rows have been removed.

alter table public.tabular_reviews
  add column if not exists document_ids jsonb;

alter table public.tabular_reviews
  alter column document_ids drop not null,
  alter column document_ids drop default;
