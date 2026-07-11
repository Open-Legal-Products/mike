#!/usr/bin/env bash
set -euo pipefail

URL="${1:-}"
TIMEOUT="${2:-30}"

if [ -z "$URL" ]; then
  echo "Usage: wait-for-service.sh <url> [timeout_seconds]"
  exit 1
fi

for i in $(seq 1 "$TIMEOUT"); do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "  [OK] $URL ready after ${i}s"
    exit 0
  fi
  sleep 1
done

echo "  [ERROR] $URL not ready after ${TIMEOUT}s"
exit 1
