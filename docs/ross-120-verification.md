# ROSS-120 verification

## Scope

ROSS-120 establishes the Ontario rules, practice-direction, current-form, source-change, and transparent deadline-calculation foundation.

## Automated checks

- Legal-source unit tests verify allowlisted official sources, link-only forms, synthetic metadata checks, both supported Rule 3.01 counting profiles, observed holidays, after-4 p.m. deemed service, user-provided closures, and invalid-input rejection.
- The baseline contract verifies official-source boundaries, form-currentness warnings, authenticated deadline routing, audit-table isolation, and the explicit limitation-period exclusion.
- Backend TypeScript compilation verifies the route and module contract.

## Human checks before production

1. An Ontario lawyer or paralegal must validate each supported deadline scenario and warning.
2. Operations must schedule the source metadata check and route changes to a human legal-content review queue.
3. Product owners must confirm the current regional practice direction for every workflow that depends on one.
4. Security must apply the migration with a service-role-only writer and confirm no browser role can read or write the audit table.

ROSS-120 is review-ready infrastructure. It is not a representation that a generated deadline, form, rule, or practice direction is current or correct for a particular matter.
