# Mike

![Mike](https://mikeoss.com/link-image.jpg)

Mike or MIkeOSS is a legal AI platform that is able to assist you with document review, drafting and legal research.

It has a Next.js frontend, an Express backend, Supabase Auth/Postgres, and Cloudflare R2-compatible object storage.

Website: [mikeoss.com](https://mikeoss.com)

## Docker (local, account-free)

Run the whole stack in containers with **one command** and no external
accounts. `docker-compose.yml` embeds everything: Supabase (Postgres + Auth +
data API + a gateway), RustFS for S3-compatible object storage, and the
frontend/backend. The schema loads itself on first boot.

The only thing you must supply is **at least one model provider key**
(Anthropic, Gemini, or OpenAI — these are external APIs and cannot be
self-hosted).

```bash
# 1. Env files
cp .env.example .env                  # frontend build vars (local demo keys prefilled)
cp backend/.env.example backend/.env

# 2. In backend/.env set:
#    - one of ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY
#    - DOWNLOAD_SIGNING_SECRET and USER_API_KEYS_ENCRYPTION_SECRET (openssl rand -hex 32)
#    SUPABASE_URL / SUPABASE_SECRET_KEY / R2_* are set by docker-compose, leave them.

# 3. Up
docker compose up --build
```

Open `http://localhost:3000` and sign up. Other endpoints: Postgres
`localhost:54322`, Supabase API `localhost:54321`, storage console
`localhost:9001` (`rustfsadmin` / `rustfsadmin`), and the **Mailpit inbox** at
`localhost:8025`.

### What happens when you register

1. You sign up with email + password at `localhost:3000`.
2. The Auth service creates an **unconfirmed** user and emails a confirmation
   link. No mail leaves your machine — it is caught by Mailpit.
3. Open the Mailpit inbox at **http://localhost:8025**, open the "Confirm Your
   Email" message, and click the link. That confirms the account and redirects
   back to the app.
4. Now you can log in.

To skip the email step entirely (instant signup), set
`GOTRUE_MAILER_AUTOCONFIRM: "true"` on the `auth` service in
`docker-compose.yml` and `docker compose up -d --force-recreate auth`.

> Mailpit only catches **auth** emails (signup, password reset). Other app email
> (via Resend) still needs a real `RESEND_API_KEY` and is not routed to Mailpit.

### Local models via Ollama

[Ollama](https://ollama.com) models are detected **dynamically** — whatever you
have installed (`ollama list`) shows up in every model picker under a **Local**
group, with no API key. The backend reaches Ollama on the host at
`http://host.docker.internal:11434/v1` (override with `OLLAMA_BASE_URL`) and
exposes the live list at `GET /models/ollama`.

Just pull a model and it appears after a refresh:

```bash
ollama pull qwen3.6
```

Notes:
- Models that support tool-calling can drive the full assistant; ones that
  don't (e.g. `phi3:mini`) still work for plain chat — the backend retries
  without tools automatically.
- Quality and speed depend on the local model; large models are noticeably
  slower for tabular review (which runs the model across many cells).

The Supabase JWT secret and the anon/`service_role` keys baked into
`docker-compose.yml` / `.env.example` are the well-known Supabase **local demo**
values — convenient for localhost, but regenerate them before exposing this
anywhere.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, Supabase access, document processing, and database schema
- `backend/schema.sql` - Supabase schema for fresh databases
- `backend/migrations/` - dated, incremental schema migrations; on an existing database, apply the files dated after the Mike version you deployed

## System Workflows

Mike's system assistant and tabular review workflows are maintained in the
[`Open-Legal-Products/mike-workflows`](https://github.com/Open-Legal-Products/mike-workflows)
repository.

## Prerequisites

- Node.js 20 or newer
- npm
- git
- A Supabase project
- A Cloudflare R2 bucket, MinIO bucket, or another S3-compatible bucket
- At least one supported model provider API key: Anthropic, Google Gemini, or OpenAI
- Optional: a CourtListener API token for case law lookup and citation verification
- LibreOffice installed locally if you need DOC/DOCX to PDF conversion

## Database Setup

For a new Supabase database, open the Supabase SQL editor and run:

```sql
-- copy and run the contents of:
-- backend/schema.sql
```

The schema file is for fresh deployments and already includes the latest database shape.

For an existing database, do not run the full schema file over production data. Instead, apply the incremental files in `backend/migrations/`: run the migrations dated **after** the version of Mike you currently have deployed, in filename order. Each file is named `YYYYMMDD_<name>.sql` (the date is also recorded in a comment at the top of the file) and is written to be safe to re-run, so when unsure you can re-apply the most recent migrations without harm.

## Environment

Create local env files:

```bash
touch backend/.env
touch frontend/.env.local
```

Create `backend/.env`:

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

# Optional: enables CourtListener case law and citation tools.
COURTLISTENER_API_TOKEN=your-courtlistener-token

# Optional: use locally imported CourtListener bulk data for faster case reads.
COURTLISTENER_BULK_DATA_ENABLED=false
```

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-anon-key
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Supabase values come from the project dashboard. Use the project URL for `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`, the service role key for the backend `SUPABASE_SECRET_KEY`, and the anon/public key for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`. If your Supabase project shows multiple key formats, use the legacy JWT-style anon and service role keys expected by the Supabase client libraries.

Provider keys are only needed for the models, legal research, and email features you plan to use. Model provider keys and the CourtListener token can be configured in `backend/.env` for the whole instance, or per user in **Account > Models & API Keys**. If a provider key is present in `backend/.env`, that provider is available by default and the matching browser API key field is read-only.

## CourtListener Integration

Mike can use CourtListener for US case law citation verification, case fetching, targeted opinion search, and case-law panels in assistant responses.

To enable live CourtListener access, set `COURTLISTENER_API_TOKEN` in `backend/.env` and restart the backend. Users can also add their own CourtListener token from **Account > Models & API Keys** when the instance does not provide one globally.

Fresh databases created from `backend/schema.sql` already include the CourtListener support tables. Existing deployments should apply the matching dated migration in `backend/migrations/` before enabling the feature.

Bulk data is optional. When `COURTLISTENER_BULK_DATA_ENABLED=true`, Mike first tries local Supabase/R2 data before falling back to CourtListener's API:

- citation metadata is read from `public.courtlistener_citation_index`
- case cluster metadata is read from `public.courtlistener_opinion_cluster_index`
- cached opinion JSON is read from the R2 prefix `courtlistener/opinions/by-cluster/{clusterId}/{opinionId}.json`

If you do not import bulk data, leave `COURTLISTENER_BULK_DATA_ENABLED=false`; live CourtListener tools still work with a valid token, subject to CourtListener rate limits.

## Install

Install each app package:

```bash
npm install --prefix backend
npm install --prefix frontend
```

## Run Locally

Start the backend:

```bash
npm run dev --prefix backend
```

Start the main app:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## First Run

1. Sign up in the app.
2. If you did not set provider keys in `backend/.env`, open **Account > Models & API Keys** and add an Anthropic, Gemini, or OpenAI API key.
3. To use legal research tools, add a CourtListener token in `backend/.env` or **Account > Models & API Keys**.
4. Create or open a project and start chatting with documents.

## Troubleshooting

**Sign-up confirmation email never arrives.** Confirmation emails are sent by Supabase Auth, not by Mike. For local development, the simplest fix is to disable email confirmation in **Supabase > Authentication > Providers > Email**. For production, configure custom SMTP in Supabase; the built-in mailer is heavily rate-limited and may be restricted on newer projects.

**The model picker shows a missing-key warning.** Add a key for that provider in **Account > Models & API Keys**, or configure the provider key in `backend/.env` and restart the backend.

**CourtListener tools say the API token is missing.** Set `COURTLISTENER_API_TOKEN` in `backend/.env`, or add a CourtListener token in **Account > Models & API Keys** for the signed-in user. Restart the backend after changing `.env`.

**CourtListener bulk lookup is not returning local results.** Confirm `COURTLISTENER_BULK_DATA_ENABLED=true`, the two CourtListener tables have been populated, and opinion JSON exists in R2 under `courtlistener/opinions/by-cluster/`. If bulk data is unavailable, Mike falls back to the live API when a token is configured.

**DOC or DOCX conversion fails.** Install LibreOffice locally and restart the backend so document conversion commands are available on the process path.

## Useful Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```
