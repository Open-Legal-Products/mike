# 0004. Database-enforced correctness for concurrent writes

- **Status:** Accepted
- **Date:** 2026-06-30
- **Commit(s):** `4a0bed8` fix(api): Phase 0 must-fixes — prompt injection, shutdown, SSRF, credits race (row-locked credit RPC); `acf4cf6` feat(tabular): durable async extraction queue (deterministic job IDs)

## Context

Two classes of concurrency bug were reachable:

1. **Credit overspend (TOCTOU).** Credit accounting was a read
   (`checkMessageCredits`) followed later by a write (`incrementMessageCredits`)
   straddling the whole stream. Concurrent requests from a user *at* their limit
   could each pass the read and all overspend — the classic check-then-act race.
2. **Duplicate job work.** A double-submit (client retry, reconnect, an at-least-
   once producer) could enqueue the same extraction/conversion twice and do the
   work twice.

Enforcing these invariants in application code (locks, read-modify-write in JS)
is racy across N replicas; the database is the only place that sees all writers.

## Decision

Push the correctness guarantee **into the database and the queue's identity
model**, not the application layer:

- **Row-locking RPC for credits.** `consume_message_credit(p_user_id, p_limit)`
  (`apps/api/schema.sql`) does `select … for update` on the profile, applies the
  monthly reset if the window elapsed, and increments **only** when under the
  limit — atomically, in one transaction. The API reserves a credit *before*
  streaming (`lib/credits.ts`) and calls `refund_message_credit` if the stream
  fails/aborts, preserving "no charge on error". This replaced the racy
  read-then-write entirely.
- **Deterministic BullMQ job IDs.** Each queue derives its `jobId`
  deterministically from the work identity — `(reviewId, documentId)` for
  extraction, `versionId` for conversion (`lib/queue/*Queue.ts`). BullMQ dedupes
  a job id that is already in-flight, so a double-submit collapses into the
  existing job instead of running twice. Terminal jobs are `removeOnComplete` /
  `removeOnFail` precisely so a *legitimate* later re-run can re-enqueue the same
  id; durable state (DB rows) — not queue history — is what prevents re-doing
  finished work. Extraction frames are additionally idempotent by
  `(document_id, column_index)`, so reconnecting/replaying never double-applies.

## Consequences

- **The invariants hold under real concurrency**, including across replicas,
  because the DB row lock and the queue's id uniqueness are single points of
  serialization that no amount of horizontal scaling defeats. A Postgres-backed
  concurrency regression test guards the credit RPC.
- **Failure policy is explicit, not implicit.** When the credit RPC is
  unreadable, behavior is governed by `CREDITS_FAIL_CLOSED` (fail-open for
  self-host UX, fail-closed for hosted metering) rather than an accidental
  outcome — see ADR-referenced `env.ts` / `lib/credits.ts`.
- **Logic lives in SQL (a `security definer` plpgsql function).** That is the
  price of atomicity: the reset-and-increment rule is now in the migration, so
  changing it means a migration, and it is less visible than TypeScript to a
  reader grepping the app. Deliberate — correctness beat locality here.
- **Determinism constrains the producers.** Job ids must stay a pure function of
  the work identity; if two genuinely different units ever collided on an id,
  one would be silently dropped as a "duplicate". The id derivation is therefore
  part of each queue's contract, documented at its `enqueue*` helper.
- **Scope note:** there is intentionally no Stripe/webhook idempotency here —
  this codebase has no billing-event ingestion. The idempotency that exists is
  exactly the credit RPC and the deterministic job ids above.
