# Manual Follow-Up

This file tracks items from `ACTION_PLAN.md` and `FORK_REPORT.md` that could not
be closed in a quick code pass — they needed credentials, product decisions, or
longer design work. **Status refreshed 2026-07-01.** Most of the original list
has since shipped; the table below maps each item to where it landed, and the
sections after it describe what is genuinely still open.

## Status of the original items

| Original item | Status | Where it landed |
|---|:--:|---|
| Local full API test run (sandbox blocked Supertest) | **Done** | Full suite runs green locally and in CI (`.github/workflows/ci.yml`): 328 passed / 6 skipped as of 2026-07-01. |
| Supabase integration + RLS/IDOR tests | **Mostly done** | Gated live harness `apps/api/src/__tests__/integration/stack.supabase.test.ts` proves the GoTrue contract, deny-all RLS, tenant isolation, and a leak sweep over all public tables (`npm run test:stack`). Still open: route-level proof for tabular-review and zip/download routes with real JWTs (see below). |
| Full async job queue | **Done for conversion** | BullMQ + Redis `document-conversion` queue: `apps/api/src/lib/queue/conversionQueue.ts` + `apps/api/src/workers/conversionWorker.ts`, behind `ASYNC_DOCUMENT_CONVERSION`. Still open: workflow-execution queue, job-status API + frontend polling (see below). |
| Playwright E2E | **Done (needs a live verification run)** | 27 web specs + non-gating `.github/workflows/e2e.yml`. Selectors were written pre-redesign; run `npm run test:e2e` locally before making the workflow required. |
| MCP connectors | **Done** | User-configurable connectors with OAuth 2.1 (`apps/api/src/lib/mcp/`), DNS-pinned SSRF guard, per-row HKDF secret encryption, and fail-safe tool confirmation. See TECH_DUE_DILIGENCE.md §0. |
| Local / alternative LLM providers | **Done for Ollama + OpenAI-compatible** | Ollama adapter behind `ENABLE_OLLAMA` (`apps/api/src/lib/llm/providers/ollama.ts`); any OpenAI-compatible endpoint via `OPENAI_BASE_URL` with SSRF guardrails; full offline posture via `AIRGAPPED=true` (see `airgapped/`). OpenRouter/Azure/Bedrock remain undecided product questions. |

## Still open — needs work

### Route-level RLS proof for tabular review and downloads

The gated stack harness proves the access-helper and RLS boundaries with real
Supabase data. Still missing: route-level tests (real JWTs, two tenants) for
`POST /tabular-review`, `GET /tabular-review/:reviewId`,
`POST /tabular-review/:reviewId/generate`, and the document zip/download routes.

### Workflow-execution queue + job-status surface

Document conversion is off the request thread, but workflow execution still runs
in-request, and there is no job-status API or frontend polling for queued
conversions — enabling `ASYNC_DOCUMENT_CONVERSION` in production needs the
frontend to poll document status. Design the status contract (`jobId`,
polling/SSE, retries, dead-letter visibility) as its own PR series.

### One live E2E verification run

The Playwright suite was ported onto the merged layout but has not been verified
against the current UI (selectors may have drifted; chat specs need an
`ANTHROPIC_API_KEY` secret). Run it once, fix drift, then consider making
`e2e.yml` a required check.

## Product-sized follow-ups (unchanged — need product direction)

### DOCX Tracked Changes Library Replacement

PR #58 replaces the custom DOCX tracked-changes implementation with
`docx-track-changes`. That may reduce long-term maintenance, but it touches
the legal-editing core. It should be evaluated with fixture documents,
round-trip visual checks, and regression tests for accept/reject behavior.

### Folder-Grouped Tabular Reviews

PR #54 adds folder-grouped reviews and per-user page limits. The current branch
has folder organization and tabular review improvements, but not that feature.
It needs UI decisions and generation semantics: one row per folder, citation
aggregation, scanned-document page limits, and migration of user settings.

### Hey Jude / Pseudonymization Gateway

PR #151 adds optional provider routing through Hey Jude. This needs a product
decision because Mike still stores original text locally while the gateway
pseudonymizes provider-bound prompts. Document the privacy model before adding
the switch.

### i18n, Jurisdiction RAG, Hallucination Scoring, Organizations

These are all visible in the fork report, but they are Phase 5+ growth work.
They need product direction and should not block the foundation/security branch.
