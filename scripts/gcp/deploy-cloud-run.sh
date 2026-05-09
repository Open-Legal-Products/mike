#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  PROJECT_ID=ornn-mike-20260509 scripts/gcp/deploy-cloud-run.sh

Required environment:
  PROJECT_ID
  SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
  SUPABASE_SECRET_KEY
  R2_ENDPOINT_URL
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET_NAME

Optional environment:
  REGION, REPOSITORY, BACKEND_SERVICE, FRONTEND_SERVICE
  SERVICE_ACCOUNT
  ALLOWED_EMAIL_DOMAINS, ALLOWED_EMAILS
  GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, RESEND_API_KEY
USAGE
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    usage >&2
    exit 1
  fi
}

ensure_secret() {
  local secret_name="$1"
  local value="$2"

  if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    printf "%s" "$value" | gcloud secrets versions add "$secret_name" \
      --project="$PROJECT_ID" \
      --data-file=- >/dev/null
  else
    printf "%s" "$value" | gcloud secrets create "$secret_name" \
      --project="$PROJECT_ID" \
      --replication-policy=automatic \
      --data-file=- >/dev/null
  fi
}

secret_ref_args=()
add_secret_ref() {
  local env_name="$1"
  local secret_name="$2"
  secret_ref_args+=("${env_name}=${secret_name}:latest")
}

join_by_comma() {
  local IFS=,
  echo "$*"
}

join_by_delimiter() {
  local delimiter="$1"
  shift
  local output="^${delimiter}^"
  local first=1

  for item in "$@"; do
    if [[ "$first" -eq 1 ]]; then
      output+="$item"
      first=0
    else
      output+="${delimiter}${item}"
    fi
  done

  printf "%s" "$output"
}

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
REPOSITORY="${REPOSITORY:-mike}"
BACKEND_SERVICE="${BACKEND_SERVICE:-mike-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-mike-frontend}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-mike-runner}"
ALLOWED_EMAIL_DOMAINS="${ALLOWED_EMAIL_DOMAINS:-${ALLOWED_EMAIL_DOMAIN:-ornn.com}}"
ALLOWED_EMAILS="${ALLOWED_EMAILS:-}"

require_env PROJECT_ID
require_env SUPABASE_URL
require_env NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
require_env SUPABASE_SECRET_KEY
require_env R2_ENDPOINT_URL
require_env R2_ACCESS_KEY_ID
require_env R2_SECRET_ACCESS_KEY
require_env R2_BUCKET_NAME

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is required." >&2
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null

SHORT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
REGISTRY_HOST="$REGION-docker.pkg.dev"
IMAGE_ROOT="$REGISTRY_HOST/$PROJECT_ID/$REPOSITORY"
BACKEND_IMAGE="$IMAGE_ROOT/$BACKEND_SERVICE:$SHORT_SHA"
FRONTEND_IMAGE="$IMAGE_ROOT/$FRONTEND_SERVICE:$SHORT_SHA"

ensure_secret mike-supabase-secret-key "$SUPABASE_SECRET_KEY"
ensure_secret mike-r2-access-key-id "$R2_ACCESS_KEY_ID"
ensure_secret mike-r2-secret-access-key "$R2_SECRET_ACCESS_KEY"
add_secret_ref SUPABASE_SECRET_KEY mike-supabase-secret-key
add_secret_ref R2_ACCESS_KEY_ID mike-r2-access-key-id
add_secret_ref R2_SECRET_ACCESS_KEY mike-r2-secret-access-key

if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  ensure_secret mike-gemini-api-key "$GEMINI_API_KEY"
  add_secret_ref GEMINI_API_KEY mike-gemini-api-key
fi

if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  ensure_secret mike-anthropic-api-key "$ANTHROPIC_API_KEY"
  add_secret_ref ANTHROPIC_API_KEY mike-anthropic-api-key
fi

if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  ensure_secret mike-openai-api-key "$OPENAI_API_KEY"
  add_secret_ref OPENAI_API_KEY mike-openai-api-key
fi

if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
  ensure_secret mike-openrouter-api-key "$OPENROUTER_API_KEY"
  add_secret_ref OPENROUTER_API_KEY mike-openrouter-api-key
fi

if [[ -n "${RESEND_API_KEY:-}" ]]; then
  ensure_secret mike-resend-api-key "$RESEND_API_KEY"
  add_secret_ref RESEND_API_KEY mike-resend-api-key
fi

SECRET_REFS="$(join_by_comma "${secret_ref_args[@]}")"
BACKEND_ENV="$(join_by_delimiter "~" \
  "NODE_ENV=production" \
  "SUPABASE_URL=$SUPABASE_URL" \
  "R2_ENDPOINT_URL=$R2_ENDPOINT_URL" \
  "R2_BUCKET_NAME=$R2_BUCKET_NAME" \
  "FRONTEND_URL=https://pending.local" \
  "TRUST_PROXY_HOPS=1" \
  "ALLOWED_EMAIL_DOMAINS=$ALLOWED_EMAIL_DOMAINS" \
  "ALLOWED_EMAILS=$ALLOWED_EMAILS")"
SERVICE_ACCOUNT_EMAIL="$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"

if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
    --project="$PROJECT_ID" \
    --display-name="Mike Cloud Run runtime"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

gcloud builds submit "$ROOT_DIR/backend" \
  --project="$PROJECT_ID" \
  --tag="$BACKEND_IMAGE"

gcloud run deploy "$BACKEND_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$BACKEND_IMAGE" \
  --allow-unauthenticated \
  --port=8080 \
  --memory=2Gi \
  --cpu=1 \
  --service-account="$SERVICE_ACCOUNT_EMAIL" \
  --set-env-vars="$BACKEND_ENV" \
  --set-secrets="$SECRET_REFS"

BACKEND_URL="$(gcloud run services describe "$BACKEND_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)')"

gcloud builds submit "$ROOT_DIR/frontend" \
  --project="$PROJECT_ID" \
  --config="$ROOT_DIR/frontend/cloudbuild.yaml" \
  --substitutions="$(join_by_delimiter "~" \
    "_IMAGE=$FRONTEND_IMAGE" \
    "_NEXT_PUBLIC_API_BASE_URL=$BACKEND_URL" \
    "_NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS=$ALLOWED_EMAIL_DOMAINS" \
    "_NEXT_PUBLIC_ALLOWED_EMAILS=$ALLOWED_EMAILS" \
    "_NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL" \
    "_NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY")"

FRONTEND_ENV="$(join_by_delimiter "~" \
  "NODE_ENV=production" \
  "NEXT_PUBLIC_API_BASE_URL=$BACKEND_URL" \
  "NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS=$ALLOWED_EMAIL_DOMAINS" \
  "NEXT_PUBLIC_ALLOWED_EMAILS=$ALLOWED_EMAILS" \
  "NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL" \
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY")"

gcloud run deploy "$FRONTEND_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$FRONTEND_IMAGE" \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --service-account="$SERVICE_ACCOUNT_EMAIL" \
  --set-env-vars="$FRONTEND_ENV" \
  --set-secrets="SUPABASE_SECRET_KEY=mike-supabase-secret-key:latest"

FRONTEND_URL="$(gcloud run services describe "$FRONTEND_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='value(status.url)')"

gcloud run services update "$BACKEND_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-env-vars="FRONTEND_URL=$FRONTEND_URL"

echo "Backend: $BACKEND_URL"
echo "Frontend: $FRONTEND_URL"
echo "Health: $BACKEND_URL/health"
