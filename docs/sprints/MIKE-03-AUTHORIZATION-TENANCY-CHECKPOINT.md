# MIKE-03-AUTHORIZATION-TENANCY — Sprint Checkpoint

**Date:** 2026-07-10
**Branch:** sprint/MIKE-03-AUTHORIZATION-TENANCY
**Base SHA:** 8c977d4 (main, Sprint 2 merge)
**Sprint scope:** RLS, tenancy model, authorization, route security classification

## Initial Hygiene Check

### Git State
- `git status --short`: clean working tree
- `git branch --show-current`: main → sprint/MIKE-03-AUTHORIZATION-TENANCY
- `git fetch --all --prune`: up to date
- `git rev-list --left-right --count origin/main...HEAD`: 0 0 (at branch creation)
- `git log --oneline --decorate -15`: confirmed 8c977d4 as latest

### Baseline Gates
| Gate | Backend | Frontend |
|---|---|---|
| Install | ✅ npm ci | ✅ npm ci |
| Lint | ✅ 0 errors, 0 warnings | ✅ 0 errors, 0 warnings |
| Typecheck | ✅ | ✅ |
| Unit tests | ✅ 59 tests | ✅ 85 tests |
| Build | ✅ | ✅ |
| Audit | 2 moderate (documented) | 6 moderate (documented) |

### PRs Open
- None at branch creation.

### Branch Protection
- Active: PR required, 1 review, enforce_admins, required checks.

## Sprint 0 P0 Corrections

### Case-law endpoint — NOT a P0
Sprint 0 identified `GET /case-law/case-opinions` as unauthenticated.
**This was incorrect.** The route is `POST /case-law/case-opinions` and
`caseLawRouter.use(requireAuth)` is applied at the router level (line 9).
The endpoint has always required authentication.

### Updated P0 list
1. ~~RLS incompleta~~ → **Being fixed in this sprint**
2. ~~Endpoint sem auth `/case-law/case-opinions`~~ → **Was never unauthenticated**
3. AGPL-3.0 compliance → Still pending (legal)
4. Raw LLM logging → Mitigated in Sprint 1 (blocked in production via env.ts)
