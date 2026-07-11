#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FAILURES=0

assert_ok() {
  local url="$1"
  local label="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [ "$code" = "200" ] || [ "$code" = "204" ]; then
    echo "  [OK] $label ($url) -> $code"
  else
    echo "  [FAIL] $label ($url) -> $code"
    FAILURES=$((FAILURES+1))
  fi
}

assert_rejected() {
  local url="$1"
  local label="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [ "$code" = "401" ] || [ "$code" = "403" ] || [ "$code" = "404" ]; then
    echo "  [OK] $label rejected ($url) -> $code"
  else
    echo "  [FAIL] $label returned $code without authentication (expected 401/403/404)"
    FAILURES=$((FAILURES+1))
  fi
}

assert_rejected_post() {
  local url="$1"
  local label="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$url" \
    -H "Content-Type: application/json" \
    -d '{"clusterId":1}' 2>/dev/null || echo "000")
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    echo "  [OK] $label rejected ($url) -> $code"
  else
    echo "  [FAIL] $label returned $code without authentication (expected 401/403)"
    FAILURES=$((FAILURES+1))
  fi
}

echo "==> Mike Atlas local smoke test"

echo ""
echo "--> Service reachability"
assert_ok "http://localhost:3001/health" "backend health"
assert_ok "http://localhost:3001/ready" "backend readiness"
assert_ok "http://localhost:3000" "frontend root"
assert_ok "http://localhost:9000/minio/health/live" "minio health"
assert_ok "http://localhost:54321/rest/v1/" "supabase api"

echo ""
echo "--> Security baseline"
assert_rejected_post "http://localhost:3001/case-law/case-opinions" "unauthenticated case-law POST"

echo ""
if [ "${1:-}" = "--ai" ]; then
  echo "--> AI provider smoke (optional)"
  if grep -qE '^(ANTHROPIC_API_KEY|CLAUDE_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY)=' backend/.env; then
    echo "  AI key present; AI smoke not yet implemented."
  else
    echo "  No AI key configured; skipping AI smoke."
  fi
fi

echo ""
echo "Summary: $FAILURES failure(s)."

if [ "$FAILURES" -gt 0 ]; then
  exit 1
fi

exit 0
