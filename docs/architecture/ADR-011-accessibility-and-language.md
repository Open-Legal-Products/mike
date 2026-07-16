# ADR-011 — Accessibility and language expansion

- Status: Proposed
- Date: 2026-07-15
- Owners: Product owner TBD; accessibility owner TBD
- Review trigger: Public preview, procurement, French content, or a material UI framework change

## Context

ROSS serves legal professionals and must not create avoidable barriers. Ontario
and Canadian legal sources may be English, French, or bilingual. Accessibility
and bilingual support require architecture choices before content multiplies.

## Options considered

1. Defer accessibility and internationalization until after launch.
2. Target WCAG 2.2 AA from the first new ROSS surface and make all new content
   localization-ready, while launching English-first with labelled language
   coverage.
3. Require complete bilingual parity before any technical preview.

## Decision

Use option 2 as the initial target. Do not claim formal conformance until an
audit is completed. Preserve source text and language metadata; do not present
machine translation as an official version.

## Consequences

- New components need keyboard, focus, screen-reader, zoom, motion, contrast,
  error, and plain-language acceptance tests.
- User-interface strings must be separated from logic.
- Coverage pages must identify the language and official status of each source.

## Follow-up

- [ ] Add automated and manual accessibility gates to ROSS-020.
- [ ] Define the French-content and bilingual-support milestone.
