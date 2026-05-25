# Manual Follow-Up

This file tracks items from `ACTION_PLAN.md` and `FORK_REPORT.md` that should
not be faked in a quick code pass. They need credentials, product decisions, or
longer design work.

## Needs Manual Validation

### Local Full API Test Run

The sandbox blocks Supertest's ephemeral listener with `listen EPERM`, so the
full `npm test --workspace apps/api` command could not be completed here. The
non-listener subset passed (`112` tests, `1` skipped), and the built API import
smoke passed.

Manual setup needed:

1. Run `npm test --workspace apps/api` from a normal terminal.
2. Optionally remove stale generated output with `rm -rf apps/api/dist` before
   rebuilding; the current runtime path is `dist/apps/api/src/index.js`.

### Supabase Integration And RLS/IDOR Tests

The branch now has mock-based access tests for the core helpers, CI runs
`supabase db reset` against the local Supabase stack, and a skipped-by-default
live harness exists at
`apps/api/src/__tests__/integration/access.supabase.test.ts`.

Manual setup needed:

1. Run `supabase start`.
2. Capture the local API URL, anon key, and service role key printed by the CLI.
3. Run `npm run test:integration:supabase --prefix apps/api`.
4. Cover:
   - Already scaffolded: access helper proof that inaccessible document IDs are
     filtered with real Supabase data.
   - Still needed: route-level proof that `POST /tabular-review`,
     `GET /tabular-review/:reviewId`, `POST /tabular-review/:reviewId/generate`,
     and document zip/download routes enforce that same boundary with real JWTs.

## Product-Sized Follow-Ups

### Full Async Job Queue

Document conversion and workflow execution still need a durable worker design.
The action plan recommends BullMQ plus Redis, but that changes the runtime
architecture and API contract (`jobId`, polling/SSE status, retries, worker
deployment, dead-letter behavior). Design this as its own PR series.

Partially automated:

- Redis now runs in Docker Compose and is exposed as `redis://localhost:6379`
  for future BullMQ workers.

Remaining scope:

1. Add BullMQ/ioredis dependencies.
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

The provider abstraction is stronger now, and OpenAI-compatible base URL
support exists through `OPENAI_BASE_URL` with production HTTPS guardrails. The
fork report still shows demand for Ollama, OpenRouter, Azure OpenAI, and
Bedrock. Before adding more first-class providers, decide:

- which providers are first-class vs. generic compatible endpoints
- how users configure base URLs and custom auth headers in the UI
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
