#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source scripts/lib/compose.sh

echo "==> Starting Mike Atlas local stack"

# Ensure Supabase local network exists
if ! docker network ls --format '{{.Name}}' | grep -q '^supabase_network_mike$'; then
  echo "Supabase network not found. Run 'make bootstrap' first."
  exit 1
fi

# Ensure .env exists for docker-compose
if [ ! -f .env ]; then
  echo "Missing root .env. Run 'make bootstrap' first."
  exit 1
fi

$DOCKER_COMPOSE up -d minio minio-init backend frontend

echo ""
echo "Waiting for services..."
bash scripts/wait-for-service.sh http://localhost:3001/health 30
bash scripts/wait-for-service.sh http://localhost:3000 30 || true

echo ""
echo "Services:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:3001"
echo "  MinIO:    http://localhost:9090 (console)"
echo "  Supabase: http://localhost:54321"
echo ""
echo "Run 'make logs' to follow logs or 'make smoke-local' to verify."
