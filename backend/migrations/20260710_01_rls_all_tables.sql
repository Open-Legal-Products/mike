-- Migration date: 2026-07-10
-- MIKE-03: Enable Row Level Security on all private tables and create policies.
--
-- This migration enables RLS on every table that was missing it and creates
-- explicit policies for SELECT, INSERT, UPDATE, and DELETE.
--
-- Defense-in-depth: the backend already uses the service-role key (which
-- bypasses RLS) and all table privileges are revoked from anon/authenticated.
-- These policies ensure that IF direct table access is ever granted to the
-- authenticated role in the future, users can only access their own data.
--
-- IMPORTANT: Apply to a fresh database alongside schema.sql, or as an
-- incremental migration on an existing database. Safe to re-run (uses IF NOT EXISTS).

-- =============================================================================
-- Tables WITHOUT RLS — enable it
-- =============================================================================

alter table public.user_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_subfolders enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_edits enable row level security;
alter table public.workflows enable row level security;
alter table public.hidden_workflows enable row level security;
alter table public.workflow_shares enable row level security;
alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;
alter table public.tabular_reviews enable row level security;
alter table public.tabular_cells enable row level security;
alter table public.tabular_review_chats enable row level security;
alter table public.tabular_review_chat_messages enable row level security;

-- =============================================================================
-- user_profiles (user_id is uuid → auth.uid())
-- =============================================================================

drop policy if exists user_profiles_select on public.user_profiles;
drop policy if exists user_profiles_insert on public.user_profiles;
drop policy if exists user_profiles_update on public.user_profiles;
drop policy if exists user_profiles_delete on public.user_profiles;

create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (user_id = auth.uid());

create policy user_profiles_insert on public.user_profiles
  for insert to authenticated
  with check (user_id = auth.uid());

create policy user_profiles_update on public.user_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_profiles_delete on public.user_profiles
  for delete to authenticated
  using (user_id = auth.uid());

-- =============================================================================
-- projects (user_id text, shared_with jsonb)
-- =============================================================================

drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;

create policy projects_select on public.projects
  for select to authenticated
  using (
    user_id = auth.uid()::text
    or coalesce(shared_with, '[]'::jsonb) @> jsonb_build_array(
      (select email from auth.users where id = auth.uid())
    )
  );

create policy projects_insert on public.projects
  for insert to authenticated
  with check (user_id = auth.uid()::text);

create policy projects_update on public.projects
  for update to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy projects_delete on public.projects
  for delete to authenticated
  using (user_id = auth.uid()::text);

-- =============================================================================
-- project_subfolders (user_id text, project_id uuid)
-- =============================================================================

drop policy if exists project_subfolders_select on public.project_subfolders;
drop policy if exists project_subfolders_insert on public.project_subfolders;
drop policy if exists project_subfolders_update on public.project_subfolders;
drop policy if exists project_subfolders_delete on public.project_subfolders;

create policy project_subfolders_select on public.project_subfolders
  for select to authenticated
  using (user_id = auth.uid()::text);

create policy project_subfolders_insert on public.project_subfolders
  for insert to authenticated
  with check (user_id = auth.uid()::text);

create policy project_subfolders_update on public.project_subfolders
  for update to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy project_subfolders_delete on public.project_subfolders
  for delete to authenticated
  using (user_id = auth.uid()::text);

-- =============================================================================
-- documents (user_id text, project_id uuid)
-- =============================================================================

drop policy if exists documents_select on public.documents;
drop policy if exists documents_insert on public.documents;
drop policy if exists documents_update on public.documents;
drop policy if exists documents_delete on public.documents;

create policy documents_select on public.documents
  for select to authenticated
  using (
    user_id = auth.uid()::text
    or exists (
      select 1 from public.projects p
      where p.id = documents.project_id
      and (
        p.user_id = auth.uid()::text
        or coalesce(p.shared_with, '[]'::jsonb) @> jsonb_build_array(
          (select email from auth.users where id = auth.uid())
        )
      )
    )
  );

create policy documents_insert on public.documents
  for insert to authenticated
  with check (user_id = auth.uid()::text);

