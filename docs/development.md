# Development

Install workspace dependencies:

```bash
npm install
```

Run checks (root scripts fan out across all workspaces):

```bash
npm run typecheck   # tsc --noEmit in every workspace
npm run lint        # ESLint in every workspace (api includes eslint-plugin-security)
npm test            # all workspace unit/integration suites
npm run verify:all  # lint + typecheck + build + every test suite (the pre-release gate)
```

Start local development (see the README Quick Start for first-time setup):

```bash
npm run dev:api     # backend  → http://localhost:3001
npm run dev:web     # frontend → http://localhost:3000
```

Optional local services:

```bash
supabase start
docker compose up -d minio minio-init redis
```

## Live Supabase stack harness

The regular API test suite mocks Supabase. A separate, gated harness proves the
real stack contract (GoTrue auth, deny-all RLS, tenant isolation, a leak sweep
over every public table) and is the check to re-run on **every Supabase image
or CLI version bump**:

```bash
supabase start
cd apps/api && npm run test:stack   # auto-reads keys from `supabase status`
```

The older access-control harness is also available once
`SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_ROLE_KEY` are set from the CLI
output:

```bash
npm run test:integration:supabase --prefix apps/api
```

Both are skipped in the default unit run unless their env vars are present.
