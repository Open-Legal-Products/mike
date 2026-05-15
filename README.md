# Mike

Mike is a legal document assistant — Next.js frontend, Express backend, Postgres
data, S3 file storage, Cognito auth, and AWS Bedrock for Claude (with optional
direct OpenAI/Gemini for the other model families).

Website: [mikeoss.com](https://mikeoss.com)

## Contents

- `frontend/` — Next.js application (standalone output, runs as `node server.js`)
- `backend/` — Express API + document processing
- `backend/src/db/` — Drizzle schema + Postgres client
- `backend/drizzle/` — generated SQL migrations
- `docker-compose.yml` — full local stack: Postgres, Cognito Local, MinIO,
  smtp4dev, plus optionally the built frontend/backend containers
- `scripts/bootstrap-local.sh` — one-shot local provisioning
- `.github/workflows/` — CI + multi-arch image publishing to ghcr.io

## Prerequisites

- Docker Desktop (or any local Docker engine + `docker compose`)
- Node.js 20+ and npm (for running app code outside of docker)

For production:

- An AWS account with **Bedrock** access enabled for the Claude models you intend to use
- A **Cognito User Pool** + App Client
- An **RDS Postgres** instance (or any Postgres 14+)
- An **S3 bucket**
- A verified **SES identity** (wired into the Cognito User Pool as the email source)
- An **ECS Fargate task role** with permissions: `bedrock:InvokeModel`,
  `bedrock:InvokeModelWithResponseStream`, `s3:GetObject`/`PutObject`/`DeleteObject`
  on the bucket, `ses:SendEmail` on the identity, `cognito-idp:AdminDeleteUser`
  on the user pool
- **ALB** + **Route 53** for traffic; ECS services for `mike-frontend` and
  `mike-backend` pulling images from ghcr.io (or re-tagged into your own ECR)

## Local development

The fast path:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
cp .env.example .env

# Bring up the local AWS-equivalent stack:
docker compose up -d postgres auth minio smtp

# Provision cognito-local user pool, create MinIO bucket, run Drizzle migrations:
./scripts/bootstrap-local.sh

# Run the apps locally (two terminals):
npm install --prefix backend
npm install --prefix frontend
npm run dev --prefix backend     # :3001
npm run dev --prefix frontend    # :3000
```

Open `http://localhost:3000`.

Notes:

- Cognito Local does not deliver real emails. After signing up, get the
  confirmation code with `docker compose logs -f auth | grep -i code`.
- MinIO console is at `http://localhost:9101` (user/pass `minioadmin/minioadmin`).
- smtp4dev web UI is at `http://localhost:8003`. The app does not currently
  send any transactional email; the container is kept for future use.
- AWS Bedrock has no local emulator. To exercise Claude models locally, set
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in your shell with credentials
  that have Bedrock invoke permissions. Otherwise, use Gemini or OpenAI models
  (per-user API keys are entered under **Account > Models & API Keys**).

To exercise the full containerised stack:

```bash
docker compose up -d --build
# wait for healthchecks
open http://localhost:3000
```

## Production deployment

Images are published to `ghcr.io/<owner>/mike-frontend` and
`ghcr.io/<owner>/mike-backend` on every push to `main` and on every `v*` tag.
You can pull them directly into ECS or re-tag into ECR:

```bash
docker pull ghcr.io/<owner>/mike-backend:latest
docker tag  ghcr.io/<owner>/mike-backend:latest \
            <account>.dkr.ecr.<region>.amazonaws.com/mike-backend:latest
docker push <account>.dkr.ecr.<region>.amazonaws.com/mike-backend:latest
```

Database migrations: run `npm run db:migrate` (in the backend container, with
`DATABASE_URL` set) once per deploy. The included CI job runs the same command
against a fresh Postgres service container so a broken migration is caught
before merge.

## Configuration reference

See `backend/.env.example` and `frontend/.env.local.example` for the full env
var list. Highlights:

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (RDS in prod) |
| `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` | Cognito identity |
| `COGNITO_JWKS_URI` | Only set for cognito-local — real AWS Cognito auto-resolves the JWKS URL |
| `S3_BUCKET_NAME` | The S3 bucket holding uploaded documents |
| `S3_ENDPOINT_URL` | Only set for MinIO — unset for real AWS S3 |
| `AWS_REGION` / `BEDROCK_REGION` | Defaults to `us-east-1` |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Server-wide keys (optional; users can supply their own in-app) |
| `USER_API_KEYS_ENCRYPTION_SECRET` | Required. AES-256-GCM key for user-stored provider keys |

## Useful commands

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint  --prefix frontend
npm run db:generate --prefix backend   # generate a new Drizzle migration
npm run db:migrate  --prefix backend   # apply pending migrations
```

## Troubleshooting

**Cognito signup confirmation code never arrives.** In local dev, cognito-local
prints the code to its container stdout — `docker compose logs -f auth`.
In production, configure the Cognito User Pool's "Email configuration" to use
SES and verify the FROM address in SES.

**Bedrock invocation returns AccessDenied.** Confirm the IAM role or local
credentials have `bedrock:InvokeModel` + `bedrock:InvokeModelWithResponseStream`
on the model ARN. Bedrock model access also has to be opt-in requested per
model family in the AWS console.

**DOC/DOCX upload conversion fails.** The backend image includes LibreOffice;
if running outside Docker, install LibreOffice locally and restart the backend.

**Postgres connection refused.** Confirm `DATABASE_URL` and that postgres is
healthy — `docker compose ps` should show `(healthy)`. For RDS in production,
TLS is required: the included pool config opts into `ssl` automatically when
`NODE_ENV=production`.

## License

AGPL-3.0-only. See `LICENSE`.
