-- Grant DML privileges to service_role on the entire public schema.
--
-- The API authenticates with the service-role key (which has BYPASSRLS), but
-- BYPASSRLS only skips row-level *policies* — it does NOT substitute for
-- table-level GRANTs. If a baseline/hardening migration ever revokes the
-- default privileges, the API gets "permission denied for table …" even though
-- RLS would have let it through. This grant is the service-role counterpart to
-- the deny-all RLS fallback (20260524000000_rls_deny_all.sql).
--
-- Granted across ALL current tables (rather than a hardcoded list) so it also
-- covers the tables the upstream merge added (mcp_connectors*, courtlistener*,
-- overview RPCs' backing tables) and stays correct as the schema grows.
-- Idempotent: GRANT is a no-op when the privilege already exists.

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Apply the same defaults to objects created in the future so new migrations
-- don't silently reintroduce the "permission denied" failure.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;
