# Technical Due Diligence — Mike

> Acquisition-grade technical review of the Mike legal-AI platform, oriented toward
> evaluating the technical cofounder's engineering judgment as much as the codebase.
> Review performed 2026-06-30 against `main` (the upstream-synced, hardened,
> Word-add-in-integrated tree). Findings cite `file:line` evidence; severities are
> the reviewer's.

---

## 0. Status: remediated (updated 2026-06-30)

**All four "must-fix" findings from §3 have since been fixed on `main`, along with
several §4 hardening items. This section maps each original finding to its current
status, verified against the code as of 2026-06-30.** The body of the report below
is preserved as the original point-in-time review; read it together with this
status map. Where a fix is only partial, that is called out explicitly.

| Old finding | Original severity | Status | Mechanism / evidence (verified) |
|---|---|:--:|---|
| **#1 Untrusted Word document body reaches the LLM unspotlighted** | Critical | **RESOLVED** | `documentContext` is now nonce-fenced via `spotlight()` before entering the prompt: `apps/api/src/modules/chat/chat.service.ts:530-531`, `apps/api/src/modules/project-chat/projectChat.service.ts:185`. `spotlight()` (`apps/api/src/lib/chatContext.ts:59-66`) puts the per-request nonce on **both** the opening and closing tags, redacts any echoed nonce, and HTML-encodes any literal `<untrusted-content>` the text smuggles in. Tool-returned document/workflow bodies are fenced the same way (`apps/api/src/lib/tools/runToolCalls.ts:209,280,321`). |
| **#2 Credits TOCTOU race** | High | **RESOLVED** | The check-then-increment pair straddling the stream is replaced by a single atomic reservation, `consumeMessageCredit()`, taken **before** `flushHeaders()` and refunded via `refundMessageCredit()` if the stream fails (`apps/api/src/modules/chat/chat.routes.ts:284-290,343`; same in `projectChat.routes.ts:118`). No window remains between check and decrement. |
| **#3 No graceful shutdown** | High | **RESOLVED** | `apps/api/src/index.ts:52-83` installs SIGTERM/SIGINT handlers that `server.close(...)` then `await stopWorkers()`, draining in-flight requests and the job queue on rollout/Ctrl-C. |
| **#4 OpenAI base-URL SSRF** | High | **RESOLVED (config-time; residual noted)** | `apps/api/src/lib/llm/baseUrl.ts` now rejects private/reserved **IP literals** via the shared `isBlockedIp()` guard (parity with the MCP path), in addition to `localhost`. Residual: it does not DNS-resolve hostnames — by design, since `OPENAI_BASE_URL` is operator env config, not user input. The user-facing MCP egress path does pin DNS (see below). |

**Additional hardening since the original review:**

- **MCP egress is now DNS-pinned (SSRF/rebinding).** `guardedFetch` routes every
  outbound MCP request through `pinnedGuardAgent()`, an undici dispatcher whose
  connect-time DNS `lookup` runs `isBlockedIp()` and returns **only** validated
  addresses — so the address validated is the address connected to, closing the
  DNS-rebinding TOCTOU. It also forces `redirect: "manual"` so a 3xx to an internal
  host can't smuggle egress. `apps/api/src/lib/mcp/client.ts:390-442`.
- **Per-row HKDF now covers MCP connector secrets too, not just user API keys.**
  User API keys already used per-row HKDF + random salt (`apps/api/src/lib/userApiKeys.ts:52-66`);
  MCP connector auth config now uses the same scheme via a `v2.`-prefixed
  `base64(salt‖ciphertext)` envelope (`apps/api/src/lib/mcp/client.ts:39-113`),
  with a legacy static-key decrypt path retained for old rows.
- **Download tokens now *require* expiry.** `verifyDownloadPayload` rejects any
  token whose `e` (expiry) is missing or in the past — previously expiry was
  optional and a token without it was valid forever
  (`apps/api/src/core/downloadTokens.ts:87-93`).
