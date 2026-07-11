#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ "${CONFIRM:-}" != "local-only" ]; then
  echo "This resets the LOCAL database. Run with CONFIRM=local-only"
  exit 1
fi

echo "==> Resetting local database"
npx supabase@latest db reset
