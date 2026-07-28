# Proposal: use Trigger.dev for durable background tasks

## Status

**Discussion only.** This proposal intentionally adds no Trigger.dev dependency, task code, configuration, or runtime behavior change.

## Problem

Some document work is resource-intensive and should outlive the HTTP request that initiated it. OCR is the clearest example: the current flow records a pending status and then starts OCR asynchronously in the API process. A process restart or deployment can therefore interrupt work without a durable job record, retry policy, or operator-facing run history. OCR also competes with API requests for CPU and memory.

## Proposed direction

Evaluate Trigger.dev as the background-job runtime, starting with **OCR only**. The API would enqueue a small, version-specific job after a successful upload; the task would fetch the document from the existing object storage, run the existing OCR pipeline, and update the document's existing OCR state.

The initial task should:

- receive document/version identifiers and a storage reference, rather than file bytes;
- use an idempotency key tied to the immutable document version, so retries and repeated upload events cannot duplicate or overwrite work;
- apply conservative concurrency limits, ideally scoped by workspace/user as well as globally;
- keep the existing `pending`, `processing`, `done`, and `failed` document states as the application-facing contract;
- use a bounded maximum runtime and explicit retry policy;
- make task runs observable and recoverable without adding work to the request-serving process.

If this proves useful, the next candidates to assess—not commit to—would be Office-to-PDF conversion and larger retryable tabular-review batches. Interactive chat streaming and request-critical operations should remain in the API.

## Security, privacy, and operational questions

Mike handles legal documents, so this should not proceed without agreement on:

- data-processing terms, worker region, log retention/redaction, and document egress to the task runner;
- whether a managed Trigger.dev deployment satisfies those requirements or a self-hosted deployment is necessary;
- how OCR system dependencies (OCRmyPDF, Tesseract, and language packs) would be packaged and patched;
- cost and queue-latency limits for large or concurrent uploads;
- version/deletion semantics, including cancelling or safely discarding a task whose document/version is deleted or superseded.

## Alternatives

1. **Keep the in-process implementation.** Lowest immediate cost, but retains restart loss, limited observability, and request-worker contention.
2. **Run a dedicated worker backed by a database queue.** Keeps full infrastructure control, but requires us to build and operate retries, scheduling, concurrency, visibility, and recovery.
3. **Use Trigger.dev.** Adds a third-party execution dependency, but provides those workflow primitives and an operator UI with substantially less application infrastructure.

## Feedback requested

Before any implementation, feedback would be particularly helpful on:

1. Whether an external managed task runner is acceptable for document-processing workloads.
2. Whether OCR is the right first task, or whether another workload has a clearer operational need.
3. Required privacy, residency, and observability standards.
4. Whether the project would prefer a dedicated self-managed worker/queue instead.

No implementation is proposed until those questions are resolved.