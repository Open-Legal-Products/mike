# Operational runbook

The "it's 3am, something is on fire" page. It ties the operational primitives
that already exist in the code — `/health` + `/ready` probes, graceful
shutdown, the circuit breaker, the migration ledger, the async-job repair loop
— into procedures you can follow under pressure. Every threshold and path below
is cited to the source file it comes from; when in doubt, read the code, not
this page.

Architecture background: [architecture.md](architecture.md). Background jobs:
[async-jobs.md](async-jobs.md). Security posture: [SECURITY-MODEL.md](SECURITY-MODEL.md).

---

## 1. Service topology (the 5-line map)

- **API** — Express, `apps/api`, listens on `PORT` (default `3001`). Stateless;
  scale horizontally. Entry point `apps/api/src/index.ts`, app `apps/api/src/app.ts`.
- **Web** — Next.js, `apps/web`, default `http://localhost:3000` (`FRONTEND_URL`).
- **Workers** — BullMQ, run *in the API process*, and only when an `ASYNC_*`
  flag is on (`apps/api/src/workers/index.ts` → `anyWorkerEnabled()`). Default
  deployment runs none.
- **Postgres** — Supabase (auth + RLS + app tables). The API talks to it via the
  service-role client; storage is a pluggable object store (Cloudflare R2 / S3,
  or GCS).
- **Redis** — required *only* when an `ASYNC_*` flag is on (`REDIS_URL`).
  **LLM** — cloud (Claude/Gemini/OpenAI) or local (Ollama); reached over the network.

---

## 2. Health checks

Two endpoints, different jobs (`apps/api/src/app.ts`):

- **`GET /health`** — liveness. Returns `{ ok: true }` unconditionally, touches
  no dependency. Use it for the load-balancer "is the process up" probe. A
  `/health` failure means the event loop is wedged or the process is down.
- **`GET /ready`** — readiness. Actively probes **the database** (a
  `select id from projects limit 0` via the admin client) **and storage**
  (`checkStorageReady()`). Returns `200 { ok: true, checks: {...} }` when both
  pass, or **`503`** with per-check `{ ok, latencyMs, error }` when either
  fails. Use it to gate traffic and to triage *which* dependency is down. A
  `503` with `checks.db.ok=false` is a Postgres problem; `checks.storage.ok=false`
  is an object-store problem — the JSON tells you which without SSH.

---

## 3. Deploy & app rollback

- **Migrations auto-deploy on merge to `main`.** CI's `deploy-migrations` job
  (`.github/workflows/ci.yml`) runs `supabase db push` after `api`, `packages`,
  `web`, and `migrations` all pass, gated on `github.ref == refs/heads/main &&
  event == push`. This is the schema half of a release. See §4 for its rollback.
- **App code** is rolled out by the process manager (Railway / PM2 / Kubernetes —
  see the shutdown comment in `index.ts`), *not* by this repo's CI. **To roll
  back the app: redeploy the previous image/commit** through that platform.
- Rollout is safe by design: `SIGTERM`/`SIGINT` trigger graceful shutdown
  (`index.ts`) — stop accepting connections, drain in-flight requests/SSE
  streams, `stopWorkers()`, flush traces, exit 0, with a **15 s** force-exit
  guard. Unhandled rejections/exceptions log `fatal` and `exit(1)` so the
  orchestrator restarts on known-good state.
- **Rolling back app code does NOT roll back the schema.** A new migration must
  keep the previous app version working, or a rollback will meet a schema it
  can't read. Prefer expand-then-contract migrations.

---

## 4. DATABASE MIGRATION ROLLBACK (the honest procedure)

**There is no automated "down" migration. Migrations are forward-only.** The
runner (`apps/api/scripts/migrate.mjs`) applies `supabase/migrations/*.sql` in
lexical (timestamp) order, records each in the `schema_migrations` ledger
(`version`, `checksum` = sha256 of the file, `applied_at`), and **refuses to
run if an already-applied file's checksum changed** ("Migrations are immutable
once applied"). Production applies via `supabase db push` (§3); the ledgered
runner is the air-gapped path. Both are one-directional.

