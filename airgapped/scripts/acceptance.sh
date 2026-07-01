#!/usr/bin/env bash
# Air-gap acceptance checks (plan phase 6, §12). Run against a brought-up stack
# on a network-disabled host. Exits non-zero if any check fails.
#
# Some checks are environment-assertions the script can't fully self-verify (an
# egress monitor must run OUTSIDE the containers); those print MANUAL and are
# listed for the operator. The rest are executed.
set -uo pipefail
cd "$(dirname "$0")/.."
PROJECT="${COMPOSE_PROJECT:-mike}"
fail=0
ok()   { echo "  PASS  $1"; }
bad()  { echo "  FAIL  $1"; fail=1; }
man()  { echo "  MANUAL $1"; }

echo "== Air-gap acceptance =="

# 1. Gateway/data plane up.
curl -fsS http://localhost:8000/health >/dev/null 2>&1 && ok "gateway health" || bad "gateway health"

# 2/3. Migrations applied + RLS firewall (reuses the stack-E2E harness).
if [[ -n "${RUN_STACK_E2E:-}" ]]; then
    ( cd ../apps/api && SUPABASE_TEST_URL=http://localhost:8000 \
        SUPABASE_TEST_ANON_KEY="${ANON_KEY:?}" SUPABASE_TEST_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?}" \
        npx vitest run src/__tests__/integration/stack.supabase.test.ts >/dev/null 2>&1 ) \
        && ok "stack-E2E (auth + RLS deny-all + tenant isolation + leak sweep)" \
        || bad "stack-E2E"
else
    man "stack-E2E — set RUN_STACK_E2E=1 + ANON_KEY/SERVICE_ROLE_KEY to run"
fi

# 4. DOCX→PDF: soffice present in the api image.
docker compose -p "${PROJECT}" exec -T api sh -c "command -v soffice" >/dev/null 2>&1 \
    && ok "LibreOffice present for DOCX→PDF" || bad "LibreOffice missing in api image"

# 5. Cloud-model refusal (no egress even attempted).
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3001/chat \
    -H 'content-type: application/json' -H 'authorization: Bearer x' \
    -d '{"messages":[{"role":"user","content":"hi"}],"model":"claude-opus-4-8"}' 2>/dev/null)"
[[ "$code" == "400" || "$code" == "401" ]] && ok "cloud model refused (HTTP $code)" \
    || bad "cloud model not refused (HTTP $code)"

# 8. No default/demo secrets (boot guard would have refused; assert env).
docker compose -p "${PROJECT}" exec -T api sh -c \
    'test "$JWT_SECRET" != "super-secret-jwt-token-with-at-least-32-characters-long"' \
    >/dev/null 2>&1 && ok "not using the demo JWT secret" || bad "demo JWT secret in use"

# 6/7/9. Environment assertions the operator must verify out-of-band.
man "egress: run a host/browser network monitor over upload→chat→PDF view→export; assert ZERO outbound"
man "persistence: docker compose down && up; re-run this script; data must survive"
man "arch: bundle arch matches host (install.sh checks this)"
man "no-pull: install.sh loaded all images; assert 0 registry calls during a full workflow"

echo "== $( [[ $fail -eq 0 ]] && echo "executed checks PASSED" || echo "FAILURES above" ) =="
exit $fail
