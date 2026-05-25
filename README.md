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

## What is Mike?

Mike is a self-hosted AI assistant for legal documents. Upload contracts, briefs, or case files and ask questions in plain language. You supply your own LLM API keys — Anthropic, Google Gemini, or OpenAI — so no document content leaves your infrastructure through a third-party service.

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

## Quick Start

### Prerequisites

- Node.js 20+
- npm
- A [Supabase](https://supabase.com) project (free tier is fine for local dev)
- A storage bucket: [Cloudflare R2](https://developers.cloudflare.com/r2/), [Google Cloud Storage](#google-cloud-storage), or [MinIO](https://min.io) running locally
- At least one LLM API key: [Anthropic](https://console.anthropic.com), [Google Gemini](https://aistudio.google.com), or [OpenAI](https://platform.openai.com)
- LibreOffice (only needed for DOC/DOCX → PDF conversion)

### 1. Clone and install

```bash
git clone https://github.com/amal66/mike.git
cd mike
npm install
```

### 2. Configure environment

```bash
cp apps/api/.env.example apps/api/.env        # or create from scratch — see below
cp apps/web/.env.example apps/web/.env.local  # or create from scratch
```

See the [Configuration](#configuration) section for every env var.

### 3. Set up the database

For a **new** Supabase project, open the SQL editor and run `apps/api/schema.sql`.

For an **existing** database, apply migrations incrementally instead:

```bash
# Install the Supabase CLI then:
supabase db push
```

> Never run the full `schema.sql` against a live database. Use the migration files in `supabase/migrations/`.

### 4. Run locally

```bash
# Backend (http://localhost:3001)
npm run dev --prefix apps/api

# Frontend (http://localhost:3000)
npm run dev --prefix apps/web
```

### 5. First login

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

#### Storage — Cloudflare R2 (default)

| Variable | Description |
|---|---|
| `R2_ENDPOINT_URL` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | Bucket name (default: `mike`) |

#### Storage — Google Cloud Storage

Set these instead of the R2 vars. See [Extending Mike → Google Cloud Storage](#google-cloud-storage).

| Variable | Description |
|---|---|
| `GCS_BUCKET_NAME` | Bucket name (default: `mike`) |
| `GCS_PROJECT_ID` | GCP project ID (optional when using Workload Identity) |
| `GCS_SIGNED_URL_TTL` | Signed URL lifetime in seconds (default: `3600`) |

Auth uses Application Default Credentials — set `GOOGLE_APPLICATION_CREDENTIALS` to a service account key file path for local dev, or use Workload Identity on GKE/Cloud Run with no extra config.

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

#### Email

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | [Resend](https://resend.com) API key for transactional email |

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

### Project structure

```
apps/api/              Express API — routes, LLM adapters, document processing, Supabase access
apps/web/              Next.js frontend
packages/core/         Shared types and utilities (no framework dependencies)
sdks/python/           Python client SDK
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
