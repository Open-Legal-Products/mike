# ROSS-140 verification

## Delivered

- Five Ontario workflow drafts: civil pleadings, documentary discovery, affidavit fact-checking, factum authority/record cross-checking, and Small Claims intake.
- A validated in-repository source catalogue and deterministic generator.
- Additive backend registration that retains all inherited Mike workflows.
- Public catalogue entries with governed metadata and authenticated-app deep links.
- Synthetic fixtures and explicit independent-review gates.

## Automated verification

- `npm run test:workflow-sources` rejects stale generated files, non-official primary-source hosts, missing governance fields, approved status without review, and malformed workflow instructions.
- Baseline contracts verify exactly five drafts, null review records, additive Mike/ROSS registration, public catalogue wiring, and synthetic fixture paths.
- Website route tests verify the catalogue, a real workflow detail page, draft status, review checks, and app deep link.
- Backend and website builds type-check the generated representations.

## External blocker

These drafts have not been reviewed by an independent Ontario lawyer. ROSS must not describe them as lawyer-reviewed, production-approved, or filing-ready until the governance record and evaluation gate are complete.
