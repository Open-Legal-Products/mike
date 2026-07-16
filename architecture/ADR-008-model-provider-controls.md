# ADR-008 — Model-provider, retention and training controls

- Status: Proposed
- Date: 2026-07-15
- Owners: Privacy owner TBD; technical owner TBD
- Review trigger: Adding a model/provider, changing provider terms, or expanding beyond synthetic/non-confidential beta data

## Context

Mike supports multiple model providers and user-supplied keys. Provider terms,
retention, training use, region, abuse monitoring, and subprocessors can differ
by product and account configuration.

## Options considered

1. Enable every supported provider without policy metadata.
2. Maintain an approved-provider registry with configuration-specific controls
   and block unknown configurations in hosted mode.
3. Operate a single self-hosted model from launch.

## Decision

Use option 2 as the hosted-mode default. Preserve inherited provider support for
self-hosted deployments, but require an explicit approved configuration for
ROSS-hosted use. During the current beta, only synthetic or non-confidential
materials may be submitted regardless of provider terms.

## Consequences

- Provider name alone cannot establish no-training or zero-retention status.
- The registry must record product/tier, region, retention, training, logging,
  contractual basis, review date, and allowed data classes.
- UI must accurately disclose active provider and applicable boundary.

## Follow-up

- [ ] Inventory inherited provider data flows and account modes.
- [ ] Approve hosted configurations before staging invitations.
