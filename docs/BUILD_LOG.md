# JessicaOS Build Log

> Running record of what was done, by whom, and how it was verified — one entry per
> PR/workstream, newest first. Every PR must append an entry here (CLAUDE.md,
> definition of done). Keep entries factual: scope, key changes, verification
> evidence, decisions taken, anything deferred.

---

## 2026-07-07 — CourtListener excision (branch `excise-courtlistener`, PR #2)

**Scope:** Clean removal of the US CourtListener integration per `docs/MIGRATION_SPEC.md` §2 — code, tools, prompts, UI, DB surface, env vars, docs. No UK features yet; the research-tools seam is kept for WS1/WS2.

**Backend**
- Deleted `lib/courtlistener.ts` (1,189 lines), `lib/legalSourcesTools/courtlistenerTools.ts`, `routes/caseLaw.ts`; unmounted `/case-law`.
- `chatTools.ts`: removed the 5 CL tool branches, ~1,000 lines of CL turn-state helpers, case-citation parsing/annotation, CL event types (−33.7k chars). Kept `buildSystemPrompt(includeResearchTools)` and the `researchTools` array as the seam (empty until WS2).
- `llm/openai.ts`: removed the CourtListener citation-reminder prompt suffix.
- Removed `'courtlistener'` provider from `userApiKeys.ts` / `llm/types.ts` / `user.ts`; removed `legal_research_us` from `userSettings.ts`, `user.ts` (profile select/serialise/validate — legacy column-fallback cascade simplified), and both chat routes (`includeResearchTools: false` until UK sources land).

**Frontend**
- Deleted `CaseLawPanel.tsx`, the orphan `convert-courts-to-ts.js`, and the whole `/account/features` page (its only content was the US toggle; nav entry removed — per the no-toggle decision).
- Removed CL entry from `/account/api-keys`; `legalResearchUs` + courtlistener key state from `UserProfileContext`; `getCourtlistenerOpinions` + provider from `mikeApi.ts`.
- `shared/types.ts`: removed 7 CL event variants and the case-citation annotation type (`CitationAnnotation` is document-only now).
- `useAssistantChat.ts` / `TRChatPanel.tsx`: removed CL SSE handlers + parsers; `AssistantMessage.tsx`: removed `CourtListenerBlock`, case-link markdown handling, case citation pills, and the 5 CL event renderers.
- **Old-chat compatibility (decision #6):** `AssistantMessage.isRenderableEvent` now skips `case_citation` / `case_opinions` / `courtlistener_*` event types by string, so pre-fork chats still render (minus US case-law blocks). This is the one intentional "courtlistener" string left in source.

**Database** (authorised migration `20260706_remove_courtlistener.sql` + matching `schema.sql` edits)
- Drops both CL index tables, deletes stored CL tokens, tightens the `user_api_keys` provider CHECK, drops `user_profiles.legal_research_us`.

**Docs/env:** CL removed from `backend/.env.example` and README (prereqs, env block, integration section, first-run step, 2 troubleshooting entries).

**Verification**
- `grep -ri courtlistener|legal_research_us` over `backend/src`, `frontend/src`, `schema.sql`, `.env.example`, README → only the 2 intentional skip-guard lines above.
- `tsc --noEmit` clean in backend and frontend. Frontend ESLint: 35 errors / 77 warnings vs 41/77 baseline (strictly better; all remaining pre-existing).
- Backend boots with dummy env; `GET /health` → `{"ok":true}`.
- `npm run evals:smoke` → 3/3 pass (live legislation.gov.uk).
- `next build` with dummy public env vars — see PR notes (first run failed on missing `NEXT_PUBLIC_SUPABASE_URL`, an environment condition also present upstream).

**Addendum 2026-07-08 (same PR):** operator env files populated (backend/.env, frontend/.env.local — untracked); backend boots on the real config (`/health` ok). Companies House key verified live and the `det-companies-house-profile` golden case activated with real data: ARIA GRACE LAW CIC, company number 13927967, incorporated 2022-02-21, SIC 69102, England & Wales (values confirmed against the live API). Full eval run: 4 pass, 1 pending (judged case awaits WS1/WS4 workflow fixtures + ANTHROPIC_API_KEY).

**Addendum (same PR):** eval runner now loads operator env files at startup (`evals/src/env.ts`: repo-root `.env.local` / `.env`, then `backend/.env`; real environment always wins) so `npm run evals` picks up `COMPANIES_HOUSE_API_KEY` / `ANTHROPIC_API_KEY` wherever the operator keeps them. Verified against a synthetic env file (parse, quoted values, no-override).

**Tooling fix (found by dogfooding the hooks):** the PostToolUse hook ran `prettier --check` on backend files, but the repo has no prettier config and upstream files are not prettier-clean — an auto-format would have rewritten a whole file's indentation (caught and reverted). The hook now runs prettier only when a project defines a prettier config.

---

## 2026-07-06 — Phase 0 decisions recorded + extra agents (PR #1 follow-ups)

- Added `frontend-designer` and `uk-copywriter` agents at the owner's request (UI/copy work from excision + UK integrations).
- Migration authorisation operationalised: human-maintained allowlist `.claude/hooks/authorized-migrations.json` (agents blocked from editing it); two files pre-authorised.
- Owner decisions recorded in MIGRATION_SPEC §6: "Disclosure Review" rename; dedicated `LOCAL_LLM_*` env vars with `OPENAI_BASE_URL` alias; Companies House available whenever a key exists (no toggle); old US chat events silently skipped at render (no data migration). Per-user local base URLs deferred (SSRF).

## 2026-07-06 — Phase 0 (branch `phase-0`, PR #1)

**Scope:** BUILD_PLAN §1 — docs + eval harness + agents/hooks; no feature code.

- **CLAUDE.md**: TODOs replaced with verified architecture map, module tables, chat request flow, full env var registry, real commands. Documented that upstream has no tests, no CI, no root package.json, no backend lint script.
- **docs/MIGRATION_SPEC.md**: full US touchpoint inventory (file:line); CourtListener clean-removal plan; Companies House design (basic-auth-as-username, 600 req/5min); legislation.gov.uk design (no key, `/data.feed` Atom search, outstanding-effects flags surfaced); local-model design (key finding: upstream OpenAI client uses the Responses API, which Ollama/LM Studio don't serve — local needs a chat-completions client).
- **evals/**: golden-set runner (`npm run evals` / `evals:smoke` from root). Citation hard gate resolves statutory refs against the live legislation.gov.uk API; neutral case citations always fail until the TNA Find Case Law licence lands. Opus judge (`claude-opus-4-8`, structured JSON via `output_config`). Smoke verified 3/3 live; self-test proves the gate rejects a fabricated s.9999 CA 2006.
- **.claude/**: agents test-writer / code-reviewer / eval-judge / terminology-auditor; hooks — PreToolUse guard (migrations/`.env*`/LICENSE), PostToolUse typecheck+lint on changed files, Stop hook running tests + `evals:smoke`. All hook paths tested.
- New deps (evals only, justified in PR): `@anthropic-ai/sdk`, `js-yaml`, `tsx`, `typescript`.
