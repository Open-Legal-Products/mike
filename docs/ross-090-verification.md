# ROSS-090 verification

Milestone: Canadian citation engine
Delivery: A — Core Ontario product

## Implemented

- Canadian case, reporter, statute, regulation, and pinpoint parsers.
- Normalization, deterministic canonical IDs, and exact deduplication.
- Ontario and McGill-compatible primary-law rendering profiles.
- Separate citation, passage, currency, and treatment verification states.
- Provider-backed case and official-legislation verification.
- Authenticated parse and verify routes.
- Positive, malformed, bilingual, historical, range, deduplication, and
  verification-boundary tests using synthetic data.

## Safety property

No parsed or generated citation is marked verified solely because it matches a
regular expression. Verification requires a matching result from a configured
authorized provider.
