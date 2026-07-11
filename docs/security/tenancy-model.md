# Tenancy Model — Mike OSS Atlas Fork

## Overview

Mike uses a **user-scoped** tenancy model with optional resource sharing.
There is no organization or workspace abstraction — every resource belongs
to a single user, identified by `user_id`.

## Entity Model

### User
- Primary identity: Supabase Auth user (`auth.users.id`, UUID).
- Profile: `user_profiles` table (1:1 with `auth.users`).
- `user_id` in resource tables is `text` (cast from UUID string).
- `user_profiles.user_id` is `uuid` (direct FK to `auth.users`).

### Resource Ownership

Every private resource has a `user_id` column identifying the owner:

| Table | user_id type | Sharing |
|---|---|---|
| `projects` | text | `shared_with` JSONB (email array) |
| `project_subfolders` | text | Via parent project |
| `documents` | text | Via parent project |
| `document_versions` | — | Via parent document |
| `document_edits` | — | Via parent document |
| `chats` | text | Via parent project |
| `chat_messages` | — | Via parent chat |
| `workflows` | text | `workflow_shares` table |
| `hidden_workflows` | text | None (private) |
| `workflow_shares` | — | Owner-only management |
| `tabular_reviews` | text | `shared_with` JSONB + via project |
| `tabular_cells` | — | Via parent review |
| `tabular_review_chats` | text | Via parent review |
| `tabular_review_chat_messages` | — | Via parent review chat |
| `user_api_keys` | uuid | None (private) |
| `user_mcp_connectors` | uuid | None (private) |
| `user_profiles` | uuid | None (private) |

### Roles

The current model does **not** have a role system (ADMIN/MEMBER/AUDITOR).
All authenticated users have the same capabilities, scoped to their own data.

**Atlas enhancement roadmap**: Add `role` column to `user_profiles` and
enforce role-based access in Sprint 9 (Atlas Access Governance).

## Access Control Architecture

### Layer 1: Database — Table Privilege Revocation

ALL table privileges are revoked from `anon` and `authenticated` roles:
```sql
revoke all on public.user_profiles from anon, authenticated;
-- ... for every table
```

This means the frontend **cannot** access any table directly. All data
access goes through the backend API.

### Layer 2: Database — Row Level Security (RLS)

RLS is enabled on **all 25 tables**. Policies ensure that even if the
`authenticated` role were granted privileges, users could only access
their own rows.

The backend uses the `service_role` key, which **bypasses RLS**. This
makes RLS a defense-in-depth measure, not the primary access control.

Migration: `backend/migrations/20260710_01_rls_all_tables.sql`

### Layer 3: Backend — JWT Verification

The `requireAuth` middleware:
1. Extracts the Bearer token from the Authorization header.
2. Verifies the JWT via `admin.auth.getUser(token)`.
3. Sets `res.locals.userId`, `res.locals.userEmail`, `res.locals.token`.
4. Optionally enforces MFA (`requireMfaIfEnrolled`).

Applied at the router level on **all 9 route files**.

### Layer 4: Backend — Resource Access Checks

Centralized in `backend/src/lib/access.ts`:

- `checkProjectAccess(projectId, userId, userEmail, db)` — owner or shared.
- `ensureDocAccess(doc, userId, userEmail, db)` — owner or shared project.
- `ensureReviewAccess(review, userId, userEmail, db)` — owner or shared.
- `filterAccessibleDocumentIds(ids, userId, userEmail, db)` — batch filter.
- `listAccessibleProjectIds(userId, userEmail, db)` — own + shared.

Workflows have their own `resolveWorkflowAccess()` in `routes/workflows.ts`
with equivalent logic.

### Layer 5: Backend — Query Scoping

Every database query filters by `user_id` from `res.locals`:
```typescript
db.from("projects").select("*").eq("user_id", userId);
```

Routes that accept resource IDs verify ownership before returning data.

## Service-Role Key Policy

The `SUPABASE_SECRET_KEY` (service-role key):

1. **Only in backend** — never sent to the frontend, never in `NEXT_PUBLIC_*`.
2. **Never logged** — not in request logs, error responses, or debug output.
3. **Never returned** — not in API responses, health checks, or error details.
4. **Used for**: JWT verification, database access, admin operations.
5. **Bypasses RLS** — this is expected and necessary for backend operations.
6. **Validated at startup** — `env.ts` requires it to be ≥32 chars and not a placeholder.

## Sharing Model

### Projects
- Owner adds emails to `shared_with` JSONB array.
- Shared users can access documents, chats, and subfolders in the project.
- Only the owner can delete, rename, or manage sharing.

### Workflows
- Owner creates `workflow_shares` records with `shared_with_email`.
- Shared users get read or edit access based on `allow_edit` flag.
- Only the owner can delete or manage shares.

### Tabular Reviews
- Owner adds emails to `shared_with` JSONB array.
- Shared users can access cells and chats in the review.
- Reviews can also be shared via their parent project.

## Audit Trail (Roadmap)

Current state: no audit trail table exists.

**Sprint 3 deliverable**: Document the gap. Implementation in Sprint 12
(Observability).

## Known Limitations

1. **No organization/workspace** — sharing is per-resource via email.
2. **No role system** — all users are equal; no admin/member distinction.
3. **No audit trail** — access events are not logged.
4. **No session revocation** — JWTs remain valid until expiry.
5. **user_id type inconsistency** — `uuid` in `user_profiles`, `text` elsewhere.
