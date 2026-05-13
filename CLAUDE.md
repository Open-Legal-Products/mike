# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Mike" is a legal document assistant (homepage: mikeoss.com, app: app.mikeoss.com). It is a two-package monorepo (`backend/` + `frontend/`) with no workspace tooling — each package has its own `package.json`, lockfile, and `tsconfig.json`. The repo root also carries `sst.config.ts` and a tiny root `package.json` that pins the `sst` CLI. Always run npm commands with `--prefix backend` or `--prefix frontend` (or `cd` into the directory); root `npm install` only installs SST.

- `backend/` — Express + TypeScript API. Talks to Postgres via Drizzle, S3 for object storage, SES for email, Clerk for auth verification, and LLM providers (Anthropic, Google Gemini, OpenAI). Runs on Fargate behind an ALB in production.
- `frontend/` — Next.js 16 (App Router, React 19, React Compiler enabled). Deployed via SST → `@opennextjs/aws` to CloudFront + Lambda + S3.
- `sst.config.ts` — single-file SST v3 infra: VPC, Aurora Serverless v2 + RDS Proxy, S3 bucket, Fargate Service, Nextjs site, and all `sst.Secret`s.
- `backend/src/db/schema.ts` — Drizzle schema, the source of truth for the database. Generated SQL lives in `backend/drizzle/`. `backend/schema.sql` is **legacy and unused** (kept on disk to ease upstream merges).

## Common Commands

```bash
# Install
npm install                                       # installs the sst CLI at root
npm install --prefix backend
npm install --prefix frontend --legacy-peer-deps  # Clerk peer-dep nit

# Dev (run both in separate terminals)
npm run dev --prefix backend     # tsx watch on PORT (default 3001)
npm run dev --prefix frontend    # next dev on :3000

# Checks before pushing
npm run build --prefix backend   # tsc — emits to dist/
npm run build --prefix frontend  # next build
npm run lint --prefix frontend   # eslint (flat config in eslint.config.mjs)

# Drizzle (backend)
npm run db:generate --prefix backend   # generate SQL from schema.ts
npm run db:migrate  --prefix backend   # apply pending migrations
npm run db:push     --prefix backend   # push schema directly (dev)
npm run db:studio   --prefix backend   # open Drizzle Studio

# SST (run from repo root; AWS credentials must be configured)
npx sst dev                                       # local dev with live AWS resources
npx sst deploy --stage production                 # build + deploy everything
npx sst secret set <Name> <value> --stage <stage> # set a secret declared in sst.config.ts
```

There is no test runner configured in either package; do not invent test commands. The pre-flight is `backend build`, `frontend build`, `frontend lint`.

## Required services

The backend will not function without these — set them in `backend/.env` for local dev, or via `sst secret set` for deployed stages (every secret name below maps to a `sst.Secret` declared in `sst.config.ts`):

- **Clerk** (auth): `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`. Optional `CLERK_JWT_KEY` pins the JWT verification key to skip the JWKS round-trip.
- **Postgres**: `DATABASE_URL`. In prod this is Aurora Serverless v2 via RDS Proxy, wired up by SST and read by `backend/src/lib/db.ts`.
- **S3**: `S3_BUCKET_NAME` (transitional fallback: `R2_BUCKET_NAME`) plus `AWS_REGION`. Credentials come from the Fargate task role in prod and from the standard AWS credential chain locally.
- **SES**: `SES_FROM_ADDRESS` — the verified sender used by `backend/src/lib/email.ts` (SESv2).
- **Model providers**: at least one of `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`. Any key absent here can be supplied per-user via the Account UI (stored encrypted in `user_api_keys`, decrypted with `USER_API_KEYS_ENCRYPTION_SECRET`).
- `DOWNLOAD_SIGNING_SECRET` — 32-byte hex used to HMAC-sign one-shot download tokens.
- `FRONTEND_URL` — used for the CORS allowlist.
- LibreOffice must be on `PATH` for DOC/DOCX → PDF conversion. The Fargate image (`backend/Dockerfile`) installs it; local dev needs it installed manually.

