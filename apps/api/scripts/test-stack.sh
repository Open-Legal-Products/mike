#!/usr/bin/env bash
# Run the gated stack-level integration tests against a local Supabase stack.
#
# These tests exercise the REAL stack (GoTrue auth + Postgres RLS + the credit
# RPC) instead of mocks. They are the harness you re-run on every Supabase image
# bump to prove the auth↔API contract and the deny-all RLS firewall still hold.
#
# Usage:  supabase start   # in the repo, once
#         npm run test:stack        (from apps/api)
set -euo pipefail

if ! command -v supabase >/dev/null 2>&1; then
    echo "supabase CLI not found. Install: brew install supabase/tap/supabase" >&2
    exit 1
fi

STATUS="$(supabase status -o json 2>/dev/null)" || {
    echo "No running Supabase stack. Start one with: supabase start" >&2
    exit 1
}

read_key() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s)['$1']??'')))" <<<"$STATUS"; }

SUPABASE_TEST_URL="$(read_key API_URL)"
SUPABASE_TEST_SERVICE_ROLE_KEY="$(read_key SERVICE_ROLE_KEY)"
SUPABASE_TEST_ANON_KEY="$(read_key ANON_KEY)"

if [[ -z "$SUPABASE_TEST_URL" || -z "$SUPABASE_TEST_SERVICE_ROLE_KEY" || -z "$SUPABASE_TEST_ANON_KEY" ]]; then
    echo "Could not read API_URL/SERVICE_ROLE_KEY/ANON_KEY from 'supabase status'." >&2
    exit 1
fi
export SUPABASE_TEST_URL SUPABASE_TEST_SERVICE_ROLE_KEY SUPABASE_TEST_ANON_KEY

echo "Running stack integration tests against $SUPABASE_TEST_URL"
exec npx vitest run \
    src/__tests__/integration/stack.supabase.test.ts \
    src/__tests__/integration/credits.concurrency.supabase.test.ts \
    "$@"
