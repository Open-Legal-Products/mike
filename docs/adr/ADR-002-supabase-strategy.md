# ADR-002 — Supabase Strategy for Mike Atlas

## Status

Proposed — pending Sprint 0 acceptance.

## Context

Mike depends on Supabase Auth, Supabase client libraries, service-role key, and a specific Postgres schema (including triggers, functions, and RLS). Replacing this is a structural refactor.

## Decision

Use **managed Supabase** in the first production phase.

- Separate Supabase projects for staging and production.
- Apply `backend/schema.sql` only to fresh databases.
- Use dated incremental migrations for updates.
- Maintain a migration-control table with checksums.
- Enforce RLS on all tenant-facing tables as defense-in-depth.
- Configure custom SMTP, redirect URLs, and MFA policies.
- Enable backups and evaluate PITR for production.

## Rationale

- Avoids rewriting auth, migrations, and client code.
- Keeps upstream merge path open.
- Reduces operational burden on Atlas.

## Consequences

- Data residency depends on Supabase region selection.
- Atlas must negotiate DPA and subprocessor terms.
- Long-term self-hosting (Option B) remains a Phase 2 candidate if residency/compliance requires it.

## Related

- ADR-001 (Hosting strategy)
