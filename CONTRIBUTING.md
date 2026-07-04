# Contributing to Mike

Thanks for helping improve Mike. This is the contributor guide: it gives a
**technical overview of the codebase**, then covers **local development** and
**how to get a change merged**. For setup, features, and configuration, see the
[README](README.md).

- [Codebase overview](#codebase-overview) — how to read the repo
- [Local development](#local-development) — running, testing, building
- [How to contribute](#how-to-contribute) — guidelines, PRs, commit style
- [Security](#security)

---

## Codebase overview

> A cheat-sheet for reading, explaining, and defending the codebase. The repo is
> large because it is a full product, not because it is dense — once you learn
> the handful of patterns below, ~85k lines collapses into "the same shapes,
> repeated." For the layered design rationale see [`docs/architecture.md`](docs/architecture.md).

### The 30-second map

```
apps/api/   ~41k LOC   Express API — one module per feature, one shared lib/ underneath
apps/web/   ~43k LOC   Next.js App Router — one route per page, container hooks + presenters
packages/   ~3k  LOC   Shared code (types, HTTP client, design system, SDK surface)
```

The line count tracks **feature count**, not complexity. Each API module is a
self-contained feature (documents, chat, tabular reviews, workflows, case-law,
orgs, users); each web route is one screen over that API. Nothing here is
framework glue — it is all product surface.

Full project layout:

```
apps/api/              Express API — routes, LLM adapters, document processing, Supabase access
apps/web/              Next.js frontend
word-addin/            Microsoft Word task-pane add-in (Office.js)
packages/core/         Shared types and utilities (no framework dependencies)
packages/api-client/   Typed HTTP client for the Mike API (used by web + add-in)
packages/shared/       Shared design system (web + Word add-in)
packages/sdk-js/       JS SDK surface (license status: see docs/LICENSING.md)
sdks/python/           Python client SDK (MIT)
airgapped/             Turnkey air-gapped self-hosting (compose profile + operator scripts)
evals/                 Offline LLM eval harness (exit-code gated)
supabase/migrations/   Incremental database migrations
schemas/               JSON Schemas for portable formats — generated, do not edit (see docs/EXTENDING.md)
docs/                  Architecture, API, workflow, extending, and safe-local-testing guides
```

### The API module pattern (learn one, know all of them)

Every feature lives under `apps/api/src/modules/<feature>/` and reads the same
way. Learn `documents/` or `projects/` once and the other modules follow:

| File | Present in | Responsibility |
|---|---|---|
| `*.routes.ts` | every module | **Thin HTTP layer.** Parses the request, calls the service, maps typed results → status codes. No business logic. |
| `*.service.ts` | every module with real logic (a few thin ones — `auth`, `downloads`, `case-law` — are routes-only) | **Business logic + data access.** Takes an explicit Supabase client (`db`) + request-derived primitives; returns values or typed `{ ok: false, kind }` results. Never touches `req`/`res`. |
| `*.access.ts` / `*.shared.ts` | where the module needs them | Module-local authorization and shared helpers. Cross-module authorization primitives live in `lib/access.ts`. |

Larger modules split the service by concern rather than growing one file — e.g.
`projects/` is `projects.crud.ts`, `projects.documents.ts`, `projects.folders.ts`,
`projects.chats.ts`, and `projects.shared.ts`, re-exported through
`projects.service.ts` as a single import surface. Same pattern, more files.

### Request lifecycle (a worked example)

A document upload, end to end — the path every write request follows:

```
POST /projects/:projectId/documents
  → middleware/auth.ts          requireAuth: verify Supabase JWT → req.user
  → projects.routes.ts          validate file (extension + magic bytes), call service
  → ensureProjectUploadAccess   projects.documents.ts: check caller may write here
  → processProjectDocumentUpload
        lib/storage.ts          upload original to S3-compatible storage
        lib/convert.ts          DOCX → PDF rendition for display
        lib/pdfjs.ts            count pages
        db.documents / db.document_versions   insert rows, point current_version_id
  → route maps { ok: true, doc } → 201 JSON   (or { ok:false, kind } → 4xx/5xx)
```

Read requests are the same minus the storage writes. The invariant everywhere:
**routes decide HTTP, services decide behaviour, `lib/` does the heavy lifting.**

### Cross-cutting subsystems (`apps/api/src/lib/`)

Modules stay small by composing shared subsystems instead of re-implementing them:

| Area | What it does |
|---|---|
| `llm/` | Provider-agnostic LLM adapter (Anthropic / Gemini / OpenAI), streaming, tool-calling |
| `storage/`, `storage.ts` | S3-compatible object storage adapter (R2 / GCS / MinIO) |
| `rag/` | Retrieval over document text for chat context |
| `mcp/` | Model Context Protocol connectors + OAuth |
| `courtlistener.ts`, `legalSourcesTools/` | Case-law search / retrieval |
| `access.ts` | Shared authorization primitives (org roles, project access) |
| `queue/`, `workers/` | Background jobs (BullMQ) — see [`docs/async-jobs.md`](docs/async-jobs.md) |
| `observability/`, `logger.ts` | OpenTelemetry + Pino structured logging |

### The web app (`apps/web/src/app/`)

Standard Next.js App Router. Routes live under `(pages)/`; shared UI under
`components/`; data-fetching hooks under `hooks/`.

The pattern that keeps screens readable is **container/presenter**:

- **Presenter** — a `*.tsx` component that is (almost) pure JSX. It receives
  state + callbacks and renders them. Example: `ProjectDocumentsView.tsx`.
- **Controller hook** — a `use*.ts` hook holding all the state and handlers
  (optimistic updates, drag-and-drop, uploads). Example:
  `project-documents/useProjectDocumentsController.ts`.

Similarly the assistant chat is split into `useAssistantChat.ts` (request
orchestration), `useAssistantEvents.ts` (the streaming event buffer), and
`applyAssistantStreamEvent.ts` (a flat SSE dispatch table). When a component
looks big, its logic has usually been lifted into a sibling hook — read the hook
for behaviour, the component for layout.

### Where does feature X live?

| Feature | API | Web |
|---|---|---|
| Projects & documents | `modules/projects`, `modules/documents` | `components/projects` |
| Assistant chat | `modules/chat`, `modules/project-chat` | `components/assistant`, `hooks/useAssistantChat.ts` |
| Tabular reviews | `modules/tabular` | `components/tabular` |
| Workflows | `modules/workflows` | `components/workflows`, `(pages)/workflows` |
| Case law | `modules/case-law`, `lib/courtlistener.ts` | rendered inline in assistant messages |
| MCP connectors | `lib/mcp` | `(pages)/account/connectors` |
| Orgs & billing | `modules/orgs`, `modules/user` | `(pages)/account` |

### How to read it without being overwhelmed

1. `apps/api/src/app.ts` + `index.ts` — the wiring. This is your map.
2. One vertical slice: `modules/documents/` routes → service → access. Trace a
   single request through and the pattern repeats for all eleven modules.
3. `lib/` — read subsystems on demand as a slice pulls them in.
4. Web: `app/layout.tsx` → one `(pages)/` route → its presenter → its controller hook.

Internalize the module pattern **once** and most of the API becomes "the same
four-file shape, eleven times." That is the whole trick to holding this codebase
in your head.

### Extending Mike

Common customizations — LLM providers, storage backends, embedding providers,
LLM tools, law libraries, API-key providers — are registry-based: implement an
interface, call a register function at startup, no core edits.
[`docs/EXTENDING.md`](docs/EXTENDING.md) is the complete catalog with worked
examples.

---

## Local development

Install workspace dependencies (see the [README Quick Start](README.md#quick-start)
for first-time service/database setup):

```bash
npm install
```

Root scripts fan out across all workspaces (`apps/api`, `apps/web`, `packages/*`):

```bash
npm run typecheck   # tsc --noEmit in every workspace
npm run lint        # ESLint in every workspace (api includes eslint-plugin-security)
npm test            # all workspace unit/integration suites
npm run build       # build every workspace
```

Run a single app's checks with `--prefix`:

```bash
npm test  --prefix apps/api           # unit + integration
npm run test:watch     --prefix apps/api
npm run test:coverage  --prefix apps/api
npm run lint  --prefix apps/web
npm run build --prefix apps/web
```

### Verifying the whole repo

The default `--workspaces` scripts do **not** cover the Word add-in (a standalone
npm project) or the Python SDK (`sdks/python`, not a Node project). Two aggregate
scripts exercise every project:

```bash
npm run test:all      # workspace tests + Word add-in build + Python SDK test note
npm run verify:all    # lint + typecheck + build across everything, then test:all — the pre-release gate
```

The Python SDK is not an npm project, so `test:all` prints its command rather than
running it; run it directly when working on the SDK:

```bash
cd sdks/python && pip install -e '.[dev]' && pytest
```

### Stack integration tests

Most API tests mock Supabase. A separate, **gated** suite exercises the real stack
(GoTrue auth + Postgres RLS + the credit RPC) — the auth↔API contract, the deny-all
RLS firewall, and cross-tenant isolation. It is skipped in the default unit run and
is the harness to re-run on **every Supabase version bump**:

```bash
supabase start                      # once, in the repo
cd apps/api && npm run test:stack   # auto-reads keys from `supabase status`
```

---

## How to contribute

Keep contributions small, focused, and easy to review.

### Guidelines

- Prefer targeted edits over broad refactors.
- Keep each PR focused on one bug, feature, or cleanup.
- Update docs or env examples when changing setup, config, or user-facing behavior.
- Please do not propose local-hosting refactors for the main app, such as local LLMs, local databases, or local filesystem storage. Those ideas are better suited to a future fully local version of the project.
- Do not commit secrets, API keys, private documents, or local `.env` files.

### Before opening a PR

- Run the relevant build or test command for the area you changed.
- Check `git diff` and remove unrelated changes.
- Write a concise Markdown PR description with: summary, changes, why, testing.

### Commit messages

Commits follow a simple, consistent convention. Browse `git log --oneline` for
many worked examples.

- **Subject: `type(scope): description`.** Use an imperative, present-tense
  description ("add", "fix", "extract" — not "added" or "fixes"). Keep it under
  ~72 characters and don't end it with a period.
- **`type`** is the kind of change: `feat`, `fix`, `refactor`, `perf`, `test`,
  `docs`, `chore`, `ci`, `build`, `a11y`, and `security` for hardening work.
- **`scope`** is the area touched: `api`, `web`, `db`, `word-addin`, `e2e`,
  `merge`, etc. Omit it only when the change is genuinely repo-wide.
- **Body explains the _why_.** Describe the motivation, the tradeoffs you
  weighed, and how you verified the change — not a restatement of the diff.
  Wrap the body at ~72 columns.

Example:

```
fix(security): make prompt-injection spotlighting unforgeable

The old fence used a static tag an attacker could reproduce inside
document text. Bind the open/close tags to a per-request nonce so
injected content can't spoof the boundary. Verified with the new
route test that feeds a crafted document.
```

---

## System Workflows

System workflows live in `workflows/`. Update `metadata.json` for structured
metadata like author, language, version, practice area, or jurisdictions,
update `SKILL.md` for workflow instructions, and use `table-config.json` for
tabular review columns.

After changing system workflows, regenerate the app files:

```bash
node scripts/build-workflows.js
```

## Security

Do not open a public issue for security vulnerabilities. Use GitHub's private vulnerability reporting **on this repository** — see [SECURITY.md](SECURITY.md) for the full policy. (Do not report fork issues to the upstream `willchen96/mike` tracker.)

We aim to respond promptly and coordinate a disclosure timeline with you. For the threat model and access-control posture, see [`docs/SECURITY-MODEL.md`](docs/SECURITY-MODEL.md).
