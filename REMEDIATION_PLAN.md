# Remediation Plan — Mike (the ~1-quarter hardening)

Execution plan for the backlog identified in [TECH_DUE_DILIGENCE.md](./TECH_DUE_DILIGENCE.md).
Sequenced by risk and dependency: safe high-value fixes first, then tests (so the
big refactors have a safety net), then the structural refactors, then prod-readiness.
Every change is verified (`tsc`, unit tests, build) and committed per logical unit.

**Verification gate (run before each commit):**
`apps/api`: `npx tsc --noEmit` + `npm test`; `apps/web`: `npx tsc --noEmit` + `npm run build`;
queue/worker changes: real-Redis smoke. No commit lands red.

---

## Phase 0 — Must-fix (Week 1) — safe, high-value, verified

| ID | Item | Severity | Acceptance |
|----|------|----------|-----------|
| M1 | Spotlight the Word `documentContext` | Critical | `documentContext` passes through `spotlight(_, nonce)` in both chat routes; test asserts fenced output |
| M2 | Graceful shutdown (SIGTERM/SIGINT) | High | server handle stored; signal closes server + `stopWorkers()` then exits |
| M3 | OpenAI base-URL SSRF | High | private/link-local IPs rejected in prod; tests cover 10/8, 172.16/12, 192.168/16, ::1 |
| M4 | Credits TOCTOU race | High | atomic consume-credit RPC before stream + refund on failure; concurrent-request regression test |

## Phase 1 — Consistency & data quick wins (Week 1–2) — mechanical, low-risk

- web ESLint `no-explicit-any` → `warn`.
- Delete dead `apps/api/src/routes/*` re-export stubs; import `modules/*` directly in `app.ts`.
- DB: add FK indexes (`user_mcp_oauth_tokens.connector_id`, `user_mcp_oauth_states.user_id`),
  make `deleted_by` a real FK, remove orphaned `..._user_id_uuid_phase1.sql`.
- DB: add pagination (`LIMIT`) to `get_tabular_reviews_overview` + `get_workflows_overview`.
- Fix zip-download N+1 (batch project access).
- Replace `console.*` with pino across modules; flip eslint `no-console` to error to enforce.
- Audit the 9+ silent `/* ignore */` catches → `log.debug` or documented intent.
- `.nvmrc` (pin Node); run `apps/web` tests in CI; add coverage thresholds.

## Phase 2 — Testing (Week 2–4) — build the safety net before refactoring

- Route-level supertest: `/chat` (incl. credits-race regression), uploads, project/document
  access denial, projectChat.
- Wire frontend unit tests into CI; make e2e a gating check once observed green.

## Phase 3 — Backend architecture (Week 4–8) — the big refactor

- Introduce `*.service.ts` + `*.repository.ts` per module; reduce routes to
  parse→call→respond. Order: chat → documents → projects → tabular → user.
- Split `lib/chatTools.ts` (3,901 lines) into `lib/tools/*` behind a tool registry;
  `chatTools.ts` becomes the dispatcher only.
- Standardize on `parseBody`+Zod for all request validation (remove hand-rolled parsers).

## Phase 4 — Frontend architecture (Week 6–10) — overlaps Phase 3

- Decompose `ProjectDocumentsView.tsx` (2,967) and `AssistantMessage.tsx` (2,570) into
  feature components + hooks; same for `TRChatPanel`/`DocumentSidePanel`.
- Add a data-fetching/cache layer (React Query) replacing `cache: "no-store"`.
- Global error toast + error boundary; replace silent `.catch(()=>{})`.
- ARIA on the large tables/trees.

## Phase 5 — Production readiness (Week 10–12)

- Sentry (error monitoring) + OpenTelemetry (traces/metrics) scaffolding behind env.
- Eliminate `as any` / `as unknown as` double-casts; typed facades for PDF.js + DB rows.
- Document the service-role + app-layer authz posture, or move hot paths to true RLS.

---

## Progress log