create policy documents_update on public.documents
  for update to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy documents_delete on public.documents
  for delete to authenticated
  using (user_id = auth.uid()::text);

-- =============================================================================
-- document_versions (no user_id, access via documents)
-- =============================================================================

drop policy if exists document_versions_select on public.document_versions;
drop policy if exists document_versions_insert on public.document_versions;
drop policy if exists document_versions_update on public.document_versions;
drop policy if exists document_versions_delete on public.document_versions;

create policy document_versions_select on public.document_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_versions.document_id
      and (
        d.user_id = auth.uid()::text
        or exists (
          select 1 from public.projects p
          where p.id = d.project_id
          and (
            p.user_id = auth.uid()::text
            or coalesce(p.shared_with, '[]'::jsonb) @> jsonb_build_array(
              (select email from auth.users where id = auth.uid())
            )
          )
        )
      )
    )
  );

create policy document_versions_insert on public.document_versions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_versions.document_id
      and d.user_id = auth.uid()::text
    )
  );

create policy document_versions_update on public.document_versions
  for update to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_versions.document_id
      and d.user_id = auth.uid()::text
    )
  );

create policy document_versions_delete on public.document_versions
  for delete to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_versions.document_id
      and d.user_id = auth.uid()::text
    )
  );

-- =============================================================================
-- document_edits (no user_id, access via documents → document_versions)
-- =============================================================================

drop policy if exists document_edits_select on public.document_edits;
drop policy if exists document_edits_insert on public.document_edits;
drop policy if exists document_edits_update on public.document_edits;
drop policy if exists document_edits_delete on public.document_edits;

create policy document_edits_select on public.document_edits
  for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_edits.document_id
      and (
        d.user_id = auth.uid()::text
        or exists (
          select 1 from public.projects p
          where p.id = d.project_id
          and (
            p.user_id = auth.uid()::text
            or coalesce(p.shared_with, '[]'::jsonb) @> jsonb_build_array(
              (select email from auth.users where id = auth.uid())
            )
          )
        )
      )
    )
  );

create policy document_edits_insert on public.document_edits
  for insert to authenticated
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_edits.document_id
      and d.user_id = auth.uid()::text
    )
  );

create policy document_edits_update on public.document_edits
  for update to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_edits.document_id
      and d.user_id = auth.uid()::text
    )
  );

create policy document_edits_delete on public.document_edits
  for delete to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_edits.document_id
      and d.user_id = auth.uid()::text
    )
  );

-- =============================================================================
-- workflows (user_id text)
-- =============================================================================

drop policy if exists workflows_select on public.workflows;
drop policy if exists workflows_insert on public.workflows;
drop policy if exists workflows_update on public.workflows;
drop policy if exists workflows_delete on public.workflows;

create policy workflows_select on public.workflows
  for select to authenticated
  using (
    user_id = auth.uid()::text
    or exists (
      select 1 from public.workflow_shares ws
      where ws.workflow_id = workflows.id
      and lower(ws.shared_with_email) = lower(
        coalesce((select email from auth.users where id = auth.uid()), '')
      )
    )
  );

create policy workflows_insert on public.workflows
  for insert to authenticated
  with check (user_id = auth.uid()::text);

create policy workflows_update on public.workflows
  for update to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy workflows_delete on public.workflows
  for delete to authenticated
  using (user_id = auth.uid()::text);

-- =============================================================================
-- hidden_workflows (user_id text)
-- =============================================================================

drop policy if exists hidden_workflows_select on public.hidden_workflows;
drop policy if exists hidden_workflows_insert on public.hidden_workflows;
drop policy if exists hidden_workflows_delete on public.hidden_workflows;

create policy hidden_workflows_select on public.hidden_workflows
  for select to authenticated
  using (user_id = auth.uid()::text);

create policy hidden_workflows_insert on public.hidden_workflows
  for insert to authenticated
  with check (user_id = auth.uid()::text);

create policy hidden_workflows_delete on public.hidden_workflows
  for delete to authenticated
  using (user_id = auth.uid()::text);

