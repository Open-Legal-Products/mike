# ROSS-080 verification

Milestone: Licensed CanLII/commercial connector framework
Delivery: A — Core Ontario product

## Implemented

- Disabled-by-default `canlii-licensed` provider descriptor.
- Contract, organization, credential, transport, operation, retention,
  full-text, and redistribution entitlement gates.
- Exact approved API-host validation; no CanLII website scraper.
- Allowed/denied audit-event hook without credential or content fields.
- Credential-safe provider status.
- Synthetic denial, activation, secret-redaction, and full-text tests.
- Reusable onboarding and activation checklist.

## Boundary

This milestone does not claim a CanLII agreement or activate a CanLII API. The
provider cannot perform search or retrieval until a separately reviewed
contract-specific transport implements only the authorized operations.
