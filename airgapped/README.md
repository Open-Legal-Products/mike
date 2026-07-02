# Air-gapped embedded stack

The Supabase data plane embedded as **3 services** (Postgres + GoTrue + PostgREST)
behind an **nginx gateway**, plus MinIO, Redis, and a local model server — no
external dependency, no Supabase CLI.

## Design decisions

- **3 Supabase services, not 13.** The app only uses Postgres, GoTrue (auth), and
  PostgREST (REST); Realtime/Storage/Studio/etc. are dropped (see plan §3).
- **nginx gateway, not Kong.** The app needs only `/auth/v1` + `/rest/v1` routing;
  the security boundary is the JWT + deny-all RLS, not a gateway apikey gate. One
  fewer service to own and patch. `gateway.conf` is the whole config.
- **Boot ordering** (via `depends_on`): `postgres` (creates roles) → `db-init`
  (sets the service-role passwords the image leaves unset) → `auth`/GoTrue
  (creates `auth.*`) → `migrate` (app migrations, which FK to `auth.users`) →
  `rest` + `gateway`.
- **Images** are pinned to the exact tags the working Supabase CLI stack uses. For
  a true air-gap bundle, repin by `@sha256` and vendor (phase 4).

## ⚠️ Secrets

The JWT secret, anon/service keys, and passwords in the compose are **Supabase
demo values**, for local bring-up only. A real deployment MUST replace them via
gen-secrets (phase 5). Do not ship these.

## Verify locally

The `migrate` service uses the `mike-api` image (phase 4). To verify the data
plane without it, use the test override (publishes Postgres) and run the migration
runner + stack tests from the host:

```bash
cd airgapped
docker compose -f docker-compose.airgapped.yml -f docker-compose.test.yml -p mikeair up -d auth   # → postgres → db-init → auth
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/postgres" node ../apps/api/scripts/migrate.mjs
docker compose -f docker-compose.airgapped.yml -f docker-compose.test.yml -p mikeair up -d --no-deps rest gateway

# stack-E2E against the embedded gateway (demo anon/service keys)
cd ../apps/api
SUPABASE_TEST_URL=http://localhost:8000 \
SUPABASE_TEST_ANON_KEY=<demo anon key> \
SUPABASE_TEST_SERVICE_ROLE_KEY=<demo service key> \
  npx vitest run src/__tests__/integration/stack.supabase.test.ts

cd ../airgapped && docker compose -f docker-compose.airgapped.yml -f docker-compose.test.yml -p mikeair down -v
```

Verified: fresh volume → auth healthy in ~8s (no manual step), all 13 migrations
apply, stack-E2E (auth contract + RLS deny-all + tenant isolation + leak sweep)
passes 4/4.
