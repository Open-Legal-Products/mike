#!/usr/bin/env bash
# Restore an air-gapped deployment from a backup.sh directory (plan phase 5).
#
# CRITICAL: reuses the ORIGINAL secrets.env. Restoring the DB while re-running
# gen-secrets.sh would make every encrypted user API key / MCP secret / download
# token / session undecryptable. This copies secrets.env back into place first.
#
# Usage:  ./restore.sh backups/<timestamp>
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?usage: restore.sh <backup_dir>}"
PROJECT="${COMPOSE_PROJECT:-mike}"

echo "[restore] verifying checksums…"
( cd "${SRC}" && sha256sum -c SHA256SUMS )

echo "[restore] restoring the original secrets (required to decrypt data)…"
cp "${SRC}/secrets.env" .env.generated
chmod 600 .env.generated

echo "[restore] bringing up postgres + db-init…"
docker compose --env-file .env.generated -f docker-compose.airgapped.yml -p "${PROJECT}" up -d postgres db-init

echo "[restore] restoring roles (globals)…"
[ -f "${SRC}/globals.sql" ] && docker compose -p "${PROJECT}" exec -T postgres \
    psql -U postgres -d postgres -v ON_ERROR_STOP=0 < "${SRC}/globals.sql" >/dev/null
echo "[restore] restoring postgres…"
gunzip -c "${SRC}/db.sql.gz" | \
    docker compose -p "${PROJECT}" exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1

echo "[restore] restoring minio objects…"
docker run --rm --volumes-from "${PROJECT}-minio-1" -v "$(pwd)/${SRC}:/in" \
    alpine sh -c "cd /data && tar xzf /in/minio.tar.gz" 2>/dev/null || \
    echo "[restore] (minio volume name differs — adjust --volumes-from)"

echo "[restore] starting the rest of the stack…"
docker compose --env-file .env.generated -f docker-compose.airgapped.yml -p "${PROJECT}" up -d
echo "[restore] done. Verify with acceptance.sh."
