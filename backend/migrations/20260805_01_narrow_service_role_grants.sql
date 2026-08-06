-- Narrow service_role's table/sequence privileges to the data operations the
-- backend actually performs.
--
-- Fresh installs already get this: commit b2dbb39 ("narrow service role
-- schema grants", 2026-07-23) changed backend/schema.sql from
-- `grant all privileges` to `grant select, insert, update, delete` on tables
-- and `grant usage, select` on sequences. But that commit shipped no
-- migration, so every deployment created before it — which follows the
-- documented upgrade path of applying only dated migrations — still carries
-- the old GRANT ALL: TRUNCATE, REFERENCES, and TRIGGER on every table, and
-- UPDATE (setval) on every sequence. This migration brings those
-- deployments to the same grants a fresh install gets.
--
-- Why it matters: service_role bypasses RLS by design, so its privileges
-- are the blast radius of a leaked backend credential or an application
-- bug. The backend only ever reads and writes rows; it never truncates
-- tables, creates triggers, or resets sequences. Least privilege says the
-- role should not be able to either.
--
-- Safe to re-run: REVOKE of an absent privilege and GRANT of a present one
-- are both no-ops, and on a database already at the fresh-install grants
-- the net effect is nothing.
--
-- Wrapped in an explicit transaction: migrations are applied with plain
-- `psql --set ON_ERROR_STOP=1` (no -1), so without begin/commit each
-- statement autocommits and the moment between "revoke all" and the
-- re-grant would be a real zero-privilege window on a live deployment,
-- during which every backend query against these tables fails. Inside one
-- transaction the revoke+grant become visible to other sessions atomically
-- at commit, so running traffic never observes the intermediate state.
begin;

revoke all privileges on all tables in schema public from service_role;
grant select, insert, update, delete
  on all tables in schema public
  to service_role;

revoke all privileges on all sequences in schema public from service_role;
grant usage, select
  on all sequences in schema public
  to service_role;

commit;