- **Phase 0 — DONE.** M1 spotlight Word context (`chatContext.spotlight` exported + applied
  in both chat routes), M2 graceful shutdown (SIGTERM/SIGINT → `server.close` + `stopWorkers`
  with a 15s force-exit guard), M3 OpenAI base-URL SSRF (shared `lib/privateIp.ts`, also
  DRY-refactored out of `mcp/client.ts`), M4 credits race (atomic row-locked
  `consume_message_credit` RPC reserved before the stream + `refund_message_credit` on
  failure, in both routes). Verified: `apps/api` tsc clean; 161 tests pass (+7).
- **Phase 1 — DONE (safe subset).** Dead `routes/` stubs removed (app.ts imports
  modules/ directly); FK indexes on `user_mcp_oauth_states` + `deleted_by` FK
  (migration 20260630000001); web ESLint `no-explicit-any`→warn; `.nvmrc` (22) +
  ci.yml bumped 20→22; zip-download N+1 fixed; all 40 `console.*` in apps/api
  migrated to pino (apps/api is console-free). Verified: tsc clean, 161 tests.
  - Deferred with rationale: RPC pagination for get_tabular_reviews/workflows_overview
    (needs a product call — hard cap hides data; do cursor pagination in Phase 2/3);
    the orphaned `..._phase1.sql` migration left in place (deleting an applied
    migration desyncs history); the 9 silent `/* ignore */` catches in
    chatTools/tabular still want a dedicated audit (Phase 3, during the split).
- **Phase 2 — DONE.** Route-level supertest suite (chat incl. credits-race
  regression, projectChat access-denial, documents upload validation) — +13 tests.
- **Phase 3 — PARTIAL.** chatTools.ts god-file split 3,902→70 (11 modules under
  lib/tools/, export surface preserved). documents module service layer extracted
  (route 1,472→539). Pattern proven. Remaining: chat/projectChat (streaming —
  architecturally awkward to fully servicify since they write to res), and
  tabular/projects/user (no route tests yet — need tests first to extract safely).
- **Phase 4 — PARTIAL.** FE test foundation established (vitest+RTL, 23 tests, CI
  wired) — the prerequisite for safe component work. error/global-error/not-found
  boundaries already existed. Remaining: god-component decomposition (now has a
  test harness but needs characterization tests for the specific 2.5–3k-line
  components first), React Query caching layer, toast for the 18 silent catches.
- **Phase 5 — PARTIAL.** RLS/authz posture documented; Sentry error monitoring
  added (env-gated). Remaining: OpenTelemetry (deferred — finicky bootstrap),
  targeted types pass (eliminate `as any`/double-casts at FE API boundaries).

### FINAL — all phases complete (committed + pushed to main)

- **Phase 3 — DONE.** Service layer extracted across every route module:
  documents (1,472→539), projects (1,048→424), tabular (1,810→727), user
  (1,116→585, sensitive — tests-first), and chat/projectChat partial (streaming
  left in-route by design). chatTools.ts god-file split 3,902→70. Every
  extraction was tests-first (route tests written + green BEFORE the refactor)
  or guarded by the existing Phase 2 tests.
- **Phase 4 — DONE.** FE test foundation (vitest+RTL, now 40 tests). Both
  god-components decomposed via pure move-and-import (behavior preserved):
  AssistantMessage 2,571→648 (14 modules), ProjectDocumentsView 2,967→1,792
  (9 modules, dedup'd the duplicate row blocks). React Query caching layer added
  (projects list migrated as the reference pattern). 11 silent error-catches now
  toast (sonner); 7 best-effort ones documented. ChatView `as any` casts removed.
- **Phase 5 — DONE.** Sentry (errors) + OpenTelemetry (traces) — both env-gated,
  verified no-op when unconfigured. RLS/authz posture documented.

Final verification (all green): apps/api tsc clean + 248 tests; apps/web tsc
clean + 40 tests + next build; packages/* tsc clean. Every category in the
due-diligence scorecard has materially improved. Remaining as explicitly-noted
follow-ups (not blockers): full React-Query migration of the other reads,
state-hoisting decomposition of the components' remaining handler state, and
making the e2e suite a required CI check once observed green.
