# Local Troubleshooting

## Port already in use

```bash
lsof -i :3000  # find process
kill -9 <PID>
```

Or change the port in `compose.yaml`.

## Docker not available

Ensure Docker Desktop is running. On macOS:
```bash
open -a Docker
```

## Supabase not starting

Supabase local needs to download ~10 Docker images on first run. If it times out:
```bash
npx supabase@latest stop
npx supabase@latest start
```

If Docker network `supabase_network_mike` is missing:
```bash
docker network create supabase_network_mike
```

If `supabase_vector_mike` container is unhealthy (known on some macOS ARM setups):
```bash
# Full clean restart
npx supabase@latest stop --no-backup
docker container prune -f
docker volume prune -f
npx supabase@latest start
```

If the vector container consistently fails, check Docker Desktop memory
allocation (minimum 4 GB recommended) and Docker Desktop settings for
Apple Virtualization Framework vs. Rosetta.

## Migrations fail

```bash
make db-status                    # check current state
make db-reset CONFIRM=local-only  # full reset
make bootstrap                    # re-apply
```

## Bucket missing

MinIO init container creates the bucket. If it fails:
```bash
docker-compose up minio-init
```

## CORS errors

Verify `FRONTEND_URL` in `backend/.env` matches the frontend URL exactly.

## LibreOffice errors

LibreOffice runs inside the backend container. If conversion fails:
```bash
docker-compose exec backend which soffice
docker-compose exec backend soffice --version
```

## Volume permission errors

```bash
make stop
docker-compose down -v
make bootstrap
```

## Frontend can't reach backend

Check `NEXT_PUBLIC_API_BASE_URL` in `frontend/.env.local` — it should be
`http://localhost:3001`.

## Readiness returns 503

The `/ready` endpoint checks Supabase and storage connectivity. Ensure both
are running:
```bash
curl http://localhost:54321/rest/v1/   # Supabase
curl http://localhost:9000/minio/health/live  # MinIO
```

## Lockfile divergent

If `package-lock.json` is out of sync:
```bash
cd backend && npm ci
cd frontend && npm ci
```

## ARM vs x86

The Dockerfiles use `node:20.19.0-slim` which supports both arm64 and amd64.
LibreOffice packages are installed via apt and support both architectures.