- **CODEOWNERS is real and scoped.** `.github/CODEOWNERS` sets `@amal66` as default
  owner and adds explicit ownership on the security-sensitive files (`auth.ts`,
  `env.ts`, `userApiKeys.ts`, `downloadTokens.ts`, `access.ts`), migrations, and CI.
- **Conversion worker sets a terminal status on permanent failure.** On BullMQ
  `failed` with retries exhausted, `setDocumentTerminalStatus()` moves the document
  to `error` instead of leaving it stuck in `processing`
  (`apps/api/src/workers/conversionWorker.ts:70-82,117-135`).

Items in §4 that were flagged Medium/Low (e.g. service/repository layer, thin
route-level test coverage, `console.*` drift, missing FK indexes) are **not**
claimed resolved here and remain open backlog unless independently verified.

---

## 1. Verdict

**Strong acquire signal on the engineer; the codebase needs a focused hardening
quarter, not a rewrite.**

The decisive analytical point for evaluating a *person* (rather than a product) is
that the cofounder's own work separates cleanly from what they inherited. The
upstream base (`willchen96/mike` / Open-Legal-Products) contributed the structural
debt — the 3,900-line `chatTools.ts`, the 1,000–2,900-line route handlers and React
components. What the cofounder *added* is consistently senior-grade: a
security-hardening campaign, a backend→`apps/` modular reorganization, provider and
storage adapters, structured logging, CI, a job queue, and a disciplined fork↔upstream
merge. **They operate visibly above the level of the code they started from.**

The weaknesses (no service layer, thin tests on critical paths, consistency drift) are
the predictable result of a solo operator hardening someone else's MVP under time
pressure. They form a backlog, not a red flag. The P0 list below is roughly one
focused quarter of work.

---

## 2. What the code reveals about the engineer

### Strengths (high signal — hard to hire for, hard to fake)

- **Security maturity well above median.**
  - API-key encryption: HKDF-SHA256 + per-row random salt, AES-256-GCM, legacy
    migration path (`apps/api/src/lib/userApiKeys.ts:43-79`). *(The same per-row
    HKDF scheme now also protects MCP connector secrets — see §0.)*
  - Download tokens: HMAC-SHA256, constant-time compare on zero-padded buffers,
    **mandatory expiry** — a token missing/past `e` is rejected
    (`apps/api/src/core/downloadTokens.ts:24-31,87-93`). *(Originally noted as
    "optional expiry"; expiry is now required — see §0.)*
  - IDOR guards centralized in `apps/api/src/lib/access.ts` (`checkProjectAccess`,
    `ensureDocAccess`, `filterAccessibleDocumentIds`), used at 40+ call sites.
  - **MCP connector SSRF defense** (`apps/api/src/lib/mcp/client.ts:226-293`):
    resolves DNS and validates every returned IP against RFC-1918 / link-local /
    metadata ranges. This is stricter than most senior engineers get right.
  - RLS deny-all fallback, helmet CSP, per-route rate limits, magic-byte upload
    validation, boot-time Zod env validation, secret redaction in logs
    (`apps/api/src/lib/safeError.ts`).
- **Operational instinct.** pino structured logging with request-ID correlation
  (`middleware/httpLogger.ts`), an async-error wrapper that patches the Express
  router (`lib/asyncErrors.ts`), LLM stream timeout, and a from-scratch
  retry + circuit breaker (`lib/llm/index.ts:74-77`); health/ready probes that
  actually check DB + storage (`app.ts:177-202`).
- **Refactor judgment.** Clean adapter patterns for LLM providers (`lib/llm/`) and
  storage backends (`lib/storage/`); the modularization and the DB-validated
  upstream merge (with explicit `fix(merge)` follow-ups) show invasive surgery done
  safely.
- **OSS hygiene is exemplary:** README, CONTRIBUTING, SECURITY.md, CODE_OF_CONDUCT,
  issue/PR templates, Dependabot, CODEOWNERS scoped to security-sensitive files,
  `docs/architecture.md` + `docs/SECURITY-MODEL.md`, AGPL-3.0, no committed secrets,
  and unusually educational commit messages.

### Blind spots (what the acquirer is buying into)

- Logic stops at the route handler — **no service/repository layer**; business logic,
  validation, and DB calls are inline in fat routes.
