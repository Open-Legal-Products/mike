#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source scripts/lib/compose.sh

echo "==> Mike Atlas local bootstrap"

# Node version check
NODE_VERSION=$(node --version | sed 's/v//')
REQUIRED_MAJOR=20
CURRENT_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$CURRENT_MAJOR" -lt "$REQUIRED_MAJOR" ]; then
  echo "Error: Node.js $NODE_VERSION is too old. Mike requires Node.js >= 20."
  exit 1
fi
echo "Node.js: $NODE_VERSION"

# Install dependencies deterministically
echo "==> Installing backend dependencies..."
cd "$REPO_ROOT/backend"
npm ci

echo "==> Installing frontend dependencies..."
cd "$REPO_ROOT/frontend"
npm ci

# Generate local env files
echo "==> Generating local environment files..."
cd "$REPO_ROOT"
bash scripts/generate-local-secrets.sh

# Initialize Supabase local project
echo "==> Initializing Supabase local project..."
if [ ! -f supabase/config.toml ]; then
  npx supabase@latest init --yes
fi

# Ensure project_id is set to mike
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY'
import re, pathlib
path = pathlib.Path("supabase/config.toml")
text = path.read_text()
text = re.sub(r'^project_id\s*=\s*"[^"]*"', 'project_id = "mike"', text, flags=re.M)
if 'project_id' not in text:
    text = 'project_id = "mike"\n' + text
path.write_text(text)
PY
fi

# Sync migrations into Supabase CLI folder
echo "==> Syncing migrations..."
mkdir -p supabase/migrations
if [ ! -f "supabase/migrations/00000000000000_initial_schema.sql" ]; then
  cp backend/schema.sql supabase/migrations/00000000000000_initial_schema.sql
fi
for file in backend/migrations/*.sql; do
  base=$(basename "$file")
  date_part=$(echo "$base" | grep -oE '^[0-9]{8}')
  if [ -n "$date_part" ]; then
    ts="${date_part}000000"
    target="supabase/migrations/${ts}_${base#*_}"
    if [ ! -f "$target" ]; then
      cp "$file" "$target"
    fi
  fi
done

# Start Supabase local
echo "==> Starting Supabase local..."
npx supabase@latest start

# Extract credentials from Supabase status
STATUS=$(npx supabase@latest status --output json)
SUPABASE_URL=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['API_URL'])")
SUPABASE_ANON_KEY=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['ANON_KEY'])")
SUPABASE_SERVICE_ROLE_KEY=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")

# Update .env with Supabase credentials
python3 - <<PY
import re, pathlib
for path in ["backend/.env", "frontend/.env.local", ".env"]:
    p = pathlib.Path(path)
    if not p.exists():
        continue
    text = p.read_text()
    text = re.sub(r'^SUPABASE_URL=.*$', f'SUPABASE_URL={SUPABASE_URL}', text, flags=re.M)
    text = re.sub(r'^SUPABASE_SECRET_KEY=.*$', f'SUPABASE_SECRET_KEY={SUPABASE_SERVICE_ROLE_KEY}', text, flags=re.M)
    text = re.sub(r'^NEXT_PUBLIC_SUPABASE_URL=.*$', f'NEXT_PUBLIC_SUPABASE_URL={SUPABASE_URL}', text, flags=re.M)
    text = re.sub(r'^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=.*$', f'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY={SUPABASE_ANON_KEY}', text, flags=re.M)
    p.write_text(text)
PY

# Create root .env for docker-compose if missing
if [ ! -f .env ]; then
  cp backend/.env .env
fi

# Start MinIO via Docker Compose
echo "==> Starting MinIO..."
cd "$REPO_ROOT"
$DOCKER_COMPOSE up -d minio minio-init

echo ""
echo "Bootstrap complete."
echo "Run 'make dev' to start backend and frontend, or 'make smoke-local' to verify."
