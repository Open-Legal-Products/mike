-- Remove the CourtListener (US case-law) integration.
-- Authorised by the project owner on 6 July 2026 (see docs/MIGRATION_SPEC.md §2.6
-- and .claude/hooks/authorized-migrations.json). Safe to re-run.
--
-- Destructive by design: drops the bulk-data index tables (empty on fresh
-- JessicaOS installs) and deletes stored CourtListener API tokens.

drop table if exists public.courtlistener_citation_index;
drop table if exists public.courtlistener_opinion_cluster_index;

delete from public.user_api_keys where provider = 'courtlistener';

alter table public.user_api_keys
  drop constraint if exists user_api_keys_provider_check;
alter table public.user_api_keys
  add constraint user_api_keys_provider_check
  check (provider in ('claude', 'gemini', 'openai', 'openrouter'));

alter table public.user_profiles
  drop column if exists legal_research_us;
