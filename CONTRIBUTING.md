# Contributing to Mike Atlas

## Prerequisites

- Node.js 20.x (see `.nvmrc`)
- npm 10.x
- Docker Desktop
- Git

## Getting Started

```bash
make doctor      # verify prerequisites
make bootstrap   # install deps, start Supabase + MinIO
make dev         # start frontend + backend
make smoke-local # verify stack
```

## Development Workflow

1. **Branch**: Create from `main` (updated)
   ```bash
   git switch main && git pull && git switch -c feat/<slug>
   ```

2. **Commits**: Use Conventional Commits
   ```
   feat(api): add document export endpoint
   fix(auth): resolve token expiry handling
   chore(deps): update express to 4.22
   test(backend): add storage integration tests
   docs(ci): update quality gates documentation
   ```

3. **Quality gates** (must pass before PR):
   ```bash
   make ci-local
   ```
   This runs: lint, typecheck, test, build, audit

4. **PR**: Open via `gh pr create` with the PR template filled.

5. **CI**: All checks must be green before merge.

6. **Merge**: Squash merge to `main`. Delete the branch.

## Quality Gates

| Gate | Command | Required |
|------|---------|----------|
| Backend lint | `npm run lint --prefix backend` | ✅ |
| Frontend lint | `npm run lint --prefix frontend` | ✅ |
| Backend typecheck | `npm run typecheck --prefix backend` | ✅ |
| Frontend typecheck | `npm run typecheck --prefix frontend` | ✅ |
| Backend tests | `npm run test --prefix backend` | ✅ |
| Frontend tests | `npm run test --prefix frontend` | ✅ |
| Backend build | `npm run build --prefix backend` | ✅ |
| Frontend build | `npm run build --prefix frontend` | ✅ |
| npm audit | `make audit` | ⚠️ (non-blocking) |
| E2E | `make test-e2e` | When applicable |

## Data Policy

**NOT APPROVED FOR REAL OR CONFIDENTIAL DATA**

- Use only synthetic fixtures from `test/fixtures/documents/`
- No real client data, credentials, or API keys
- No production Supabase or S3 credentials

## Security

- Never commit `.env` files
- Never log secrets, tokens, or API keys
- Report security issues privately (see `.github/ISSUE_TEMPLATE/security_bug.yml`)
- Raw LLM logging is prohibited in production
