#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source scripts/lib/compose.sh

echo "==> Docker Compose services"
$DOCKER_COMPOSE ps

echo ""
echo "==> Supabase local status"
npx supabase@latest status 2>/dev/null || echo "Supabase not running"

echo ""
echo "==> Health checks"
for url in http://localhost:3001/health http://localhost:3000; do
  printf "%-40s " "$url"
  curl -fsS "$url" >/dev/null 2>&1 && echo "OK" || echo "UNREACHABLE"
done
