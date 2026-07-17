# ROSS-130 verification

## Implemented

- Explicit `self-hosted`, `controlled-beta`, and fail-closed `production` runtime modes.
- Controlled-beta acknowledgement UI, persisted acknowledgement record, service audit event, and required header on content-bearing writes.
- Hosted model-provider allowlist and production approval flag.
- Raw model-stream logging rejected outside local development.
- Metadata-only audit schema with browser access revoked and allowlisted metadata fields.
- Prompt-injection and matter-scope system instructions.
- Threat model, PIA draft, machine-readable data/subprocessor/retention inventories, and incident runbook.

## Automated checks

Security tests exercise route classification, missing/valid acknowledgement, self-hosted compatibility, audit sanitization, service audit insertion, invalid event rejection, local defaults, explicit staging configuration, raw-log rejection, and unapproved production rejection. Backend and frontend TypeScript builds validate the integration.

## External blockers

ROSS-130 does not approve real client material or production launch. Operator identification, legal applicability, provider contracts/regions, privacy notice, final retention, full IDOR/RLS suite, malware/conversion sandbox validation, independent privacy/security review, accessibility review, and penetration testing remain open. The production approval environment flag must not be enabled until those approvals are recorded.
