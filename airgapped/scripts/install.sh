#!/usr/bin/env bash
# Install the offline bundle on the AIR-GAPPED host (plan phase 6).
#
# Verifies checksum + architecture, loads the images (no network), generates
# secrets on first run, brings the stack up in dependency order, and waits for
# health. The only manual pre-steps: transfer the bundle + its .sha256, and keep
# the generated secrets safe (needed for restores).
#
# Usage:  ./install.sh /path/to/mike-airgap-<arch>.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."   # airgapped/

BUNDLE="${1:?usage: install.sh <bundle.tar.gz>}"
ENV_FILE=".env.generated"

echo "[install] verifying checksum…"
sha256sum -c "${BUNDLE}.sha256"

want_arch="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
case "$BUNDLE" in
    *"-${want_arch}."*) : ;;
    *) echo "[install] ERROR: bundle arch does not match host (${want_arch})"; exit 1 ;;
esac

echo "[install] loading images (offline)…"
gunzip -c "${BUNDLE}" | docker load

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "[install] generating secrets → ${ENV_FILE} (keep this safe — restores need it)"
    ./scripts/gen-secrets.sh > "${ENV_FILE}"
    chmod 600 "${ENV_FILE}"
fi

echo "[install] starting stack (postgres → db-init → auth → migrate → rest → gateway → app)…"
docker compose --env-file "${ENV_FILE}" -f docker-compose.airgapped.yml -p mike up -d

echo "[install] waiting for the gateway to be healthy…"
for i in $(seq 1 60); do
    if curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
        echo "[install] gateway up."
        break
    fi
    sleep 3
done

echo "[install] done. Front the gateway with the TLS proxy (Caddyfile) for HTTPS."
echo "[install] Verify: run acceptance.sh"
