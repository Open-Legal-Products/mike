#!/usr/bin/env bash
# Back up an air-gapped deployment (plan phase 5).
#
# Captures the three stateful stores AND the secrets — encrypted data
# (user_api_keys, MCP connector secrets, download tokens, sessions) is ONLY
# decryptable with the original secrets, so a DB backup without them is useless.
#
# Usage:  ./backup.sh [dest_dir]   (default: ./backups/<timestamp>)
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${COMPOSE_PROJECT:-mike}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${1:-backups/${STAMP}}"
mkdir -p "${DEST}"

echo "[backup] postgres roles → globals.sql"
docker compose -p "${PROJECT}" exec -T postgres \
    pg_dumpall -U postgres --globals-only > "${DEST}/globals.sql"
echo "[backup] postgres → db.sql.gz"
docker compose -p "${PROJECT}" exec -T postgres \
    pg_dump -U postgres -d postgres --no-owner | gzip > "${DEST}/db.sql.gz"

echo "[backup] minio objects → minio.tar.gz"
docker run --rm --volumes-from "${PROJECT}-minio-1" -v "$(pwd)/${DEST}:/out" \
    alpine tar czf /out/minio.tar.gz -C /data . 2>/dev/null || \
    echo "[backup] (minio volume name differs — adjust --volumes-from)"

echo "[backup] secrets → secrets.env  (KEEP AS SAFE AS THE DATA)"
{ cp .env.generated "${DEST}/secrets.env" && chmod 600 "${DEST}/secrets.env"; } 2>/dev/null || \
    echo "[backup] WARNING: .env.generated not found — restore will fail without the original secrets"

sha256sum "${DEST}"/* > "${DEST}/SHA256SUMS"
echo "[backup] done → ${DEST}"
echo "[backup] store secrets.env in a secrets manager; the DB dump alone cannot decrypt user keys/sessions."
