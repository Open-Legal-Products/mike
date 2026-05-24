# Manual Follow-Up

This file tracks items from `ACTION_PLAN.md` and `FORK_REPORT.md` that should
not be faked in a quick code pass. They need credentials, product decisions, or
longer design work.

## Needs Manual Validation

### Supabase Integration And RLS/IDOR Tests

The branch now has mock-based access tests for the core helpers, and CI runs
`supabase db reset` against the local Supabase stack. The remaining proof is a
real seeded integration suite that creates two users, two projects, and cross-
project documents, then verifies tabular review routes cannot read foreign
document IDs.

Manual setup needed:

1. Run `supabase start`.
2. Capture the local API URL, anon key, and service role key printed by the CLI.
3. Add a dedicated integration test script that seeds users/documents via the
   service role key and calls API routes with real user JWTs.
4. Cover:
   - `POST /tabular-review` drops or rejects inaccessible `document_ids`.
   - `GET /tabular-review/:reviewId` hides inaccessible review data.
   - `POST /tabular-review/:reviewId/generate` cannot load inaccessible docs.
   - document download and zip routes only return accessible docs.

## Product-Sized Follow-Ups

### Full Async Job Queue

Document conversion and workflow execution still need a durable worker design.
The action plan recommends BullMQ plus Redis, but that changes the runtime
architecture and API contract (`jobId`, polling/SSE status, retries, worker
deployment, dead-letter behavior). Design this as its own PR series.

Suggested scope:

1. Add Redis to Docker Compose.
2. Add `document-ingestion`, `conversion`, and `workflow-execution` queues.
3. Move LibreOffice conversion out of request handlers.
4. Add job status APIs and frontend status states.
5. Add worker health checks and failure visibility.

### Playwright E2E

The critical browser path still needs an end-to-end test:

`sign in -> upload PDF -> ask a question -> receive streamed answer`

This needs a deterministic local Supabase auth setup, local object storage, and
either a mocked LLM provider or disposable provider keys. Add it after the
seeded Supabase integration harness exists.

### MCP Connectors

PR #32 and multiple forks built user-configurable MCP connectors with URL,
headers, and OAuth 2.1. This is valuable, but it needs SSRF protection, secret
storage, OAuth callback UX, per-request tool scoping, and connector health
status. Treat it as a feature project, not a drive-by merge.

### Local / Alternative LLM Providers

The provider abstraction is stronger now, but the fork report still shows
demand for Ollama, OpenRouter, Azure OpenAI, Bedrock, and generic
OpenAI-compatible base URLs. Before adding providers, decide:

- which providers are first-class vs. generic compatible endpoints
- how users configure base URLs and custom auth headers
- what safety checks prevent SSRF for user-provided endpoints
- how model availability appears in the UI

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