**So you cannot "un-apply" a migration by editing or deleting the file.** Do
this instead:

1. **Assess.** Connect to the DB and read the ledger:
   `select version, applied_at from public.schema_migrations order by applied_at desc;`
   Identify the offending migration and what it changed.
2. **If the change is additive and reversible in SQL** (dropped a column, added a
   bad index/constraint, wrong default): **write a NEW forward migration** with a
   later timestamp that inverts it (`alter table … drop column …`, `drop index …`).
   Never edit the original file — the checksum guard will abort the next run. Get
   it through CI (the `migrations` job resets a real Supabase DB from scratch) and
   merge; it deploys like any other.
3. **If the change destroyed data** (dropped a populated column/table, a
   lossy type change) SQL cannot bring it back — **restore from backup.**
   - Air-gapped: `airgapped/scripts/backup.sh` captures Postgres (`pg_dumpall`
     globals + `pg_dump`), MinIO objects, **and** `.env.generated` secrets
     (encrypted data is useless without the original secrets). Restore with
     `airgapped/scripts/restore.sh <backup_dir>` — it verifies `SHA256SUMS`,
     copies the **original** `secrets.env` back first (so encrypted user keys /
     sessions / download tokens stay decryptable), then restores DB + objects.
   - Supabase-hosted: use the project's point-in-time-recovery / backup restore
     from the Supabase dashboard.
4. **Backups are only as fresh as the last run.** Take one *before* any risky
   migration deploy.

---

## 5. Stalled / failed BullMQ jobs

Full mechanics and the manual-repair path live in
**[async-jobs.md](async-jobs.md)** — don't duplicate it. Operator summary:

- Jobs retry **3 times** with exponential backoff (`delay: 2000`); terminal jobs
  are removed so a re-run can re-enqueue the same deterministic `jobId`
  (`lib/queue/*Queue.ts`). Worker concurrency caps: conversion 2, extraction 3,
  embedding 2 (`workers/*Worker.ts`) — a per-worker bulkhead.
- **Crash mid-run** → BullMQ stalled-job recovery re-queues it; already-`done`
  cells are skipped, so no work is redone.
- **Retries exhausted** → the worker's `failed` handler flips the document's
  unfinished cells to `error`.
- **Manual repair** → re-run `POST /tabular-review/:id/generate`; it only
  processes cells not already `done`, so it doubles as a repair button. Clients
  reconnect to a dropped stream via `…/generate/stream` (pure observer).
- Workers only exist when the matching `ASYNC_*` flag is on. If jobs aren't
  moving, first confirm the flag is set **and** Redis (`REDIS_URL`) is reachable.

---

## 6. LLM provider outage

A per-provider **circuit breaker** fronts every LLM call
(`apps/api/src/lib/llm/index.ts`):

- Retryable errors: HTTP **429/500/502/503/504** and `ECONNRESET` / `ETIMEDOUT`
  / `ENOTFOUND`. Each call retries up to **3** attempts, backoff
  `min(1000·2^(n-1), 8000)` ms.
- The breaker counts retryable failures per label
  (`streamChatWithTools/<provider>`, `completeText/<provider>`). **5 failures
  within a 60 s window opens the circuit for 30 s** (`CIRCUIT_FAILURE_THRESHOLD=5`,
  `CIRCUIT_WINDOW_MS=60_000`, `CIRCUIT_OPEN_MS=30_000`). While open, calls throw
  immediately with `code: "LLM_CIRCUIT_OPEN"` and `retryAfterMs`. A success
  resets the breaker.

**Operator actions:**
- **Do NOT restart the API to "clear" an open circuit.** Breaker state is
  **in-process and per-instance** (a `Map`) — restarting just resets it and
  sends fresh load at a provider that is likely still down (N replicas each keep
  their own breaker). Let the 30 s window expire.
- Check the upstream provider's status page. The `[llm] circuit opened…` log
  (level `error`) names the provider label.
