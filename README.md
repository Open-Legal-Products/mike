# JessicaOS

JessicaOS is an open-source AI legal platform for UK practice: a document assistant with a Next.js frontend, an Express backend, Supabase Auth/Postgres, and Cloudflare R2-compatible object storage. It is the first substantive UK version of the platform — real UK data integrations, verified citations, and an optional fully on-premises model mode, not just a relabelled US product.

Built by the COO of Aria Grace Law and piloted with practising solicitors there.

- Practising solicitor evaluating the platform? Start with [UK data integrations](#uk-data-integrations), [model providers](#model-providers), and the [roadmap](#roadmap).
- Self-hosting or contributing code? Go straight to [Self-hosting](#self-hosting).

## Fork lineage

JessicaOS is a fork of [Mike](https://github.com/willchen96/mike) (MikeOS) by Will Chen, licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). The lineage is preserved and celebrated, not hidden — Mike's architecture, security work, and core document/chat engine are the foundation this UK version builds on.

Naming rationale: Mike worked for Harvey. They both worked for Jessica.

## UK data integrations

> Landing across the current UK workstreams (Companies House and legislation.gov.uk are in review at the time of writing); see the [roadmap](#roadmap) for what is deliberately deferred.

- **Companies House** — live company search, company profiles, officers, persons with significant control (PSCs), and filing history. Requires a free API key (see [Self-hosting](#self-hosting)).
- **legislation.gov.uk** — statute and statutory instrument lookup, revised text, and citation resolution. No API key required; reuse is permitted under the Open Government Licence. Where legislation.gov.uk has not yet applied an amendment to the text it holds, JessicaOS surfaces the outstanding-effects flag rather than presenting revised text as settled — revision lag is never hidden.
- **Citation verification** — the assistant is instructed to verify every statutory citation against the live legislation.gov.uk API using its verification tools before finalising an answer, and the eval suite resolves every statutory reference in workflow output against the live API. An unverifiable citation is treated as a bug and fails the eval citation gate.

## Model providers

Bring your own API key for Claude, Gemini, OpenAI, or OpenRouter, configured per user in **Account → API Keys** (or as instance-wide defaults in `backend/.env`). Frontier API models are the recommended default for quality.

JessicaOS also supports a **local / on-premises mode**: point the backend at any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM) via `LOCAL_LLM_BASE_URL` and `LOCAL_LLM_MODELS` (`OPENAI_BASE_URL` is honoured as an alias). This is a data-sovereignty option, not a cost-saving one — documents and prompts never leave the firm's own infrastructure. Local models carry real quality trade-offs against frontier APIs; see the eval comparison below and `docs/local-models.md` (setup guide and honest quality guidance, landing with the local-model support workstream) before relying on one for client work.

## Model quality — eval comparison

| Model | Deterministic pass rate | Citation gate | Judged mean (1–5) |
|---|---|---|---|
| Claude | — | — | — |
| Gemini | — | — | — |
| Local Qwen (via Ollama) | — | — | — |

Populated by the full eval comparison run; see `evals/README.md`.

## Roadmap

- **Find Case Law (The National Archives)** — case-law retrieval is deferred pending a computational-use licence (application in progress). Until then, the assistant is instructed to cite no case law it cannot verify.
- **HM Land Registry Business Gateway** — deferred; requires a commercial account.
- **BAILII** — never scraped or integrated; their terms prohibit it.

## Self-hosting

### Prerequisites

- Node.js 20 or newer, and npm
- git
- A Supabase project
- A Cloudflare R2 bucket, MinIO bucket, or another S3-compatible bucket
- At least one model provider API key: Anthropic, Google Gemini, OpenAI, or OpenRouter — or a running Ollama/LM Studio/vLLM endpoint for local mode
- LibreOffice installed locally if you need DOC/DOCX to PDF conversion

### Repository layout

- `frontend/` — Next.js application
- `backend/` — Express API, Supabase access, document processing
- `backend/schema.sql` — Supabase schema for fresh databases
- `backend/migrations/` — dated, incremental schema migrations; on an existing database, apply the files dated after the version you deployed
- `evals/` — golden-set eval harness (deterministic, citation-gate, and judged cases)
- `docs/safe-local-testing.md` — how to test safely with disposable infrastructure and synthetic documents before touching real client data

### Database setup

For a new Supabase database, open the Supabase SQL editor and run the contents of `backend/schema.sql`. It is written for fresh deployments and already includes the latest database shape.

For an existing database, do not run the full schema file over production data. Instead, apply the incremental files in `backend/migrations/`, in filename order, starting from the first migration dated after the version you currently have deployed.

### Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Fill in `.env` (see the environment variable table below), then apply `backend/schema.sql` to your Supabase project as above, and start the backend:

```bash
npm run dev
```

### Frontend setup

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-anon-key
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Only `NEXT_PUBLIC_`-prefixed variables belong here — no secrets in the frontend, ever. Then:

```bash
npm run dev
```

Open `http://localhost:3000`.

### Environment variables (backend)

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | optional (default 3001) | backend port |
| `FRONTEND_URL` | yes | CORS origin |
| `DOWNLOAD_SIGNING_SECRET` | yes | HMAC signing for `/download/:token` URLs |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | yes | Supabase service-role key (backend only) |
| `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | yes for document uploads | Cloudflare R2 / S3-compatible storage |
| `R2_BUCKET_NAME` | optional (default `mike`) | storage bucket name |
| `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | optional | instance-wide model provider fallback keys (users can also add their own in **Account → API Keys**) |
| `RESEND_API_KEY` | optional | email sending (SDK installed; not yet wired into `src/`) |
| `USER_API_KEYS_ENCRYPTION_SECRET` | yes | encrypts each user's own API keys at rest |
| `COMPANIES_HOUSE_API_KEY` | optional, recommended | powers the Companies House integration above (lands with that workstream) |
| `LOCAL_LLM_BASE_URL` | optional | OpenAI-compatible endpoint for on-premises models — Ollama, LM Studio, vLLM (lands with the local-model support workstream) |
| `LOCAL_LLM_MODELS` | optional | comma-separated model ids to offer from that endpoint |
| `LOCAL_LLM_API_KEY` | optional | key for the local endpoint, if it checks one — most don't |

`OPENAI_BASE_URL` is honoured as an alias for `LOCAL_LLM_BASE_URL` when the latter is unset, for anyone already following that convention. Provider keys and the Companies House key are only needed for the features you plan to use. For the full env var registry, including rate-limit tuning and MCP connector settings, see `CLAUDE.md`.

### Companies House API key

Register a free key at [developer.company-information.service.gov.uk](https://developer.company-information.service.gov.uk/). Set it as `COMPANIES_HOUSE_API_KEY` in `backend/.env`, or add it per user in **Account → API Keys** once the integration lands.

### Safe local testing

Before pointing any deployment at real client documents, read `docs/safe-local-testing.md` — disposable Supabase projects, disposable storage buckets, capped provider API keys, and synthetic documents only until you have reviewed your own data flows.

### Evals

```bash
npm run evals          # full golden set — CI merge gate, includes the citation hard gate
npm run evals:smoke    # ≤5 smoke cases
```

See `evals/README.md` for case types and setup.

### Troubleshooting

**Sign-up confirmation email never arrives.** Confirmation emails are sent by Supabase Auth, not by JessicaOS. For local development, the simplest fix is to disable email confirmation in **Supabase > Authentication > Providers > Email**. For production, configure custom SMTP in Supabase; the built-in mailer is heavily rate-limited and may be restricted on newer projects.

**The model picker shows a missing-key warning.** Add a key for that provider in **Account → API Keys**, or configure the provider key in `backend/.env` and restart the backend.

**DOC or DOCX conversion fails.** Install LibreOffice locally and restart the backend so document conversion commands are available on the process path.

### Useful checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit
```

## Piloted with Aria Grace Law

JessicaOS is being piloted with practising solicitors at Aria Grace Law. Feedback and issues are welcome — please open a GitHub issue.

## Licence

JessicaOS is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0), the same licence as upstream Mike. See `LICENSE`. Upstream copyright and attribution are preserved — see [Fork lineage](#fork-lineage) above. Contributions are welcome; see `CONTRIBUTING.md`.
