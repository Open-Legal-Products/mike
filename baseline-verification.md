# ROSS-000 Baseline Verification

Date: 2026-07-15

Baseline commit: `ba02044812da7548103e24e7675fca1dec62310d`

Local verification runtime: Node.js 24.14.0

CI target runtime: Node.js 20

## Result

The inherited Mike application is now surrounded by an additive preservation contract. No inherited backend or frontend application source was changed in this package.

| Check | Result | Notes |
|---|---|---|
| Product boundary and feature contract | Pass | 8 of 8 baseline tests pass |
| Backend TypeScript build | Pass | Existing `tsc` build succeeds |
| Frontend production build | Pass | Existing Next.js application compiles, type-checks, and prerenders with synthetic build-time configuration |
| Frontend strict lint | Existing debt | 25 errors and 42 warnings at the pinned Mike baseline |
| Frontend regression lint gate | Pass | New error groups or increased error/warning counts fail the gate; reductions are allowed |
| Deployed health smoke tests | Not run | Requires `ROSS_E2E_API_URL` and `ROSS_E2E_APP_URL` |
| GitHub Actions run | Pass | ROSS pull request #1 passed baseline verification and merged to `main` on 2026-07-15 |

## Commands

From the repository root:

~~~bash
npm run install:all
npm run check
~~~

To inspect all inherited frontend lint findings:

~~~bash
npm run lint:strict
~~~

To test a deployed environment:

~~~bash
ROSS_E2E_API_URL=https://api.example.test \
ROSS_E2E_APP_URL=https://app.example.test \
npm run test:e2e
~~~

## Preserved baseline

The machine-readable inventory in `docs/mike-feature-baseline.yaml` records the inherited application capabilities, routes, API mounts, database tables, and CourtListener integration. `tests/baseline/repository-contract.test.mjs` protects the most important surfaces from accidental removal while Ontario and Canadian capabilities are added.

## Known baseline debt

The strict frontend lint result is intentionally not disguised. Its current error groups are recorded in `tests/baseline/frontend-lint-debt.json`. The baseline gate allows this inherited debt to decrease but rejects increases or new error groups. Removing the debt should be completed as a dedicated maintenance package so behavioural changes receive focused review.
