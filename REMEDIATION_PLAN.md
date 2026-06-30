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
- _Phase 1 — next._
