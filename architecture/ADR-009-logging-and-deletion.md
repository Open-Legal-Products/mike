# ADR-009 — Logging, audit, retention and deletion

- Status: Proposed
- Date: 2026-07-15
- Owners: Privacy owner TBD; security owner TBD
- Review trigger: Staging deployment, hosted user admission, incident response requirement, or data-boundary expansion

## Context

Operational logs help diagnose failures and security events but can accidentally
capture prompts, document text, legal queries, identifiers, tokens, or secrets.
Deletion must cover primary data and documented downstream copies.

## Options considered

1. Log request and response bodies for maximum debugging.
2. Disable all logs and audits.
3. Use structured metadata-only operational logs, separate security audit
   events, explicit retention, redaction, access controls, and tested deletion.

## Decision

Adopt option 3 as the design default. Never intentionally log document bodies,
prompt bodies, model responses, credentials, signed URLs, or access tokens.
Production retention periods remain open pending privacy and operational review.

## Consequences

- Logging helpers need allow-listed fields and automated secret/content tests.
- User deletion must document databases, objects, search indexes, caches, logs,
  backups, vendors, and legal holds.
- Audit access itself must be auditable and least-privileged.

## Follow-up

- [ ] Create a data inventory and retention schedule.
- [ ] Add deletion, redaction, and restore tests in ROSS-130.
