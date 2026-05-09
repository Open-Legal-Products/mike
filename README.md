# Mike

Open-source release containing the Mike frontend and backend.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, Supabase access, document processing, and database schema
- `backend/schema.sql` - Supabase schema for fresh databases

## Setup

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend --legacy-peer-deps
```

Create local env files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Run `backend/schema.sql` in the Supabase SQL editor for a fresh database.

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

## GCP Deployment

This repo includes Cloud Run scaffolding for a two-service GCP deployment:

- `backend/Dockerfile` builds the Express API with LibreOffice installed.
- `frontend/Dockerfile` builds and serves the Next.js app.
- `scripts/gcp/setup-project.sh` creates/prepares a GCP project, enables required APIs, and creates an Artifact Registry repository.
- `scripts/gcp/deploy-cloud-run.sh` builds both images, stores secrets in Secret Manager, deploys Cloud Run services, and updates backend CORS to the deployed frontend URL.
- `ALLOWED_EMAIL_DOMAINS=ornn.com` and `ALLOWED_EMAILS` restrict the custom install to Ornn users plus explicitly invited external users.

See `docs/gcp-cloud-run.md` for the full setup and deployment flow.

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only. See `LICENSE`.
