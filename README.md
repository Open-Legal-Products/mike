<p align="center">
  <a href="https://mikeoss.com">
    <img src="https://mikeoss.com/og.png" alt="Mike - open-source legal document AI" width="800" />
  </a>
</p>

<h3 align="center">Mike</h3>

<p align="center">
  Open-source AI assistant for legal documents.<br />
  Chat with contracts, briefs, and case files using your own LLM keys.
</p>

<p align="center">
  <a href="https://mikeoss.com">Website</a> ·
  <a href="#why-this-fork-exists">Why This Fork Exists</a> ·
  <a href="#self-hosting">Self-Hosting</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0" /></a>
</p>

---

## Why This Fork Exists

This fork is organized around a simple open-source bet: the fastest way to make Mike durable is to learn from the work already happening around it.

The commit history intentionally reads like a book. Each commit explains:

- **Why** the change matters for a real deployment or contributor.
- **What principle** it applies, such as fail-fast configuration, least privilege, structured observability, defense in depth, or expand/contract database migration.
- **Which precedent** it borrows from the public ecosystem around Mike, especially the open pull requests and active forks summarized in `/Users/amalanandmuthukumaran/Downloads/FORK_REPORT.md`.

The fork report showed a clear signal: contributors were independently solving the same problems in the wild. Security hardening, Docker/self-hosting, provider flexibility, workflow portability, schema discipline, and test coverage were not speculative ideas. They were repeated community patterns. This repository turns those patterns into a more coherent baseline.

## Open-Source Bets

### 1. Make the project legible before making it bigger

The first commits reorganize the repository into npm workspaces:

- `apps/web/` for the Next.js application
- `apps/api/` for the Express API
- `packages/core/` for shared contracts and framework-free utilities
- `packages/api-client/` and `packages/sdk-js/` for typed integration points

**Principle:** a contributor should be able to clone the repo, understand the map, and run common commands from the root.

**Precedent:** active forks had already begun splitting concerns, adding SDK surfaces, and building deployment-specific structure. The monorepo keeps that extensibility available without scattering the codebase.

### 2. Treat security as a product feature

This fork folds in the security themes that appeared repeatedly in open PRs and forks:

- fail-fast environment validation
- singleton Supabase and S3 clients
- timing-safe token comparison
- structured logging with request IDs
- PII minimization in logs
- Helmet and frontend security headers
- Row Level Security deny-all fallback policies
- case-normalized email access checks
- HKDF plus per-row salt for user API key encryption
- monthly credit enforcement before LLM calls
- prompt spotlighting with nonce fences for untrusted document content
- upload magic-byte validation
- `user_id` conversion from `text` to `uuid` with foreign keys to `auth.users`

**Principle:** legal software should fail closed where possible, expose operational problems clearly, and avoid treating the LLM as a security boundary.

**Precedent:** the fork report identified security as the dominant open-PR theme, including PRs #78, #80, #81, #113, #145, #155, #157, and #158. It also found that 10 independent forks had patched the same CWE-639 authorization class around tabular document access. That repeated discovery made access control and database integrity first-order priorities.

### 3. Make self-hosting boring

This fork adds Dockerfiles, Docker Compose, Supabase migration infrastructure, and safe local testing guidance.

**Principle:** self-hosting should be a documented path, not a reverse-engineering exercise. A local stack should use disposable resources, synthetic documents, and server-only secrets.

