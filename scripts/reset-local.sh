#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source scripts/lib/compose.sh

if [ "${CONFIRM:-}" != "local-only" ]; then
  echo "This destroys LOCAL data only. Run with CONFIRM=local-only"
  exit 1
fi

echo "==> Resetting Mike Atlas local environment"
$DOCKER_COMPOSE down -v
npx supabase@latest stop 2>/dev/null || true
npx supabase@latest db reset 2>/dev/null || true
rm -rf supabase/.branches supabase/.temp

echo "Local data reset. Run 'make bootstrap' to recreate."
