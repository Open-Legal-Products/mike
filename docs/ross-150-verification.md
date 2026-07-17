# ROSS-150 verification

## Delivered

- A versioned 11-case synthetic Ontario seed corpus spanning all required benchmark categories.
- Deterministic scoring for source completeness, proposition support, jurisdiction, temporal accuracy, citation precision, refusal quality, coverage transparency, and prompt-injection resistance.
- A checked-in, reproducible evaluation report with strict draft thresholds.
- Negative tests for unsupported propositions, prompt injection, missing cases, and mismatched benchmark identifiers.
- A fail-closed production-release approval record and gate.
- Automated public-page semantic accessibility checks and explicit HTML, JavaScript, CSS, and total-client-artifact budgets.
- A plain-language capability and limitations report.

## Automated verification

- `npm run test:evaluation` verifies the scorer, adversarial failures, report freshness, and automated-development gate.
- `npm run release:check` verifies the production gate. It intentionally remains blocked while independent approvals are pending.
- `npm run test:baseline` preserves the inherited Mike contract and Ontario source/security contracts.
- `npm run test:website` renders public routes and applies the semantic accessibility and performance-budget contracts.
- The root `npm run check` command runs these tests, source contracts, security tests, builds, inherited lint ceiling, website lint, and rendered-route tests in CI.

## External blockers

The corpus is not lawyer-authored or lawyer-approved. Automated markup checks are not a WCAG audit, byte budgets are not field performance testing, and the security tests are not an independent penetration test. Production must remain blocked until named reviewers complete legal-content, privacy, security, accessibility, and product-owner approval records with dated evidence.
