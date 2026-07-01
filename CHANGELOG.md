# Changelog

All notable changes to this fork are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This is a hardened fork of [`willchen96/mike`](https://github.com/willchen96/mike);
see [NOTICE](NOTICE) for attribution. Each commit subject names the outcome and
each body explains the reasoning — walk `git log --oneline` for the full index.

## [Unreleased]

### Added

- **Microsoft Word add-in** — an Office.js task pane bringing Mike into Word,
  built on a single shared `@mike/shared` design system with the web app
  (React 19 + Tailwind redesign).
- **Extensibility registries** — pluggable LLM-provider, storage, and
  jurisdiction law-library adapters so common customizations are one-file,
  no-core-edit operations; configurable S3 region for provider-portable storage.
- **Observability** — optional OpenTelemetry tracing and optional Sentry error
  monitoring.
- **React Query caching layer** on the web app (projects, workflows, and
  tabular-review lists).
- **BullMQ job queue** for document conversion.
- **Testing foundations** — API route-level integration tests, a web unit-test
  foundation (Vitest + RTL), a runnable Playwright e2e suite, and a CI
  no-regression coverage floor.
- **Provenance & governance docs** — this CHANGELOG, a root NOTICE, README
  "Relationship to upstream" section, and tech due-diligence / remediation /
  manual-follow-up deliverables.

### Changed

- **Merged upstream `willchen96/mike`** into the hardened fork, resolving and
  DB-validating flagged post-merge items and restoring fork hardening behaviors
  the merge regressed.
- **API service-layer extraction** — split god-files and thinned route handlers
  across documents, projects, tabular, user, chat, and project-chat modules;
  standardized chat-route validation on zod + `parseBody`.
- **Web component decomposition** — broke up the 2,967-line
  `ProjectDocumentsView` and 2,571-line `AssistantMessage` components and
  extracted `TRChatPanel` / `DocumentSidePanel`.
- **Structured logging everywhere** (Pino) with per-request correlation IDs;
  enforced `no-console`.
- Typed the PDF.js facade and dropped redundant casts; general types passes.
- Accessibility: ARIA semantics for the document tree and data grids.

### Fixed

- Prompt-injection spotlighting made unforgeable via a per-request nonce on
  both fence tags.
- Zip-download N+1 query.
- Capped previously unbounded overview RPCs.
- Refresh expired Supabase sessions in the add-in; guarded the dev-server port.

### Security

- Phase 0 must-fixes: prompt injection, graceful shutdown, SSRF, and a credits
  race condition.
- Scoped tabular-review `document_ids` by access (CWE-639 IDOR).
- Required dedicated download-signing and user-API-key encryption secrets
  (fail-fast when missing); timing-safe token handling.
- Documented the real authorization posture (service-role + app-layer) and
  added security-scoped CODEOWNERS.
