# 0002. Optional-by-default observability

- **Status:** Accepted
- **Date:** 2026-06-30
- **Commit(s):** `346ee83` feat(api): optional OpenTelemetry tracing (Phase 5); `e8c8415` feat(api): optional Sentry error monitoring (Phase 5)

## Context

The platform runs in two very different worlds: a hosted deployment that wants
distributed tracing and error reporting, and a self-hosted / air-gapped
deployment that must generate **zero** external network traffic and take on no
extra dependencies by default. Observability that is on-by-default would either
leak data (traces and error payloads can carry document snippets) or force every
self-hoster to run a collector they don't want.

## Decision

Both OpenTelemetry and Sentry are **fully optional and off by default**, gated on
their configuration variable being present:

- **OTel** initializes only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; **Sentry**
  only when `SENTRY_DSN` is set. Unset → `initOtel()` / `initSentry()` are
  complete no-ops: no SDK constructed, no modules patched, no traffic
  (`lib/observability/otel.ts`, `sentry.ts`).
- **`AIRGAPPED=true` is a hard kill switch that wins regardless of the above.**
  Both `otel.ts` and `sentry.ts` check `process.env.AIRGAPPED === "true"` first
  and bail before doing anything — so even a misconfigured DSN/endpoint cannot
  cause egress in air-gapped mode.
- **Import order is a hard constraint.** `initOtel()` must run at the very top of
  `apps/api/src/index.ts` — before `./lib/env` and before any instrumented module
  (`http`/`express`/`./app`) is imported — because the Node
  auto-instrumentations patch modules at load time. Sentry has the same
  requirement (init before `./app`).
- **These two files read `process.env` directly, not the validated `env` module,
  on purpose.** OTel must initialize *before* `./lib/env` loads, so it cannot
  depend on it without creating an import-order/circular-init hazard. The same
  variables are still declared in `env.ts` purely for validation and
  documentation; `otel.ts` carries a comment saying the real gate is read from
  `process.env`.

## Consequences

- **The default deployment is dependency-free and silent** — no collector, no
  Sentry project, no outbound traffic. Self-host and air-gap stay clean.
- **Turning it on is one env var each**, and graceful shutdown already flushes
  pending spans (`shutdownOtel()` in the SIGTERM path) so enabling tracing
  doesn't lose data on rollout.
- **The `process.env`-direct reads are a deliberate, documented exception** to
  the "all config flows through validated `env`" rule. Without the comments this
  reads as an inconsistency; the import-order constraint is the reason, and it
  must be preserved — moving these reads onto the `env` module would reintroduce
  the load-order bug.
- **The init-order coupling is fragile by nature.** Anyone who adds an import
  above `initOtel()` in `index.ts`, or imports an instrumented module earlier,
  silently breaks instrumentation. The ordering is load-bearing and easy to
  regress in a refactor.
