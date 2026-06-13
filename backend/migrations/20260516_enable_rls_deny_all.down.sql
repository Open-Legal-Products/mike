-- Rollback for 20260516_enable_rls_deny_all.sql (issue #144).
--
-- Drops the deny_client_access_<tbl> policy and disables RLS on every public
-- base table that did not have RLS before this migration ran. The REVOKE
-- statements in schema.sql remain in force so client roles still cannot reach
-- these tables — this rollback only removes the second wall, not the first.
--
-- Tables with pre-existing RLS (enabled in schema.sql before this migration):
--   user_api_keys, courtlistener_citation_index, courtlistener_opinion_cluster_index
-- RLS is left ENABLED on those tables on rollback so they are not left in a
-- worse state than before the migration ran.
--
-- Idempotent — safe to re-run.

drop event trigger if exists enforce_rls_on_public_tables;
drop function if exists public.enforce_rls_on_public_tables();

do $$
declare
    tbl text;
    policy_name text;
    -- Tables that had RLS enabled before this migration. Skipped when
    -- disabling RLS so rollback does not leave them worse than their
    -- pre-migration state.
    pre_existing_rls text[] := array[
        'user_api_keys',
        'courtlistener_citation_index',
        'courtlistener_opinion_cluster_index'
    ];
begin
    for tbl in
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
    loop
        policy_name := 'deny_client_access_' || tbl;
        execute format('drop policy if exists %I on public.%I', policy_name, tbl);
        if not (tbl = any(pre_existing_rls)) then
            execute format('alter table public.%I disable row level security', tbl);
        end if;
    end loop;
end$$;
