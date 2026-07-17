-- FK index + referential-integrity tidy-up (TECH_DUE_DILIGENCE §4.3).
-- Idempotent.

-- user_mcp_oauth_states had an index only on expires_at; user_id (account
-- cleanup) and connector_id (connector cascade deletes) would full-scan.
create index if not exists idx_user_mcp_oauth_states_user_id
  on public.user_mcp_oauth_states(user_id);
create index if not exists idx_user_mcp_oauth_states_connector
  on public.user_mcp_oauth_states(connector_id);

-- document_versions.deleted_by was an untyped uuid with no FK — orphaned IDs
-- when a user is deleted. Make it a real FK that nulls on user deletion.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'document_versions_deleted_by_fkey'
      and table_name = 'document_versions'
  ) then
    alter table public.document_versions
      add constraint document_versions_deleted_by_fkey
      foreign key (deleted_by) references auth.users(id) on delete set null;
  end if;
end$$;