-- =============================================================================
-- workflow_shares (shared_by_user_id text — owner of the workflow)
-- =============================================================================

drop policy if exists workflow_shares_select on public.workflow_shares;
drop policy if exists workflow_shares_insert on public.workflow_shares;
drop policy if exists workflow_shares_delete on public.workflow_shares;

create policy workflow_shares_select on public.workflow_shares
  for select to authenticated
  using (
    shared_by_user_id = auth.uid()::text
    or lower(shared_with_email) = lower(
      coalesce((select email from auth.users where id = auth.uid()), '')
    )
  );

create policy workflow_shares_insert on public.workflow_shares
  for insert to authenticated
  with check (shared_by_user_id = auth.uid()::text);

create policy workflow_shares_delete on public.workflow_shares
  for delete to authenticated
  using (shared_by_user_id = auth.uid()::text);

-- =============================================================================
-- chats (user_id text, project_id uuid)
-- =============================================================================

drop policy if exists chats_select on public.chats;
drop policy if exists chats_insert on public.chats;
drop policy if exists chats_update on public.chats;
drop policy if exists chats_delete on public.chats;

create policy chats_select on public.chats
  for select to authenticated
  using (
    user_id = auth.uid()::text
    or exists (
      select 1 from public.projects p
      where p.id = chats.project_id
      and (
        p.user_id = auth.uid()::text
        or coalesce(p.shared_with, '[]'::jsonb) @> jsonb_build_array(
          (select email from auth.users where id = auth.uid())
        )
      )
    )
  );

create policy chats_insert on public.chats
  for insert to authenticated
  with check (user_id = auth.uid()::text);

create policy chats_update on public.chats
  for update to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy chats_delete on public.chats
  for delete to authenticated
  using (user_id = auth.uid()::text);

-- =============================================================================
-- chat_messages (no user_id, access via chats)
-- =============================================================================

drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists chat_messages_insert on public.chat_messages;
drop policy if exists chat_messages_delete on public.chat_messages;

create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = chat_messages.chat_id
      and (
        c.user_id = auth.uid()::text
        or exists (
          select 1 from public.projects p
          where p.id = c.project_id
          and (
            p.user_id = auth.uid()::text
            or coalesce(p.shared_with, '[]'::jsonb) @> jsonb_build_array(
              (select email from auth.users where id = auth.uid())
            )
          )
        )
      )
    )
  );

create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.chats c
      where c.id = chat_messages.chat_id
      and c.user_id = auth.uid()::text
    )
  );

create policy chat_messages_delete on public.chat_messages
  for delete to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = chat_messages.chat_id
      and c.user_id = auth.uid()::text
    )
  );

-- =============================================================================
-- tabular_reviews (user_id text, shared_with jsonb)
-- =============================================================================

drop policy if exists tabular_reviews_select on public.tabular_reviews;
drop policy if exists tabular_reviews_insert on public.tabular_reviews;
drop policy if exists tabular_reviews_update on public.tabular_reviews;
drop policy if exists tabular_reviews_delete on public.tabular_reviews;

create policy tabular_reviews_select on public.tabular_reviews
  for select to authenticated
  using (
    user_id = auth.uid()::text
    or coalesce(shared_with, '[]'::jsonb) @> jsonb_build_array(
      (select email from auth.users where id = auth.uid())
    )
    or exists (
      select 1 from public.projects p
      where p.id = tabular_reviews.project_id
      and (
        p.user_id = auth.uid()::text
        or coalesce(p.shared_with, '[]'::jsonb) @> jsonb_build_array(
          (select email from auth.users where id = auth.uid())
        )
      )
    )
  );

create policy tabular_reviews_insert on public.tabular_reviews
  for insert to authenticated
  with check (user_id = auth.uid()::text);

create policy tabular_reviews_update on public.tabular_reviews
  for update to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy tabular_reviews_delete on public.tabular_reviews
  for delete to authenticated
  using (user_id = auth.uid()::text);

-- =============================================================================
-- tabular_cells (no user_id, access via tabular_reviews)
-- =============================================================================