- **Test coverage on the highest-risk paths is ~8%; route-level coverage is zero**
  (chat, uploads, tabular, credits). The frontend has ~80 test files that **do not
  run in CI**.
- Consistency drift from the merge: Zod `parseBody` used in ~1 route; `console.*`
  persists in newer modules; web ESLint disables `no-explicit-any`.

---

## 3. Must-fix before scaling (verified against code)

> **All four items below are now RESOLVED on `main` (2026-06-30).** The original
> findings are preserved for the record; see §0 for the fix/mechanism and current
> `file:line` evidence for each.

| # | Severity | Status | Issue | Evidence (as originally filed) |
|---|----------|:--:|-------|----------|
| 1 | **Critical** | **RESOLVED** | Untrusted Word document body reaches the LLM **unspotlighted** (literal `<word-document>` tags; a nonce is generated but `spotlight()` is never applied). Contradicts the SECURITY-MODEL's "spotlighting everywhere" claim. *Introduced in the recent Word-add-in integration, not the baseline.* — **Fixed:** `documentContext` now nonce-fenced via `spotlight()` (`chat.service.ts:530`, `projectChat.service.ts:185`). | `apps/api/src/modules/chat/chat.routes.ts:600`; `apps/api/src/modules/project-chat/projectChat.routes.ts:206` |
| 2 | **High** | **RESOLVED** | **Credits TOCTOU race.** `checkMessageCredits` and `incrementMessageCredits` straddle the entire LLM stream, so concurrent requests from a user at their limit all pass the check before any increment → quota bypass (bounded by concurrency). — **Fixed:** atomic `consumeMessageCredit()` reservation before the stream, with refund on failure (`chat.routes.ts:284-290,343`). | `chat.routes.ts:629` (check), `:671` (increment) |
| 3 | **High** | **RESOLVED** | **No graceful shutdown.** The server handle is never stored and `stopWorkers()` is never called; on SIGTERM the process drops in-flight streams and leaves the job queue dirty. — **Fixed:** SIGTERM/SIGINT → `server.close()` + `stopWorkers()` (`index.ts:52-83`). | `apps/api/src/index.ts` |
| 4 | **High** | **RESOLVED** | **OpenAI base-URL SSRF.** Validation blocks `localhost` but not private IP ranges (10/8, 172.16/12, 192.168/16) — the MCP path already does this correctly and should be reused. — **Fixed:** private/reserved IP literals now rejected via shared `isBlockedIp()` (`baseUrl.ts`); MCP path additionally DNS-pins via `pinnedGuardAgent`. | `apps/api/src/lib/llm/baseUrl.ts:14-37` |

Items #1 and #3 were small and have since been fixed immediately, along with #2 and #4 (see §0).

---

## 4. Per-dimension findings

### 4.1 Backend architecture

- **No service/repository layer.** `apps/api/src/modules/*` contain only `*.routes.ts`;
  handlers mix parsing, business logic, and Supabase queries. Fat routes:
  `tabular.routes.ts` (1,810), `documents.routes.ts` (1,464), `user.routes.ts`
  (1,116), `projects.routes.ts` (1,042), `chat.routes.ts` (752). **(High)**
- **God-file:** `lib/chatTools.ts` is **3,901 lines** mixing PDF extraction, DOCX
  generation, document editing, citation parsing, CourtListener integration, and the
  ~1,400-line `runToolCalls` dispatcher. Untestable in isolation. **(High)**
- **Dead/confusing code:** `apps/api/src/routes/*.ts` are 9 one-line re-export stubs of
  `modules/*/*.routes.ts`. Delete and import directly. **(Low)**
- **Strengths:** clean LLM provider registry (`lib/llm/`), storage adapter
  (`lib/storage/`), centralized access control, correct middleware ordering and central
  error redaction.

### 4.2 Frontend architecture

