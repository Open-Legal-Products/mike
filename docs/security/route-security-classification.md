# Route Security Classification

## Overview

All HTTP routes in the Mike backend are classified by security level.
New routes **must** be classified before being added.

## Classification Levels

| Level | Description | Auth Required | Example |
|---|---|---|---|
| PUBLIC | Intentionally public, no sensitive data | No | `GET /health`, `GET /ready` |
| AUTHENTICATED | Requires valid JWT, user-scoped | Yes | `GET /projects`, `POST /chat` |
| AUTHENTICATED_MFA | Requires JWT + MFA verification | Yes + MFA | `PUT /user/api-keys/:provider` |
| ADMIN | Requires admin role (future) | Yes + role | (not yet implemented) |

## Current Route Inventory

### PUBLIC (2 routes)

| Method | Path | File | Justification |
|---|---|---|---|
| GET | `/health` | `index.ts` | Liveness check, no sensitive data |
| GET | `/ready` | `index.ts` | Readiness check, no sensitive data |

### AUTHENTICATED (88 routes)

All routes below use `requireAuth` at the router level.

#### /chat (7 routes) — `chat.ts`
| Method | Path | Access Check |
|---|---|---|
| GET | `/` | `userId` scope |
| POST | `/create` | `userId` scope |
| GET | `/:chatId` | `ensureDocAccess` via chat ownership |
| PATCH | `/:chatId` | Chat ownership |
| DELETE | `/:chatId` | Chat ownership |
| POST | `/:chatId/generate-title` | Chat ownership |
| POST | `/` | `userId` scope |

#### /projects (15 routes) — `projects.ts`
| Method | Path | Access Check |
|---|---|---|
| GET | `/` | `userId` scope |
| POST | `/` | `userId` scope |
| GET | `/:projectId` | `checkProjectAccess` |
| GET | `/:projectId/people` | `checkProjectAccess` |
| PATCH | `/:projectId` | `checkProjectAccess` (owner) |
| DELETE | `/:projectId` | `checkProjectAccess` (owner) |
| GET | `/:projectId/documents` | `checkProjectAccess` |
| POST | `/:projectId/documents/:documentId` | `checkProjectAccess` |
| PATCH | `/:projectId/documents/:documentId` | `checkProjectAccess` |
| POST | `/:projectId/documents` | `checkProjectAccess` |
| GET | `/:projectId/chats` | `checkProjectAccess` |
| POST | `/:projectId/folders` | `checkProjectAccess` |
| PATCH | `/:projectId/folders/:folderId` | `checkProjectAccess` (owner) |
| DELETE | `/:projectId/folders/:folderId` | `checkProjectAccess` (owner) |
| PATCH | `/:projectId/documents/:documentId/folder` | `checkProjectAccess` |

#### /single-documents (16 routes) — `documents.ts`
| Method | Path | Access Check |
|---|---|---|
| GET | `/` | `userId` scope |
| POST | `/` | `userId` scope |
| DELETE | `/:documentId` | `ensureDocAccess` |
| GET | `/:documentId/display` | `ensureDocAccess` |
| POST | `/download-zip` | `filterAccessibleDocumentIds` |
| GET | `/:documentId/url` | `ensureDocAccess` |
| GET | `/:documentId/docx` | `ensureDocAccess` |
| GET | `/:documentId/versions` | `ensureDocAccess` |
| POST | `/:documentId/versions/from-document` | `ensureDocAccess` |
| POST | `/:documentId/versions` | `ensureDocAccess` |
| PATCH | `/:documentId/versions/:versionId` | `ensureDocAccess` |
| PUT | `/:documentId/versions/:versionId/file` | `ensureDocAccess` |
| DELETE | `/:documentId/versions/:versionId` | `ensureDocAccess` |
| GET | `/:documentId/tracked-change-ids` | `ensureDocAccess` |
| POST | `/:documentId/edits/:editId/accept` | `ensureDocAccess` |
| POST | `/:documentId/edits/:editId/reject` | `ensureDocAccess` |

#### /tabular-review (14 routes) — `tabular.ts`
| Method | Path | Access Check |
|---|---|---|
| GET | `/` | `userId` scope |
| POST | `/` | `userId` scope |
| POST | `/prompt` | `userId` scope |
| GET | `/:reviewId` | `ensureReviewAccess` |
| GET | `/:reviewId/people` | `ensureReviewAccess` |
| PATCH | `/:reviewId` | `ensureReviewAccess` (owner) |
| DELETE | `/:reviewId` | `ensureReviewAccess` (owner) |
| POST | `/:reviewId/clear-cells` | `ensureReviewAccess` |
| POST | `/:reviewId/regenerate-cell` | `ensureReviewAccess` |
| POST | `/:reviewId/generate` | `ensureReviewAccess` |
| GET | `/:reviewId/chats` | `ensureReviewAccess` |
| DELETE | `/:reviewId/chats/:chatId` | `ensureReviewAccess` |
| GET | `/:reviewId/chats/:chatId/messages` | `ensureReviewAccess` |
| POST | `/:reviewId/chat` | `ensureReviewAccess` |

