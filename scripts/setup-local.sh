#!/usr/bin/env bash
set -euo pipefail

# Starts local Supabase, writes credentials into .env files, and applies the schema.
# Run once after cloning: bash scripts/setup-local.sh

cd "$(dirname "$0")/.."

if ! command -v supabase &>/dev/null; then
  echo "supabase CLI not found. Install with: brew install supabase/tap/supabase"
  exit 1
fi

echo "==> Starting local Supabase..."
supabase start

# supabase status outputs JSON in recent CLI versions:
#   { "API_URL": "...", "ANON_KEY": "...", "SERVICE_ROLE_KEY": "...", ... }
if ! command -v jq &>/dev/null; then
  echo "jq not found. Install with: brew install jq"
  exit 1
fi

STATUS_JSON=$(supabase status 2>/dev/null | sed -n '/^{/,/^}/p')

extract() { echo "$STATUS_JSON" | jq -r ".$1 // empty" 2>/dev/null; }

API_URL=$(extract "API_URL")
ANON_KEY=$(extract "ANON_KEY")
SERVICE_KEY=$(extract "SERVICE_ROLE_KEY")

if [[ -z "$API_URL" || -z "$ANON_KEY" || -z "$SERVICE_KEY" ]]; then
  echo "Could not parse supabase status output. Copy credentials manually from above."
  exit 1
fi

patch_env() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

echo "==> Writing credentials to apps/api/.env..."
[[ -f apps/api/.env ]] || cp apps/api/.env.example apps/api/.env
patch_env apps/api/.env SUPABASE_URL "$API_URL"
patch_env apps/api/.env SUPABASE_SECRET_KEY "$SERVICE_KEY"

echo "==> Writing credentials to apps/web/.env.local..."
[[ -f apps/web/.env.local ]] || touch apps/web/.env.local
patch_env apps/web/.env.local NEXT_PUBLIC_SUPABASE_URL "$API_URL"
patch_env apps/web/.env.local NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY "$ANON_KEY"
patch_env apps/web/.env.local NEXT_PUBLIC_API_BASE_URL "http://localhost:3001"

echo "==> Applying pending migrations..."
supabase migration up --local

echo ""
echo "Done. Fill in remaining vars in apps/api/.env (LLM keys, storage, secrets) then:"
echo "  npm run dev:api"
echo "  npm run dev:web"
