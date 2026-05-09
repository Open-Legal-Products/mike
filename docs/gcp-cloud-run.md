# GCP Cloud Run Deployment

This repo can run on GCP with two Cloud Run services:

- `mike-backend`: Express API from `backend/`
- `mike-frontend`: Next.js app from `frontend/`

The GCP project hosts compute, images, and secrets. Mike still requires external Supabase Auth/Postgres and S3-compatible object storage unless the application is changed to use GCP-native services.

This deployment is intended for Ornn-controlled access. Set `ALLOWED_EMAIL_DOMAINS=ornn.com` to admit Ornn users, and set `ALLOWED_EMAILS` for explicitly invited non-domain users.

## Required Inputs

- A GCP project with billing enabled.
- Supabase project URL, publishable key, and service-role key.
- `backend/schema.sql` applied to the Supabase database.
- S3-compatible storage credentials, such as Cloudflare R2.
- Optional default model provider keys: Gemini, Anthropic, OpenAI/OpenRouter.
- Optional Resend API key for email.

## Create Or Prepare The GCP Project

```bash
export PROJECT_ID=ornn-mike-20260509
export REGION=us-central1
export BILLING_ACCOUNT=000000-000000-000000

scripts/gcp/setup-project.sh "$PROJECT_ID"
```

`BILLING_ACCOUNT` is optional for an existing billed project, but a new project must be linked to billing before Cloud Run, Cloud Build, Artifact Registry, and Secret Manager can be used.

The setup script enables:

- Cloud Run
- Cloud Build
- Artifact Registry
- Secret Manager

It also creates a Docker Artifact Registry repository named `mike` by default.
The script also creates a `mike-runner` service account for the Cloud Run
services and grants it Secret Manager read access.

## Deploy

Set the required runtime values in your shell. The deploy script writes sensitive values to Secret Manager and references them from Cloud Run.

```bash
export PROJECT_ID=ornn-mike-20260509
export REGION=us-central1

export SUPABASE_URL=https://your-project.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-anon-key
export SUPABASE_SECRET_KEY=your-supabase-service-role-key

export ALLOWED_EMAIL_DOMAINS=ornn.com
export ALLOWED_EMAILS=advisor@example.com,contractor@example.com

export R2_ENDPOINT_URL=https://your-account-id.r2.cloudflarestorage.com
export R2_ACCESS_KEY_ID=your-r2-access-key
export R2_SECRET_ACCESS_KEY=your-r2-secret-key
export R2_BUCKET_NAME=mike

# Optional defaults. Users can also add provider keys inside the app.
export GEMINI_API_KEY=your-gemini-key
export ANTHROPIC_API_KEY=your-anthropic-key
export OPENAI_API_KEY=your-openai-key
export OPENROUTER_API_KEY=your-openrouter-key
export RESEND_API_KEY=your-resend-key

scripts/gcp/deploy-cloud-run.sh
```

The script deploys the backend first, reads its Cloud Run URL, builds the frontend with that backend URL, deploys the frontend, then updates backend CORS to the final frontend URL.

Access enforcement happens in two places:

- The frontend blocks login/signup attempts that do not match `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS` or `NEXT_PUBLIC_ALLOWED_EMAILS`.
- The backend enforces the same policy on every authenticated API route using `ALLOWED_EMAIL_DOMAINS` and `ALLOWED_EMAILS`.

## Verify

```bash
BACKEND_URL="$(gcloud run services describe mike-backend \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')"

FRONTEND_URL="$(gcloud run services describe mike-frontend \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')"

curl "$BACKEND_URL/health"
open "$FRONTEND_URL"
```

The backend health endpoint can pass before Supabase or storage-backed workflows are complete. Test login, document upload, project creation, and chat flows after all external service keys are configured.
