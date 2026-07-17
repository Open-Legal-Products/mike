# Public website content governance

## Scope and status

The ROSS public site contains substantiated engineering content for an owner-only checkpoint and invitation-only controlled beta. It is not an effective hosted-service agreement, production privacy notice, accessibility conformance statement, live status service, or claim of comprehensive Ontario legal coverage.

Every public page records an owner role, reviewer, review status, effective date, last-reviewed date, and next-review date. `engineering-reviewed` means the statement was checked against the repository implementation; it does not mean independent legal, privacy, security, accessibility, or product approval. Pages with `independent-review-required` are not effective policies.

## Claim sources

- Product-preservation claims are tied to `docs/mike-feature-baseline.yaml` and baseline contract tests.
- Provider status is generated from `config/public-source-coverage.json`; the generator verifies that each provider identifier exists in its declared implementation source.
- Workflow catalogue content is generated from `workflows/ontario/catalogue.json` and retains draft/reviewer metadata.
- Evaluation claims are tied to `reports/ontario-evaluation-v1.json` and must say that the current corpus is synthetic and not lawyer-approved.
- Privacy, security, retention, and subprocessor statements are limited by the corresponding draft records in `docs/privacy` and `docs/security`.

Do not convert runtime-dependent, unofficial, current-source-only, disabled, unreviewed, or draft states into stronger marketing language.

## Synthetic demonstration

The `/demo` page uses the fictional Northstar Components matter and invented authorities. It includes a visible synthetic label, caption, full text equivalent, verification-state labels, treatment limitation, and professional-review warning. No real client, matter, person, authority, quotation, or confidential information may be substituted in public demos or screenshots.

When an original raster screenshot is captured from the reviewed application, record the commit, route, capture date, viewport, synthetic fixture, alt text, caption, approver, and any redactions. A screenshot must not imply that illustrated providers are live or that a synthetic answer is legally correct.

## Review and freshness

The build checks page governance metadata, dated updates, generated coverage freshness, internal links, semantic structure, byte budgets, and intentional no-index state. A content owner must review changed claims and all pages at or before their next-review date. Security-sensitive details stay in private vulnerability reporting.

## Publication blockers

Before public indexing or a general-public hosted service:

1. Identify the legal operator and accountable owners.
2. Complete independent legal-content, privacy, security, accessibility, and product reviews with dated evidence.
3. Approve actual vendors, tiers, regions, contracts, retention, support and complaint channels.
4. Replace example domains and non-deliverable contacts.
5. Re-run the complete release gate and record the release approval.