drop policy if exists tabular_cells_select on public.tabular_cells;
drop policy if exists tabular_cells_insert on public.tabular_cells;
drop policy if exists tabular_cells_update on public.tabular_cells;
drop policy if exists tabular_cells_delete on public.tabular_cells;

create policy tabular_cells_select on public.tabular_cells
  for select to authenticated
  using (
    exists (
      select 1 from public.tabular_reviews tr
      where tr.id = tabular_cells.review_id
      and (
        tr.user_id = auth.uid()::text
        or coalesce(tr.shared_with, '[]'::jsonb) @> jsonb_build_array(
          (select email from auth.users where id = auth.uid())
        )
        or exists (
          select 1 from public.projects p
          where p.id = tr.project_id
          and (
            p.user_id = auth.uid()::text
            or coalesce(p.shared_with, '[]'::jsonb) @> jsonb_build_array(
              (select email from auth.users where id = auth.uid())
            )
          )
        )
      )
    )
  );

create policy tabular_cells_insert on public.tabular_cells
  for insert to authenticated
  with check (
    exists (
      select 1 from public.tabular_reviews tr
      where tr.id = tabular_cells.review_id
      and tr.user_id = auth.uid()::text
    )
  );

create policy tabular_cells_update on public.tabular_cells
  for update to authenticated
  using (
    exists (
      select 1 from public.tabular_reviews tr
      where tr.id = tabular_cells.review_id
      and tr.user_id = auth.uid()::text
    )
  );

create policy tabular_cells_delete on public.tabular_cells
  for delete to authenticated
  using (
    exists (
      select 1 from public.tabular_reviews tr
      where tr.id = tabular_cells.review_id
      and tr.user_id = auth.uid()::text
    )
  );

-- =============================================================================
-- tabular_review_chats (user_id text, review_id uuid)
-- =============================================================================

drop policy if exists tabular_review_chats_select on public.tabular_review_chats;
drop policy if exists tabular_review_chats_insert on public.tabular_review_chats;
drop policy if exists tabular_review_chats_update on public.tabular_review_chats;
drop policy if exists tabular_review_chats_delete on public.tabular_review_chats;

create policy tabular_review_chats_select on public.tabular_review_chats
  for select to authenticated
  using (
    user_id = auth.uid()::text
    or exists (
      select 1 from public.tabular_reviews tr
      where tr.id = tabular_review_chats.review_id
      and (
        tr.user_id = auth.uid()::text
        or coalesce(tr.shared_with, '[]'::jsonb) @> jsonb_build_array(
          (select email from auth.users where id = auth.uid())
        )
      )
    )
  );

create policy tabular_review_chats_insert on public.tabular_review_chats
  for insert to authenticated
  with check (user_id = auth.uid()::text);

create policy tabular_review_chats_update on public.tabular_review_chats
  for update to authenticated
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

create policy tabular_review_chats_delete on public.tabular_review_chats
  for delete to authenticated
  using (user_id = auth.uid()::text);

-- =============================================================================
-- tabular_review_chat_messages (no user_id, access via tabular_review_chats)
-- =============================================================================

drop policy if exists tr_chat_messages_select on public.tabular_review_chat_messages;
drop policy if exists tr_chat_messages_insert on public.tabular_review_chat_messages;
drop policy if exists tr_chat_messages_delete on public.tabular_review_chat_messages;

create policy tr_chat_messages_select on public.tabular_review_chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.tabular_review_chats trc
      where trc.id = tabular_review_chat_messages.chat_id
      and (
        trc.user_id = auth.uid()::text
        or exists (
          select 1 from public.tabular_reviews tr
          where tr.id = trc.review_id
          and (
            tr.user_id = auth.uid()::text
            or coalesce(tr.shared_with, '[]'::jsonb) @> jsonb_build_array(
              (select email from auth.users where id = auth.uid())
            )
          )
        )
      )
    )
  );

create policy tr_chat_messages_insert on public.tabular_review_chat_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.tabular_review_chats trc
      where trc.id = tabular_review_chat_messages.chat_id
      and trc.user_id = auth.uid()::text
    )
  );

