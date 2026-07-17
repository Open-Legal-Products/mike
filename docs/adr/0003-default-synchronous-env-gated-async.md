# 0003. Default-synchronous job execution with env-gated async queues

- **Status:** Accepted
- **Date:** 2026-07-01
- **Commit(s):** `acf4cf6` feat(tabular): durable async extraction queue + reconnectable generate stream (async model established across document conversion, tabular extraction, and embeddings)

## Context

Three workloads are expensive and can outlive a single request: DOCX→PDF
conversion, tabular cell extraction, and document chunking+embedding. Running
them inline is simple and needs no infrastructure, but the work dies with the
request (a client disconnect or server restart loses it) and can't retry. Making
them async needs Redis and workers — infrastructure that a self-hoster kicking
the tires on `docker compose up` should not be forced to run.

## Decision

Every async-capable path is **synchronous by default and opt-in to async via an
`ASYNC_*` env flag**, each defaulting to `"false"` (`apps/api/src/lib/env.ts`):

- `ASYNC_DOCUMENT_CONVERSION`, `ASYNC_TABULAR_EXTRACTION`, `ASYNC_EMBEDDING`.
- Off → the work runs inline on the request thread (the historical behavior);
  **no Redis required.** The server only starts workers when
  `anyWorkerEnabled()` is true (`workers/index.ts`, driven by `WORKER_REGISTRY`
  in `workers/registry.ts`), so the default process has no Redis dependency at
  all.
- On → the work is enqueued to a BullMQ queue and a worker drains it, gaining
  durability across disconnect/restart and retry-with-backoff. The
  extraction/embedding paths degrade gracefully when off (e.g. `search_documents`
  simply returns nothing without `ASYNC_EMBEDDING`).
- **This is a progressive-delivery lever, not a rewrite.** The same core function
  serves both modes — e.g. `extractDocumentColumns` is called by both the sync
  route and the async worker, differing only in `missing`-cell policy — so async
  is a deployment choice, and each queue can be enabled independently.
- **Bulkhead concurrency caps per worker** bound resource use:
  conversion `concurrency: 2`, extraction `3`, embedding `2`
  (`workers/*Worker.ts`) — one runaway workload can't starve the others.

## Consequences

- **Trivial default onboarding.** A fresh clone runs everything inline; no Redis,
  no worker process, no queue config. Production turns on exactly the queues it
  needs.
- **Durability and retries where they matter.** With the flag on, work survives
  restarts and retries with backoff; the tabular `/generate` request becomes a
  reconnectable *view* over Redis pub/sub rather than the thing doing the work.
- **Two code paths to keep honest.** Because sync and async are both real, the
  shared core must stay the single source of truth for the actual work, or the
  modes drift. This is mitigated by construction (one extraction function) but is
  a standing maintenance constraint.
- **Workers run in-process by default.** `startWorkers()` runs inside the API
  process, which keeps the single-node story simple but couples worker load to
  API capacity. Splitting them into a dedicated process is possible (call
  `startWorkers()` from a separate entrypoint) but is not the default — at scale
  that co-tenancy is a downside to revisit.
