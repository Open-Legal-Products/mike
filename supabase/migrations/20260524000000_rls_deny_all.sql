-- Phase: Safety net — enable RLS on every public base table with a
-- deny-all policy for anon and authenticated roles.
--
-- WHY THIS IS NEEDED:
-- Supabase enables Row Level Security on tables individually.  If a new
-- table is created (e.g. during a migration or via the Supabase dashboard)
-- without an explicit RLS policy, it is accessible to ANY authenticated
-- user.  This migration adds a catch-all deny-all policy to every table
-- in the public schema that doesn't already have one.
--
-- Think of it as a firewall default-deny rule: traffic is blocked unless
-- an explicit allow rule matches.  Without this, the firewall is default-
-- allow — a dangerous posture for a multi-tenant legal document platform.
--
-- WHAT THIS DOES:
-- For each table in public.*:
--   1. Ensures RLS is enabled (idempotent — safe to run on tables that
--      already have it enabled).
--   2. Adds a USING (false) policy for 'anon' and 'authenticated' roles
--      ONLY IF no policy already exists for that table.
--      USING (false) means the predicate is always false — no row ever
--      matches, so no row is ever returned or mutated.
--
-- This does NOT break existing access because tables that already have
-- explicit allow policies are unaffected — the existing policies take
-- precedence.  The deny-all policy only matters for tables that have
-- NO policies yet.
--
-- IMPORTANT: This migration is intentionally additive. It never removes
-- or modifies existing RLS policies.

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
    LOOP
        -- Enable RLS on every public table (idempotent)
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

        -- Add deny-all fallback only if no policies exist yet for this table
        IF NOT EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = t
        ) THEN
            EXECUTE format(
                'CREATE POLICY deny_all_fallback ON public.%I
                 FOR ALL
                 TO anon, authenticated
                 USING (false)
                 WITH CHECK (false)',
                t
            );
        END IF;
    END LOOP;
END
$$;
