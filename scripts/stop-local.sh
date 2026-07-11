#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source scripts/lib/compose.sh

echo "==> Stopping Mike Atlas local stack (data preserved)"
$DOCKER_COMPOSE down
npx supabase@latest stop 2>/dev/null || true

echo "Stopped. Use 'make dev' to restart or 'make reset' to destroy data."
