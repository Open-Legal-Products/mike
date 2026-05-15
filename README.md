# Mike

Mike is a legal document assistant built on Next.js route handlers, Supabase Auth/Postgres, and Cloudflare R2-compatible object storage.

Website: [mikeoss.com](https://mikeoss.com)

## Contents

- `frontend/` - Next.js app, route handlers, oRPC, Supabase access, and document processing
- `docs/db/schema.sql` - Supabase schema for fresh databases

## Prerequisites

- Node.js 20 or newer
- npm
- git
- A Supabase project
- A Cloudflare R2 bucket, MinIO bucket, or another S3-compatible bucket
- At least one supported model provider: Ollama, Anthropic, Google Gemini, or OpenAI
- LibreOffice installed locally if you need DOC/DOCX to PDF conversion

## Database Setup

For a new Supabase database, open the Supabase SQL editor and run:

```sql
-- copy and run the contents of:
-- docs/db/schema.sql
```

For an existing database, do not run the full schema file over production data.

## Environment

Create local env files:

```bash
touch frontend/.env.local
```

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-anon-key
SUPABASE_SECRET_KEY=your-supabase-service-role-key
NEXT_PUBLIC_API_BASE_URL=/api/backend
DOWNLOAD_SIGNING_SECRET=replace-with-a-random-32-byte-hex-string

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

Supabase values come from the project dashboard. Use the project URL for `NEXT_PUBLIC_SUPABASE_URL`, the service role key for `SUPABASE_SECRET_KEY`, and the anon/public key for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`. If your Supabase project shows multiple key formats, use the legacy JWT-style anon and service role keys expected by the Supabase client libraries.

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

**Sign-up confirmation email never arrives.** Confirmation emails are sent by Supabase Auth, not by Mike. For local development, the simplest fix is to disable email confirmation in **Supabase > Authentication > Providers > Email**. For production, configure custom SMTP in Supabase; the built-in mailer is heavily rate-limited and may be restricted on newer projects.

**The model picker shows a missing-key warning.** Add a key for that provider in **Account > Models & API Keys**, or configure the provider key in `frontend/.env.local` and restart Next. For Ollama, set `OLLAMA_ENABLED=true` or `OLLAMA_BASE_URL`.

**DOC or DOCX conversion fails.** Install LibreOffice locally and restart Next so document conversion commands are available on the process path.

## Useful Checks

```bash
npm run build --prefix frontend
npm run lint --prefix frontend
```
