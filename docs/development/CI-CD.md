# CI/CD Pipeline

## Workflows

### ci.yml
Triggers: push to main, PR to main

Jobs:
- **Backend**: npm ci, lint, typecheck, test, build, audit
- **Frontend**: npm ci, lint, typecheck, test, build, audit
- **Docker Build**: build backend and frontend images

### security.yml
Triggers: push to main, PR to main, weekly schedule

Jobs:
- **CodeQL**: JavaScript/TypeScript static analysis
- **Secret Scan**: gitleaks CLI on full history
- **Dependency Scan**: npm audit for both packages

### dependency-review.yml
Triggers: PR to main

Blocks PRs that introduce new dependencies with high+ severity vulnerabilities.

### container-scan.yml
Triggers: changes to Dockerfiles or package.json

Scans Docker images with Trivy for CRITICAL and HIGH vulnerabilities.

## Concurrency

All workflows use:
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

## Artifacts

- Coverage reports (LCOV + HTML) — 14 day retention
- Test results — 7 day retention
- Playwright traces (on failure) — 7 day retention

## Local Reproduction

```bash
make ci-local
```

Reproduces the same gates as CI in the same order.
