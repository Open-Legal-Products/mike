# Quality Gates

This document defines the mandatory quality gates for the Mike Atlas fork.

## Local Gates (`make ci-local`)

Runs in the same order as CI:

1. **Lint** — `npm run lint` (backend + frontend)
   - 0 errors, 0 warnings
   - ESLint with TypeScript rules

2. **Typecheck** — `npm run typecheck` (backend + frontend)
   - `tsc --noEmit`
   - No type errors

3. **Tests** — `npm run test` (backend + frontend)
   - Backend: Vitest with 59+ tests
   - Frontend: Vitest with 85+ tests
   - No skipped tests without justification

4. **Build** — `npm run build` (backend + frontend)
   - Backend: `tsc` compilation
   - Frontend: `next build`

5. **Audit** — `npm audit`
   - Moderate+ severity tracked
   - No critical/high without documented exception

## CI Gates (GitHub Actions)

| Workflow | Checks |
|----------|--------|
| ci.yml | Backend, Frontend, Docker Build |
| security.yml | CodeQL, Secret Scan, Dependency Scan |
| dependency-review.yml | New dependency vulnerabilities |
| container-scan.yml | Trivy image scan |

## Branch Protection

- PR required
- 1 approving review
- Required checks: Backend, Frontend, Docker Build
- No force push
- No branch deletion
- Strict (branch must be up to date)

## Coverage Targets

| Area | Target |
|------|--------|
| Backend global | 65% |
| Configuration/env | 85% |
| Health/readiness | 90% |
| Encryption | 90% |
| Storage adapter | 80% |
| Security middleware | 85% |
| Frontend global | 50% |

## Exceptions

Documented exceptions for known vulnerabilities or test gaps must be:
- Filed as an issue
- Referenced in the PR
- Time-boxed with a fix plan
