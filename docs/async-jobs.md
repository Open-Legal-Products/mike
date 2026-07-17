# Background jobs

Mike runs slow, failure-prone work on a [BullMQ](https://docs.bullmq.io/) job
queue backed by Redis, instead of inline on the HTTP request. This keeps the
work alive across client disconnects and server restarts, retries transient
failures, and lets the workers scale independently of the web tier.

Each queue is **opt-in behind an env flag** and defaults **off**, so a
single-node deployment can run entirely synchronously with no Redis.

## Queues

| Queue | Flag | Job unit | Producer | Worker |
| --- | --- | --- | --- | --- |
| `document-conversion` | `ASYNC_DOCUMENT_CONVERSION` | one upload | `documents.upload.ts` | `workers/conversionWorker.ts` |
| `tabular-extraction` | `ASYNC_TABULAR_EXTRACTION` | one `(review, document)` | `tabular.generateStream.ts` | `workers/extractionWorker.ts` |

Both require `REDIS_URL`. All workers run in-process in the API server (started
by `startWorkers()` when `anyWorkerEnabled()`); move them to a dedicated process
by calling `startWorkers()` from a separate entrypoint when you need to scale
them apart.

## Tabular extraction flow

Extraction fills a grid of cells — one LLM call per document covers all of that
document's columns.

**Synchronous (`ASYNC_TABULAR_EXTRACTION=false`, default).** `POST
/tabular-review/:id/generate` runs the extraction inline and streams
`cell_update` SSE frames as it goes. The work dies if the request is
interrupted.

**Async (`ASYNC_TABULAR_EXTRACTION=true`).** `POST .../generate` enqueues one
job per document and turns the request into a *view* over that work:

1. The route subscribes to the review's Redis progress channel, then enqueues
   the jobs (subscribe-before-enqueue avoids missing a fast worker's first
   frame).
2. Each `extractionWorker` job re-derives its inputs from the DB (columns, cell
   state, active document version, the owner's model + API keys — **no secrets
   ride in the job payload**), extracts the document text once, runs the
   multi-column LLM call, and **persists + publishes** each cell as it lands.
3. The request forwards those frames as the same `cell_update` SSE the sync path
   emits, ending with `[DONE]` once every targeted cell is terminal.
4. A 3-second **DB-poll backstop** reconciles cell state, so a dropped pub/sub
   message can never leave the stream hung.

The `tabular_cells` table is always the source of truth; Redis pub/sub is only
the low-latency delivery path.

### The extraction core is shared

Both the sync route and the async worker call one function,
`extractDocumentColumns` (`tabular.extractDoc.ts`), so the extraction loop lives
in exactly one place. It owns the DB writes (mark generating, persist done) and
the text-extraction + LLM call, and reports which columns the model failed to
return as `missing`. The callers differ only in policy for `missing`: the sync
route marks them `error` inline; the async worker throws so BullMQ retries them.

### Retries & repair

- **Transient failures** (LLM/network/storage) retry with exponential backoff
  (`attempts: 3`).
- **Crash mid-run** → BullMQ stalled-job recovery re-queues the job; already-
  `done` cells are skipped on the retry, so no work is redone.
- **Permanent failure** (retries exhausted) → the worker's `failed` handler
  flips the document's still-unfinished cells to `error`.
- Re-running `/generate` only processes cells that are not already `done` with
  content, so it doubles as manual repair.

### Reconnecting

`GET /tabular-review/:id/generate/stream` tails an in-flight (or just-finished)
run **without** enqueuing anything — a pure observer that catches up from the
DB. If a client's `POST /generate` stream drops, the web UI
(`TabularReviewView.tsx`) reconnects here with bounded retries and resumes
applying frames (idempotent — cells match by `document_id` + `column_index`).

## Adding a new background queue

The worker lifecycle is table-driven, so a new queue is a declarative addition:

1. Add the queue + `enqueue*` helper in `lib/queue/<name>Queue.ts` (copy
   `extractionQueue.ts`: deterministic `jobId`, `attempts`, backoff).
2. Add the worker in `workers/<name>Worker.ts` with an extracted, unit-testable
   `run*Job(data, deps)` plus a `create*Worker()` / `stop*Worker()` pair and a
   permanent-failure handler (copy `extractionWorker.ts`).
3. Add an env flag in `lib/env.ts` (default `"false"`).
4. Append one `WorkerDescriptor` to `WORKER_REGISTRY` in `workers/registry.ts`.

`startWorkers()`, `stopWorkers()`, `anyWorkerEnabled()`, and the server
entrypoint all pick it up with no further change. If the work needs to stream
live progress to a request, reuse the Redis progress bus (`lib/queue/runProgress.ts`)
and the tail pattern in `tabular.generateStream.ts`.
