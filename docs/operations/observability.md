# Observability and service objectives

No service-level objective or public availability commitment is approved. The
operations owner must select infrastructure and set measurable objectives before
launch.

## Minimum signals

- website, application, API, authentication, database, object storage, email,
  conversion, model-provider, and legal-source availability;
- request volume, latency, error class, rate-limit activity, queue saturation,
  storage capacity, migration state, backup age, restore-test age, and source
  observation age;
- security events including repeated auth failure, access denial, data-boundary
  rejection, privilege changes, secret rotation, and audit-pipeline failure;
- release, workflow, prompt, schema, provider, and source-version identifiers.

Telemetry must be allowlisted and metadata-only. Raw prompts, documents, model
streams, source passages, credentials, and client identifiers are prohibited.
Alerts need an owner, severity, tested route, acknowledgement expectation,
escalation path, suppression rule, and runbook. Exercise one critical alert and
one dependency failure in staging and retain evidence before approval.

Public status must not disclose private security details. It must distinguish
the website, authenticated application, API, legal-source availability, and
known coverage limitations.
