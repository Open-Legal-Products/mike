# ADR-012 — Release, rollback and legal-source governance

- Status: Proposed
- Date: 2026-07-15
- Owners: Release owner TBD; legal-content owner TBD; technical owner TBD
- Review trigger: First staging deployment, first source ingestion, or any production release

## Context

Software releases and legal-source updates can fail independently. A current
application can still present stale law, and a source update can introduce
incorrect metadata without an application deployment.

## Options considered

1. Deploy from `main` and update sources without versioned approvals.
2. Version software, source snapshots, coverage manifests, prompts, workflows,
   schemas, and evaluations with independent rollback and recorded reviewers.
3. Freeze all legal sources into infrequent application releases.

## Decision

Use option 2 as the release design. Production remains unauthorized until CI,
staging, migration, backup/restore, rollback, source-currency, security, and
Ontario evaluation gates are implemented and assigned owners.

## Consequences

- Every answer must be traceable to provider/source identifiers and retrieval or
  version metadata where available.
- Coverage degradation can block or roll back a source independently.
- Release notes must distinguish code changes from source/content changes.
- Failed verification must produce a limitation state, not silent stale output.

## Follow-up

- [ ] Define release artefacts and approval matrix in ROSS-150 and ROSS-170.
- [ ] Add source health, freshness, quarantine, and rollback procedures.
