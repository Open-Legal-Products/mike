#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f backend/.env ]; then
  echo "backend/.env already exists; skipping generation."
  exit 0
fi

cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local

python3 - <<'PY'
import secrets, pathlib, re

backend = pathlib.Path("backend/.env").read_text()
frontend = pathlib.Path("frontend/.env.local").read_text()

def set_var(text, name, value):
    return re.sub(rf"^{name}=.*$", f"{name}={value}", text, flags=re.M)

download_secret = secrets.token_hex(32)
encryption_secret = secrets.token_hex(32)
minio_root = secrets.token_hex(16)
minio_password = secrets.token_hex(16)

backend = set_var(backend, "DOWNLOAD_SIGNING_SECRET", download_secret)
backend = set_var(backend, "USER_API_KEYS_ENCRYPTION_SECRET", encryption_secret)
backend = set_var(backend, "S3_ACCESS_KEY_ID", "minioadmin")
backend = set_var(backend, "S3_SECRET_ACCESS_KEY", "minioadmin")
backend = set_var(backend, "S3_BUCKET_NAME", "mike-documents")
backend = set_var(backend, "S3_ENDPOINT_URL", "http://minio:9000")
backend = set_var(backend, "S3_REGION", "us-east-1")
backend = set_var(backend, "R2_ENDPOINT_URL", "")
backend = set_var(backend, "R2_ACCESS_KEY_ID", "")
backend = set_var(backend, "R2_SECRET_ACCESS_KEY", "")
backend = set_var(backend, "R2_BUCKET_NAME", "")
backend = set_var(backend, "RAW_LLM_STREAM_LOG_DIR", "")
backend = set_var(backend, "LOG_RAW_LLM_STREAM", "false")
backend = set_var(backend, "COURTLISTENER_API_TOKEN", "")

frontend = set_var(frontend, "NEXT_PUBLIC_BACKEND_URL", "http://localhost:3001")

pathlib.Path("backend/.env").write_text(backend)
pathlib.Path("frontend/.env.local").write_text(frontend)
PY

echo "backend/.env and frontend/.env.local created with local-only secrets."