The frontend needs `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (server-side, used by `clerkMiddleware`), and `NEXT_PUBLIC_API_BASE_URL`. Treat anything not prefixed `NEXT_PUBLIC_` as server-only.

## Architecture

### Request flow

Browser → Next.js (UI + a few server routes under `frontend/src/app/api/*`) → Express backend (`http://localhost:3001` in dev, `NEXT_PUBLIC_API_BASE_URL` in prod) → Postgres / S3 / SES / LLM provider.

All backend calls are authenticated with a Clerk JWT in `Authorization: Bearer <token>`. `backend/src/middleware/auth.ts` verifies the token via `@clerk/backend` (cached in-process), sets `res.locals.userId` / `userEmail` / `token`, and on first request bootstraps the matching row in `user_profiles` (replaces the dropped Supabase `handle_new_user` trigger).

### Backend routers (mounted in `backend/src/index.ts`)

- `/chat` — single-document and standalone assistant chats.
- `/projects` and `/projects/:projectId/chat` — project-scoped chats and documents.
- `/single-documents` — uploads, versions, and document operations.
- `/tabular-review` — table-style document extraction; uses the mid-tier model.
- `/workflows` — built-in (`backend/src/lib/builtinWorkflows.ts`) and user-defined prompt workflows.
- `/user` (alias `/users`) — profile, API keys, model preferences.
- `/download` — short-lived signed download URLs (HMAC via `DOWNLOAD_SIGNING_SECRET`).

All routers query Postgres through Drizzle (`db` from `backend/src/lib/db.ts`); the old `supabase-js` client is gone.

Tiered rate limits are applied in `index.ts`: `generalLimiter` for everything, plus stricter limits on chat (`chatLimiter`), chat creation/title-gen (`chatCreateLimiter`), and uploads (`uploadLimiter`). All windows/maxes are overridable via `RATE_LIMIT_*` env vars.

### LLM provider abstraction (`backend/src/lib/llm/`)

`streamChatWithTools` and `completeText` in `llm/index.ts` dispatch to `claude.ts`, `gemini.ts`, or `openai.ts` based on the model id prefix (`claude`, `gemini`, `gpt-`). Model tiers in `llm/models.ts`:

- **Main** — user-selectable per chat (Opus/Sonnet, Gemini Pro/Flash, GPT-5.5/mini).
- **Mid** — used for tabular review; user picks one in Account settings.
- **Low** — used for chat-title generation and lightweight extractions.

When adding a new model, register it in `CLAUDE_*` / `GEMINI_*` / `OPENAI_*` arrays in `llm/models.ts` so `providerForModel` and `resolveModel` recognise it. The frontend mirrors availability in `frontend/src/app/lib/modelAvailability.ts`.

User-supplied API keys (stored encrypted in `user_api_keys`) override server keys for that user; see `backend/src/lib/userApiKeys.ts` and `lib/userSettings.ts`.

### Document pipeline

`lib/upload.ts` and `lib/convert.ts` handle ingestion. DOC/DOCX inputs run through LibreOffice (`libreoffice-convert`) to PDF for parsing with `pdfjs-dist`; DOCX text/tracked-changes extraction uses `mammoth`. Generated DOCX outputs (e.g. CP Checklists from the built-in workflows) are produced with the `docx` package. Object bytes live in S3 (`lib/storage.ts`, native `@aws-sdk/client-s3` + IAM role credentials); database rows track keys, versions (`lib/documentVersions.ts`), and access (`lib/access.ts`).

### Frontend structure

- `src/app/(pages)/` — App Router routes grouped under a single layout: `assistant` (chat), `projects/[id]`, `workflows/[id]`, `tabular-reviews`, `account`. The root `page.tsx` redirects to `/assistant`.
- `src/app/components/` — feature-specific React components (assistant, projects, workflows, tabular, modals, shared types).
- `src/app/contexts/` — `ChatHistoryContext`, `SidebarContext`.
- `src/app/hooks/` — feature hooks (`useAssistantChat`, `useDocumentVersions`, `useSelectedModel`, etc.).
- `src/app/lib/mikeApi.ts` — single client for backend calls; attaches the Clerk bearer token (via `useAuth().getToken()`).
- `src/components/ui/` — generic UI primitives (button, dropdown, badge, cite-button, text-search-widget).
- Auth surface: `<ClerkProvider>` wraps the root layout, `middleware.ts` runs `clerkMiddleware`, and `/login` and `/signup` are catch-all segments (`[[...rest]]`) that render Clerk's `<SignIn>` / `<SignUp>`.

`next.config.ts` enables `reactCompiler: true` and rewrites `/sitemap.xml` (and `/sitemap_<slug>.xml`) to the App-Router `api/sitemap/*` handlers. `open-next.config.ts` targets `@opennextjs/aws`; SST drives the actual deploy, so no manual `opennextjs` CLI invocations.

### Database

`backend/src/db/schema.ts` is the **source of truth** for the 16-table schema (snake_case columns). Generated SQL lives in `backend/drizzle/` (`0000_init.sql` is the current baseline). `backend/schema.sql` is **legacy and unused** — it's kept in tree purely to ease upstream merges.

Key differences vs. the upstream Supabase schema:

- RLS has been **dropped entirely**. Access checks live in the route handlers (see `backend/src/lib/access.ts`); there is no `auth.uid()` to lean on.
- `user_id` columns are `text` (Clerk user IDs like `user_2abc...`), not `uuid`.
- `user_profiles` rows are bootstrapped on first authenticated request in `middleware/auth.ts`, replacing the dropped `on_auth_user_created` trigger.

When changing the schema, edit `schema.ts`, run `npm run db:generate --prefix backend` to emit a new migration file under `backend/drizzle/`, and commit both. Apply with `db:migrate` (or `db:push` in dev).

## Conventions to honour

- Backend uses 2-space indentation; frontend uses 4-space indentation (see existing files — don't reformat across packages).
- Prefer the `streamChatWithTools` / `completeText` entry points over calling provider SDKs directly so model routing and per-user API-key fallback stay consistent.
- Route handlers use `res.locals.userId` (set by `requireAuth`); do not re-read or re-verify the token inside a route.
- Use the shared `db` export from `backend/src/lib/db.ts`. Do not instantiate new `pg.Pool`s or new Drizzle clients per route — it breaks the RDS Proxy connection accounting.
- The frontend gets the bearer token via `useAuth().getToken()` from `@clerk/nextjs`, funnelled through `frontend/src/app/lib/mikeApi.ts`. Don't reach for `window.Clerk` directly outside of `mikeApi.ts`.
- S3 object keys are user- and project-scoped; never expose them directly to the browser — always go through `/download` for signed URLs.
- The frontend's `NEXT_PUBLIC_*` allow-list is enforced by convention only. `CLERK_SECRET_KEY` must never leak into a `NEXT_PUBLIC_*` name — only `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is safe to ship to the browser.
