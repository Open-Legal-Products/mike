#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  PROJECT_ID=ornn-mike-20260509 BILLING_ACCOUNT=000000-000000-000000 scripts/gcp/setup-project.sh [project-id]

Environment:
  PROJECT_ID       GCP project id. Can also be passed as the first argument.
  DISPLAY_NAME     Human-readable project name. Defaults to "Mike".
  REGION           GCP region. Defaults to "us-central1".
  REPOSITORY       Artifact Registry repository. Defaults to "mike".
  SERVICE_ACCOUNT  Cloud Run runtime service account name. Defaults to "mike-runner".
  ORGANIZATION_ID  Optional GCP organization id for new project creation.
  FOLDER_ID        Optional GCP folder id for new project creation.
  BILLING_ACCOUNT  Optional billing account id or resource name.
USAGE
}

PROJECT_ID="${1:-${PROJECT_ID:-}}"
DISPLAY_NAME="${DISPLAY_NAME:-Mike}"
REGION="${REGION:-us-central1}"
REPOSITORY="${REPOSITORY:-mike}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-mike-runner}"
ORGANIZATION_ID="${ORGANIZATION_ID:-}"
FOLDER_ID="${FOLDER_ID:-}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"

if [[ -z "$PROJECT_ID" ]]; then
  usage >&2
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is required." >&2
  exit 1
fi

if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Project $PROJECT_ID already exists."
else
  create_args=("--name=$DISPLAY_NAME")
  if [[ -n "$FOLDER_ID" ]]; then
    create_args+=("--folder=$FOLDER_ID")
  elif [[ -n "$ORGANIZATION_ID" ]]; then
    create_args+=("--organization=$ORGANIZATION_ID")
  fi
  gcloud projects create "$PROJECT_ID" "${create_args[@]}"
fi

gcloud config set project "$PROJECT_ID" >/dev/null

if [[ -n "$BILLING_ACCOUNT" ]]; then
  if [[ "$BILLING_ACCOUNT" != billingAccounts/* ]]; then
    BILLING_ACCOUNT="billingAccounts/$BILLING_ACCOUNT"
  fi
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
else
  echo "No BILLING_ACCOUNT provided; skipping billing link."
fi

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com

if gcloud artifacts repositories describe "$REPOSITORY" \
  --project="$PROJECT_ID" \
  --location="$REGION" >/dev/null 2>&1; then
  echo "Artifact Registry repository $REPOSITORY already exists in $REGION."
else
  gcloud artifacts repositories create "$REPOSITORY" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --repository-format=docker \
    --description="Mike Cloud Run images"
fi

SERVICE_ACCOUNT_EMAIL="$SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Service account $SERVICE_ACCOUNT_EMAIL already exists."
else
  gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
    --project="$PROJECT_ID" \
    --display-name="Mike Cloud Run runtime"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

echo "GCP project is ready: $PROJECT_ID"
echo "Region: $REGION"
echo "Artifact Registry: $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY"
echo "Cloud Run service account: $SERVICE_ACCOUNT_EMAIL"