create policy tr_chat_messages_delete on public.tabular_review_chat_messages
  for delete to authenticated
  using (
    exists (
      select 1 from public.tabular_review_chats trc
      where trc.id = tabular_review_chat_messages.chat_id
      and trc.user_id = auth.uid()::text
    )
  );

-- =============================================================================
-- Tables that already had RLS but no policies
-- =============================================================================

-- user_api_keys (user_id uuid)
drop policy if exists user_api_keys_select on public.user_api_keys;
drop policy if exists user_api_keys_insert on public.user_api_keys;
drop policy if exists user_api_keys_update on public.user_api_keys;
drop policy if exists user_api_keys_delete on public.user_api_keys;

create policy user_api_keys_select on public.user_api_keys
  for select to authenticated
  using (user_id = auth.uid());

create policy user_api_keys_insert on public.user_api_keys
  for insert to authenticated
  with check (user_id = auth.uid());

create policy user_api_keys_update on public.user_api_keys
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_api_keys_delete on public.user_api_keys
  for delete to authenticated
  using (user_id = auth.uid());

-- user_mcp_connectors (user_id uuid)
drop policy if exists user_mcp_connectors_select on public.user_mcp_connectors;
drop policy if exists user_mcp_connectors_insert on public.user_mcp_connectors;
drop policy if exists user_mcp_connectors_update on public.user_mcp_connectors;
drop policy if exists user_mcp_connectors_delete on public.user_mcp_connectors;

create policy user_mcp_connectors_select on public.user_mcp_connectors
  for select to authenticated
  using (user_id = auth.uid());

create policy user_mcp_connectors_insert on public.user_mcp_connectors
  for insert to authenticated
  with check (user_id = auth.uid());

create policy user_mcp_connectors_update on public.user_mcp_connectors
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_mcp_connectors_delete on public.user_mcp_connectors
  for delete to authenticated
  using (user_id = auth.uid());

-- user_mcp_oauth_tokens (no user_id, access via user_mcp_connectors)
drop policy if exists user_mcp_oauth_tokens_select on public.user_mcp_oauth_tokens;
drop policy if exists user_mcp_oauth_tokens_insert on public.user_mcp_oauth_tokens;
drop policy if exists user_mcp_oauth_tokens_update on public.user_mcp_oauth_tokens;
drop policy if exists user_mcp_oauth_tokens_delete on public.user_mcp_oauth_tokens;

create policy user_mcp_oauth_tokens_select on public.user_mcp_oauth_tokens
  for select to authenticated
  using (
    exists (
      select 1 from public.user_mcp_connectors c
      where c.id = user_mcp_oauth_tokens.connector_id
      and c.user_id = auth.uid()
    )
  );

create policy user_mcp_oauth_tokens_insert on public.user_mcp_oauth_tokens
  for insert to authenticated
  with check (
    exists (
      select 1 from public.user_mcp_connectors c
      where c.id = user_mcp_oauth_tokens.connector_id
      and c.user_id = auth.uid()
    )
  );

create policy user_mcp_oauth_tokens_update on public.user_mcp_oauth_tokens
  for update to authenticated
  using (
    exists (
      select 1 from public.user_mcp_connectors c
      where c.id = user_mcp_oauth_tokens.connector_id
      and c.user_id = auth.uid()
    )
  );

create policy user_mcp_oauth_tokens_delete on public.user_mcp_oauth_tokens
  for delete to authenticated
  using (
    exists (
      select 1 from public.user_mcp_connectors c
      where c.id = user_mcp_oauth_tokens.connector_id
      and c.user_id = auth.uid()
    )
  );

-- user_mcp_oauth_states (user_id uuid)
drop policy if exists user_mcp_oauth_states_select on public.user_mcp_oauth_states;
drop policy if exists user_mcp_oauth_states_insert on public.user_mcp_oauth_states;
drop policy if exists user_mcp_oauth_states_delete on public.user_mcp_oauth_states;

create policy user_mcp_oauth_states_select on public.user_mcp_oauth_states
  for select to authenticated
  using (user_id = auth.uid());

