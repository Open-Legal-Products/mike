# ADR-003 — Public website and application topology

- Status: Proposed
- Date: 2026-07-15
- Owners: Technical owner TBD
- Review trigger: Hosting selection, domain purchase, or production infrastructure design

## Context

ROSS needs a public website comparable in accessibility to the upstream project
and a separately secured product application. Marketing content and application
runtime concerns have different deployment and risk profiles.

## Options considered

1. Put public marketing pages inside the inherited frontend.
2. Use one deployment but separate route groups.
3. Add a separate `website/` application and retain `frontend/` as the
   authenticated product, with `backend/` as the API and future workers.

## Decision

Adopt option 3 as the implementation default. Use placeholder website, app,
API, and status domains from `config/ross-brand.json`. Keep production hosting
and providers open until ADR-004 is accepted.

## Consequences

- Public pages can deploy independently and expose no application secrets.
- Shared claims, links, colours, and attribution must derive from centralized
  configuration.
- Cross-origin authentication, cookies, CSP, CSRF, CORS, and deep links need
  explicit testing before staging.

## Follow-up

- [ ] Scaffold `website/` in ROSS-020.
- [ ] Prove local and staging topology in ROSS-040.
