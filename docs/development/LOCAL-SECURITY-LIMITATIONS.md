# Local Security Limitations

> NOT APPROVED FOR REAL OR CONFIDENTIAL DATA
> PRODUCTION READINESS: BLOCKED

This document tracks known security limitations that must be resolved before
production use. These are documented here for visibility, not accepted as risks.

## P0 — Production Blockers

### 1. Incomplete Row Level Security (RLS)

Most tables in the schema do not have RLS enabled. Only 6 auxiliary tables
have RLS policies. This means any user with a valid auth token could
potentially access other users' data via the Supabase API.

**Sprint**: MIKE-03-AUTHORIZATION-TENANCY

### 2. Unauthenticated endpoint: /case-law/case-opinions

The case-law endpoint does not require authentication. CourtListener is
disabled in the Atlas configuration, but the endpoint remains accessible.

**Sprint**: MIKE-03-AUTHORIZATION-TENANCY

### 3. Raw LLM stream logging

`LOG_RAW_LLM_STREAM` and `RAW_LLM_STREAM_LOG_DIR` can write full prompts and
completions to disk. Blocked in production via env validation, but the
capability exists in code.

**Sprint**: MIKE-10-AI-GOVERNANCE

### 4. AGPL-3.0 license validation pending

Legal review of AGPL-3.0 obligations for network-accessible software is
pending. The fork is private, but compliance requirements must be validated
before offering the service to external users.

**Sprint**: Ongoing — legal team

## P1 — High Priority

### 5. Dependency vulnerabilities (high severity)

- `tmp` — path traversal (fixed via `npm audit fix`)
- `protobufjs` — code injection, DoS (fixed via `npm audit fix`)
- `ws` — memory disclosure, DoS (fixed via `npm audit fix`)
- `undici` — TLS bypass, header injection (frontend; requires `npm audit fix`)
- `@anthropic-ai/sdk` — insecure file permissions (breaking change; deferred)
- `esbuild` — dev server file read (low risk for production)

**Sprint**: MIKE-02-QUALITY-CI

### 6. Pre-existing frontend lint errors (25 errors)

The upstream codebase has 25 ESLint errors in existing components. These are
not caused by Sprint 1 changes and will be addressed in Sprint 2.

**Sprint**: MIKE-02-QUALITY-CI

## P2 — Medium Priority

### 7. CourtListener integration

Disabled but not removed. If enabled, it sends document content to a
third-party US legal API.

### 8. No MFA enforcement for admins

MFA exists in the codebase but is not enforced for administrative users.

### 9. No audit trail

No structured audit logging for sensitive operations (login, upload, delete).

## Local Environment Protections

The following protections are in place for the local development environment:

- All services bind to 127.0.0.1 (not 0.0.0.0)
- No LLM key required for startup
- Raw LLM logging disabled by default and blocked in production
- CourtListener token empty by default
- MinIO bucket set to private
- Supabase local is isolated from any remote project
- No production credentials used
- Secrets generated cryptographically (not hardcoded)
