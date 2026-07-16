# ADR-007 — Provider-neutral legal research

- Status: Accepted
- Date: 2026-07-15
- Owners: Technical owner TBD; legal-content owner TBD
- Review trigger: A new source type, provider, jurisdiction, citator, or provider-specific UI requirement

## Context

Inherited U.S. legal research is coupled to CourtListener-specific tools and
data. Ontario support cannot be reliable if source identity, jurisdiction,
authority level, temporal validity, and provider access are collapsed together.

## Options considered

1. Replace CourtListener calls with a Canadian provider in place.
2. Add Canadian provider-specific code beside every CourtListener code path.
3. Define provider-neutral legal-source, document, citation, passage, coverage,
   and verification contracts, then adapt CourtListener and Canadian providers.

## Decision

Adopt option 3. CourtListener remains an optional U.S. provider and is not
removed. Jurisdiction, court level, document type, authority status, version,
provider, retrieval time, canonical URL, and verification state are separate
fields.

## Consequences

- Provider adapters may expose capabilities and gaps without pretending to be
  interchangeable.
- UI and prompts must not infer authority from provider name alone.
- Existing CourtListener behaviour stays protected by baseline tests while an
  adapter is introduced incrementally.

## Follow-up

- [ ] Specify types, capability negotiation, errors, and fixtures in ROSS-050.
- [ ] Add a CourtListener compatibility adapter before changing existing tools.
