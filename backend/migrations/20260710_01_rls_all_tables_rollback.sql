-- Rollback for migration 20260710_01_rls_all_tables.sql
--
-- Removes all RLS policies created by the forward migration.
-- RLS remains enabled on tables that had it before the migration
-- (the 8 tables that were already RLS-enabled in schema.sql).
--
-- This rollback does NOT disable RLS on the 15 tables that were
-- newly enabled, because doing so would require knowing which tables
-- had RLS before. If you need to fully revert, run the additional
-- ALTER TABLE ... DISABLE ROW LEVEL SECURITY statements below manually.

-- Drop all policies created by the forward migration

drop policy if exists user_profiles_select on public.user_profiles;
drop policy if exists user_profiles_insert on public.user_profiles;
drop policy if exists user_profiles_update on public.user_profiles;
drop policy if exists user_profiles_delete on public.user_profiles;

drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;

drop policy if exists project_subfolders_select on public.project_subfolders;
drop policy if exists project_subfolders_insert on public.project_subfolders;
drop policy if exists project_subfolders_update on public.project_subfolders;
drop policy if exists project_subfolders_delete on public.project_subfolders;

drop policy if exists documents_select on public.documents;
drop policy if exists documents_insert on public.documents;
drop policy if exists documents_update on public.documents;
drop policy if exists documents_delete on public.documents;

drop policy if exists document_versions_select on public.document_versions;
drop policy if exists document_versions_insert on public.document_versions;
drop policy if exists document_versions_update on public.document_versions;
drop policy if exists document_versions_delete on public.document_versions;

drop policy if exists document_edits_select on public.document_edits;
drop policy if exists document_edits_insert on public.document_edits;
drop policy if exists document_edits_update on public.document_edits;
drop policy if exists document_edits_delete on public.document_edits;

drop policy if exists workflows_select on public.workflows;
drop policy if exists workflows_insert on public.workflows;
drop policy if exists workflows_update on public.workflows;
drop policy if exists workflows_delete on public.workflows;

drop policy if exists hidden_workflows_select on public.hidden_workflows;
drop policy if exists hidden_workflows_insert on public.hidden_workflows;
drop policy if exists hidden_workflows_delete on public.hidden_workflows;

drop policy if exists workflow_shares_select on public.workflow_shares;
drop policy if exists workflow_shares_insert on public.workflow_shares;
drop policy if exists workflow_shares_delete on public.workflow_shares;

drop policy if exists chats_select on public.chats;
drop policy if exists chats_insert on public.chats;
drop policy if exists chats_update on public.chats;
drop policy if exists chats_delete on public.chats;

drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_insert on public.chat_messages;
drop policy if exists chat_messages_delete on public.chat_messages;

drop policy if exists tabular_reviews_select on public.tabular_reviews;
drop policy if exists tabular_reviews_insert on public.tabular_reviews;
drop policy if exists tabular_reviews_update on public.tabular_reviews;
drop policy if exists tabular_reviews_delete on public.tabular_reviews;

drop policy if exists tabular_cells_select on public.tabular_cells;
drop policy if exists tabular_cells_insert on public.tabular_cells;
drop policy if exists tabular_cells_update on public.tabular_cells;
drop policy if exists tabular_cells_delete on public.tabular_cells;

drop policy if exists tabular_review_chats_select on public.tabular_review_chats;
drop policy if exists tabular_review_chats_insert on public.tabular_review_chats;
drop policy if exists tabular_review_chats_update on public.tabular_review_chats;
drop policy if exists tabular_review_chats_delete on public.tabular_review_chats;

drop policy if exists tr_chat_messages_select on public.tabular_review_chat_messages;
drop policy if exists tr_chat_messages_insert on public.tabular_review_chat_messages;
drop policy if exists tr_chat_messages_delete on public.tabular_review_chat_messages;

drop policy if exists user_api_keys_select on public.user_api_keys;
drop policy if exists user_api_keys_insert on public.user_api_keys;
drop policy if exists user_api_keys_update on public.user_api_keys;
drop policy if exists user_api_keys_delete on public.user_api_keys;

drop policy if exists user_mcp_connectors_select on public.user_mcp_connectors;
drop policy if exists user_mcp_connectors_insert on public.user_mcp_connectors;
drop policy if exists user_mcp_connectors_update on public.user_mcp_connectors;
drop policy if exists user_mcp_connectors_delete on public.user_mcp_connectors;

drop policy if exists user_mcp_oauth_tokens_select on public.user_mcp_oauth_tokens;
drop policy if exists user_mcp_oauth_tokens_insert on public.user_mcp_oauth_tokens;
drop policy if exists user_mcp_oauth_tokens_update on public.user_mcp_oauth_tokens;
drop policy if exists user_mcp_oauth_tokens_delete on public.user_mcp_oauth_tokens;

drop policy if exists user_mcp_oauth_states_select on public.user_mcp_oauth_states;
drop policy if exists user_mcp_oauth_states_insert on public.user_mcp_oauth_states;
drop policy if exists user_mcp_oauth_states_delete on public.user_mcp_oauth_states;

drop policy if exists user_mcp_connector_tools_select on public.user_mcp_connector_tools;
drop policy if exists user_mcp_connector_tools_insert on public.user_mcp_connector_tools;
drop policy if exists user_mcp_connector_tools_update on public.user_mcp_connector_tools;
drop policy if exists user_mcp_connector_tools_delete on public.user_mcp_connector_tools;

drop policy if exists user_mcp_tool_audit_logs_select on public.user_mcp_tool_audit_logs;
drop policy if exists user_mcp_tool_audit_logs_insert on public.user_mcp_tool_audit_logs;

drop policy if exists courtlistener_citation_select on public.courtlistener_citation_index;
drop policy if exists courtlistener_opinion_select on public.courtlistener_opinion_cluster_index;

drop policy if exists wf_oss_submissions_select on public.workflow_open_source_submissions;
drop policy if exists wf_oss_submissions_insert on public.workflow_open_source_submissions;
drop policy if exists wf_oss_submissions_update on public.workflow_open_source_submissions;

-- Optional: disable RLS on the 15 newly-enabled tables
-- Uncomment if you need a full revert:
-- alter table public.user_profiles disable row level security;
-- alter table public.projects disable row level security;
-- alter table public.project_subfolders disable row level security;
-- alter table public.documents disable row level security;
-- alter table public.document_versions disable row level security;
-- alter table public.document_edits disable row level security;
-- alter table public.workflows disable row level security;
-- alter table public.hidden_workflows disable row level security;
-- alter table public.workflow_shares disable row level security;
-- alter table public.chats disable row level security;
-- alter table public.chat_messages disable row level security;
-- alter table public.tabular_reviews disable row level security;
-- alter table public.tabular_cells disable row level security;
-- alter table public.tabular_review_chats disable row level security;
-- alter table public.tabular_review_chat_messages disable row level security;
