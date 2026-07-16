# ADR-006 — Ontario and Canadian legal-source policy

- Status: Accepted
- Date: 2026-07-15
- Owners: Legal-content owner TBD; technical owner TBD
- Review trigger: Adding a source, changing access method, changing licence terms, or making a completeness/currentness claim

## Context

CourtListener is U.S.-focused and must remain available for inherited research.
ROSS needs authorized Ontario and Canadian primary-law sources with traceable
provenance, currency, and coverage gaps.

## Options considered

1. Replace CourtListener with scraped CanLII content.
2. Preserve CourtListener and add provider-neutral access to A2AJ, official
   government/court sources, and negotiated or licensed providers.
3. Rely only on model training data without source retrieval.

## Decision

Adopt option 2. ROSS will not scrape CanLII contrary to its terms or without an
applicable permission. Every provider must have a recorded authorization basis,
coverage statement, update method, canonical link policy, and failure mode.

## Consequences

- Official does not automatically mean complete, machine-readable, timely, or
  licensed for every reuse; metadata must state what was verified.
- A2AJ coverage gaps must be measured and displayed.
- Unsupported source requests must return a clear limitation rather than a
  fabricated or silently substituted authority.

## Follow-up

- [ ] Build the source registry and provider contract in ROSS-050.
- [ ] Implement A2AJ and official legislation in ROSS-060 and ROSS-070.
