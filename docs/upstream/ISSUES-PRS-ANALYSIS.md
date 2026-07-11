# Mike Atlas — Upstream Issues & Pull Requests Analysis

> Snapshot taken at baseline date 2026-07-10. Upstream: `Open-Legal-Products/mike`.

## Executive summary

The upstream has **83 open issues** and **38 open pull requests**. No releases exist, so Atlas tracks by commit SHA. The most important findings are:

1. **Critical security gap**: upstream issue #144 reports that **no application table has Row Level Security enabled**. PR #145 proposes a deny-all RLS policy fix.
2. **Active hardening work**: contributor `bmersereau` opened a series of security/reliability fixes (#108–113) that Atlas should evaluate for cherry-picking.
3. **Large unmerged PR #205** bundles air-gap mode, organizations, security hardening, RAG, Word add-in, e2e and demo mode. It is too large to merge blindly but contains ideas aligned with Atlas sprints.
4. **Reliability issues** exist around SSE timeouts, download-zip OOM, missing pagination, and swallowed R2 errors.

## Open issues — highlights

| # | Title | Category | Atlas relevance |
|---|-------|----------|-----------------|
| 144 | No Row Level Security on any application table | Security | CRITICAL — must watch PR #145 |
| 164 | Access tokens stored in localStorage vulnerable to XSS | Security | High — move to httpOnly cookies |
| 184 | Mikeoss stopped after a couple of questions / red circle | Reliability | High — indicates production instability |
| 100 | No timeout on SSE/LLM stream | Reliability | Medium — fixed by PR #112 |
| 99 | POST /download-zip no bound on document_ids | DoS | Medium — fixed by PR #111 |
| 105 | GET /chat returns all chats without pagination | Performance | Low — fixed by PR #110 |
| 104 | user_id columns are text, no FK | Data integrity | Low — fixed by PR #113 |
| 103 | Supabase admin client created on every request | Performance | Low — fixed by PR #109 |
| 102 | R2 errors swallowed without logging | Observability | Medium — fixed by PR #108 |
| 101 | S3Client instantiated on every R2 operation | Performance | Low — fixed by PR #108 |
| 160 | Consider migrating to Vercel AI SDK | Architecture | Watch — may affect AI governance |
| 189 | Wishlist | Product | Low — community requests |

## Open pull requests — highlights

| # | Title | Category | Atlas relevance |
|---|-------|----------|-----------------|
| 145 | Enable RLS with deny-all policy on all public tables | Security | Merge candidate for Sprint 3 |
| 113 | Migration: user_id text → uuid FK | Data integrity | Merge after impact analysis |
| 112 | 3-minute timeout on SSE LLM streams | Reliability | Merge candidate for Sprint 3 |
| 111 | Cap POST /download-zip at 50 documents | DoS | Merge candidate |
| 110 | Paginate GET /chat | Performance | Merge candidate |
| 109 | Singleton Supabase admin client | Performance | Merge candidate |
| 108 | S3Client singleton + R2 error logging | Reliability | Superseded by S3 refactor (Sprint 4) |
| 158 | Spotlight untrusted content + threat model | Security | Review — overlaps with Sprint 0/3 |
| 156 | Structured JSON logger | Observability | Review for Sprint 12 alignment |
| 155 | Validate request body in project chat | Security | Merge candidate |
| 149 | Docker and Docker Compose support | DevEx | Reference for Sprint 1 |
| 196 | Self-hosted Docker stack + Ollama | Self-hosting | Reference for Phase 2E |
| 205 | Open-source hardening: air-gap, orgs, security, RAG, Word add-in, e2e | Mega-PR | Too large/risky to merge blindly; cherry-pick ideas |
| 181 | Content hashes + tamper-evident export manifest | Security | Review for document integrity Sprint 4/11 |

## Recommendations

1. **Immediately watch PR #145** (RLS). If it is merged upstream before Atlas completes Sprint 3, backport it.
2. **Cherry-pick reliability fixes** #112, #111, #110, #109 after test coverage exists (Sprint 2).
3. **Do not merge PR #205** as-is; decompose it into Atlas sprints where appropriate.
4. **Track #164** (localStorage tokens) and implement httpOnly cookies regardless of upstream resolution.
5. **Track #158 / #156** (threat model + structured logging) for observability alignment.
6. Re-evaluate this list during each monthly upstream sync (Sprint 17+).
