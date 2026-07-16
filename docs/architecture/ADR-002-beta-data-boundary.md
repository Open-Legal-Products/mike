# ADR-002 — Beta data boundary

- Status: Accepted
- Date: 2026-07-15
- Owners: Product owner TBD; privacy owner TBD
- Review trigger: Any proposal to accept confidential, privileged, proprietary, regulated, or real client material

## Context

The inherited product supports document uploads and model providers, but ROSS
does not yet have a completed privacy impact assessment, threat model,
subprocessor inventory, retention schedule, or production security review.

## Options considered

1. Accept normal law-firm client documents immediately.
2. Disable all document functionality.
3. Preserve functionality but restrict the hosted beta to synthetic or
   affirmatively non-confidential materials.

## Decision

Option 3 is adopted. Development, tests, demonstrations, previews, and the
hosted beta may use only synthetic or non-confidential material. This is a data
classification rule, not merely a disclaimer.

## Consequences

- Test fixtures must be visibly synthetic and auditable.
- Upload and onboarding controls must warn and, where feasible, require an
  acknowledgement before material is submitted.
- Logs, screenshots, demos, support tickets, and analytics inherit the same
  restriction.
- Production handling of client material remains prohibited until a successor
  ADR and security package are approved.

## Follow-up

- [ ] Implement the hosted-beta enforcement controls in ROSS-130.
- [ ] Complete the privacy and security reviews before expanding the boundary.
