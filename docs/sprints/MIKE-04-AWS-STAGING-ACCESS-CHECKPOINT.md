# MIKE-04: AWS Staging Access — Checkpoint

## Status

- **Infrastructure provisioned:** partial (ALB, ECS, RDS, ECR, S3, Secrets Manager)
- **Application operational:** yes (backend, frontend, supabase all running)
- **Login operational:** yes (GoTrue auth working, user created, login tested)
- **Sprint status:** in progress

## AWS ALB URL

```
http://atlas-mike-staging-alb-1821218227.us-east-1.elb.amazonaws.com
```

Uses the native ALB hostname over HTTP (port 80). No custom domain or ACM certificate.

## Functional Credentials

- **Email:** admin@atlasgov.com
- **Password:** AtlasStaging2026!
- **Auth endpoint:** `http://atlas-mike-staging-alb-1821218227.us-east-1.elb.amazonaws.com/supabase/auth/v1/`

## Architecture

```
Browser → ALB (HTTP :80)
  ├── /                    → Frontend (Next.js dev mode, :3000)
  ├── /health, /ready,     → Backend (Express, :3001)
  │   /chat/*, /projects/*,
  │   /single-documents/*,
  │   /tabular-review/*,
  │   /workflows/*, /user/*,
  │   /users/*, /download/*,
  │   /case-law/*
  └── /supabase/*           → Kong (:8000)
                              ├── /supabase/auth/v1/* → GoTrue (:9999)
                              └── /supabase/rest/v1/* → PostgREST (:3000)
```

All services run as ECS Fargate tasks in the `atlas-mike-staging-cluster`.

## AWS Resources (all prefixed `atlas-mike-staging-`)

| Resource | Name/ID |
|----------|---------|
| VPC | vpc-0c0ae5e34f87f4399 (default) |
| ALB | atlas-mike-staging-alb |
| ALB DNS | atlas-mike-staging-alb-1821218227.us-east-1.elb.amazonaws.com |
| ECS Cluster | atlas-mike-staging-cluster |
| RDS | atlas-mike-staging-db (PostgreSQL) |
| S3 (documents) | atlas-mike-staging-documents |
| S3 (tfstate) | atlas-mike-staging-tfstate |
| ECR | atlas-mike-staging/{frontend,backend,kong} |
| Secrets Manager | atlas-mike-staging-app-secrets |
| IAM roles | atlas-mike-staging-task-execution, atlas-mike-staging-task, atlas-mike-staging-github-deploy |

## ECS Services

| Service | Task Def | Status |
|---------|----------|--------|
| atlas-mike-staging-frontend | revision 3 | Running (Next.js dev mode) |
| atlas-mike-staging-backend | revision 3 | Running (production) |
| atlas-mike-staging-supabase | revision 10 | Running (Kong + GoTrue + PostgREST) |

## GoTrue Migration Fix

GoTrue v2.164.0 was failing because:
1. `pop` (migration library) stored migration records in `public.schema_migrations`, not `auth.schema_migrations`
2. Types created without schema prefix (e.g., `factor_type`) went to `public` instead of `auth`
3. Later migrations referencing `auth.factor_type` failed

**Fix:** Added `options=-c search_path=auth,public` to `DATABASE_URL` in Secrets Manager. This ensures types without a schema prefix are created in `auth`. All 54 migrations applied successfully.

## Kong Gateway Fix

Kong custom image required multiple iterations:
1. **Permission denied on entrypoint** — fixed with `chmod 755` and `COPY --chown=kong:kong`
2. **`sed -i` can't create temp file** — fixed by writing to `/tmp/kong.yml` instead
3. **`docker-start` not a CLI command** — fixed by calling original `/docker-entrypoint.sh`
4. **`name resolution failed` for `auth`/`rest`** — fixed by using `localhost` (ECS awsvpc shares network namespace)
5. **Routes didn't match `/supabase/` prefix** — fixed by updating Kong routes to `/supabase/auth/v1/` and `/supabase/rest/v1/`

## What's Working

- ✅ Backend health endpoint
- ✅ Supabase Auth (GoTrue) — health, signup, login
- ✅ Kong API gateway routing
- ✅ PostgREST running
- ✅ User created and login tested
- ✅ ALB native hostname serving traffic over HTTP
- ✅ No external domain references in code or infrastructure

## What's Not Working / Limitations

- Frontend uses dev mode (Dockerfile.staging) — production build requires CI runner
- HTTP only (no HTTPS) — ACM can't issue certs for `*.elb.amazonaws.com`
- Frontend may be slow on first load (Next.js dev compilation)
- No Route53 custom domain (using native ALB hostname)