create policy user_mcp_oauth_states_insert on public.user_mcp_oauth_states
  for insert to authenticated
  with check (user_id = auth.uid());

create policy user_mcp_oauth_states_delete on public.user_mcp_oauth_states
  for delete to authenticated
  using (user_id = auth.uid());

-- user_mcp_connector_tools (no user_id, access via user_mcp_connectors)
drop policy if exists user_mcp_connector_tools_select on public.user_mcp_connector_tools;
drop policy if exists user_mcp_connector_tools_insert on public.user_mcp_connector_tools;
drop policy if exists user_mcp_connector_tools_update on public.user_mcp_connector_tools;
drop policy if exists user_mcp_connector_tools_delete on public.user_mcp_connector_tools;

create policy user_mcp_connector_tools_select on public.user_mcp_connector_tools
  for select to authenticated
  using (
    exists (
      select 1 from public.user_mcp_connectors c
      where c.id = user_mcp_connector_tools.connector_id
      and c.user_id = auth.uid()
    )
  );

create policy user_mcp_connector_tools_insert on public.user_mcp_connector_tools
  for insert to authenticated
  with check (
    exists (
      select 1 from public.user_mcp_connectors c
      where c.id = user_mcp_connector_tools.connector_id
      and c.user_id = auth.uid()
    )
  );

create policy user_mcp_connector_tools_update on public.user_mcp_connector_tools
  for update to authenticated
  using (
    exists (
      select 1 from public.user_mcp_connectors c
      where c.id = user_mcp_connector_tools.connector_id
      and c.user_id = auth.uid()
    )
  );

create policy user_mcp_connector_tools_delete on public.user_mcp_connector_tools
  for delete to authenticated
  using (
    exists (
      select 1 from public.user_mcp_connectors c
      where c.id = user_mcp_connector_tools.connector_id
      and c.user_id = auth.uid()
    )
  );

-- user_mcp_tool_audit_logs (user_id uuid)
drop policy if exists user_mcp_tool_audit_logs_select on public.user_mcp_tool_audit_logs;
drop policy if exists user_mcp_tool_audit_logs_insert on public.user_mcp_tool_audit_logs;

create policy user_mcp_tool_audit_logs_select on public.user_mcp_tool_audit_logs
  for select to authenticated
  using (user_id = auth.uid());

create policy user_mcp_tool_audit_logs_insert on public.user_mcp_tool_audit_logs
  for insert to authenticated
  with check (user_id = auth.uid());

-- =============================================================================
-- Reference data tables (read-only for authenticated)
-- =============================================================================

drop policy if exists courtlistener_citation_select on public.courtlistener_citation_index;
create policy courtlistener_citation_select on public.courtlistener_citation_index
  for select to authenticated
  using (true);

drop policy if exists courtlistener_opinion_select on public.courtlistener_opinion_cluster_index;
create policy courtlistener_opinion_select on public.courtlistener_opinion_cluster_index
  for select to authenticated
  using (true);

-- =============================================================================
-- workflow_open_source_submissions (submitted_by_user_id text)
-- =============================================================================

drop policy if exists wf_oss_submissions_select on public.workflow_open_source_submissions;
drop policy if exists wf_oss_submissions_insert on public.workflow_open_source_submissions;
drop policy if exists wf_oss_submissions_update on public.workflow_open_source_submissions;

create policy wf_oss_submissions_select on public.workflow_open_source_submissions
  for select to authenticated
  using (submitted_by_user_id = auth.uid()::text);

create policy wf_oss_submissions_insert on public.workflow_open_source_submissions
  for insert to authenticated
  with check (submitted_by_user_id = auth.uid()::text);

create policy wf_oss_submissions_update on public.workflow_open_source_submissions
  for update to authenticated
  using (submitted_by_user_id = auth.uid()::text)
  with check (submitted_by_user_id = auth.uid()::text);

-- =============================================================================
-- contact_messages (admin-only, no user_id — no policies = locked to service_role)
-- RLS already enabled; no policy means no access for authenticated/anon.
-- This is intentional: only the backend service role can read/write.
-- =============================================================================