#### /workflows (13 routes) — `workflows.ts`
| Method | Path | Access Check |
|---|---|---|
| GET | `/` | `userId` scope (RPC) |
| POST | `/` | `userId` scope |
| PUT | `/:workflowId` | `resolveWorkflowAccess` |
| PATCH | `/:workflowId` | `resolveWorkflowAccess` |
| DELETE | `/:workflowId` | `.eq("user_id", userId)` |
| GET | `/hidden` | `.eq("user_id", userId)` |
| POST | `/hidden` | `userId` scope |
| DELETE | `/hidden/:workflowId` | `.eq("user_id", userId)` |
| POST | `/:workflowId/open-source` | `.eq("user_id", userId)` |
| GET | `/:workflowId` | `resolveWorkflowAccess` |
| GET | `/:workflowId/shares` | `resolveWorkflowAccess` (owner) |
| DELETE | `/:workflowId/shares/:shareId` | `resolveWorkflowAccess` (owner) |
| POST | `/:workflowId/share` | `resolveWorkflowAccess` (owner) |

#### /user (23 routes) — `user.ts`
| Method | Path | Access Check | MFA |
|---|---|---|---|
| POST | `/profile` | `userId` scope | — |
| GET | `/lookup` | `userId` scope | — |
| GET | `/profile` | `userId` scope | — |
| PATCH | `/profile` | `userId` scope | — |
| PATCH | `/security/mfa-login` | `userId` scope | MFA |
| GET | `/api-keys` | `userId` scope | — |
| PUT | `/api-keys/:provider` | `userId` scope | MFA |
| GET | `/mcp-connectors` | `userId` scope | — |
| GET | `/mcp-connectors/:connectorId` | `userId` + `connectorId` | — |
| POST | `/mcp-connectors` | `userId` scope | MFA |
| PATCH | `/mcp-connectors/:connectorId` | `userId` + `connectorId` | MFA |
| DELETE | `/mcp-connectors/:connectorId` | `userId` + `connectorId` | MFA |
| POST | `/mcp-connectors/:connectorId/oauth/start` | `userId` + `connectorId` | MFA |
| GET | `/mcp-connectors/oauth/callback` | `userId` scope | — |
| POST | `/mcp-connectors/:connectorId/refresh-tools` | `userId` + `connectorId` | MFA |
| PATCH | `/mcp-connectors/:connectorId/tools/:toolId` | `userId` + `connectorId` | MFA |
| DELETE | `/account` | `userId` scope | — |
| DELETE | `/chats` | `userId` scope | — |
| DELETE | `/projects` | `userId` scope | — |
| DELETE | `/tabular-reviews` | `userId` scope | — |
| GET | `/export` | `userId` scope | — |
| GET | `/chats/export` | `userId` scope | — |
| GET | `/tabular-reviews/export` | `userId` scope | — |

#### /download (1 route) — `downloads.ts`
| Method | Path | Access Check |
|---|---|---|
| GET | `/:token` | HMAC token validation + `ensureDocAccess` |

#### /projects/:projectId/chat (1 route) — `projectChat.ts`
| Method | Path | Access Check |
|---|---|---|
| POST | `/` | `checkProjectAccess` |

#### /case-law (1 route) — `caseLaw.ts`
| Method | Path | Access Check |
|---|---|---|
| POST | `/case-opinions` | `requireAuth` (router-level) |

## New Route Checklist

Before adding a new route, verify:

- [ ] Route is classified as PUBLIC, AUTHENTICATED, AUTHENTICATED_MFA, or ADMIN.
- [ ] If AUTHENTICATED: `requireAuth` is applied (router-level or per-route).
- [ ] If AUTHENTICATED_MFA: `requireMfaIfEnrolled` is also applied.
- [ ] If the route accepts a resource ID: ownership/access is verified using
      `checkProjectAccess`, `ensureDocAccess`, `ensureReviewAccess`, or
      equivalent before returning data.
- [ ] Database queries filter by `userId` from `res.locals`.
- [ ] No service-role key is logged or returned.
- [ ] Test coverage includes: positive (owner), negative (no auth), negative
      (different user), and regression test for the behavior being added.

## Sprint 0 P0 Correction

**Sprint 0 identified `GET /case-law/case-opinions` as unauthenticated.**

This was **incorrect**. The route is `POST /case-law/case-opinions` and
`caseLawRouter.use(requireAuth)` is applied at the router level (line 9
of `caseLaw.ts`). The endpoint has always required authentication.

This correction does not diminish the other P0 findings (RLS, AGPL,
LLM logging).
