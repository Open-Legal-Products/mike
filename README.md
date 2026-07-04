<p align="center">
  <a href="https://mikeoss.com">
    <img src="https://mikeoss.com/og.png" alt="Mike – open-source legal document AI" width="800" />
  </a>
</p>

<h3 align="center">Mike</h3>

<p align="center">
  Open-source AI assistant for legal documents.<br />
  Chat with contracts, briefs, and case files using your own LLM keys.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#extending-mike">Extending Mike</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0" /></a>
</p>

---

## Relationship to upstream

This repository is a **hardened fork** of [`willchen96/mike`](https://github.com/willchen96/mike), the original open-source Mike project. It tracks upstream and layers on top of it:

- **Security & code-quality hardening** — a multi-phase campaign (prompt-injection fencing, IDOR fixes, timing-safe token handling, structured logging, test coverage floors, and more). See [CHANGELOG.md](CHANGELOG.md) and the git history (every hardening commit documents its rationale); open work is tracked in [docs/ROADMAP.md](docs/ROADMAP.md).
- **Reorganization & extensibility** — pluggable LLM-provider, storage, and law-library registries so common customizations are one-file, no-core-edit operations.
- **Microsoft Word add-in** — an Office.js task pane that brings Mike into Word, sharing one design system with the web app.

Upstream copyright remains with the Mike authors; fork changes are © 2026 the fork author. Both are licensed under AGPL-3.0. See [NOTICE](NOTICE) and [LICENSE](LICENSE) for full attribution.

---

## What is Mike?

Mike is a self-hosted AI assistant for legal documents. Upload contracts, briefs, or case files and ask questions in plain language. Mike is **bring-your-own-key (BYOK)**: you supply your own LLM API keys — Anthropic, Google Gemini, OpenAI, Vertex AI, or any OpenAI-compatible endpoint. There is no Mike-operated backend or telemetry in the loop, so no vendor-hosted Mike service ever receives your documents.

To answer questions, Mike sends the relevant document content to whichever model provider **you** configure, over **your** account, under **that provider's terms**. Choose (or self-host, e.g. Ollama) a provider whose data-handling terms you accept. Mike does not add a third party beyond the model provider you pick.

**Key features:**
- Document chat with multi-turn conversation and tool use
- Per-user API keys, or operator-wide instance keys
- Projects to group related documents and conversations
- Tabular review — extract structured data across a document set
- Reusable workflows, exportable as `.mikeworkflow.json`
- DOC/DOCX support via LibreOffice conversion
- Pluggable storage (Cloudflare R2, Google Cloud Storage, MinIO, any S3-compatible bucket)
- Pluggable LLM providers (Anthropic, Gemini, OpenAI, Vertex AI, Ollama, or any OpenAI-compatible endpoint)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | [Next.js](https://nextjs.org) |
| Backend | [Express](https://expressjs.com) |
| Auth + Database | [Supabase](https://supabase.com) (Postgres + Auth) |
| Storage | Cloudflare R2 / GCS / MinIO (S3-compatible) |
| LLM providers | Anthropic, Google Gemini, OpenAI |
| Tests | Vitest + Supertest |
| Logs | Pino structured JSON with per-request correlation IDs |

---

## Architecture

> A cheat-sheet for reading, explaining, and defending the codebase. The repo is
> large because it is a full product, not because it is dense — once you learn
> the handful of patterns below, ~85k lines collapses into "the same shapes,
> repeated."

### The 30-second map

```
apps/api/   ~41k LOC   Express API — one module per feature, one shared lib/ underneath
apps/web/   ~43k LOC   Next.js App Router — one route per page, container hooks + presenters
packages/   ~3k  LOC   Shared code (types, HTTP client, design system, SDK surface)
```

The line count tracks **feature count**, not complexity. Each API module is a
self-contained feature (documents, chat, tabular reviews, workflows, case-law,
orgs, users); each web route is one screen over that API. Nothing here is
framework glue — it is all product surface.

### The API module pattern (learn one, know all of them)

Every feature lives under `apps/api/src/modules/<feature>/` and reads the same
way. Learn `documents/` or `projects/` once and the other modules follow:

| File | Present in | Responsibility |
|---|---|---|
| `*.routes.ts` | every module | **Thin HTTP layer.** Parses the request, calls the service, maps typed results → status codes. No business logic. |
| `*.service.ts` | every module with real logic (a few thin ones — `auth`, `downloads`, `case-law` — are routes-only) | **Business logic + data access.** Takes an explicit Supabase client (`db`) + request-derived primitives; returns values or typed `{ ok: false, kind }` results. Never touches `req`/`res`. |
| `*.access.ts` / `*.shared.ts` | where the module needs them | Module-local authorization and shared helpers. Cross-module authorization primitives live in `lib/access.ts`. |

Larger modules split the service by concern rather than growing one file — e.g.
`projects/` is `projects.crud.ts`, `projects.documents.ts`, `projects.folders.ts`,
`projects.chats.ts`, and `projects.shared.ts`, re-exported through
`projects.service.ts` as a single import surface. Same pattern, more files.

### Request lifecycle (a worked example)

A document upload, end to end — the path every write request follows:

```
POST /projects/:projectId/documents
  → middleware/auth.ts          requireAuth: verify Supabase JWT → req.user
  → projects.routes.ts          validate file (extension + magic bytes), call service
  → ensureProjectUploadAccess   projects.documents.ts: check caller may write here
  → processProjectDocumentUpload
        lib/storage.ts          upload original to S3-compatible storage
        lib/convert.ts          DOCX → PDF rendition for display
        lib/pdfjs.ts            count pages
        db.documents / db.document_versions   insert rows, point current_version_id
  → route maps { ok: true, doc } → 201 JSON   (or { ok:false, kind } → 4xx/5xx)
```

Read requests are the same minus the storage writes. The invariant everywhere:
**routes decide HTTP, services decide behaviour, `lib/` does the heavy lifting.**

### Cross-cutting subsystems (`apps/api/src/lib/`)

Modules stay small by composing shared subsystems instead of re-implementing them:

| Area | What it does |
|---|---|
| `llm/` | Provider-agnostic LLM adapter (Anthropic / Gemini / OpenAI), streaming, tool-calling |
| `storage/`, `storage.ts` | S3-compatible object storage adapter (R2 / GCS / MinIO) |
| `rag/` | Retrieval over document text for chat context |
| `mcp/` | Model Context Protocol connectors + OAuth |
| `courtlistener.ts`, `legalSourcesTools/` | Case-law search / retrieval |
| `access.ts` | Shared authorization primitives (org roles, project access) |
| `queue/`, `workers/` | Background jobs (BullMQ) |
| `observability/`, `logger.ts` | OpenTelemetry + Pino structured logging |

### The web app (`apps/web/src/app/`)

Standard Next.js App Router. Routes live under `(pages)/`; shared UI under
`components/`; data-fetching hooks under `hooks/`.

The pattern that keeps screens readable is **container/presenter**:

- **Presenter** — a `*.tsx` component that is (almost) pure JSX. It receives
  state + callbacks and renders them. Example: `ProjectDocumentsView.tsx`.
- **Controller hook** — a `use*.ts` hook holding all the state and handlers
  (optimistic updates, drag-and-drop, uploads). Example:
  `project-documents/useProjectDocumentsController.ts`.

Similarly the assistant chat is split into `useAssistantChat.ts` (request
orchestration), `useAssistantEvents.ts` (the streaming event buffer), and
`applyAssistantStreamEvent.ts` (a flat SSE dispatch table). When a component
looks big, its logic has usually been lifted into a sibling hook — read the hook
for behaviour, the component for layout.

### Where does feature X live?

| Feature | API | Web |
|---|---|---|
| Projects & documents | `modules/projects`, `modules/documents` | `components/projects` |
| Assistant chat | `modules/chat`, `modules/project-chat` | `components/assistant`, `hooks/useAssistantChat.ts` |
| Tabular reviews | `modules/tabular` | `components/tabular` |
| Workflows | `modules/workflows` | `components/workflows`, `(pages)/workflows` |
| Case law | `modules/case-law`, `lib/courtlistener.ts` | rendered inline in assistant messages |
| MCP connectors | `lib/mcp` | `(pages)/account/connectors` |
| Orgs & billing | `modules/orgs`, `modules/user` | `(pages)/account` |

### How to read it without being overwhelmed

1. `apps/api/src/app.ts` + `index.ts` — the wiring. This is your map.
2. One vertical slice: `modules/documents/` routes → service → access. Trace a
   single request through and the pattern repeats for all eleven modules.
3. `lib/` — read subsystems on demand as a slice pulls them in.
4. Web: `app/layout.tsx` → one `(pages)/` route → its presenter → its controller hook.

Internalize the module pattern **once** and most of the API becomes "the same
four-file shape, eleven times." That is the whole trick to holding this codebase
in your head.

---

## Quick Start

### Prerequisites

These are required to run Mike locally. Each item links to its setup instructions.

- **Node.js 22+** and **npm** — install via [nodejs.org](https://nodejs.org/en/download) or [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) (npm ships with Node.js)
- **Docker** — [install Docker Desktop](https://docs.docker.com/get-docker/); the default setup runs Postgres/Supabase and object storage (MinIO) locally, so no cloud accounts are needed
- **[Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)** — the recommended setup runs Supabase locally (or use a free [hosted project](https://supabase.com/dashboard) instead — see the alternative in step 2)
- **At least one LLM API key** — get one from [Anthropic](https://console.anthropic.com), [Google Gemini](https://aistudio.google.com), or [OpenAI](https://platform.openai.com) (or add it later in the UI)

> Some features have their own optional dependencies — LibreOffice for DOC/DOCX conversion, a CourtListener token for US case law lookup. See [Configuration](#configuration) for those; they are not required to run Mike.

### 1. Clone and install

```bash
git clone https://github.com/amal66/mike.git
cd mike
npm install
```

### 2. Set up services, database, and env

The recommended path is **fully local** — no cloud accounts. It needs just Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started).

```bash
docker compose up -d minio minio-init   # object storage (MinIO)
./scripts/setup-local.sh                # local Supabase + writes both .env files + applies migrations
```

Then set the two required secrets in `apps/api/.env` (and optionally an LLM key now — you can also add one later in the UI):

```bash
DOWNLOAD_SIGNING_SECRET=$(openssl rand -hex 32)
USER_API_KEYS_ENCRYPTION_SECRET=$(openssl rand -hex 32)
# optional: ANTHROPIC_API_KEY=…   (or GEMINI_API_KEY / OPENAI_API_KEY)
```

> Deploying, or prefer a managed database? See [Hosted Supabase](#hosted-supabase) for pointing Mike at a cloud Supabase project instead of the local CLI.

### 3. Run

```bash
npm run dev:api    # backend  → http://localhost:3001
npm run dev:web    # frontend → http://localhost:3000
```

### 4. First login

1. Open [http://localhost:3000](http://localhost:3000) and sign up.
2. If email confirmation is enabled in Supabase, disable it under **Authentication > Providers > Email** for local dev.
3. If you did not set provider keys in `apps/api/.env`, open **Account > Models & API Keys** and add at least one.

---

## Configuration

### Backend (`apps/api/.env`)

#### Required

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (`https://xxx.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Supabase **service role** key — never expose this to the browser |
| `DOWNLOAD_SIGNING_SECRET` | Random 32-byte hex string used to sign download tokens |
| `USER_API_KEYS_ENCRYPTION_SECRET` | Random secret used to encrypt stored user API keys |

#### Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the API listens on |
| `FRONTEND_URL` | `http://localhost:3000` | Used for CORS and redirect URLs |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |

#### Storage — local MinIO (default)

The default. `docker compose up -d minio minio-init` and the `.env.example` values
work as-is — no cloud account, nothing to configure:

| Variable | Default |
|---|---|
| `R2_ENDPOINT_URL` | `http://localhost:9000` |
| `R2_ACCESS_KEY_ID` | `minioadmin` |
| `R2_SECRET_ACCESS_KEY` | `minioadmin` |
| `R2_BUCKET_NAME` | `mike` |
| `R2_REGION` | `us-east-1` |

<details>
<summary><strong>Alternative — Cloudflare R2 or any S3-compatible bucket</strong></summary>

For production, point the same `R2_*` vars at a real bucket (`R2_REGION=auto` for
Cloudflare R2):

| Variable | Description |
|---|---|
| `R2_ENDPOINT_URL` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | Bucket name (default: `mike`) |

</details>

<details>
<summary><strong>Alternative — Google Cloud Storage</strong></summary>

Set these instead of the R2 vars. See [Extending Mike → Google Cloud Storage](#google-cloud-storage).

| Variable | Description |
|---|---|
| `GCS_BUCKET_NAME` | Bucket name (default: `mike`) |
| `GCS_PROJECT_ID` | GCP project ID (optional when using Workload Identity) |
| `GCS_SIGNED_URL_TTL` | Signed URL lifetime in seconds (default: `3600`) |

Auth uses Application Default Credentials — set `GOOGLE_APPLICATION_CREDENTIALS` to a service account key file path for local dev, or use Workload Identity on GKE/Cloud Run with no extra config.

</details>

#### LLM providers

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `GEMINI_API_KEY` | Google Gemini API key (AI Studio) |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_BASE_URL` | Override OpenAI base URL (for Ollama, OpenRouter, Azure, etc.) |

#### Vertex AI (Gemini via Google Cloud)

| Variable | Description |
|---|---|
| `VERTEX_AI_PROJECT` | GCP project ID — required to activate Vertex AI routing |
| `VERTEX_AI_LOCATION` | Region (default: `us-central1`) |

#### Legal research — CourtListener (optional)

Enables US case law citation verification, case fetching, opinion search, and case-law panels in assistant responses. Configure the token here for the whole instance, or let each user add their own under **Account > Models & API Keys**.

| Variable | Default | Description |
|---|---|---|
| `COURTLISTENER_API_TOKEN` | — | [CourtListener](https://www.courtlistener.com) API token for live case law and citation tools |
| `COURTLISTENER_BULK_DATA_ENABLED` | `false` | When `true`, read locally imported CourtListener bulk data (Supabase tables + R2-cached opinion JSON) before falling back to the live API |

Fresh databases created from `apps/api/schema.sql` already include the CourtListener support tables; existing deployments should apply the matching migration in `supabase/migrations/` before enabling the feature.

### Frontend (`apps/web/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Same as `SUPABASE_URL` above |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase **anon** (public) key |
| `NEXT_PUBLIC_API_BASE_URL` | Backend URL (default: `http://localhost:3001`) |

> **Security:** `SUPABASE_SECRET_KEY` is the service role key. It bypasses Row Level Security and must never appear in `NEXT_PUBLIC_*` variables. Keep it in `apps/api/.env` only.

---

## Safe Local Development

- Use a **dedicated, disposable Supabase project** — not your production database.
- Use a **dedicated storage bucket** — not one serving production traffic.
- Upload **synthetic documents only** — not real client files or PII.
- Use provider API keys with **low spend limits** and billing alerts set.

Details: [docs/safe-local-testing.md](docs/safe-local-testing.md)

---

## Extending Mike

Mike is built around three extension points. Each is a one-file, one-call operation — no edits to core files required.

### Custom LLM provider

Implement the `LLMProviderAdapter` interface and call `registerProvider()`. The Ollama example is a useful starting point:

```ts
// lib/llm/providers/myProvider.ts
import { registerProvider } from "../registry";

export function setupMyProvider() {
    registerProvider({
        id: "my-provider",
        matchesModel: (m) => m.startsWith("my-"),
        stream: myStreamFunction,
        complete: myCompleteFunction,
        models: { main: ["my-model-large"], mid: ["my-model-fast"], low: [] },
    });
}
```

Call `setupMyProvider()` once at application startup. See [`lib/llm/providers/ollama.ts`](apps/api/src/lib/llm/providers/ollama.ts) for the full pattern.

### Vertex AI (Gemini via Google Cloud)

To route Gemini calls through your Google Cloud project instead of AI Studio (for enterprise billing, data residency, or IAM-gated access):

```ts
import { setupVertexAI } from "lib/llm/providers/vertexAI";
setupVertexAI(); // replaces the built-in Gemini adapter; model IDs unchanged
```

Set `VERTEX_AI_PROJECT` and optionally `VERTEX_AI_LOCATION`. Auth uses Application Default Credentials — no API key required.

### Google Cloud Storage

To use GCS instead of Cloudflare R2:

```ts
import { setStorageAdapter } from "./lib/storage";
import { GCSStorageAdapter } from "./lib/storage/gcs";

setStorageAdapter(new GCSStorageAdapter());
```

Call this once at startup before any uploads. Set `GCS_BUCKET_NAME` and `GCS_PROJECT_ID` (or rely on Workload Identity). See [`lib/storage/gcs.ts`](apps/api/src/lib/storage/gcs.ts) for the full implementation.

### Custom storage backend

Implement the `StorageAdapter` interface (five methods: `upload`, `download`, `delete`, `getSignedUrl`, `checkReady`) and call `setStorageAdapter()`. See [`lib/storage/adapter.ts`](apps/api/src/lib/storage/adapter.ts) for the interface and [`lib/storage/r2.ts`](apps/api/src/lib/storage/r2.ts) for the reference implementation.

### Hosted Supabase

The [Quick Start](#quick-start) runs Supabase locally via the CLI. For a deployment (or if you'd rather not run it locally), point Mike at a cloud [Supabase](https://supabase.com/dashboard) project instead:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
```

- In `apps/api/.env`, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the **service role** key).
- In `apps/web/.env.local`, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (the **anon** key).
- Set the schema: open the project's **SQL Editor** and run `apps/api/schema.sql` for a new project, or apply `supabase/migrations/` incrementally on an existing one (`supabase link` → `supabase db push`).

Storage is independent of this — keep the default local MinIO or point the `R2_*` vars at a cloud bucket (see [Storage](#storage--local-minio-default)).

> **Which migration runner?** There are two, for two contexts, over the same
> `supabase/migrations/` files: local dev uses the Supabase CLI
> (`supabase migration up`, run for you by `setup-local.sh`); deployments
> without the CLI — notably the [air-gapped profile](airgapped/OPERATIONS.md) —
> use `npm run migrate --workspace apps/api`, a ledgered, checksummed runner
> (`apps/api/scripts/migrate.mjs`) that records applied migrations in
> `public.schema_migrations` and fails loudly on drift.

### Jurisdiction-specific law library

Add citation conventions and optional tool schemas for a jurisdiction without touching `chatTools.ts`:

```ts
import { registerLawLibrary } from "lib/lawLibraries";

registerLawLibrary({
    id: "my-jurisdiction",
    displayName: "My Jurisdiction Law",
    systemPromptFragment: () => `\n\n## My Jurisdiction\n...`,
    tools: () => [/* optional OpenAI tool schemas */],
});
```

See [`lib/lawLibraries/examples/danishLaw.ts`](apps/api/src/lib/lawLibraries/examples/danishLaw.ts) for a complete example.

### Python SDK

A typed Python client for the Mike API is available in [`sdks/python/`](sdks/python/):

```bash
pip install -e sdks/python
```

```python
from mike import MikeClient

client = MikeClient(base_url="https://your-mike.app", session_token="...")

# Sync
chats = client.chat.list()

# SSE stream
for event in client.chat.stream(chat_id="...", message="Summarize this contract"):
    print(event)
```

Both sync (`MikeClient`) and async (`AsyncMikeClient`) are supported. See [`sdks/python/`](sdks/python/) for full API reference.

---

## Development

### Run tests

```bash
npm test --prefix apps/api           # unit + integration tests
npm run test:watch --prefix apps/api # watch mode
npm run test:coverage --prefix apps/api
```

### Type check

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```

### Lint

```bash
npm run lint --prefix apps/api
npm run lint --prefix apps/web
```

### Build

```bash
npm run build --prefix apps/api
npm run build --prefix apps/web
```

### Verifying the whole repo

The default root scripts (`npm test`, `npm run lint`, `npm run typecheck`) use
`--workspaces`, which covers `apps/api`, `apps/web`, and `packages/*` but **not**
the Word add-in (an intentionally standalone npm project) or the Python SDK
(`sdks/python`, not a Node project). Two aggregate scripts exercise every project
from a single entrypoint:

```bash
npm run test:all      # workspace tests + Word add-in build + Python SDK test note
npm run verify:all    # lint + typecheck + build across everything, then test:all
```

`verify:all` also runs the Word add-in build (`word-addin`). The Python SDK is not
an npm project, so `test:all` prints its command rather than running it; run it
directly when working on the SDK:

```bash
cd sdks/python && pip install -e '.[dev]' && pytest
```

#### Stack integration tests

Most API tests mock Supabase. A separate, **gated** suite exercises the real stack
(GoTrue auth + Postgres RLS + the credit RPC) — the auth↔API contract, the deny-all
RLS firewall, and cross-tenant isolation. It is skipped in the default unit run and
is the harness you re-run on **every Supabase version bump** to prove the stack
contract still holds (the prerequisite for pinning a fixed image set):

```bash
supabase start                 # once, in the repo
cd apps/api && npm run test:stack   # auto-reads keys from `supabase status`
```

### Project structure

```
apps/api/              Express API — routes, LLM adapters, document processing, Supabase access
apps/web/              Next.js frontend
word-addin/            Microsoft Word task-pane add-in (Office.js)
packages/core/         Shared types and utilities (no framework dependencies)
packages/api-client/   Typed HTTP client for the Mike API (used by web + add-in)
packages/shared/       Shared design system (web + Word add-in)
packages/sdk-js/       JS SDK surface (license status: see docs/LICENSING.md)
sdks/python/           Python client SDK (MIT)
airgapped/             Turnkey air-gapped self-hosting (compose profile + operator scripts)
evals/                 Offline LLM eval harness (exit-code gated)
supabase/migrations/   Incremental database migrations
schemas/               JSON Schemas for portable formats (workflows, etc.)
docs/                  Architecture, API, workflow, and safe-local-testing guides
```

---

## Troubleshooting

**Sign-up confirmation email never arrives.**
Disable email confirmation in **Supabase > Authentication > Providers > Email** for local dev. For production, configure custom SMTP in Supabase (the built-in mailer is rate-limited).

**The model picker shows a missing-key warning.**
Add a key for that provider in **Account > Models & API Keys**, or set the provider key in `apps/api/.env` and restart the backend.

**DOC or DOCX conversion fails.**
Install LibreOffice and restart the backend so the conversion commands are on the process PATH.

**CourtListener tools say the API token is missing.**
Set `COURTLISTENER_API_TOKEN` in `apps/api/.env`, or add a CourtListener token in **Account > Models & API Keys** for the signed-in user. Restart the backend after changing `.env`.

**CourtListener bulk lookup is not returning local results.**
Confirm `COURTLISTENER_BULK_DATA_ENABLED=true`, the two CourtListener tables have been populated, and opinion JSON exists in R2 under `courtlistener/opinions/by-cluster/`. If bulk data is unavailable, Mike falls back to the live API when a token is configured.

**Storage upload fails with a credentials error.**
Check that `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are set correctly (or the GCS equivalents). The API logs will include the error at startup.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

The short version:
- Open an issue before large changes so the approach can be agreed on.
- Keep PRs focused — one bug or feature per PR.
- Run the relevant tests before opening (`npm test --prefix apps/api`).
- Do not commit `.env` files, API keys, or real documents.

Security reports: follow [SECURITY.md](SECURITY.md) and use **private** vulnerability reporting rather than public issues.

---

## License

Mike is licensed under the [GNU Affero General Public License v3.0](LICENSE).

---

<details>
<summary>Design notes and commit history</summary>

This fork was built from a study of 1,019 public forks of the original Mike repository. The commits are structured as numbered chapters, each explaining the *why* behind the change, the principle it applies, and the community precedent that inspired it.

The major themes that emerged from fork research and shaped this codebase:

- **Security hardening** — 10 independent forks patched the same tabular document IDOR; prompts needed content fencing; token lifetimes and timing-safe comparisons were missing.
- **Provider extensibility** — 18 forks added alternative LLM providers. Now handled by the `LLMProviderAdapter` registry.
- **Storage extensibility** — 12 forks replaced the storage backend. Now handled by the `StorageAdapter` interface.
- **Law library plugins** — 13 forks added jurisdiction-specific law integrations. Now handled by the `LawLibraryPlugin` registry.
- **Self-hosting** — 3 independent Docker/self-hosting PRs existed before this fork added first-class Docker Compose support.

Full change index: walk `git log --oneline` from the beginning. Each commit subject names the outcome; each body explains the reasoning.

</details>
