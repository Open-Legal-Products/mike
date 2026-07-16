# ROSS architecture decisions

Architecture decision records (ADRs) distinguish approved product boundaries
from proposed implementation choices. `Accepted` records govern current work;
`Proposed` records are safe defaults for development but cannot support a
production claim until their open items are resolved.

| ADR | Decision | Status |
|---|---|---|
| [ADR-001](ADR-001-product-scope.md) | Product scope and intended users | Accepted |
| [ADR-002](ADR-002-beta-data-boundary.md) | Beta data boundary | Accepted |
| [ADR-003](ADR-003-application-topology.md) | Website and application topology | Proposed |
| [ADR-004](ADR-004-hosting-and-residency.md) | Hosting and data residency | Proposed |
| [ADR-005](ADR-005-auth-and-tenancy.md) | Authentication and tenancy | Proposed |
| [ADR-006](ADR-006-legal-source-policy.md) | Ontario and Canadian source policy | Accepted |
| [ADR-007](ADR-007-provider-neutral-research.md) | Provider-neutral legal research | Accepted |
| [ADR-008](ADR-008-model-provider-controls.md) | Model-provider controls | Proposed |
| [ADR-009](ADR-009-logging-and-deletion.md) | Logging, audit, retention and deletion | Proposed |
| [ADR-010](ADR-010-agpl-and-attribution.md) | AGPL and upstream attribution | Accepted |
| [ADR-011](ADR-011-accessibility-and-language.md) | Accessibility and language expansion | Proposed |
| [ADR-012](ADR-012-release-and-source-governance.md) | Release and source governance | Proposed |

## Status meanings

- **Accepted:** approved and binding until superseded.
- **Proposed:** recommended default; production dependencies remain open.
- **Superseded:** replaced by a later ADR, which must be linked.
- **Rejected:** considered and not adopted.

Copy [ADR template](adr-template.md) for later decisions. Changes to an accepted
ADR require a focused pull request, named reviewer, and explicit consequences.