- **God-components** with mixed concerns and 15–25+ `useState`:
  `ProjectDocumentsView.tsx` (2,967), `AssistantMessage.tsx` (2,570),
  `TRChatPanel.tsx` (1,927), `TabularReviewView.tsx` (1,140), `DocumentSidePanel.tsx`
  (1,072, 16 callback props). **(High/Critical)**
  _(Line counts are as of this review, 2026-06-30. Several have since been
  decomposed — e.g. `AssistantMessage` 2,570→~650 via `assistant-message/*`,
  `ProjectDocumentsView` 2,967→~1,800, `TRChatPanel` 1,927→~1,160.)_
- **No data-fetching cache.** `@mike/api-client` sets `cache: "no-store"` on every
  request (`packages/api-client/src/index.ts:130`); lists are refetched without dedup
  or stale-while-revalidate. Recommend React Query/SWR. **(High)**
- **Inconsistent error UX.** Silent `.catch(() => {})` (e.g. assistant page); no global
  toast/error boundary; some `as any` on streaming events (`ChatView.tsx:627-642`).
  **(Medium)**
- **Strengths:** React 19 + Next 16 + strict TS + React Compiler; Radix-based a11y
  foundation; `@mike/shared` design system cleanly consumed by both web and the
  add-in.

### 4.3 Data layer

- **Solid schema:** 3NF, typed UUID FKs with cascade rules, GIN indexes on
  `shared_with`, soft-delete with a partial index, atomic credit-increment RPC.
- **Missing FK indexes:** `user_mcp_oauth_tokens.connector_id`,
  `user_mcp_oauth_states.user_id` (`schema.sql:110,129,136`). **(Medium)**
- **RPC pagination gaps:** `get_tabular_reviews_overview` (potential quadratic
  `jsonb_array_elements_text` expansion) and `get_workflows_overview` lack limits.
  **(Medium)**
- **N+1** in zip-download access check — `ensureDocAccess` per document
  (`documents.routes.ts:198-207`). **(Medium)**
- `deleted_by` is an untyped `uuid` with no FK (`schema.sql:264`). **(Low)**
- **Migration dual-source:** `schema.sql` is the source of truth plus a partial
  migration history (the upstream merge couldn't replay 37 incremental migrations onto
  the UUID-converted baseline). Documented and defensible, but an orphaned
  `20260521000001_user_id_uuid_phase1.sql` should be removed to avoid operator
  confusion. **(Medium)**
- **Authz model:** service-role + app-layer enforcement, with RLS as a deny-all
  firewall (not the primary control). Defensible, but a service-role key leak means
  full data access; document explicitly or move hot paths to true RLS.

### 4.4 Security

- Critical/High items #1 and #4 in §3 — both now **RESOLVED** (see §0).
- **Strengths** (verified): MFA enforcement (`middleware/auth.ts`), HKDF key
  encryption, timing-safe download tokens, comprehensive IDOR guards, MCP SSRF
  defense, RLS deny-all, helmet CSP, per-endpoint rate limiting, magic-byte upload
  validation, env validation.
- **Gaps (low):** project-sharing emails aren't format-validated
  (`projects.routes.ts:168-184`); `console.error` for a crypto failure in
  `lib/mcp/client.ts:98-99`.
- **Note:** the SECURITY-MODEL is honest and mostly accurate. Finding #1 was the one
  place its coverage claim was false at review time; it is now **RESOLVED** (the Word
  `documentContext` is nonce-fenced via `spotlight()`), so the "spotlighting
  everywhere" claim holds — see §0.

### 4.5 Testing, CI & operations

- **~8% test ratio** (1,768 test lines vs 22,142 source); **zero route-level tests**
  for chat, uploads, tabular, billing. Highest-risk untested paths: the credit
  check/increment sequence and document-access denial. **(Critical)**
- **CI** (`.github/workflows/ci.yml`) gates lint + unit + typecheck + build +
  `npm audit --audit-level=high` + a real-Supabase migration validation — good — but:
  the **frontend's ~80 tests never run in CI** (web job is lint+build only); there are
  **no coverage thresholds**; and the **e2e suite is non-gating** and needs an
  `ANTHROPIC_API_KEY` secret. **(Medium)**
