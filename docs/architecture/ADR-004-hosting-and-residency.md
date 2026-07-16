# ADR-004 — Hosting and data residency

- Status: Proposed
- Date: 2026-07-15
- Owners: Operator TBD; privacy owner TBD; technical owner TBD
- Review trigger: Selecting any production vendor, region, subprocessor, backup location, or support-access arrangement

## Context

Ontario legal professionals will reasonably care where documents, database
records, logs, backups, and model requests are processed. No production vendor
or region has been approved.

## Options considered

1. Select the fastest global services without residency requirements.
2. Target Canadian storage and processing for ROSS-controlled production data,
   documenting every exception and transborder model request.
3. Self-host every dependency in Canada immediately.

## Decision

Use option 2 as the production target. Preview deployments outside Canada are
permitted only for synthetic data and must not contain production secrets. This
ADR does not approve a vendor or authorize a production launch.

## Consequences

- The architecture inventory must cover primary storage, replicas, logs,
  analytics, email, backups, support access, and subprocessors.
- Model-provider processing location and retention must be disclosed separately.
- Marketing may say “Canadian data residency target,” not “all data stays in
  Canada,” until verified controls support the stronger claim.

## Follow-up

- [ ] Compare Canadian-region hosting options and costs.
- [ ] Complete data-flow and subprocessor inventories before acceptance.
