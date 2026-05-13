# Mike

Mike is a legal document assistant with a Next.js frontend and an Express backend, deployed AWS-native via SST.

Website: [mikeoss.com](https://mikeoss.com)

## Contents

- `frontend/` — Next.js application (App Router, React 19)
- `backend/` — Express API, document processing, Drizzle schema
- `backend/src/db/schema.ts` — Drizzle schema (source of truth)
- `backend/drizzle/` — generated SQL migrations
- `sst.config.ts` — single-file SST v3 infrastructure definition
- `infra/UPSTREAM.md` — upstream-merge protocol for this fork

## Stack

- **Frontend**: Next.js 16, deployed via SST → OpenNext-AWS (CloudFront + Lambda + S3)
- **Backend**: Express + TypeScript, containerized, runs on Fargate behind an ALB
- **Database**: Aurora Serverless v2 Postgres + RDS Proxy, accessed via Drizzle ORM
- **Auth**: Clerk (`@clerk/nextjs`, `@clerk/backend`)
- **Object storage**: S3
- **Email**: SES (SESv2)
- **IaC**: SST v3 (single `sst.config.ts` at the repo root)

## Prerequisites

- Node.js 20 or newer (see `.nvmrc`)
- npm
- An AWS account with credentials configured (e.g. `aws configure`)
- A Clerk account/application (publishable + secret keys)
- At least one model provider key: Anthropic, Google Gemini, or OpenAI
- LibreOffice installed locally if you want DOC/DOCX → PDF conversion in dev. The Fargate image installs it automatically; locally it needs to be on `PATH`.

## Install

```bash
npm install --prefix backend
npm install --prefix frontend --legacy-peer-deps   # Clerk peer-dep nit
npm install                                        # installs the sst CLI at root
```

## Environment

Create local env files:

```bash
touch backend/.env
touch frontend/.env.local
```

`backend/.env`:

```bash
PORT=3001
FRONTEND_URL=http://localhost:3000

# Database (any reachable Postgres URL works locally)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/mike

# Auth
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
# Optional: pin the JWT key to skip the JWKS round-trip
CLERK_JWT_KEY=

# Object storage (S3 in prod; for local dev set the bucket name only and
# rely on AWS credentials in your environment)
S3_BUCKET_NAME=mike-dev
# Transitional fallback while the rename rolls through call-sites:
# R2_BUCKET_NAME=mike-dev
AWS_REGION=us-east-1

# Email (SESv2)
SES_FROM_ADDRESS=no-reply@example.com

# Secrets
DOWNLOAD_SIGNING_SECRET=replace-with-a-random-32-byte-hex-string
USER_API_KEYS_ENCRYPTION_SECRET=replace-with-a-long-random-secret

# Model providers (any subset; users can also supply their own in-app)
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
```

`frontend/.env.local`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Provider keys are only needed for the models you plan to use. A user-supplied key entered in **Account > Models & API Keys** overrides the server-side key for that user.

## Local Development

1. Start a local Postgres (Docker, Homebrew, or your preferred flavour) and point `DATABASE_URL` at it.
2. Apply the schema:

   ```bash
   npm run db:push --prefix backend
   ```

3. In separate terminals:

   ```bash
   npm run dev --prefix backend     # tsx watch on :3001
   npm run dev --prefix frontend    # next dev on :3000
   ```

4. Open `http://localhost:3000`, sign up via Clerk, and open a project to start chatting.

## AWS Deployment

SST v3 owns all AWS infrastructure: VPC, Aurora Serverless v2 + RDS Proxy, S3 bucket, Fargate service for the API, and OpenNext-AWS for the Next.js app.

1. Configure AWS credentials (`aws configure` or `AWS_PROFILE`).
2. Set every secret declared in `sst.config.ts` for your target stage:

   ```bash
   npx sst secret set ClerkSecretKey               sk_live_...    --stage production
   npx sst secret set ClerkPublishableKey          pk_live_...    --stage production
   npx sst secret set ClerkJwtKey                  ""             --stage production
   npx sst secret set AnthropicApiKey              ...            --stage production
   npx sst secret set GeminiApiKey                 ...            --stage production
   npx sst secret set OpenAIApiKey                 ...            --stage production
   npx sst secret set UserApiKeysEncryptionSecret  ...            --stage production
   npx sst secret set DownloadSigningSecret        ...            --stage production
   npx sst secret set SesFromAddress               no-reply@...   --stage production
   ```

3. Deploy:

   ```bash
   npx sst deploy --stage production
   ```

4. First-time database setup: connect to the RDS instance via the bastion/SSM session SST provisions, then either run `backend/drizzle/0000_init.sql` directly, or point `drizzle-kit migrate` at the RDS URL.

## Useful Checks

```bash
npm run build --prefix backend     # tsc, emits to dist/
npm run build --prefix frontend    # next build
npm run lint  --prefix frontend    # eslint
```

There is no test runner configured in either package.

## Troubleshooting

**The model picker shows a missing-key warning.** Add a key in **Account > Models & API Keys**, or configure the provider key in `backend/.env` (or via `sst secret set` in prod) and restart the backend.

**DOC or DOCX conversion fails.** Install LibreOffice locally and restart the backend so `libreoffice` is on the process `PATH`. The Fargate image installs it automatically.

## Upstream Fork

This is an AWS-native fork of `mikeoss/mike`, which targets Cloudflare + Supabase. See `infra/UPSTREAM.md` for the merge protocol and the list of files where conflicts are expected when syncing upstream changes.
