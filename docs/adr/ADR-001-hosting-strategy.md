# ADR-001 — Hosting Strategy for Mike Atlas

## Status

Proposed — pending Sprint 0 acceptance.

## Context

Mike is a Next.js + Express application that needs to run inside Atlas infrastructure with hardening, observability, and LGPD compliance.

## Decision

Use **Option A** for the first production deployment:

- Frontend: Next.js standalone in ECS Fargate.
- Backend: Express in ECS Fargate (LibreOffice included in image).
- Database / Auth: **Supabase managed**.
- Storage: Amazon S3 private with SSE-KMS.
- CDN/WAF: CloudFront + AWS WAF.
- DNS/TLS: Route 53 + ACM.
- Secrets: AWS Secrets Manager.
- Images: Amazon ECR.
- Observability: CloudWatch + X-Ray.
- Alerts: CloudWatch Alarms → SNS.
- Email: Amazon SES.
- IaC: Terraform.
- CI/CD: GitHub Actions with AWS OIDC.

## Rationale

- Lower delivery risk and operational surface.
- Preserves upstream compatibility.
- Avoids a large auth/database refactor in the first cycle.
- S3-compatible SDK in Mike makes R2 → S3 migration straightforward.

## Consequences

- Supabase remains a critical external dependency; its availability and data residency must be contractually verified.
- Self-hosting Supabase (Option B) or replacing it (Option C) are explicitly deferred to a later phase.

## Related

- ADR-002 (Supabase strategy)
- ADR-003 (Storage strategy)