**Precedent:** the fork report found three independent Docker/self-hosting PRs (#44, #63, #149) plus a large cluster of forks replacing Supabase, R2, or cloud coupling for local and enterprise deployments. The bet here is to reduce divergence by making the supported path clearer.

### 4. Keep provider choice behind a stable interface

Mike supports Anthropic, Google Gemini, and OpenAI. This fork adds model routing tests and a retry wrapper for transient provider errors.

**Principle:** provider choice should be configuration and policy, not scattered conditionals. External LLM APIs fail transiently, so the API layer should distinguish retryable failures from real user-visible errors.

**Precedent:** the fork report identified alternative LLM providers as one of the largest fork clusters. Many forks added OpenAI-compatible endpoints, Bedrock, Azure OpenAI, OpenRouter, Ollama, or local LLM support. The current provider layer is a foundation for that pattern without committing to every provider at once.

### 5. Make workflows portable

This fork adds workflow export/import as `.mikeworkflow.json`, a JSON Schema, and human-readable workflow documentation.

**Principle:** the most useful legal workflows should be portable across teams, instances, and forks. Schema-first formats let humans share workflows while tools validate them.

**Precedent:** PR #59 proposed workflow JSON transfer, and PR #34 proposed declarative workflow pack documentation. The fork report also showed many jurisdiction and practice-area forks building reusable legal workflows. Portable workflow packs are how those investments can travel.

### 6. Let tests protect the sharp edges

The test suite now covers download tokens, storage paths, API key encryption, upload validation, credit limits, prompt spotlighting helpers, document-label resolution, model routing, and basic API health.

**Principle:** tests should concentrate where regressions are expensive: security boundaries, billing/credit gates, provider routing, storage behavior, and prompt assembly.

**Precedent:** the fork report highlighted several testing leaders among active forks. This fork borrows the practice of testing the boundary behavior that makes a deployment trustworthy, not only happy-path UI behavior.

## Features

- **Document chat**: upload contracts, briefs, or case files and ask questions in plain language.
- **Multi-provider LLM support**: works with Anthropic, Google Gemini, and OpenAI.
- **Per-user API keys**: users can configure their own provider keys, or an operator can set instance-wide keys.
- **Project organization**: group related documents into projects for focused conversations.
- **Workflow portability**: export and import reusable `.mikeworkflow.json` workflow packs.
- **DOC/DOCX support**: converts Word documents to PDF via LibreOffice before processing.
- **Self-hostable stack**: run with your own Supabase project and S3-compatible storage.

## Tech Stack

- **Frontend**: [Next.js](https://nextjs.org)
- **Backend**: [Express](https://expressjs.com)
- **Auth and database**: [Supabase](https://supabase.com) (Postgres plus Auth)
- **Storage**: [Cloudflare R2](https://developers.cloudflare.com/r2/) or any S3-compatible bucket
- **LLM providers**: Anthropic, Google Gemini, OpenAI
- **Tests**: Vitest and Supertest
- **Logging**: Pino structured JSON logs with per-request correlation IDs

## Repo Structure

```text
apps/web/              Next.js application
apps/api/              Express API, Supabase access, document processing, database schema
packages/core/         Shared contracts, domain types, and framework-free utilities
packages/api-client/   Typed HTTP client for the Mike API
packages/sdk-js/       Public JavaScript SDK wrapper
supabase/migrations/   Incremental database updates for existing deployments
schemas/               JSON Schemas for portable formats such as workflows
docs/                  Architecture, API, workflow, and safe local testing guides
```

## Reading The Commit History

The commits are ordered as chapters:

1. **Foundation:** monorepo workspaces, community health files, and migration infrastructure.
2. **Operational safety:** fail-fast env validation, singleton clients, structured logging, headers, readiness probes, and CI.
3. **Security hardening:** token expiry, RLS fallback, email normalization, bounded queries, HKDF encryption, prompt spotlighting, upload validation, and UUID foreign keys.
4. **Self-hosting and portability:** Docker Compose, safe local testing docs, workflow export/import, and workflow schemas.
5. **Regression protection:** focused unit and integration tests for the risky boundaries.

When adding new work, keep that shape:

- one commit per idea
- a subject line that names the outcome
- a body that explains why the change exists
- a note on the principle or best practice behind it
- a reference to the upstream PR, fork pattern, or report finding that inspired it

## Complete Change Index

This is the full set of changes in this fork relative to `willchen96/mike` at upstream commit `d39f580`. Read it as a table of contents before walking the commits one by one.

| Chapter | Change | Plain-English Reason | Principle | Borrowed Precedent |
|---:|---|---|---|---|
| 1 | Reorganize into npm workspaces | Put the web app, API, shared types, API client, and SDK into predictable folders so contributors can find things. | Make the project legible before scaling it. | Active forks split concerns and added integration surfaces. |
| 2 | Add community health files | Give contributors issue templates, PR expectations, conduct rules, and a private security-reporting path. | Healthy projects document how people collaborate. | GitHub community-health conventions and PR #147. |
| 3 | Add Supabase migration infrastructure | Turn one large schema file into timestamped database changes that can be applied safely over time. | Schema history should be reviewable and repeatable. | Supabase CLI practice, Docker/local-dev PRs, and PR #113. |
| 4 | Validate env, reuse clients, fix timing comparison | Fail loudly on bad config, reuse long-lived DB/storage clients, and avoid leaking token timing clues. | Fail fast; avoid per-request resource churn; compare secrets safely. | PRs #81, #106, and #109. |
| 5 | Add structured request logging | Give every request a correlation ID so production issues can be traced across log lines. | Logs should be machine-queryable and privacy-aware. | PR #156 and production observability practice. |
| 6 | Remove console logging and PII logs | Stop sending legal-document activity and user identifiers into plain logs. | Minimize sensitive data in operational systems. | PR #80 and GDPR data-minimization practice. |
| 7 | Add security headers and readiness probe | Harden browser/API responses and distinguish "process is alive" from "service is ready." | Defense in depth and deployable health checks. | PR #78 and common container orchestration practice. |
| 8 | Add API workspace config | Make the API build, test, and type-check as its own workspace. | Each package should have clear local commands. | Monorepo/workspace practice seen across larger forks. |
| 9 | Move API source into the workspace | Finish the physical move from `backend/` into `apps/api/`. | Make structure match ownership. | Same monorepo bet as Chapter 1. |
| 10 | Introduce modules, Zod validation, and IDOR guard | Split large route files and validate request inputs before trusted code uses them. | Boundaries should validate data and enforce access. | PR #155 and the fork-report CWE-639 finding. |
| 11 | Test tokens, storage helpers, and API keys | Protect low-level security/storage helpers from silent regressions. | Test the sharp edges first. | Testing leaders in active forks. |
| 12 | Add CI pipeline | Run tests, builds, migrations, and deploy gates automatically on pull requests. | Review should be backed by repeatable checks. | Downstream CI disclosures and testing-focused forks. |
| 13 | Add SSE timeout | Stop stalled LLM streams from holding open server connections forever. | External calls need time bounds. | PR #112. |
| 14 | Expire download tokens | Limit how long signed document-download links remain useful. | Secrets should have lifetimes. | PR #77. |
| 15 | Add RLS deny-all fallback | Make every public table default to no browser/client access unless explicitly allowed. | Least privilege and defense in depth. | PR #145. |
| 16 | Normalize shared emails | Treat email casing consistently when checking shared project access. | Access checks should match user expectations and stored identity rules. | PR #79. |
| 17 | Paginate chat history | Avoid loading unbounded chat history in one request. | Public endpoints need resource limits. | PR #110. |
| 18 | Reduce JSON body size and handle crashes | Lower accidental memory pressure and log unexpected process-level failures. | Bound inputs and surface operational failures. | Security-hardening fork patterns. |
| 19 | Add ESLint security rules | Catch unsafe TypeScript and API patterns before review. | Automate boring review checks. | Open-source CI hygiene. |
| 20 | Add Dependabot and CODEOWNERS | Keep dependency updates flowing and route sensitive changes to reviewers. | Maintenance should be systematic. | GitHub dependency and ownership conventions. |
| 21 | Add audit and lint scans to CI | Make dependency and lint risk visible in every PR. | Security checks belong in the merge path. | Security-hardening PR cluster. |
| 22 | Encrypt API keys with HKDF and per-row salt | Avoid deriving every user API-key encryption key from one static hash. | Use standard key derivation and unique salts. | PR #76. |
| 23 | Enforce monthly message credits | Make the usage-limit UI real by checking credits before LLM calls. | Billing and quota gates must live server-side. | PR #157. |
| 24 | Spotlight untrusted content | Fence document text and filenames so the model can better distinguish user instructions from untrusted content. | LLMs are not security boundaries; prompts need provenance. | PR #158 and `docs/SECURITY-MODEL.md`. |
| 25 | Validate upload magic bytes | Check file signatures instead of trusting extensions alone. | Trust content, not names. | PR #78 and upload-security practice. |
| 26 | Finish structured logging in `chatTools` | Bring the large prompt/tool module into the same logging discipline as the rest of the API. | Observability should be consistent in sensitive paths. | PR #156 and Chapter 5. |
| 27 | Add Docker Compose dev environment | Let contributors run web/API dependencies locally with less manual setup. | Self-hosting should be boring. | PRs #44, #63, #149 and local-stack forks. |
| 28 | Add Supertest integration tests | Test the Express app through HTTP while keeping app creation separate from process startup. | Integration tests should exercise real request boundaries. | Downstream test suites in active forks. |
| 29 | Retry transient LLM provider errors | Recover from temporary provider overload instead of failing immediately. | External API failures need classified retries. | Alternative-provider fork cluster. |
| 30 | Convert `user_id` to UUID foreign keys | Make database user references match Supabase Auth and prevent orphaned data. | Enforce integrity in the database. | PR #113. |
| 31 | Export and import workflow JSON | Let users move workflows between instances and teams. | Useful knowledge should be portable. | PR #59. |
| 32 | Document workflow pack schema | Give humans and tools a shared contract for workflow files. | Schema-first formats reduce fork divergence. | PR #34 and workflow-heavy forks. |
| 33 | Add safe local testing guidance | Warn contributors away from production data, production buckets, and browser-exposed service keys. | Good docs prevent expensive mistakes. | PR #133. |
| 34 | Test credit-limit logic | Pin the edge cases around monthly quota enforcement. | Server-side gates need boundary tests. | Chapter 23 and testing-focused forks. |
| 35 | Test spotlight nonce and document labels | Make sure prompt fencing and document lookup helpers keep working. | Prompt assembly deserves regression tests. | Chapter 24. |
| 36 | Test model routing | Ensure each model ID goes to the right provider and unknown IDs fail safely. | Provider abstraction needs a contract. | Alternative-provider fork cluster. |
| 37 | Rewrite README as the guide | Turn the README into a reader's map for the whole fork. | Documentation should explain the why, not just the how. | The fork report itself. |

## Self-Hosting

### Prerequisites

- Node.js 20 or newer
- npm
- A Supabase project
- A Cloudflare R2 bucket, MinIO bucket, or another S3-compatible bucket
- At least one supported model provider API key: Anthropic, Google Gemini, or OpenAI
- LibreOffice installed locally if you need DOC/DOCX to PDF conversion

### Database Setup

For a **new** Supabase database, open the Supabase SQL editor and run the contents of `apps/api/schema.sql`.

For an **existing** database, apply the incremental files in `supabase/migrations/` instead. Do not run the full schema file over live data.

### Environment

Create local env files:

```bash
touch apps/api/.env
touch apps/web/.env.local
```

`apps/api/.env`:

```bash
PORT=3001
FRONTEND_URL=http://localhost:3000
DOWNLOAD_SIGNING_SECRET=replace-with-a-random-32-byte-hex-string
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-supabase-service-role-key

R2_ENDPOINT_URL=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=mike

GEMINI_API_KEY=your-gemini-key
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
RESEND_API_KEY=your-resend-key
USER_API_KEYS_ENCRYPTION_SECRET=your-long-random-secret
```

`apps/web/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-anon-key
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Supabase values come from the project dashboard. Use the project URL for `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`, the service role key for the backend `SUPABASE_SECRET_KEY`, and the anon/public key for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`. If your Supabase project shows multiple key formats, use the legacy JWT-style anon and service role keys expected by the Supabase client libraries.

> **Security:** `SUPABASE_SECRET_KEY` is the Supabase **service role** key. It bypasses Row Level Security and must never appear in `NEXT_PUBLIC_*` variables or be sent to a browser. Keep it in `apps/api/.env` only.

Provider keys are only needed for the models and email features you plan to use. Model provider keys can be configured in `apps/api/.env` for the whole instance, or per user in **Account > Models & API Keys**. If a provider key is present in `apps/api/.env`, that provider is available by default and the matching browser API key field is read-only.

### Safe Local Testing

- **Use a dedicated, disposable Supabase project**: not your production database.
- **Use a dedicated R2 bucket or MinIO**: not a bucket that serves production traffic.
- **Use synthetic documents**: do not upload real client documents, case files, or personally identifiable information to a development instance.
- **Use provider keys with low spend limits**: set billing alerts on Anthropic, OpenAI, and Gemini accounts used for development.

More detail lives in [docs/safe-local-testing.md](docs/safe-local-testing.md).

### Install

```bash
npm install
```

### Run Locally

Start the backend:

```bash
npm run dev --prefix apps/api
```

Start the frontend:

```bash
npm run dev --prefix apps/web
```

Open [http://localhost:3000](http://localhost:3000).

### First Run

1. Sign up in the app.
2. If you did not set provider keys in `apps/api/.env`, open **Account > Models & API Keys** and add an Anthropic, Gemini, or OpenAI key.
3. Create or open a project and start chatting with documents.

## Useful Commands

```bash
npm test --prefix apps/api
npm run build --prefix apps/api
npm run build --prefix apps/web
npm run lint --prefix apps/web
```

## Troubleshooting

**Sign-up confirmation email never arrives.** Confirmation emails are sent by Supabase Auth. For local development, disable email confirmation in **Supabase > Authentication > Providers > Email**. For production, configure custom SMTP in Supabase; the built-in mailer is rate-limited and may be restricted on newer projects.

**The model picker shows a missing-key warning.** Add a key for that provider in **Account > Models & API Keys**, or set the provider key in `apps/api/.env` and restart the backend.

**DOC or DOCX conversion fails.** Install LibreOffice and restart the backend so the conversion commands are on the process path.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. For bugs and feature requests, open a [GitHub issue](../../issues).

Security reports should follow [SECURITY.md](SECURITY.md) and use private vulnerability reporting rather than public issues.

## License

Mike is licensed under the [GNU Affero General Public License v3.0](LICENSE).
