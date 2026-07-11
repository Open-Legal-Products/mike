# ADR-003 — Document Storage Strategy for Mike Atlas

## Status

Proposed — pending Sprint 0 acceptance.

## Context

Upstream Mike uses Cloudflare R2 via the AWS SDK with hardcoded access-key credentials. Atlas requires private, encrypted, IAM-controlled storage.

## Decision

Replace R2 with **Amazon S3** in production, while keeping MinIO for local development.

- Abstract storage behind `putObject`, `getObject`, `deleteObject`, `headObject`, `getSignedDownloadUrl`.
- Production uses default AWS credential provider chain (ECS Task Role).
- Local/MinIO uses explicit endpoint + keys.
- Object keys use `documents/{orgId}/{projectId}/{docId}/{versionId}.{ext}`.
- SSE-KMS with customer-managed key.
- Block Public Access, access logging, lifecycle rules, versioning per policy.
- Short-lived signed URLs (default 5 minutes, max 15 minutes).

## Rationale

- S3 integrates natively with IAM, KMS, CloudTrail, and Terraform.
- AWS SDK compatibility means minimal code change.
- MinIO preserves local reproducibility.

## Consequences

- Need to rewrite `backend/src/lib/storage.ts` and remove R2-specific naming.
- Need to handle S3 multipart uploads and lifecycle.
- Need to migrate any existing R2 data if applicable (not relevant for green-field Atlas deployment).

## Related

- ADR-001 (Hosting strategy)