- Mitigations that *do* help: switch the deployment's default model to a
  healthy provider, or (self-host) point users at the built-in demo/Ollama
  provider — a keyless demo provider is always registered as a fallback.

---

## 7. Kill switches & feature gates

All read from env (`apps/api/src/lib/env.ts`). Verified against source.

| Flag | Default | Effect |
|------|---------|--------|
| `AIRGAPPED` | `false` | Hard kill switch. Cloud LLM providers are **not registered** and are refused at the request boundary; OpenTelemetry **and** Sentry are force-disabled (`otel.ts`, `sentry.ts` read `process.env.AIRGAPPED` directly); DMS connectors disabled. Only local (Ollama) models served. |
| `CREDITS_FAIL_CLOSED` | `false` | When a credit read/RPC fails: `false` = fail **open** (allow — self-host default); `true` = fail **closed** (deny — protects hosted metering). See `lib/credits.ts`. |
| `ASYNC_DOCUMENT_CONVERSION` | `false` | On → DOCX→PDF conversion goes to the BullMQ queue (needs Redis). Off → inline on the request. |
| `ASYNC_TABULAR_EXTRACTION` | `false` | On → tabular extraction is a durable, reconnectable queue. Off → inline (dies with the request). |
| `ASYNC_EMBEDDING` | `false` | On → chunk+embed to the queue so `search_documents` has an index. Off → semantic search returns nothing (degrades gracefully). |
| `ENABLE_OLLAMA` | `false` | On → registers the local Ollama provider (needs `OPENAI_BASE_URL` + `OPENAI_ALLOW_LOCAL_BASE_URL=true`). |
| `METRICS_ENABLED` | `false` | On → mounts unauthenticated `GET /metrics` (Prometheus: RED histogram, queue-depth gauges, process metrics), registered before the rate limiter. Off → route unmounted (404), no collectors run. |
| `SENTRY_DSN` | unset | Unset → Sentry fully off (no init, no traffic). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Unset → tracing fully off (no SDK, no patching). |

Turning any `ASYNC_*` flag **off** returns that path to synchronous execution
and removes the Redis dependency — a safe fallback if Redis or a worker is the
problem (already-queued work still needs a running worker to drain).

---

## 8. Credit accounting & job idempotency (why replay is safe)

There is no Stripe/webhook path in this codebase; the correctness-under-concurrency
primitives that matter operationally are:

- **Credits** are reserved *before* the stream by the atomic
  `consume_message_credit(p_user_id, p_limit)` RPC (`apps/api/schema.sql`,
  `lib/credits.ts`): it row-locks the profile (`for update`), applies the
  monthly reset if due, and increments only when under the limit — so concurrent
  requests can't both pass a read and overspend. A failed/aborted stream calls
  `refund_message_credit` (best-effort). This replaced a racy read-then-write.
- **Jobs are safe to replay.** Every queue uses a **deterministic `jobId`**
  (derived from `(reviewId, documentId)` or `versionId`), so a double-submit
  dedupes into the in-flight job rather than doubling work. Terminal jobs are
  removed so a *legitimate* later re-run can re-enqueue the same id. Extraction
  frames are idempotent by `(document_id, column_index)`, so reconnecting or
  re-running never double-applies.

---

## 9. First SLIs to add (what to measure next)

A Prometheus baseline now exists behind `METRICS_ENABLED` (§7): an HTTP RED
histogram (`http_request_duration_seconds`, labeled by route pattern), BullMQ
queue-depth gauges, and Node process metrics. Not yet instrumented on top of it,
the highest-signal starting set:

- **p95 first-token latency on chat** — the user-perceived "is it fast"
  number; regressions here usually mean provider or breaker trouble (§6).
- **Extraction job success rate** — terminal `failed` vs `completed` on the
  `tabular-extraction` queue; the leading indicator that the async pipeline is
  degrading before users notice missing cells.
- Cheap wins already emitted: `/ready` reports DB + storage `latencyMs`, and
  circuit-open events log at `error` — scrape both before building anything new.
