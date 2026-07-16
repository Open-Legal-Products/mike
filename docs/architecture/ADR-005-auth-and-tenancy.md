# ADR-005 — Authentication, invitations, roles and tenancy

- Status: Proposed
- Date: 2026-07-15
- Owners: Product owner TBD; security owner TBD
- Review trigger: First hosted beta, organization accounts, external identity providers, or real client data

## Context

Mike already uses Supabase Auth and user-scoped records. ROSS needs controlled
invitations without weakening inherited authentication, MFA, export, deletion,
or sharing behaviour.

## Options considered

1. Public self-service sign-up.
2. Invitation-only individual accounts using inherited authentication.
3. Firm-level multi-tenancy with SSO and administrator roles at beta launch.

## Decision

Use option 2 for the first hosted beta. Preserve inherited authentication and
MFA. Add an invitation allow-list and explicit beta role without treating email
domain membership as authorization. Organization tenancy and SSO remain future
decisions.

## Consequences

- Authorization must remain server-enforced and tested independently of UI.
- Invitation state, account state, and data ownership must not be conflated.
- Sharing must not bypass beta admission or expose records across users.
- No claim of enterprise tenancy or SSO is permitted yet.

## Follow-up

- [ ] Design invitation lifecycle and administrator recovery.
- [ ] Threat-model auth, sharing, RLS, service keys, and account deletion.
