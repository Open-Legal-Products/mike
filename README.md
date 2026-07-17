<p align="center">
  <a href="https://mikeoss.com">
    <img src="https://mikeoss.com/og.png" alt="Mike – open-source legal document AI" width="800" />
  </a>
</p>

<h3 align="center">Mike</h3>

<p align="center">
  Open-source, self-hosted AI assistant for legal documents.<br />
  Chat with contracts, briefs, and case files using your own LLM keys.
</p>

<p align="center">
  <a href="#apps--features">Features</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#using-mike">Using Mike</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0" /></a>
</p>

---

## What is Mike?

Mike is a self-hosted AI assistant for legal documents. Upload contracts, briefs, or case files and ask questions in plain language — with **grounded, cited answers** over your own documents.

Mike is **bring-your-own-key (BYOK)**: you supply your own LLM API keys — Anthropic, Google Gemini, OpenAI, Vertex AI, or any OpenAI-compatible endpoint (including self-hosted Ollama). There is no Mike-operated backend or telemetry in the loop, so no vendor-hosted Mike service ever receives your documents. To answer a question, Mike sends the relevant document content to whichever provider **you** configure, over **your** account, under **that provider's terms** — no third party beyond the model provider you pick.

You can run Mike **fully locally** with no cloud accounts (Docker + a local Supabase), or deploy it against managed services. See [Quick Start](#quick-start).

---

## Apps & Features

Mike ships two end-user apps over one backend:

| App | What it is | Docs |
|---|---|---|
| **Web app** | The main product — a Next.js UI for chat, projects, tabular reviews, and workflows | This README |
| **Word add-in** | An Office.js task pane that brings Mike into Microsoft Word (chat, tracked-change redlines, one-click actions) | [`word-addin/README.md`](word-addin/README.md) |

For building on top of the API, Mike also provides typed API clients — a [Python SDK](sdks/python/) (sync + async) and a [JavaScript SDK](docs/sdk.md). These are libraries, not apps.

### Features

- **Document chat with citations** — multi-turn conversation with tool use; every answer links back to the exact source text.
- **Demo mode** — try the full UI with no API key; demo answers are transparent placeholders, never fake analysis.
- **Bring-your-own-key** — per-user API keys (encrypted at rest) or operator-wide instance keys.
- **Projects** — group related documents, chats, and reviews; invite members.
- **Tabular reviews** — extract a chosen set of fields ("columns") across a whole document set into an answer grid.
- **Workflows** — a library of reusable, practice-area templates for chat and tabular reviews; exportable as `.mikeworkflow.json`. See [`docs/workflows.md`](docs/workflows.md).
- **DOC/DOCX support** — via LibreOffice conversion (optional dependency).
- **US case law** — citation verification and opinion search via CourtListener (optional).
- **MCP connectors** — connect remote [Model Context Protocol](https://modelcontextprotocol.io) servers to add tools to chat, no code required.
- **Pluggable providers & storage** — swap LLM providers, storage backends, and jurisdiction law libraries via one-file registries (see [Configuration](#configuration)).

> Want to see it in action? [`FEATURE_WALTHROUGH.md`](FEATURE_WALTHROUGH.md) is a screenshot-driven tour of every flow, captured live against the local dev stack.

---

## Quick Start

### Prerequisites

Each item links to its setup instructions. Only the first four are required to run Mike.

- **Node.js 22+** and **npm** — via [nodejs.org](https://nodejs.org/en/download) or [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) (npm ships with Node.js)
- **Docker** — [install Docker Desktop](https://docs.docker.com/get-docker/); the default setup runs Postgres/Supabase and object storage (MinIO) locally, so no cloud accounts are needed
- **[Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)** — the recommended setup runs Supabase locally (or use a free [hosted project](https://supabase.com/dashboard) — see [Configuration → Hosting & database](#hosting--database))
- **At least one LLM API key** — from [Anthropic](https://console.anthropic.com), [Google Gemini](https://aistudio.google.com), or [OpenAI](https://platform.openai.com) (or add it later in the UI)

> Optional features have their own dependencies — LibreOffice for DOC/DOCX conversion, a CourtListener token for US case law. See [Configuration](#configuration); they are not required to run Mike.

### 1. Clone and install

```bash
git clone https://github.com/amal66/mike.git
cd mike
npm install
```

### 2. Set up services, database, and env

The recommended path is **fully local** — no cloud accounts. It needs just Docker and the Supabase CLI.

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

> Prefer a managed database, or deploying? See [Configuration → Hosting & database](#hosting--database).

### 3. Run

```bash
npm run dev:api    # backend  → http://localhost:3001
npm run dev:web    # frontend → http://localhost:3000
```

### 4. First login

1. Open [http://localhost:3000](http://localhost:3000) and sign up.
2. If email confirmation is enabled in Supabase, disable it under **Authentication > Providers > Email** for local dev.
3. If you didn't set provider keys in `apps/api/.env`, open **Account > Models & API Keys** and add at least one (or explore in demo mode first).

---

## Using Mike

Once you're signed in, the core flows are:

1. **Chat with a document.** Attach a PDF/DOCX in the composer and ask a question. Mike reads the document with a tool step, then streams a grounded answer with **inline citations** that link to the exact source text, plus a citations panel.
2. **Organize with projects.** Group related documents into a **Project** so you can run chats and tabular reviews across the whole set, and invite team members.
3. **Extract fields at scale with tabular reviews.** Define columns (each with a name, output format, and prompt), pick documents, and Mike fills a spreadsheet-style grid — one cell per document per column.
4. **Reuse expertise with workflows.** Apply a pre-built template (NDA review, due-diligence checklist, risk matrix…) to a chat or review in one click, or save and export your own.
5. **Work inside Word.** Sideload the [Word add-in](word-addin/README.md) to chat about the open document, apply AI suggestions as tracked-change redlines, and run saved workflows without leaving Word.

For a step-by-step, screenshot-driven tour of all of these, see [`FEATURE_WALTHROUGH.md`](FEATURE_WALTHROUGH.md).

---

## Configuration

Mike is configured through two env files — `apps/api/.env` (backend) and `apps/web/.env.local` (frontend) — plus a set of one-file code registries for deeper customization. This section covers the common knobs; full env reference is in the collapsible tables below.

### Models & providers

Configure LLM keys for the whole instance in `apps/api/.env`, or let each user add their own under **Account > Models & API Keys** (encrypted at rest). Supported: Anthropic, Google Gemini, OpenAI, any OpenAI-compatible endpoint (via `OPENAI_BASE_URL` — Ollama, OpenRouter, Azure…), and Gemini-via-Vertex-AI.

- **Secondary models** — the title-generation and tabular-review models are configured separately under **Settings > Model Preferences**.
- **Custom provider** — implement `LLMProviderAdapter` and call `registerProvider()`; no core edits. See [`docs/EXTENDING.md`](docs/EXTENDING.md).

<details>
<summary><strong>Env reference — providers</strong></summary>

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `GEMINI_API_KEY` | Google Gemini API key (AI Studio) |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_BASE_URL` | Override OpenAI base URL (Ollama, OpenRouter, Azure, etc.) |
| `VERTEX_AI_PROJECT` | GCP project ID — required to activate Vertex AI routing for Gemini |
| `VERTEX_AI_LOCATION` | Vertex region (default: `us-central1`); auth uses Application Default Credentials, no API key |

</details>

### Storage

Mike stores uploaded documents in S3-compatible object storage. The default is **local MinIO** (`docker compose up -d minio minio-init`) — the `.env.example` values work as-is with no cloud account. For production, point the same `R2_*` vars at Cloudflare R2 or any S3-compatible bucket, or switch to Google Cloud Storage.

- **Custom backend** — implement the five-method `StorageAdapter` and call `setStorageAdapter()`. See [`docs/EXTENDING.md`](docs/EXTENDING.md).

<details>
<summary><strong>Env reference — storage (MinIO default / R2 / S3)</strong></summary>

| Variable | Default | Description |
|---|---|---|
| `R2_ENDPOINT_URL` | `http://localhost:9000` | Endpoint (`https://<account-id>.r2.cloudflarestorage.com` for R2) |
| `R2_ACCESS_KEY_ID` | `minioadmin` | Access key |
| `R2_SECRET_ACCESS_KEY` | `minioadmin` | Secret key |
| `R2_BUCKET_NAME` | `mike` | Bucket name |
| `R2_REGION` | `us-east-1` | Region (`auto` for Cloudflare R2) |

</details>

<details>
<summary><strong>Env reference — Google Cloud Storage</strong></summary>

Set these instead of the `R2_*` vars, then call `setStorageAdapter(new GCSStorageAdapter())` at startup ([`docs/EXTENDING.md`](docs/EXTENDING.md)). Auth uses Application Default Credentials — set `GOOGLE_APPLICATION_CREDENTIALS` for local dev, or use Workload Identity on GKE/Cloud Run.

| Variable | Description |
|---|---|
| `GCS_BUCKET_NAME` | Bucket name (default: `mike`) |
| `GCS_PROJECT_ID` | GCP project ID (optional with Workload Identity) |
| `GCS_SIGNED_URL_TTL` | Signed URL lifetime in seconds (default: `3600`) |

</details>

### Hosting & database

The [Quick Start](#quick-start) runs **Supabase locally** via the CLI. Alternatives:

- **Hosted Supabase** — point Mike at a cloud [Supabase](https://supabase.com/dashboard) project: copy `apps/api/.env.example` → `apps/api/.env` and `apps/web/.env.local.example` → `apps/web/.env.local`, set the URLs/keys below, then apply the schema (run `apps/api/schema.sql` for a new project, or `supabase/migrations/` incrementally for an existing one).
- **Docker Compose** — `docker-compose.yml` builds and runs the full stack (`api`, `web`, `minio`, `redis`).
- **Air-gapped** — a turnkey no-cloud profile embedding Supabase as 3 services. See [`airgapped/README.md`](airgapped/README.md) and [`airgapped/OPERATIONS.md`](airgapped/OPERATIONS.md).

> **Security:** `SUPABASE_SECRET_KEY` is the **service role** key. It bypasses Row Level Security and must never appear in `NEXT_PUBLIC_*` variables — keep it in `apps/api/.env` only.

<details>
<summary><strong>Env reference — required backend & frontend</strong></summary>

**Backend (`apps/api/.env`) — required**

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL (`https://xxx.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Supabase **service role** key — never expose to the browser |
| `DOWNLOAD_SIGNING_SECRET` | Random 32-byte hex string used to sign download tokens |
| `USER_API_KEYS_ENCRYPTION_SECRET` | Random secret used to encrypt stored user API keys |

**Backend — server**

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the API listens on |
| `FRONTEND_URL` | `http://localhost:3000` | Used for CORS and redirect URLs |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |

**Frontend (`apps/web/.env.local`)**

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Same as `SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase **anon** (public) key |
| `NEXT_PUBLIC_API_BASE_URL` | Backend URL (default: `http://localhost:3001`) |

</details>

### Optional features

- **DOC/DOCX conversion** — install LibreOffice on the API host and restart.
- **US case law (CourtListener)** — set `COURTLISTENER_API_TOKEN` for the instance (or per-user in Settings) to enable citation verification, opinion search, and case-law panels. Set `COURTLISTENER_BULK_DATA_ENABLED=true` to read locally imported bulk data before the live API.
- **Background jobs** — document conversion and tabular extraction can run off the request thread on a Redis-backed queue, each gated behind an `ASYNC_*` flag (default off). See [`docs/async-jobs.md`](docs/async-jobs.md).
- **Jurisdiction law libraries** — add citation conventions/tools for a jurisdiction via `registerLawLibrary()`. See [`docs/EXTENDING.md`](docs/EXTENDING.md).

### Safe local testing

Before pointing Mike at anything real: use a **disposable** Supabase project and storage bucket, upload **synthetic documents only**, and use provider keys with **low spend limits**. Details: [`docs/safe-local-testing.md`](docs/safe-local-testing.md).

---

## Troubleshooting

**Sign-up confirmation email never arrives.** Disable email confirmation in **Supabase > Authentication > Providers > Email** for local dev. For production, configure custom SMTP in Supabase.

**The model picker shows a missing-key warning.** Add a key for that provider in **Account > Models & API Keys**, or set the provider key in `apps/api/.env` and restart the backend.

**DOC or DOCX conversion fails.** Install LibreOffice and restart the backend so the conversion commands are on the process PATH.

**CourtListener tools say the API token is missing.** Set `COURTLISTENER_API_TOKEN` in `apps/api/.env`, or add a token in **Account > Models & API Keys**. Restart the backend after changing `.env`.

**Storage upload fails with a credentials error.** Check `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` (or the GCS equivalents). The API logs the error at startup.

---

## Contributing

Contributions are welcome. **[CONTRIBUTING.md](CONTRIBUTING.md) is the contributor guide** — it gives the technical overview of the codebase (the module pattern, request lifecycle, where each feature lives) and covers local development, the PR process, and commit conventions. Start there.

The short version:
- Open an issue before large changes so the approach can be agreed on.
- Keep PRs focused — one bug or feature per PR.
- Run the relevant tests before opening (`npm test --prefix apps/api`).
- Do not commit `.env` files, API keys, or real documents.

Deeper technical docs live in [`docs/`](docs/) — [architecture](docs/architecture.md), [extending Mike](docs/EXTENDING.md), [API](docs/api.md), [background jobs](docs/async-jobs.md), [security model](docs/SECURITY-MODEL.md), [operational runbook](docs/RUNBOOK.md), and [ADRs](docs/adr/README.md).

Security reports: follow [SECURITY.md](SECURITY.md) and use **private** vulnerability reporting rather than public issues.

---

## License

Mike is licensed under the [GNU Affero General Public License v3.0](LICENSE).

This repository is a **hardened fork** of [`willchen96/mike`](https://github.com/willchen96/mike) — it tracks upstream and layers on a security/code-quality hardening campaign, registry-based extensibility (providers, storage, law libraries), and the Microsoft Word add-in. Upstream copyright remains with the Mike authors; fork changes are © 2026 the fork author. See [NOTICE](NOTICE) and [LICENSE](LICENSE) for full attribution.

<details>
<summary>Design notes and commit history</summary>

This fork was built from a study of 1,019 public forks of the original Mike repository. The commits are structured as numbered chapters, each explaining the *why* behind the change, the principle it applies, and the community precedent that inspired it.

Major themes that emerged from fork research and shaped this codebase:

- **Security hardening** — 10 independent forks patched the same tabular document IDOR; prompts needed content fencing; token lifetimes and timing-safe comparisons were missing.
- **Provider extensibility** — 18 forks added alternative LLM providers. Now handled by the `LLMProviderAdapter` registry.
- **Storage extensibility** — 12 forks replaced the storage backend. Now handled by the `StorageAdapter` interface.
- **Law library plugins** — 13 forks added jurisdiction-specific law integrations. Now handled by the `LawLibraryPlugin` registry.
- **Self-hosting** — 3 independent Docker/self-hosting PRs existed before this fork added first-class Docker Compose support.

Full change index: walk `git log --oneline` from the beginning. Each commit subject names the outcome; each body explains the reasoning. Open work is tracked in [docs/ROADMAP.md](docs/ROADMAP.md) and [CHANGELOG.md](CHANGELOG.md).

</details>
