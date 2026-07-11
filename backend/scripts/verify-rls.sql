-- RLS Verification Script
--
-- Run this against a Supabase project where the RLS migration has been applied.
-- This script verifies that RLS is enabled and policies exist for all tables.
-- It does NOT test cross-user access (that requires authenticated sessions).

-- Check RLS is enabled on all expected tables
select
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'user_profiles', 'projects', 'project_subfolders', 'documents',
    'document_versions', 'document_edits', 'workflows', 'hidden_workflows',
    'workflow_shares', 'chats', 'chat_messages', 'tabular_reviews',
    'tabular_cells', 'tabular_review_chats', 'tabular_review_chat_messages',
    'user_api_keys', 'user_mcp_connectors', 'user_mcp_oauth_tokens',
    'user_mcp_oauth_states', 'user_mcp_connector_tools', 'user_mcp_tool_audit_logs',
    'courtlistener_citation_index', 'courtlistener_opinion_cluster_index',
    'workflow_open_source_submissions', 'contact_messages'
  )
order by tablename;

-- Expected: all rows should have rowsecurity = true

-- Check policies exist
select
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- Expected: policies for SELECT, INSERT, UPDATE, DELETE on user-owned tables
-- Expected: SELECT-only policies on reference data tables
-- Expected: no policies on contact_messages (admin-only, locked to service_role)

-- Verify anon/authenticated have no direct table access
select
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee;

-- Expected: zero rows (all privileges revoked)
