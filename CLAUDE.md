# CLAUDE.md — JessicaOS

> Project constitution. Read fully before any work. Rules here override task instructions.

## What this project is

**JessicaOS** is the UK localisation of [Mike](https://github.com/willchen96/mike) (MikeOS), the open-source AI legal platform. Fork lineage and AGPL-3.0 licence are preserved and celebrated, not hidden.

Mission: the first *substantive* UK version — real UK data integrations, UK legal workflows, verified citations, and an optional fully on-premises open-weights model mode. Built by the COO of Aria Grace Law and piloted with real solicitors.

**Naming rationale:** Mike worked for Harvey. They both worked for Jessica.

## Architecture (verified against code, Phase 0)

Two independent npm projects, no shared workspace. Frontend calls backend over HTTP; browser never touches the DB directly (all client grants revoked in `backend/schema.sql:792-823`).

- **Frontend**: Next.js 16 App Router (TypeScript, React 19, Tailwind 4) in `frontend/`. Deploy target Cloudflare Workers via `@opennextjs/cloudflare`. Auth is Supabase JS on the client (JWT + optional TOTP MFA).
- **Backend**: Express 4 (TypeScript, tsx in dev, tsc→node in prod) in `backend/`. Single entry `backend/src/index.ts` (helmet, CORS from `FRONTEND_URL`, per-route rate limits).
- **DB**: Supabase Postgres. Canonical schema `backend/schema.sql`; dated migrations in `backend/migrations/` (protected — see hard rule 1). Backend uses the service-role key only.
- **Storage**: Cloudflare R2 / S3-compatible (`backend/src/lib/storage.ts`), HMAC-signed download tokens (`downloadTokens.ts`), DOCX→PDF via LibreOffice (`convert.ts`).
- **Model providers**: `backend/src/lib/llm/` — `models.ts` (registry: Claude / Gemini / OpenAI tiers, provider inferred from model-id prefix), `index.ts` (dispatch), `claude.ts` / `gemini.ts` / `openai.ts` (streaming + tool calls). BYO keys per user, AES-256-GCM encrypted (`userApiKeys.ts`), env keys as fallback.

### Module map (backend)

| Area | Files |
|---|---|
| Routes | `src/routes/`: `chat.ts` (main SSE chat), `projectChat.ts`, `projects.ts`, `documents.ts`, `tabular.ts`, `workflows.ts`, `user.ts` (profile, API keys, MCP connectors, export/delete), `downloads.ts`, `caseLaw.ts` (**CourtListener — to be excised**) |
| Chat engine | `src/lib/chatTools.ts` (~4.6k lines: system prompts, doc context, tool execution loop `runLLMStream`, citation annotation extraction) |
| Legal sources | `src/lib/legalSourcesTools/courtlistenerTools.ts` + `src/lib/courtlistener.ts` (**to be excised**; UK sources land in `legalSourcesTools/` per `docs/MIGRATION_SPEC.md`) |
| Documents | `storage.ts`, `documentVersions.ts`, `docxTrackedChanges.ts`, `convert.ts`, `upload.ts`, `downloadTokens.ts` |
| Users | `userSettings.ts`, `userApiKeys.ts`, `userDataExport.ts`, `userDataCleanup.ts`, `access.ts`, `middleware/auth.ts` |
| MCP | `src/lib/mcp/` (client, oauth, servers) + `mcpConnectors.ts` |
| Seed workflows | `src/lib/builtinWorkflows.ts` (backend, 3 system workflows) and `frontend/src/app/components/workflows/builtinWorkflows.ts` (frontend, 14 templates) |

### Module map (frontend)

- `src/app/(pages)/` — routes: assistant, projects, tabular-reviews, workflows, account (models / features / api-keys / connectors / security / privacy-data); `login`, `signup`, `verify-mfa` at app root.
- `src/app/components/` — `assistant/` (ChatView, AssistantMessage, CaseLawPanel — **CourtListener UI**), `projects/`, `tabular/`, `workflows/`, `shared/`, `modals/`.
- `src/app/lib/mikeApi.ts` — the only backend client (~1.2k lines; base URL `NEXT_PUBLIC_API_BASE_URL`, Supabase JWT bearer auth).
- `src/app/hooks/useAssistantChat.ts` — SSE event parser/state machine for streaming chat.
- Contexts: `AuthContext`, `UserProfileContext` (profile, feature flags, API-key status), `ChatHistoryContext`.

### Request flow (chat)

1. `ChatInput` → `useAssistantChat` → `mikeApi.streamChat()` → `POST /chat` (SSE).
2. `requireAuth` middleware validates Supabase JWT → `chat.ts` builds doc context (`buildDocContext`), loads user model settings + decrypted API keys, assembles system prompt (`buildSystemPrompt` — appends CourtListener research prompt when `legal_research_us` is on).
3. `runLLMStream` (chatTools.ts) → `streamChatWithTools` (llm/index.ts) → provider stream; tool calls (document read/edit, generate_docx, workflow, MCP, legal research) executed server-side, results fed back; every step emitted as an SSE event (`text_delta`, `doc_edited`, `case_citation`, `courtlistener_*`, `mcp_tool_*`…).
4. Assistant message + citation annotations persisted to `chat_messages`; frontend renders events incrementally.

### Env var registry

Backend (`backend/.env.example` documents the core set):

| Var | Required | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | yes | DB + auth admin |
| `DOWNLOAD_SIGNING_SECRET` | yes | HMAC for `/download/:token` |
| `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | yes for uploads | R2 storage (`R2_BUCKET_NAME` optional, default `mike`) |
| `USER_API_KEYS_ENCRYPTION_SECRET` | yes | AES-256-GCM key derivation for BYO keys |
| `ANTHROPIC_API_KEY` (alt `CLAUDE_API_KEY`), `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | optional | provider fallbacks when user has no key |
| `PORT` (3001), `FRONTEND_URL` (CORS), `NODE_ENV`, `TRUST_PROXY_HOPS` | optional | runtime |
| `API_PUBLIC_URL` / `BACKEND_URL` | optional | MCP OAuth callback base |
| `MCP_OAUTH_CLIENT_ID/_SECRET`, `MCP_OAUTH_DEFAULT_SCOPE`, `MCP_CONNECTORS_ENCRYPTION_SECRET` | optional | MCP connectors |
| `RATE_LIMIT_*` (11 vars, `src/index.ts:54-83`) | optional | rate-limit tuning |
| `LOG_RAW_LLM_STREAM`, `RAW_LLM_STREAM_LOG_DIR` | optional | dev-only stream logging |
| `RESEND_API_KEY` | optional | in `.env.example`; SDK installed, currently unused in `src/` |
| `COURTLISTENER_API_TOKEN`, `COURTLISTENER_BULK_DATA_ENABLED` | optional | **US — to be excised** |
| `COMPANIES_HOUSE_API_KEY` | planned | WS1 (see MIGRATION_SPEC) |
| `OPENAI_BASE_URL` (+ local model config) | planned | WS3 local models (see MIGRATION_SPEC) |

Frontend (`frontend/.env.local.example`, all public): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:3001`). No secrets in the frontend, ever.

## UK conventions — apply everywhere

| US (upstream) | UK (this fork) |
|---|---|
| attorney / lawyer | solicitor / counsel (context-dependent) |
| opinion | judgment |
| plaintiff | claimant |
| deposition | (rarely applicable — witness statement / examination) |
| discovery | disclosure |
| motion | application |
| docket | case file / cause list |
| MM/DD/YYYY | DD/MM/YYYY |
| US Bluebook citations | UK neutral citations, e.g. `[2024] UKSC 12`; statutes as `s.994 Companies Act 2006` |
| ZIP code | postcode |
| corporation / Inc. | company / Ltd / plc / LLP |
| US spelling (analyze, license-as-verb-and-noun) | UK spelling (analyse, licence [noun] / license [verb]) |

All user-facing copy, prompts, and workflow templates use UK English and UK legal terminology. When in doubt, ask; do not guess US→UK legal equivalences — some concepts have no equivalent.

## Data integrations

1. **Companies House API** — free, requires API key (`COMPANIES_HOUSE_API_KEY`). Company search, profile, officers, PSCs, filing history.
2. **legislation.gov.uk API** — fully open, no key. Open Government Licence permits computational reuse. Acts + SIs, revised versions. Surface the "outstanding effects / prospective amendments" flags to the user — never hide revision lag.
3. **Find Case Law (The National Archives)** — DEFERRED pending computational-use licence. Do not integrate case-law retrieval yet. Roadmap item; be transparent in README.
4. **HM Land Registry Business Gateway** — DEFERRED (commercial account required). Roadmap item.
5. **BAILII** — NEVER scrape or integrate. Prohibited by their terms.

## Model providers

- Default recommendation: frontier API models (quality hierarchy documented in README eval table).
- Local/open-weights mode: any OpenAI-compatible endpoint via `OPENAI_BASE_URL` (Ollama, LM Studio, vLLM). Positioning = data sovereignty, not cost. Docs must carry honest quality caveats backed by the eval table.
- Never remove or weaken the BYO-key model; never log or persist API keys outside the existing encrypted path.

## Hard rules — violating any of these fails review

1. **NEVER** edit files in `backend/**/migrations/` (or wherever migrations live) without an explicit human instruction naming the file.
2. **NEVER** edit, create, or read `.env`, `.env.*`, or any secrets file. Use `.env.example` for documenting new vars.
3. **NEVER** remove or alter licence headers, `LICENSE`, or upstream copyright/attribution. This fork stays AGPL-3.0.
4. **NEVER** hardcode API keys, company numbers used in tests notwithstanding.
5. Any cited statutory provision or citation produced by product prompts MUST be verifiable against a live API. Unverifiable citation = bug = red build.
6. All work lands via PR from a feature branch. No direct pushes to `main`. Human merges.
7. Do not add dependencies without stating why in the PR description; prefer stdlib/existing deps.
8. Do not "fix" upstream code style wholesale — minimal diffs, so upstream rebases stay cheap.

## Definition of done (per workstream)

- `tsc`, ESLint, Prettier clean on changed files (hook-enforced)
- Unit tests written and passing
- Eval smoke subset passing; no regression on golden set
- UK terminology table respected in all user-facing strings
- PR description: what/why/how-tested, screenshots for UI
- CLAUDE.md and `/docs` updated if behaviour or env vars changed

## Commands

Two separate npm projects — install and run each from its own directory. There is no root workspace; the root `package.json` exists only to expose the eval runners.

```bash
# Backend (Express, port 3001)
cd backend && npm install
npm run dev              # tsx watch src/index.ts
npm run build            # tsc → dist/
npm start                # node dist/index.js
npx tsc --noEmit         # typecheck (no dedicated lint script; prettier is a devDependency)
npx prettier --check src # format check

# Frontend (Next.js, port 3000)
cd frontend && npm install
npm run dev              # next dev
npm run build            # next build
npm run lint             # eslint (flat config)
npx tsc --noEmit         # typecheck

# Evals (from repo root; see evals/README.md)
npm run evals            # full golden set — CI merge gate, includes citation hard gate
npm run evals:smoke      # ≤5 smoke cases — used by the Stop hook
```

**No unit-test framework exists yet** (upstream ships none). Adding one (vitest) is part of the sprint; until then "unit tests passing" in the definition of done applies only where tests exist. Hooks in `.claude/settings.json` enforce typecheck/lint/format on edits, protect migrations/`.env*`/LICENSE, and run `evals:smoke` on Stop.

## Current sprint

See `docs/BUILD_PLAN.md`. Deadline pressure is real (free Fable window ends 7 July); bias to shipping the five v1 workstreams over any refactor not on the critical path.
