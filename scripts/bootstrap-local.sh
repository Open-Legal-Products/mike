#!/usr/bin/env bash
# Bootstrap local dev: provision cognito-local user pool + client, ensure MinIO
# bucket, run Drizzle migrations against local Postgres.
#
# Prerequisites:
#   - docker compose up -d postgres auth minio smtp
#   - Node.js 20+ installed locally so `npm run db:migrate` works
#
# Idempotent — safe to run repeatedly.
set -euo pipefail

POOL_ID="${COGNITO_USER_POOL_ID:-us-east-1_localDev01}"
CLIENT_ID="${COGNITO_CLIENT_ID:-local-client-id}"
COGNITO_URL="${COGNITO_URL:-http://localhost:9229}"
COGNITO_DATA_DIR="${COGNITO_DATA_DIR:-$(dirname "$0")/../temp/auth}"

echo "==> Waiting for cognito-local on $COGNITO_URL ..."
for i in $(seq 1 30); do
  if curl -sf "$COGNITO_URL/" >/dev/null 2>&1 \
     || [ "$(curl -s -o /dev/null -w '%{http_code}' "$COGNITO_URL/")" = "404" ]; then
    echo "    cognito-local is up"
    break
  fi
  sleep 1
done

# The amaingot fork of cognito-local accepts a custom pool id via PoolName,
# but always auto-generates the client id (the value we pass in the API
# request body is ignored). To get a deterministic, doc-friendly client id we
# pre-seed clients.json on disk before cognito-local serves any requests.
# However by the time bootstrap runs the container is already up, so we:
#   1. Patch clients.json in the mounted DATA_DIR
#   2. Restart cognito-local so it reloads the file
PRE_SEED=true
if [ "$PRE_SEED" = "true" ] && [ -d "$COGNITO_DATA_DIR" ]; then
  clients_file="$COGNITO_DATA_DIR/clients.json"
  python3 - "$clients_file" "$POOL_ID" "$CLIENT_ID" <<'PY'
import json, os, sys
path, pool_id, client_id = sys.argv[1], sys.argv[2], sys.argv[3]
data = {}
if os.path.exists(path):
    with open(path) as f:
        try:
            data = json.load(f) or {}
        except json.JSONDecodeError:
            data = {}
# Drop any auto-generated clients pointing at this pool, then add ours.
data = {k: v for k, v in data.items() if v.get("userPoolId") != pool_id}
data[client_id] = {
    "clientId": client_id,
    "clientName": "mike-local",
    "userPoolId": pool_id,
    "callbackUrls": [],
    "logoutUrls": [],
    "explicitAuthFlows": ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    "allowedOAuthFlows": [],
    "allowedOAuthScopes": [],
    "accessTokenValidity": 3600,
    "idTokenValidity": 3600,
    "refreshTokenValidity": 2592000,
}
with open(path, "w") as f:
    json.dump(data, f, indent=2)
print(f"    Wrote {len(data)} client(s) to {path}")
PY
fi

# Now make sure the pool exists. CreateUserPool with the same PoolName is
# idempotent on the amaingot fork (the existing pool's id stays put).
create_pool_response=$(
  curl -sf "$COGNITO_URL/" \
    -H "Content-Type: application/x-amz-json-1.1" \
    -H "X-Amz-Target: AWSCognitoIdentityProviderService.CreateUserPool" \
    -d "{\"PoolName\":\"$POOL_ID\",\"UsernameAttributes\":[\"email\"],\"AutoVerifiedAttributes\":[\"email\"]}" \
  || true
)
echo "==> Pool create response (truncated): ${create_pool_response:0:200}"

# Bounce cognito-local so it picks up the seeded clients.json. Skip the bounce
# if we're not pre-seeding (lets users run this script against a remote cognito
# stack with no docker context).
if [ "$PRE_SEED" = "true" ] && command -v docker >/dev/null 2>&1; then
  echo "==> Restarting mike-aws-auth to load seeded client"
  docker restart mike-aws-auth >/dev/null
  for i in $(seq 1 30); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$COGNITO_URL/$POOL_ID/.well-known/openid-configuration")" = "200" ]; then
      break
    fi
    sleep 1
  done
fi

echo "==> Cognito user pool '$POOL_ID' with client '$CLIENT_ID' ready"

echo "==> MinIO bucket creation is handled by the docker-compose 'minio-init' service"

echo "==> Running Drizzle migrations against postgres://localhost:5432/mike"
(
  cd "$(dirname "$0")/../backend"
  DATABASE_URL="${DATABASE_URL:-postgres://mike:mike@localhost:5432/mike}" \
    npm run db:migrate
)

echo "==> Bootstrap complete."
echo ""
echo "Next steps:"
echo "  1. (optional) export GEMINI_API_KEY=... OPENAI_API_KEY=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=..."
echo "  2. npm run dev --prefix backend"
echo "  3. npm run dev --prefix frontend"
echo "  4. Open http://localhost:3000"
echo "  5. To retrieve Cognito signup codes during testing:"
echo "       docker compose logs -f auth | grep -i code"