- **Observability:** ~30–39 `console.*` calls bypass pino (notably `user.routes.ts`
  MCP code, `documents.routes.ts`, `projects.routes.ts`); **no Sentry/metrics/tracing**.
  **(Medium)**
- **Resilience:** LLM timeout + retry/circuit-breaker + `unhandledRejection`/
  `uncaughtException` handlers are present and good; **graceful shutdown is missing**
  (item #3). **(High)**
- **Deploy:** multi-stage Dockerfile on `node:22-alpine`, health/ready probes, boot
  env validation, secrets via `env_file` (not baked into images) — solid. Node is
  pinned only as `>=20` with no `.nvmrc`. **(Low)**

### 4.6 Code quality & OSS hygiene

- **Type safety:** `strict: true` everywhere, but the **web ESLint disables
  `@typescript-eslint/no-explicit-any`** (`apps/web/eslint.config.mjs`), a regression
  vs. the API's `warn`. API has ~23 `as any` and several `as unknown as` double-casts
  concentrated around PDF.js and DB payloads. **(Medium)**
- **Error handling:** good `sendError`/`parseBody` utilities, but **9+ silent
  `/* ignore */` catches** in `chatTools.ts` and `tabular.routes.ts`. **(Medium)**
- **Merge debris:** minimal — 1 `MERGE-REVIEW` annotation, ~8 TODO/FIXME, no conflict
  markers; the merge was cleaned up with follow-up commits. **(Low)**
- **OSS:** strong (see §2). Gaps: no CHANGELOG; operational runbook is sparse.

---

## 5. Recommended changes (prioritized)

### P0 — structural (unlocks onboarding, testing, and scale)
1. Introduce a **service + repository layer**; reduce routes to parse→call→respond.
   This is also what makes the untested paths testable.
2. Split the two debt-anchors: `lib/chatTools.ts` → `lib/tools/*` behind a registry;
   the frontend's `ProjectDocumentsView`/`AssistantMessage` → feature components +
   hooks.
3. **Route-level tests for the revenue/security paths first** (supertest): `/chat`
   incl. the credit race, uploads, access denial. Wire frontend tests + e2e into CI;
   make e2e gating once green.

### P1 — consistency & correctness
4. Standardize on `parseBody`+Zod for all validation; standardize on pino (remove
   `console.*`); set web ESLint `no-explicit-any` to `warn`.
5. Data: add the two missing FK indexes; paginate the two overview RPCs; fix the zip
   N+1; make `deleted_by` a real FK; remove the orphaned phase-1 migration.
6. Audit the 9+ silent catches — log-at-debug or document intent.

### P2 — production-readiness
7. Error monitoring (Sentry) + metrics/tracing (OpenTelemetry); pin Node via `.nvmrc`;
   add CI coverage thresholds on `lib/` and the new service layer.
8. Frontend: add a fetch/cache layer (React Query/SWR), a global error-toast pattern,
   and ARIA on the large tables.
9. Document the RLS posture explicitly, or move hot paths to true row-level security.

---

## 6. Scorecard

| Dimension | Grade | Note |
|-----------|:-----:|------|
| Security | A− | Deep and mostly correct; the flagged spotlight and SSRF gaps are now resolved (§0) |
| Data layer | B+ | Solid model; indexes/pagination/N+1 to tidy; documented migration risk |
| Backend architecture | B− | Clean adapters; no service layer; one god-file |
| Frontend architecture | B− | Modern stack; god-components; no caching layer |
| Testing & CI | C+ | Good CI spine; critical paths untested; FE tests not in CI |
| Ops & resilience | B | Strong logging/retry/probes; missing graceful shutdown + monitoring |
| Code quality & OSS hygiene | B+ | Exemplary OSS hygiene; type-safety/consistency drift |
| **Engineer (cofounder) signal** | **A−** | Security/ops depth + merge/refactor discipline + docs; backlog is prioritization, not capability |

---

*Methodology: six parallel read-only reviews (backend, frontend, data, security,
testing/ops, code quality/OSS) over `main`, each producing `file:line` evidence;
the two highest-impact findings (credits race, unspotlighted Word context) were
re-verified directly against source before inclusion.*
