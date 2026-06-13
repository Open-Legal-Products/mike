# Running Mike locally (no Supabase, no auth, no R2)

This setup runs Mike entirely on your machine with **zero external services**:

- **Database:** a plain Postgres (via Docker Compose) instead of Supabase.
- **Auth:** disabled — every request is the single hardcoded local user.
- **File storage:** local disk (`backend/uploads/`) instead of Cloudflare R2 / S3.

All Mike functionality, routes, and the frontend UI are unchanged.

## 1. Start Postgres

```bash
docker compose up -d
```

This starts Postgres 16 with database/user/password all `mike`, on `localhost:5432`,
and **auto-applies the schema on first boot** (it mounts
`backend/migrations/000_one_shot_schema.sql` into the container's init dir).

If you ever need to (re)apply the schema manually:

```bash
psql postgresql://mike:mike@localhost:5432/mike -f backend/migrations/000_one_shot_schema.sql
```

> The one-shot migration wraps the original Supabase schema (`backend/schema.sql`)
> with a tiny `auth` shim: it creates an `auth.users` table plus the
> `anon`/`authenticated`/`service_role` roles the schema's GRANTs reference, then
> seeds a single local user. It must run as a Postgres **superuser** — the
> docker-compose Postgres user is one by default.

## 2. Configure environment

Copy the examples (already filled with working local defaults):

```bash
cp backend/.env.example backend/.env          # or use the committed backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Set `ANTHROPIC_API_KEY` (and optionally `GEMINI_API_KEY` / `OPENAI_API_KEY`) in
`backend/.env` if you want the chat/agent features to work.

## 3. Run the apps

```bash
npm install --prefix backend
npm install --prefix frontend

npm run dev --prefix backend     # http://localhost:3001
npm run dev --prefix frontend    # http://localhost:3000
```

Open <http://localhost:3000> — the app loads directly, no login screen, as a
single `local@localhost` user.

## The "local user"

Every `user_id` column in the schema is a `uuid`, so the local user is the fixed
UUID **`00000000-0000-0000-0000-000000000001`** (email `local@localhost`) rather
than a plain string. It's defined once in `backend/src/middleware/auth.ts`
(`LOCAL_USER_ID`) and seeded by the migration.

## What changed vs. the upstream (Supabase) setup

| Concern | Before | Now |
| --- | --- | --- |
| DB client | `@supabase/supabase-js` | `pg` behind a PostgREST-compatible shim in `backend/src/lib/supabase.ts` (same `createServerSupabase()` API) |
| Auth | Supabase JWT in `requireAuth` | passthrough injecting the local user |
| File storage | Cloudflare R2 (`@aws-sdk/client-s3`) in `backend/src/lib/storage.ts` | local disk under `backend/uploads/`, same function signatures |
| Download URLs | R2 presigned URLs | absolute `/download/<hmac-token>` links served by the backend; files also browsable under `/uploads` |
| Frontend auth | Supabase client + session checks | `frontend/src/lib/supabase.ts` stub returning a fixed local session |

## Future: Python chat backend

The chat route (`/projects/:id/chat`) is kept independent of document/storage
routing so it can later be proxied to a separate Python (FastAPI + LangGraph)
service with a one-line change in the Express app.
