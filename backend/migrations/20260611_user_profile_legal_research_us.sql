-- Migration date: 2026-06-11

-- Per-user toggle for US legal research (CourtListener) tools in chat.
--
-- When true (the default), the CourtListener case-law tools and their system
-- prompt are exposed to the chat assistant. When false, both the tools and the
-- prompt are excluded from the chat. Surfaced in account settings under
-- Features > Legal Research > Jurisdiction > US.
--
-- Safe to run before application code changes: this only adds a column with a
-- default that preserves the existing (enabled) behaviour for all rows.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS legal_research_us boolean NOT NULL DEFAULT true;
