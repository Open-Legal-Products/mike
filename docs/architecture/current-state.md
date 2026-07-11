# Mike Atlas — Current State Architecture

> Sprint 0 diagnostic baseline. Generated from fork `Edu-Carone-SA/mike` at upstream SHA `e32daad5a4c64a5561e04c53ee12411e3c5e7238`.

## 1. What Mike is

Mike is an open-source legal document assistant:
- **Frontend**: Next.js 16 (React 19) web app.
- **Backend**: Express 4 API in TypeScript.
- **Auth & database**: Supabase Auth + Postgres.
- **Object storage**: S3-compatible (currently hardcoded to Cloudflare R2 SDK conventions).
- **AI providers**: Anthropic, Google Gemini, OpenAI, OpenRouter.
- **Email**: Resend.
- **Document conversion**: LibreOffice (soffice) via `libreoffice-convert`.
- **Optional legal research**: CourtListener (US case law).

## 2. Repository footprint

```
286 files
~53 kLOC (excl. node_modules / SQL migrations)
Backend: 83 TypeScript files, ~19 kLOC
Frontend: 133 TSX files, ~31 kLOC
SQL: 42 files (schema + migrations), ~1.9 kLOC
```

## 3. Runtime architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         End user browser                         │
│  Next.js frontend (localhost:3000 / Atlas domain)                │
│  ──▶ Supabase Auth (anon key)                                    │
│  ──▶ Mike API (Bearer JWT)                                       │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                     Express backend (Node 20+)                   │
│  ──▶ Supabase service-role key (Postgres + Auth admin)           │
│  ──▶ R2 / S3-compatible storage (access key + secret)            │
│  ──▶ Anthropic / Gemini / OpenAI / OpenRouter API keys           │
│  ──▶ Resend (transactional email)                                │
│  ──▶ CourtListener (optional)                                    │
│  ──▶ LibreOffice subprocess (DOC/DOCX/PPTX → PDF)                │
└─────────────────────────────────────────────────────────────────┘
```

## 4. Environment variables

### Backend (`backend/.env`)

| Variable | Sensitivity | Purpose |
|----------|-------------|---------|
| `PORT` | low | API port |
| `FRONTEND_URL` | low | CORS origin |
| `DOWNLOAD_SIGNING_SECRET` | **high** | HMAC key for `/download/:token` |
| `SUPABASE_URL` | medium | Supabase project URL |
| `SUPABASE_SECRET_KEY` | **high** | Service-role key (bypasses RLS) |
| `R2_ENDPOINT_URL` | medium | S3-compatible endpoint |
| `R2_ACCESS_KEY_ID` | **high** | Storage access key |
| `R2_SECRET_ACCESS_KEY` | **high** | Storage secret |
| `R2_BUCKET_NAME` | low | Bucket name |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | **high** | Provider keys |
| `RESEND_API_KEY` | **high** | Email API key |
| `USER_API_KEYS_ENCRYPTION_SECRET` | **high** | AES-256-GCM master key for per-user provider keys |
| `COURTLISTENER_API_TOKEN` | **high** | Optional US case-law token |
| `LOG_RAW_LLM_STREAM` / `RAW_LLM_STREAM_LOG_DIR` | **high** | Can log full prompts/responses |
| `MCP_*` secrets | **high** | MCP connector OAuth/encryption |

### Frontend (`frontend/.env.local`)

| Variable | Sensitivity | Purpose |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | low (public) | Supabase URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | low (public) | Supabase anon/public key |
| `NEXT_PUBLIC_API_BASE_URL` | low (public) | API base URL |

Only `NEXT_PUBLIC_*` variables reach the browser bundle. No secrets were found in the frontend env template.

## 5. Backend routes (mounted under `/`)

| Router | Base path | Auth | Notes |
|--------|-----------|------|-------|
| `health` | `GET /health` | none | Liveness only; no readiness probe |
| `chatRouter` | `/chat` | `requireAuth` | Chat CRUD, streaming, title generation |
| `projectsRouter` | `/projects` | `requireAuth` | Projects, folders, documents, chats, copy |
| `projectChatRouter` | `/projects/:projectId/chat` | `requireAuth` | Project-scoped chat |
| `documentsRouter` | `/single-documents` | `requireAuth` | Single-document upload, display, versions, download-zip, docx |
| `tabularRouter` | `/tabular-review` | `requireAuth` | Tabular reviews, cells, generation, chat |
| `workflowsRouter` | `/workflows` | `requireAuth` | Workflows, shares, open-source submissions |
| `userRouter` | `/user`, `/users` | `requireAuth` except `/mcp-connectors/oauth/callback` | Profile, API keys, MCP connectors, exports, data deletion |
| `downloadsRouter` | `/download/:token` | `requireAuth` | HMAC-signed download links |
| `caseLawRouter` | `/case-law` | **none on `/case-law/case-opinions`** | US case-law lookup |

**Notable gaps**
- `/case-law/case-opinions` is **unauthenticated**.
- No `/ready` readiness endpoint.
- Rate-limit values are configurable but `jsonLimitForPath()` returns a constant `50mb` regardless of path.
- CORS allows a single origin; no separate handling for preflight in high-risk routes beyond `OPTIONS` skip.

## 6. Database schema (23 tables, 5 RPC overview functions)

Tables:
1. `public.user_profiles`
2. `public.user_api_keys`
3. `public.user_mcp_connectors`
4. `public.user_mcp_oauth_tokens`
5. `public.user_mcp_oauth_states`
6. `public.user_mcp_connector_tools`
7. `public.user_mcp_tool_audit_logs`
8. `public.projects`
9. `public.project_subfolders`
10. `public.documents`
11. `public.document_versions`
12. `public.document_edits`
13. `public.workflows`
14. `public.hidden_workflows`
15. `public.workflow_shares`
16. `public.chats`
17. `public.chat_messages`
18. `public.tabular_reviews`
19. `public.tabular_cells`
20. `public.tabular_review_chats`
21. `public.tabular_review_chat_messages`
22. `public.courtlistener_citation_index`
23. `public.courtlistener_opinion_cluster_index`

Functions:
- `handle_new_user()`
- `get_workflows_overview(...)`
- `get_chats_overview(...)`
- `get_projects_overview(...)`
- `get_tabular_reviews_overview(...)`

RLS is **enabled only on**:
- `user_api_keys`
- `user_mcp_connectors`
- `user_mcp_oauth_tokens`
- `user_mcp_oauth_states`
- `user_mcp_connector_tools`
- `user_mcp_tool_audit_logs`

Core data tables (`projects`, `documents`, `document_versions`, `chats`, `chat_messages`, `tabular_reviews`, `tabular_cells`, etc.) **do not have RLS enabled**. Authorization is enforced entirely in Express middleware/helpers.

## 7. Authentication flow

1. Browser authenticates with Supabase Auth (anon key).
2. JWT access token is sent to backend as `Authorization: Bearer <token>`.
3. `requireAuth` creates a fresh Supabase admin client with the service-role key and calls `admin.auth.getUser(token)`.
4. On success, `res.locals.userId`, `userEmail`, `token` are set.
5. `enforceLoginMfaIfEnabled` checks `user_profiles.mfa_on_login` and demands AAL2 if enabled.

**Concerns**
- A new admin Supabase client is created on every authenticated request.
- Service-role key is used for every auth verification; never exposed to frontend.
- No caching of JWT validation.

## 8. Authorization model

Current model is **user-scoped with email-based project sharing**:
- A project has a `user_id` owner and a `shared_with` JSONB email list.
- `access.ts` centralizes `checkProjectAccess`, `ensureDocAccess`, `ensureReviewAccess`, `filterAccessibleDocumentIds`, `listAccessibleProjectIds`.
- There is **no organization or workspace entity**, and **no role-based matrix** beyond owner/shared-with.

For Atlas internal use this must be hardened into an organization-scoped model with roles (ADMIN / MEMBER / AUDITOR).

## 9. Document lifecycle

1. Upload via `POST /single-documents` or `POST /projects/:projectId/documents`.
2. Multer loads file into memory (max 100 MB, single file).
3. Extension checked against `ALLOWED_DOCUMENT_TYPES` (pdf, docx, doc, xlsx, xlsm, xls, pptx, ppt).
4. Document row + version row created.
5. Source bytes uploaded to storage under `documents/{userId}/{docId}/source.{ext}`.
6. Office docs/PPTX converted to PDF via LibreOffice and stored under `converted-pdfs/{userId}/{docId}.pdf`.
7. Display routes stream bytes from storage.
8. Download uses HMAC-signed `/download/:token` links (non-expiring).
9. Deletion removes storage objects then DB rows; soft-delete columns exist on `document_versions` (`deleted_at`, `deleted_by`) but delete route appears to hard-delete.

**Gaps**
- No MIME-type or magic-byte validation.
- No antivirus / sandboxing.
- No quarantine stage.
- Macro-enabled formats (`xlsm`, `doc`, `ppt`) are accepted.
- No explicit timeout on LibreOffice conversion.
- No verification that storage delete succeeded.

## 10. AI / LLM integration

- Provider keys can be global (env) or per-user (encrypted in `user_api_keys`).
- `USER_API_KEYS_ENCRYPTION_SECRET` derives a 32-byte key via `crypto.scryptSync(secret, "mike-user-api-keys-v1", 32)` using a fixed salt.
- Supports Anthropic, Gemini, OpenAI, OpenRouter.
- `LOG_RAW_LLM_STREAM` + `RAW_LLM_STREAM_LOG_DIR` can write full prompts and completions to disk/console.

## 11. Current build / quality gates

| Gate | Status |
|------|--------|
| `npm run build --prefix backend` | exists (`tsc`) |
| `npm run build --prefix frontend` | exists (`next build`) |
| `npm run lint --prefix frontend` | exists (`eslint`) |
| `npm run lint --prefix backend` | **missing** |
| `npm run typecheck` | **missing** (relies on `tsc`) |
| `npm run test` | **missing** |
| `npm run test:unit` | **missing** |
| `npm run test:integration` | **missing** |
| CI workflows | **none present** |
| `.nvmrc` | **missing** |
| `engines` in package.json | **missing** |

Both `package-lock.json` and `bun.lock` exist in each app, creating ambiguity.

## 12. Dependency audit summary

| App | Components | High | Moderate | Low |
|-----|-----------|------|----------|-----|
| Backend | 402 | 5 | 7 | 1 |
| Frontend | 1233 | 7 | 14 | 2 |

Notable high-severity findings:
- `tmp` path traversal (backend & frontend).
- `protobufjs` code injection / DoS (backend via `@google/genai`).
- `ws` memory exhaustion / uninitialized memory (both).
- `undici` TLS bypass, header injection, DoS (frontend).
- `fast-xml-builder` / `xmldom` XML injection (backend).

Full SBOMs: `artifacts/sbom-backend.json`, `artifacts/sbom-frontend.json`.
