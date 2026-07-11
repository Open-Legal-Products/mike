#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source backend/.env

DB_URL="${SUPABASE_URL}/pgrest/v1/"  # placeholder; real verification uses psql or supabase sql

echo "==> Verifying local database objects"

# Check essential tables via Supabase PostgREST
TABLES="users projects documents document_versions chats chat_messages user_api_keys"
for table in $TABLES; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "${SUPABASE_URL}/rest/v1/${table}?limit=0" \
    -H "apikey: ${SUPABASE_SECRET_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" 2>/dev/null || echo "000")
  if [ "$code" = "200" ] || [ "$code" = "401" ]; then
    echo "  [OK] table or endpoint $table reachable ($code)"
  else
    echo "  [FAIL] table $table not reachable ($code)"
  fi
done

echo ""
echo "==> Tables without RLS (known production blocker)"
python3 - <<'PY'
import re, pathlib
schema = pathlib.Path("backend/schema.sql").read_text()
# crude extraction of create table statements without enable row level security
lines = schema.splitlines()
in_table = False
table_name = None
rls_tables = set()
all_tables = []
for line in lines:
    m = re.match(r"^create table if not exists ([\w_]+)", line.strip().lower())
    if m:
        in_table = True
        table_name = m.group(1)
        all_tables.append(table_name)
    if in_table and line.strip().endswith(";"):
        in_table = False
        table_name = None
    if "alter table" in line.lower() and "enable row level security" in line.lower():
        m = re.search(r"alter table ([\w_]+)", line.lower())
        if m:
            rls_tables.add(m.group(1))
for t in all_tables:
    status = "RLS enabled" if t in rls_tables else "NO RLS"
    print(f"  {t}: {status}")
PY
