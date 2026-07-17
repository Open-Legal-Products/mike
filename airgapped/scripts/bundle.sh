#!/usr/bin/env bash
# Build the offline image bundle on a CONNECTED host (plan phase 4).
#
# Pulls every pinned image for the target architecture, builds the app images,
# and saves everything to a single checksummed tarball for sneakernet transfer to
# the air-gapped host, where install.sh loads it. No pulls happen at deploy time.
#
# Usage:  ARCH=amd64 ./bundle.sh              # or ARCH=arm64
# Output: dist/mike-airgap-<arch>.tar.gz  +  .sha256
#
# NOTE: bundle size is large (~20-40 GB with Ollama weights). Pre-pull the model
# separately into the ollama volume and include it, or document a first-boot
# `ollama pull` from an internal mirror.
set -euo pipefail
cd "$(dirname "$0")/../.."

ARCH="${ARCH:-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')}"
OUT_DIR="dist"
OUT="${OUT_DIR}/mike-airgap-${ARCH}.tar"

# Pinned third-party images (must match docker-compose.airgapped.yml). Repin to
# @sha256 for a real release so the bundle is byte-reproducible.
IMAGES=(
    "public.ecr.aws/supabase/postgres:15.8.1.085"
    "public.ecr.aws/supabase/gotrue:v2.191.0"
    "public.ecr.aws/supabase/postgrest:v14.13"
    "nginx:1.27-alpine"
    "minio/minio:RELEASE.2025-09-07T16-13-09Z"
    "minio/mc:RELEASE.2025-08-13T08-35-41Z"
    "redis:7-alpine"
    "axllent/mailpit:v1.20"
    "ollama/ollama:0.6.8"
    "alpine:3.20"
)

echo "[bundle] target arch: ${ARCH}"
mkdir -p "${OUT_DIR}"

echo "[bundle] pulling pinned images (${ARCH})…"
for img in "${IMAGES[@]}"; do
    docker pull --platform "linux/${ARCH}" "$img"
done

echo "[bundle] building app images (${ARCH})…"
docker buildx build --platform "linux/${ARCH}" --target production-airgapped \
    -f apps/api/Dockerfile -t mike-api:airgapped --load .
docker buildx build --platform "linux/${ARCH}" --target production \
    -f apps/web/Dockerfile -t mike-web:airgapped --load .

echo "[bundle] saving → ${OUT}"
docker save -o "${OUT}" "${IMAGES[@]}" mike-api:airgapped mike-web:airgapped
gzip -f "${OUT}"
( cd "${OUT_DIR}" && sha256sum "$(basename "${OUT}").gz" > "$(basename "${OUT}").gz.sha256" )

echo "[bundle] done:"
ls -lh "${OUT}.gz" "${OUT}.gz.sha256"
echo "[bundle] transfer ${OUT}.gz + .sha256 to the air-gapped host, then run install.sh"
