# Mike

Open-source release containing the Mike frontend and backend.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, Supabase access, document processing, and migrations
- `backend/migrations/000_one_shot_schema.sql` - one-shot Supabase schema for fresh databases

## Run locally with Docker + local Supabase

Spins up the frontend, backend, and a full local Supabase stack (Postgres, Auth, Storage, Realtime) — no cloud account required.

Prerequisites: Docker Desktop, [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`).

```bash
# 1. Start local Supabase (Postgres, Auth, Storage, etc.)
#    The migration in supabase/migrations/ is applied automatically.
supabase start

# 2. Note the keys printed by `supabase start` (or run `supabase status`).
#    Create env files from the examples and paste in the local values:
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local

# 3. Start the app stack
docker compose up -d
```

Then open http://localhost:4000.

Default ports (set in [docker-compose.yml](docker-compose.yml)):

| Service | URL |
|---|---|
| Frontend | http://localhost:4000 |
| Backend  | http://localhost:4001 |
| Supabase API | http://localhost:54321 |
| Supabase DB  | `postgresql://postgres:postgres@localhost:54322/postgres` |
| Mailpit (auth emails) | http://localhost:54324 |

Env values for the local Supabase stack:

```
# backend/.env
SUPABASE_URL=http://host.docker.internal:54321        # container -> host
SUPABASE_SECRET_KEY=<secret key from `supabase status`>
R2_ENDPOINT_URL=http://host.docker.internal:54321/storage/v1/s3
R2_ACCESS_KEY_ID=<S3 access key from `supabase status`>
R2_SECRET_ACCESS_KEY=<S3 secret key from `supabase status`>
R2_BUCKET_NAME=mike

# frontend/.env.local
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321        # browser -> host
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=<publishable key>
SUPABASE_SECRET_KEY=<secret key>
NEXT_PUBLIC_API_BASE_URL=http://localhost:4001
```

Create the `mike` storage bucket once:

```bash
docker exec supabase_db_mike psql -U postgres -d postgres -c \
  "insert into storage.buckets (id, name, public) values ('mike','mike',false) on conflict (id) do nothing;"
```

Lifecycle:

```bash
docker compose logs -f          # tail app logs
docker compose restart          # pick up env changes
docker compose down             # stop the app
supabase stop                   # stop the supabase stack (volumes persist)
supabase db reset               # wipe DB and re-run migrations
```

The compose file bind-mounts source for hot reload and runs `npm install` on container start so the deps in the named volume are guaranteed consistent (works around a Docker Desktop named-volume init quirk when bind mounts overlap).

## Setup (manual, without Docker)

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Create local env files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Run `backend/migrations/000_one_shot_schema.sql` in the Supabase SQL editor for a fresh database.

Start the backend:

```bash
npm run dev --prefix backend
```

Start the frontend:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## Required Services

- Supabase Auth and Postgres
- S3-compatible object storage, such as Cloudflare R2
- At least one supported model provider key, depending on which models you enable
- LibreOffice for DOC/DOCX to PDF conversion

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only. See `LICENSE`.
