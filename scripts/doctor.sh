#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ERRORS=0
WARNINGS=0

check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "  [OK] $1: $(command -v $1)"
  else
    echo "  [ERROR] $1 not found"
    ERRORS=$((ERRORS+1))
  fi
}

check_port() {
  if lsof -Pi ":$1" -sTCP:LISTEN >/dev/null 2>&1 || netstat -an 2>/dev/null | grep -q "\.$1 "; then
    echo "  [WARNING] port $1 already in use"
    WARNINGS=$((WARNINGS+1))
  else
    echo "  [OK] port $1 available"
  fi
}

check_version() {
  echo "Node.js: $(node --version 2>/dev/null || echo 'unknown')"
  echo "npm: $(npm --version 2>/dev/null || echo 'unknown')"
  echo "Docker: $(docker --version 2>/dev/null || echo 'unknown')"
  if command -v docker-compose >/dev/null 2>&1; then
    echo "Docker Compose: $(docker-compose --version 2>/dev/null || echo 'unknown')"
  elif docker compose version >/dev/null 2>&1; then
    echo "Docker Compose: $(docker compose version 2>/dev/null || echo 'unknown')"
  fi
}

echo "==> Mike Atlas local doctor"
check_version
echo ""
echo "==> Required commands"
check_command node
check_command npm
check_command docker
check_command git

echo ""
echo "==> Optional / context commands"
check_command python3 || true
check_command npx || true

echo ""
echo "==> Node compatibility"
NODE_VERSION=$(node --version | sed 's/v//')
MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$MAJOR" -ge 20 ]; then
  echo "  [OK] Node.js $NODE_VERSION >= 20"
else
  echo "  [ERROR] Node.js $NODE_VERSION is too old (need >= 20)"
  ERRORS=$((ERRORS+1))
fi

echo ""
echo "==> Default ports"
check_port 3000
check_port 3001
check_port 54321
check_port 9000
check_port 9090

echo ""
echo "==> Required files"
for f in backend/package.json frontend/package.json backend/.env.example frontend/.env.local.example compose.yaml; do
  if [ -f "$f" ]; then
    echo "  [OK] $f present"
  else
    echo "  [ERROR] $f missing"
    ERRORS=$((ERRORS+1))
  fi
done

echo ""
echo "==> Secret leakage scan (gitleaks)"
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks detect --source . --redact 2>/dev/null; then
    echo "  [OK] no secrets detected"
  else
    echo "  [ERROR] gitleaks found potential secrets"
    ERRORS=$((ERRORS+1))
  fi
else
  echo "  [WARNING] gitleaks not installed"
  WARNINGS=$((WARNINGS+1))
fi

echo ""
echo "==> Disk space"
df -h . | tail -1 | awk '{print "  available: "$4" / total: "$2}'

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "Result: $ERRORS error(s), $WARNINGS warning(s). Fix errors before bootstrap."
  exit 1
else
  echo "Result: healthy. $WARNINGS warning(s)."
  exit 0
fi
