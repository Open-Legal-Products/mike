# Mike Atlas — Target State Architecture

> Sprint 0 — recommended production architecture for Atlas internal use.

## 1. Guiding principles

1. **Least privilege** everywhere: IAM roles, security groups, bucket policies, Supabase RLS.
2. **No long-lived AWS access keys**: OIDC from GitHub Actions, ECS Task Roles, IRSA where applicable.
3. **Data residency and classification**: documents in `sa-east-1`, encryption at rest and in transit, no public objects.
4. **Tenant isolation**: organization-scoped access with ADMIN/MEMBER/AUDITOR roles.
5. **Observability by default**: structured logs, metrics, alarms, dashboards.
6. **Rollback-first**: every deploy is reproducible and reversible.
7. **Synthetic data only** until the Security Gate is formally approved.

## 2. Target architecture

```
                                 Internet
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────┐
│  CloudFront distribution (Atlas domain, HTTPS, WAF)              │
│   ──▶ AWS WAF (rate limiting, common rule sets, geo-blocking)     │
│   ──▶ Origin: public ALB / static S3 for Next.js standalone        │
└───────────────────────────────────────────────────────────────┘
                                    │
                    ┌────────────┴────────────┐
                    │                 │
                    ▼                 ▼
        ┌───────────────────┐     ┌───────────────────┐
        │  Next.js frontend      │     │  Express backend       │
        │  ECS Fargate service   │     │  ECS Fargate service   │
        │  (standalone output)   │     │  (LibreOffice in image) │
        └───────────────────┘     └───────────────────┘
                    │                 │
                    │                 ──▶ Supabase managed (Auth + Postgres)
                    │                 ──▶ Amazon S3 (private documents, KMS)
                    │                 ──▶ Amazon SES (email)
                    │                 ──▶ Secrets Manager
                    │                 ──▶ CloudWatch / X-Ray / SNS
                    │
                    ──▶ Route 53 + ACM (TLS)

```

## 3. Component choices

| Layer | Target | Rationale |
|-------|--------|-----------|
| Compute | ECS Fargate (frontend + backend) | Serverless containers, no EC2 patching, easy auto-scaling |
| Reverse proxy / WAF | CloudFront + AWS WAF | DDoS protection, geographic control, TLS termination |
| DNS / TLS | Route 53 + ACM | Managed certificates, automatic renewal |
| Ingress | ALB (public for frontend, public/private for backend) | Health checks, target groups, SSL |
| Database / Auth | Supabase managed (initial phase) | Avoids refactoring auth stack; keeps upstream compatibility |
| Object storage | Amazon S3 private + SSE-KMS | Native IAM integration, lifecycle, logging, versioning |
| Secrets | AWS Secrets Manager | Rotation, fine-grained IAM, no env leakage |
| Images | Amazon ECR | Vulnerability scanning, immutable tags |
| Email | Amazon SES | Replaces Resend; compliant with Atlas domains |
| Logs / metrics | CloudWatch Logs, CloudWatch Metrics, X-Ray | Central observability |
| Alerts | CloudWatch Alarms → SNS | PagerDuty/Slack integration later |
| IaC | Terraform | Reproducible, reviewable, drift-detectable |
| CI/CD | GitHub Actions + OIDC | No long-lived AWS credentials |

## 4. Storage target design

- **Abstraction layer** in backend: `putObject`, `getObject`, `deleteObject`, `headObject`, `getSignedDownloadUrl`.
- **S3 default credential provider chain** in production (IAM Task Role).
- **MinIO endpoint + keys** configurable for local development.
- **Object keys** use UUIDs only: `documents/{orgId}/{projectId}/{docId}/{versionId}.{ext}`.
- **SSE-KMS** with customer-managed key.
- **Bucket policy** denies all public access; Block Public Access enabled.
- **Lifecycle**: abort incomplete multipart uploads, transition old versions, soft-delete / purge workflow.
- **Access logging** and **S3 inventory** enabled.

## 5. Security target design

- **Signup disabled** in production; invite-only or SSO.
- **MFA mandatory** for ADMIN role.
- **Organization-scoped RBAC**: ADMIN, MEMBER, AUDITOR.
- **RLS enabled on all tenant tables** as defense-in-depth, even though Express enforces authz.
- **Row-level audit trail**: login, logout, upload, download, delete, provider-key changes, admin actions.
- **Document pipeline hardening**: MIME + magic-byte validation, antivirus scan, quarantine bucket, macro blocking, conversion sandbox with CPU/memory/time limits.
- **AI governance**: provider allowlist, per-user/org budgets, token/cost logging, no prompt storage in default logs.
- **CSP hardened** for frontend; `rehype-raw` and `dangerouslySetInnerHTML` audited.
- **Download tokens** gain expiry and one-time-use option.

## 6. Observability target design

- JSON logs with `timestamp`, `severity`, `service`, `environment`, `trace_id`, `request_id`, `user_id_pseudonym`, `status_code`, `duration`.
- Explicit prohibition on logging tokens, cookies, API keys, document content, prompts, completions, full signed URLs.
- Metrics: requests, errors, latency, CPU/memory, restarts, uploads, conversions, AI failures/tokens/cost.
- Alarms: unhealthy tasks, 5xx rate, latency p99, memory pressure, storage errors, elevated login failures, AI cost anomalies, backup failures.
- Runbooks for rollback, DB restore, object recovery, provider outage, Supabase outage.

## 7. Deployment target design

1. PR merged to `main`.
2. GitHub Actions: install, lint, typecheck, test, build, security scans, Terraform validate/plan.
3. Build and push image tagged with `git-SHA`, `branch`, `timestamp` (no `latest`).
4. Run migrations in pre-deploy job.
5. ECS blue/green or rolling update with health checks.
6. Automated smoke tests; auto-rollback on failure.
7. Production deploy requires explicit go-ahead after Security Gate.

## 8. Cost-conscious defaults

| Environment | Notes |
|-------------|-------|
| Local | MinIO, local/CLI Supabase, synthetic fixtures |
| Staging | Single-task Fargate spots where possible, small RDS-less Supabase project |
| Production | Multi-AZ, multi-task, reserved capacity evaluated after pilot |

## 9. Phased compliance

- **Sprint 0–3**: harden authz/tenancy, tests, CI.
- **Sprint 4–7**: S3, containers, Terraform foundation, Supabase migration control.
- **Sprint 8–14**: staging, access governance, AI governance, document security, observability, branding, security gate.
- **Sprint 15–16**: production launch + QA stabilization.
- **Sprint 17+**: upstream sync, continuous operation.
