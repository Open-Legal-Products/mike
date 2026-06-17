-- Migration date: 2026-05-08

-- Migration: make application data tables backend-only.
-- RLS remains enabled as defense in depth, but direct browser Supabase clients
-- should not be able to query or mutate these tables with anon/authenticated.

DO $$
DECLARE
  table_name text;
  backend_only_tables text[] := ARRAY[
    'projects',
    'project_subfolders',
    'documents',
    'document_versions',
    'document_edits',
    'workflows',
    'hidden_workflows',
    'workflow_shares',
    'chats',
    'chat_messages',
    'tabular_reviews',
    'tabular_cells',
    'tabular_review_chats',
    'tabular_review_chat_messages',
    'user_api_keys'
  ];
BEGIN
  FOREACH table_name IN ARRAY backend_only_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated',
        table_name
      );
    END IF;
  END LOOP;
END $$;
