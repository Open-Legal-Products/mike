# Roadmap

Open engineering and product work, in rough priority order. History and
rationale for completed work live in the git log (each commit documents its
why/how) and [CHANGELOG.md](../CHANGELOG.md).

## Engineering

- **Route-level RLS proof for tabular review and downloads.** The gated stack
  harness (`npm run test:stack`) proves the access-helper and RLS boundaries
  with real Supabase data; still missing are route-level tests (real JWTs, two
  tenants) for `POST /tabular-review`, `GET /tabular-review/:reviewId`,
  `POST /tabular-review/:reviewId/generate`, and the document zip/download
  routes.
- **Workflow-execution queue + job-status surface.** Document conversion runs
  off the request thread (BullMQ), but workflow execution is still in-request,
  and there is no job-status API or frontend polling — enabling
  `ASYNC_DOCUMENT_CONVERSION` in production needs the frontend to poll document
  status. Design the status contract (`jobId`, polling/SSE, retries,
  dead-letter visibility) as its own PR series.
- **One live E2E verification run.** The Playwright suite was ported onto the
  merged layout but not verified against the current UI (selectors may have
  drifted; chat specs need an `ANTHROPIC_API_KEY` secret). Run it, fix drift,
  then consider making `e2e.yml` a required check.
- **Per-row RLS on hot read paths.** Authorization is app-layer over a
  `service_role` connection (see `docs/SECURITY-MODEL.md`); moving the hottest
  read paths to true per-row RLS would let the database independently contain
  an API-process compromise.
- **Air-gap disconnected acceptance.** The data plane and secret wiring are
  verified live; a full bring-up on disconnected hardware with the built
  `mike-api:airgapped` image and a preloaded Ollama model remains an
  operator-side acceptance step.
- **Continuous legal evals.** `evals/` is an honest 8-case offline starter;
  a real program needs a larger golden set and provider-in-the-loop runs.
- **Frontend decomposition.** `ProjectDocumentsView.tsx` (~1,800 lines), the
  connectors page (~1,470), and `useAssistantChat.ts` (~1,280) are the
  remaining god-components; decompose with the same hook/row-component
  extraction already applied to `AssistantMessage`.

## Product (needs direction before code)

- **DOCX tracked-changes library replacement** (upstream PR #58,
  `docx-track-changes`): touches the legal-editing core; evaluate with fixture
  documents, round-trip visual checks, and accept/reject regression tests.
- **Folder-grouped tabular reviews** (upstream PR #54): needs UI decisions and
  generation semantics (one row per folder, citation aggregation, page limits).
- **Pseudonymization gateway** (upstream PR #151, Hey Jude routing): needs a
  documented privacy model — Mike stores original text locally while the
  gateway pseudonymizes provider-bound prompts.
- **i18n, jurisdiction RAG, hallucination scoring, organizations:** growth
  work; needs product direction.
