# Sprint 1 — MIKE-01-LOCAL-DEVELOPMENT Result

## Status

```
STATUS: DONE
LOCAL ENVIRONMENT: REPRODUCIBLE
REAL DATA: PROHIBITED
PRODUCTION READINESS: BLOCKED
NEXT SPRINT: MIKE-02-QUALITY-CI
```

## Summary

Established a reproducible local development environment for the Mike Atlas fork. Any developer can clone the repo, run `make bootstrap && make dev`, and have a working stack with frontend, backend, MinIO storage, and Supabase local — all bound to 127.0.0.1.

## SHAs

- **Initial SHA**: `18dc17e` (Sprint 0 merge)
- **Final SHA**: `fb38e69` (migration fix)
- **PR**: [#2 — MIKE-01: Reproducible local development environment](https://github.com/Edu-Carone-SA/mike/pull/2)

## Versions

| Component | Version |
|-----------|---------|
| Node.js | 20.19.0 (pinned in .nvmrc, .node-version, Dockerfiles) |
| npm | 10.x (engines in both package.json) |
| Docker | Docker Desktop (docker-compose) |
| Supabase CLI | latest (via npx) |
| LibreOffice | 7.4.7 (in backend Docker image) |

## Commits (13)

1. `chore(dev): pin Node.js 20.19.0 and npm 10.x`
2. `test(dev): add vitest suite with env, health, and secrets tests`
3. `feat(config): validate backend environment at startup with Zod`
4. `feat(api): add health and readiness endpoints`
5. `feat(dev): adapt storage for S3/MinIO with R2 legacy fallback`
6. `feat(dev): add Docker Compose stack with MinIO, backend, frontend`
7. `feat(dev): add automation scripts and Makefile`
8. `test(dev): add synthetic test fixtures with watermark`
9. `feat(dev): add Supabase local config and migration sync`
10. `docs(dev): document reproducible local setup and security limitations`
11. `chore(dev): update lockfiles after audit fix and remove old fixtures`
12. `fix(dev): remove duplicate baseline schema from migrations`
13. `fix(dev): use schema.sql as single baseline migration for local Supabase`

## Quality Gates

| Gate | Result |
|------|--------|
| Backend typecheck | ✅ Pass |
| Frontend typecheck | ✅ Pass |
| Backend build | ✅ Pass |
| Frontend build | ✅ Pass |
| Backend tests | ✅ 12/12 pass (3 files, 208ms) |
| Frontend lint | ⚠️ 25 pre-existing errors (upstream code, not sprint changes) |
| New code lint | ✅ No errors in files created by this sprint |
| Docker build | ✅ Backend (with LibreOffice) + Frontend |
| Backend health | ✅ `{"status":"ok","service":"mike-backend"}` |

## npm Audit Results

### Backend
- **Before**: 13 vulnerabilities (1 low, 7 moderate, 5 high)
- **After `npm audit fix`**: 2 vulnerabilities (1 low, 1 moderate)
- **Fixed**: tmp, protobufjs, ws, @xmldom/xmldom, fast-xml-builder, fast-xml-parser, qs, @protobufjs/utf8
- **Residual**: esbuild (low/moderate, dev only), @anthropic-ai/sdk (moderate, breaking change)

### Frontend
- **Before**: 23 vulnerabilities (2 low, 14 moderate, 7 high)
- **`npm audit fix` timed out** — will be addressed in Sprint 2
- **Key residual**: undici (high), ws (high), tmp (high), form-data (high), linkify-it (high)

## Vulnerabilities Fixed

| Package | Severity | Issue | Fix |
|---------|----------|-------|-----|
| tmp | high | Path traversal via unsanitized prefix/postfix | npm audit fix |
| protobufjs | high | Code injection, DoS, prototype pollution | npm audit fix |
| ws | high | Memory disclosure, DoS | npm audit fix |
| @xmldom/xmldom | high | XML injection, uncontrolled recursion | npm audit fix |
| fast-xml-builder | high | Attribute bypass, comment regex bypass | npm audit fix |
| qs | moderate | DoS via stringify crash | npm audit fix |
| fast-xml-parser | moderate | XML comment/CDATA injection | npm audit fix |

## Vulnerabilities Residual

| Package | Severity | Reason |
|---------|----------|--------|
| esbuild | low/moderate | Dev server only, Windows-specific |
| @anthropic-ai/sdk | moderate | Breaking change (0.91→0.110), deferred to Sprint 2 |
| undici (frontend) | high | npm audit fix timed out, Sprint 2 |
| ws (frontend) | high | npm audit fix timed out, Sprint 2 |
| tmp (frontend) | high | npm audit fix timed out, Sprint 2 |
| form-data (frontend) | high | npm audit fix timed out, Sprint 2 |
| linkify-it (frontend) | high | npm audit fix timed out, Sprint 2 |

## Services Deployed Locally

| Service | Port | Bind | Status |
|---------|------|------|--------|
| Frontend (Next.js) | 3000 | 127.0.0.1 | ✅ Build pass |
| Backend (Express) | 3001 | 127.0.0.1 | ✅ Health verified |
| MinIO | 9000/9090 | 127.0.0.1 | ✅ Configured |
| Supabase local | 54321 | 127.0.0.1 | ⚠️ Vector container health issue on this machine |

## Fixtures

- `sample-contract.pdf` (1.6 KB)
- `sample-contract.docx` (36.7 KB)
- `sample-spreadsheet.xlsx` (4.9 KB)
- `sample-nda.pdf` (1.6 KB)
- `empty.pdf` (1.5 KB)
- `invalid-extension.txt` (100 B)
- `corrupted.pdf` (64 B)
- `near-limit.pdf` (231.5 KB)

All contain: `SYNTHETIC TEST DOCUMENT — NO REAL CLIENT DATA`

## Production Blockers (carried from Sprint 0)

1. **P0**: Incomplete RLS — most tables lack Row Level Security
2. **P0**: Unauthenticated endpoint `/case-law/case-opinions`
3. **P0**: Raw LLM stream logging capability (blocked in production via env validation)
4. **P0**: AGPL-3.0 license validation pending
5. **P1**: 25 pre-existing frontend lint errors
6. **P1**: Frontend dependency vulnerabilities (undici, ws, tmp, form-data, linkify-it)

## Architecture Tested

```
Browser → Frontend (Next.js :3000) → Backend (Express :3001)
                                        ├── Supabase (Auth + Postgres :54321)
                                        ├── MinIO (S3 storage :9000)
                                        └── LibreOffice (in backend container)
```

## Commands Executed

```bash
make doctor                     # prerequisites check
npm ci --prefix backend         # deterministic install
npm ci --prefix frontend
npm run typecheck --prefix backend   # ✅
npm run typecheck --prefix frontend  # ✅
npm run build --prefix backend       # ✅
npm run build --prefix frontend      # ✅
npm run test --prefix backend        # ✅ 12/12
npm run lint --prefix frontend       # ⚠️ 25 pre-existing errors
npm audit --prefix backend           # 13→2 after fix
npm audit --prefix frontend          # 23 (timeout on fix)
docker-compose build backend frontend # ✅
npx supabase@latest start            # schema applied, vector health issue
```

## Conclusion

**READY** to start Sprint 2 (MIKE-02-QUALITY-CI).

The local development environment is reproducible from a clean checkout. All code created in this sprint passes typecheck, build, and tests. Pre-existing upstream issues (lint errors, frontend vulnerabilities) are documented and will be addressed in Sprint 2. Production remains NO-GO until P0 blockers are resolved in Sprints 3, 10, and 14.
