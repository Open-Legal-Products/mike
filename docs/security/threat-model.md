# ROSS controlled-beta threat model

Status: engineering draft for independent security and privacy review  
Scope: invitation-only hosted beta using synthetic or affirmatively non-confidential material  
Last engineering review: 2026-07-16  
Owners: operator, privacy owner, and security owner remain unassigned

## Protected assets and trust boundaries

ROSS handles account identifiers, authentication sessions, user-supplied API keys, synthetic/non-confidential prompts and files, generated work, project and sharing metadata, legal-source responses, connector credentials, and operational/security metadata. Boundaries exist between the browser, API, authentication/database service, object storage, document converter, model providers, legal-source providers, MCP connectors, email provider, logs, backups, and administrators.

Real confidential, privileged, proprietary, regulated, or client material is outside the approved beta boundary. The attestation gate reduces accidental submission but cannot reliably classify document substance; it is one layer, not a data-loss-prevention claim.

## Principal threats and implemented controls

| Threat | Current control | Residual risk / required follow-up |
| --- | --- | --- |
| Prohibited material submitted during beta | Versioned user acknowledgement, required request header for content writes, persistent acknowledgement timestamp, public warnings | A user can misclassify or deliberately bypass an attestation; independent review and production-grade DLP are not complete |
| Cross-user or cross-matter access | Authenticated routes, existing ownership checks/RLS, scoped document tools | Full IDOR/RLS matrix and independent penetration test remain required |
| Prompt injection in uploads or sources | System instruction treats all document/source/connector text as untrusted and forbids scope expansion | Adversarial evaluation and tool-level authorization tests remain required |
| Secret or content leakage through logs | Production/staging startup rejects raw model-stream logging; audit metadata is allowlisted | Existing log call sites require continuing review; infrastructure log access and retention are not selected |
| Unapproved model provider | Hosted provider allowlist enforced at the model adapter | Product/tier/region/retention contractual approval remains external |
| Credential compromise | Server-only service keys, inherited encrypted user-key storage, MFA support, redaction of common key patterns | Privileged-account MFA enforcement and key rotation exercise remain required |
| Malicious files/conversion | Existing type/size validation and isolated service boundary in the target topology | Malware scanning, conversion sandbox verification, resource limits, and penetration testing remain required |
| Unsafe sharing/export | Existing server authorization and rate limits; metadata-only audit table foundation | Complete audit hooks and sharing/export IDOR tests remain required |
| Source poisoning or stale law | Official/allowlisted sources, provider metadata, source hashes/checks, visible verification states | Human stale-source response and comprehensive citator coverage remain incomplete |
| Availability or abuse | Helmet, exact CORS, bounded payloads, route-specific rate limits, fail-closed source policy, release/rollback/restore runbooks | Distributed limiter, WAF, monitoring, backups, restore and failover still require selected infrastructure and exercised evidence |

## Abuse cases

- A document tells the model to ignore system rules, reveal credentials, or retrieve another matter.
- An authenticated user changes a document/project/workflow identifier to another user’s object.
- A user uploads a decompression bomb, malformed office file, malware, or oversized file.
- A connector returns instructions or content designed to trigger unrelated tool calls.
- A source page changes format, redirects to an unapproved host, or supplies an invented citation.
- A developer enables raw stream logging or production mode with placeholder controls.

## Release blockers

No expansion to real client material is authorized until the operator and vendors are selected; the PIA, contracts, residency, retention, deletion, backups, incident process, tenant tests, accessibility review, and penetration test are approved; and a successor to ADR-002 is accepted.
