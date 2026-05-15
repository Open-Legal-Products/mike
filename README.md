# Mike

Mike is a legal document assistant built on Next.js route handlers, Better Auth, Postgres, and Cloudflare R2-compatible object storage.

Website: [mikeoss.com](https://mikeoss.com)

## Contents

- `frontend/` - Next.js app, route handlers, oRPC, Postgres access, and document processing
- `docs/db/schema.sql` - Postgres schema for fresh databases

## Prerequisites

- Node.js 20 or newer
- npm
- git
- Any Postgres database
- A Cloudflare R2 bucket, MinIO bucket, or another S3-compatible bucket
- At least one supported model provider: Ollama, Anthropic, Google Gemini, or OpenAI
- LibreOffice installed locally if you need DOC/DOCX to PDF conversion

## Database Setup

For a new Postgres database, run:

```sql
-- copy and run the contents of:
-- docs/db/schema.sql
```

For an existing database, do not run the full schema file over production data.

Regenerate Kysely DB types after schema changes:

```bash
npm run db:codegen --prefix frontend
```

## Environment

Create local env files:

```bash
touch frontend/.env.local
```

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1
DOWNLOAD_SIGNING_SECRET=replace-with-a-random-32-byte-hex-string
BETTER_AUTH_SECRET=replace-with-a-random-32-byte-hex-string
BETTER_AUTH_URL=http://localhost:3000/api/v1/auth
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/mike

R2_ENDPOINT_URL=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=mike

GEMINI_API_KEY=your-gemini-key
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
OLLAMA_ENABLED=false
OLLAMA_BASE_URL=http://localhost:11434
RESEND_API_KEY=your-resend-key
USER_API_KEYS_ENCRYPTION_SECRET=your-long-random-secret
```

Provider keys are only needed for the cloud models and email features you plan to use. Model provider keys can be configured in `frontend/.env.local` for the whole instance, or per user in **Account > Models & API Keys**. If a provider key is present in `frontend/.env.local`, that provider is available by default and the matching browser API key field is read-only.

To run fully local model inference, install Ollama, pull one of the listed models, and enable it:

```bash
ollama pull llama3.1
ollama pull qwen3:8b
ollama pull qwen3:4b
```

Then set `OLLAMA_ENABLED=true` in `frontend/.env.local`. `OLLAMA_BASE_URL` defaults to `http://localhost:11434`.

## Install

Install the app package:

```bash
npm install --prefix frontend
```

## Run Locally

Start the app:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## First Run

1. Sign up in the app.
2. If you did not enable Ollama or set provider keys in `frontend/.env.local`, open **Account > Models & API Keys** and add an Anthropic, Gemini, or OpenAI API key.
3. Create or open a project and start chatting with documents.

## Troubleshooting

**The model picker shows a missing-key warning.** Add a key for that provider in **Account > Models & API Keys**, or configure the provider key in `frontend/.env.local` and restart Next. For Ollama, set `OLLAMA_ENABLED=true` or `OLLAMA_BASE_URL`.

**DOC or DOCX conversion fails.** Install LibreOffice locally and restart Next so document conversion commands are available on the process path.

## Useful Checks

```bash
npm run build --prefix frontend
npm run lint --prefix frontend
```
