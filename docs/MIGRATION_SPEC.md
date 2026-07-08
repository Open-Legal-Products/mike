# JessicaOS Migration Spec — US → UK

> Phase 0 deliverable. Written against the codebase as of `main@93f921b`. All file:line references verified at time of writing. This document specifies **what** changes and **how**; the workstream PRs (WS1–WS4) implement it.

Contents:

1. [US-specific touchpoint inventory](#1-us-specific-touchpoint-inventory)
2. [CourtListener excision plan (clean removal)](#2-courtlistener-excision-plan)
3. [Companies House integration design (WS1)](#3-companies-house-integration-design)
4. [legislation.gov.uk integration design (WS2)](#4-legislationgovuk-integration-design)
5. [Local model support design (WS3)](#5-local-model-support-design)
6. [Open questions for human review](#6-open-questions-for-human-review)

---

## 1. US-specific touchpoint inventory

### 1.1 CourtListener — backend code

| Touchpoint | Location | Notes |
|---|---|---|
| API client (1,189 lines) | `backend/src/lib/courtlistener.ts` | Search, citation verification, cluster/opinion fetch, R2 bulk-data cache. Base URL `https://www.courtlistener.com/api/rest/v4` |
| LLM tool definitions + system prompt | `backend/src/lib/legalSourcesTools/courtlistenerTools.ts` | 5 tools (`courtlistener_verify_citations`, `_get_cases`, `_find_in_case`, `_read_case`, `_search_case_law`), `COURTLISTENER_SYSTEM_PROMPT` ("US CASE LAW RESEARCH…"), event types |
| Route | `backend/src/routes/caseLaw.ts` (84 lines) | `POST /case-law/case-opinions` — sidepanel opinion fetch; mounted in `src/index.ts` |
| Chat engine wiring | `backend/src/lib/chatTools.ts:27-29` (imports), `:172-174` (`buildSystemPrompt(includeResearchTools)` splices `COURTLISTENER_SYSTEM_PROMPT`), `:781-784`, `:2332`, `:2564-2987` (tool-call execution branches), `:3933-3968` (`includeResearchTools` param, `researchTools` array) | The `includeResearchTools` seam is the extension point UK sources will reuse |
| Route gating | `backend/src/routes/chat.ts:540,547,582` and `backend/src/routes/projectChat.ts:148,155,185` | `legal_research_us` flag flows from `getUserModelSettings` → `buildMessages` → `runLLMStream` |
| User settings | `backend/src/lib/userSettings.ts:14,36,44-46` | `legal_research_us` (defaults **true** unless explicitly false) |
| API keys | `backend/src/lib/userApiKeys.ts:47` (`COURTLISTENER_API_TOKEN` env fallback) + `'courtlistener'` in the provider union throughout the file; `backend/src/lib/llm/types.ts` (`UserApiKeys.courtlistener`) | |
| OpenAI-provider citation reminder | `backend/src/lib/llm/openai.ts:13-23,156,161` | `COURTLISTENER_CITATION_REMINDER` appended to system prompt when courtlistener tools present |
| Route registration for `/user/api-keys/courtlistener` | `backend/src/routes/user.ts` (provider allowlist) | |

### 1.2 CourtListener — database

| Touchpoint | Location |
|---|---|
| `courtlistener_citation_index` table | `backend/schema.sql:756-773`; created by `backend/migrations/20260523_courtlistener_bulk_indexes.sql` |
| `courtlistener_opinion_cluster_index` table | `backend/schema.sql:775-789`; same migration |
| `user_api_keys.provider` CHECK includes `'courtlistener'` | `backend/schema.sql:57`; `backend/migrations/20260528_01_add_courtlistener_user_api_key_provider.sql` |
| `user_profiles.legal_research_us` column (default `true`) | `backend/schema.sql` (user_profiles block); `backend/migrations/20260611_user_profile_legal_research_us.sql` |
| Client grants revocation mentions CL tables | `backend/schema.sql:792-823` |

### 1.3 CourtListener — frontend

| Touchpoint | Location |
|---|---|
| Opinion viewer panel | `frontend/src/app/components/assistant/CaseLawPanel.tsx` (sanitiser allowlists only `courtlistener.com` URLs; `en-US` date formatting at `:159`) |
| SSE event parsing (10 `courtlistener_*` event handlers + `case_citation`, `case_opinions`) | `frontend/src/app/hooks/useAssistantChat.ts:585-896` |
| Event type definitions | `frontend/src/app/components/shared/types.ts:162-215,310` |
| API client | `frontend/src/app/lib/mikeApi.ts:809-816` (`getCourtlistenerOpinions` → `/case-law/case-opinions`), `:262` (`'courtlistener'` in provider type) |
| Feature toggle UI ("Enable US case law research (CourtListener)") | `frontend/src/app/(pages)/account/features/page.tsx:24,64,74` |
| API-key entry UI ("CourtListener API Key") | `frontend/src/app/(pages)/account/api-keys/page.tsx:43-47` |
| Profile context (`legalResearchUs`, `courtlistener` key state) | `frontend/src/contexts/UserProfileContext.tsx:33,65,74,123,220` |
| Case-law rendering in messages / tabular chat | `frontend/src/app/components/assistant/AssistantMessage.tsx`, `frontend/src/app/components/tabular/TRChatPanel.tsx`, `AssistantSidePanel.tsx` |
| Orphan US-courts script | `frontend/src/scripts/convert-courts-to-ts.js` — reads `src/hooks/google-scholar-courts.json` and writes `src/data/court-data.ts`, **neither of which exists in the repo**. Dead code; delete. |

### 1.4 Env vars and docs

- `backend/.env.example:22-23` — `COURTLISTENER_API_TOKEN`.
- `README.md:49-72` (env table), `:86-100` (CourtListener section incl. `COURTLISTENER_BULK_DATA_ENABLED` and R2 bulk layout `courtlistener/opinions/by-cluster/…`), troubleshooting entries.

### 1.5 Prompts, citation formats, terminology, seed data

| Touchpoint | Location | Issue |
|---|---|---|
| Chat system prompt persona | `backend/src/lib/chatTools.ts:107-195` | "You are Mike…" — branding + no UK framing; citation `[N]` + `<CITATIONS>` mechanism itself is jurisdiction-neutral (keep) |
| CourtListener system prompt | `courtlistenerTools.ts:72-90` | Reporter-citation format ("467 U.S. 837"), US workflow — removed with excision |
| Backend builtin workflows (3) | `backend/src/lib/builtinWorkflows.ts` | "Credit Agreement Summary", "CP Checklist", "Shareholder Agreement Summary" — content is largely English-law-compatible finance/corporate drafting but needs a UK terminology pass (e.g. governing-law framing, SOFR/reference-rate examples) |
| Frontend builtin workflow templates (14) | `frontend/src/app/components/workflows/builtinWorkflows.ts` | US-flavoured templates: "E-Discovery Review" (US litigation; UK equivalent is **disclosure** review — flagged in §6), LPA/SHA templates use US venture vocabulary; WS4 adds UK templates (SPA, commercial lease/LTA 1954, TUPE, employment vs statutory minima, CH due-diligence snapshot) |
| Tabular column presets / prompt generator | `frontend/src/app/components/tabular/columnPresets.ts`, `prompt-generator.ts` | Governing-law example strings ("New York Law", "English Law") — reorder examples UK-first; date preset already "DD Month YYYY" (UK-compatible) |
| Date formats | `frontend/.../CaseLawPanel.tsx:159` (`en-US`, dies with excision); `frontend/src/app/components/modals/credits-exhausted-modal.tsx:20` (`en-US` → `en-GB`); all other `toLocaleDateString(undefined, …)` calls follow browser locale (acceptable) | |
| UK terminology sweep scope | All user-facing strings in `frontend/src/app/**` and prompt text in `backend/src/lib/**` per the CLAUDE.md table | WS4; terminology-auditor agent reports, human decides legal terms of art |
| Branding | `frontend/src/components/site-logo.tsx`, `chat/mike-icon.tsx`, `app/layout.tsx:19-51` ("Mike - AI Legal Platform"), `login/signup/support` pages, `mikeApi.ts` comment, `R2_BUCKET_NAME` default `mike`, `localStorage` key `mike.selectedModel`, backend prompt persona | Rebrand is WS5-adjacent; **out of Phase 0** |

No ZIP-code fields, no US-jurisdiction pickers, and no other US seed data were found beyond the above.

---

## 2. CourtListener excision plan

**Goal:** clean removal, not env-gating. After excision the repo contains no CourtListener code paths, tools, prompts, UI, env vars, or live schema surface — while keeping the *seam* (a pluggable `legalSourcesTools/` module + `includeResearchTools`-style flag) that WS1/WS2 plug UK sources into. Minimal-diff discipline: delete whole files where possible; keep surgical edits small at the wiring points listed in §1.1.

### Order of operations (one PR, reviewable in this sequence)

1. **Backend tools & client.** Delete `lib/courtlistener.ts`, `lib/legalSourcesTools/courtlistenerTools.ts`, `routes/caseLaw.ts`; remove the route mount in `index.ts`.
2. **Chat engine.** In `chatTools.ts`: remove CL imports, the five tool-execution branches, and the CL prompt splice. **Keep** `buildSystemPrompt(includeResearchTools)` and the `researchTools` array as the seam — they become the injection point for UK sources (renamed `legalResearchTools`; empty array until WS2 lands). In `llm/openai.ts`: remove `COURTLISTENER_CITATION_REMINDER` block (`:13-23,156,161`).
3. **Settings & keys.** Remove `'courtlistener'` from `userApiKeys.ts`, `llm/types.ts` `UserApiKeys`, and the `user.ts` provider allowlist. Remove `legal_research_us` from `userSettings.ts` and the `PATCH /user/profile` handler. Route gating in `chat.ts`/`projectChat.ts` passes `includeResearchTools: false` until UK sources exist (WS2 re-enables via UK config).
4. **Frontend.** Delete `CaseLawPanel.tsx` and `convert-courts-to-ts.js`; remove the 10 `courtlistener_*` + `case_citation`/`case_opinions` handlers from `useAssistantChat.ts`, the event types from `shared/types.ts`, `getCourtlistenerOpinions` + `'courtlistener'` provider from `mikeApi.ts`, the features-page toggle, the api-keys page entry, `legalResearchUs`/courtlistener state from `UserProfileContext.tsx`, and case-law rendering branches in `AssistantMessage.tsx` / `TRSidePanel.tsx` / `AssistantSidePanel.tsx` / `TRChatPanel.tsx`.
5. **Env & docs.** Remove CL entries from `backend/.env.example` and README (env table, CourtListener section, troubleshooting).
6. **Database — requires explicit human instruction (CLAUDE.md hard rule 1).** Proposed forward migration `backend/migrations/<date>_remove_courtlistener.sql` (human to create or explicitly authorise):
   ```sql
   drop table if exists courtlistener_citation_index;
   drop table if exists courtlistener_opinion_cluster_index;
   alter table user_api_keys drop constraint user_api_keys_provider_check;
   alter table user_api_keys add constraint user_api_keys_provider_check
     check (provider in ('claude', 'gemini', 'openai', 'openrouter'));
   delete from user_api_keys where provider = 'courtlistener';
   alter table user_profiles drop column if exists legal_research_us;
   ```
   Plus matching edits to `schema.sql` (fresh-install path). Note: dropping the two index tables is destructive to any imported bulk data; for a fresh JessicaOS Supabase project they are empty. `delete from user_api_keys` destroys stored CL tokens — intended.
7. **Persisted chat events.** Old `chat_messages` rows may contain persisted `courtlistener_*` / `case_citation` events. The frontend must ignore unknown event types gracefully (verify `useAssistantChat` default branch does this; add a silent-skip if not) rather than migrating data.

### Acceptance criteria

- `grep -ri courtlistener backend/src frontend/src` → 0 hits.
- `tsc --noEmit` clean in both projects; app boots; chat + documents + tabular + workflows all function with research tools absent.
- README/env docs contain no CL references; eval smoke passes.

---

## 3. Companies House integration design

**Powers:** company search-as-you-look-up in chat (LLM tools), the "Corporate due-diligence snapshot" workflow (demo centrepiece), and deterministic eval cases.

### 3.1 API facts

- Base: `https://api.company-information.service.gov.uk`
- Auth: HTTP Basic — **API key as username, blank password** (`Authorization: Basic base64(key + ":")`). Register key at developer.company-information.service.gov.uk. Free.
- Rate limit: **600 requests / 5 minutes** per key. 429 on breach (window resets, no retry-after guarantee).
- Endpoints used:

| Endpoint | Purpose |
|---|---|
| `GET /search/companies?q=&items_per_page=` | Company search |
| `GET /company/{companyNumber}` | Profile (status, type, incorporation date, registered office, SIC codes, accounts/confirmation-statement due dates) |
| `GET /company/{companyNumber}/officers` | Officers (active + resigned) |
| `GET /company/{companyNumber}/persons-with-significant-control` | PSCs |
| `GET /company/{companyNumber}/filing-history?items_per_page=&start_index=` | Filing history (paginated) |

### 3.2 Backend design (mirrors the CL shape deliberately — minimal-diff, familiar seam)

- `backend/src/lib/companiesHouse.ts` — typed client. Key from user API key (new `'companies_house'` provider — **needs a migration to extend the provider CHECK**, human instruction required) or `COMPANIES_HOUSE_API_KEY` env fallback, same precedence as LLM keys.
- `backend/src/lib/legalSourcesTools/companiesHouseTools.ts` — LLM tools:
  - `companies_house_search_companies {query}`
  - `companies_house_get_company {company_number}` (profile + officers + PSCs, batched server-side)
  - `companies_house_get_filing_history {company_number, page?}`
  plus a short system-prompt block (UK terminology: company number is 8 chars, may be zero-padded or have prefixes like `SC`/`NI`; instruct model to cite company number + retrieval date in output).
- Wired through the `legalResearchTools` seam left by §2; gated by a new `uk_data_sources` boolean on `user_profiles`? **No** — keep it simpler: always available when a key is configured (open questions §6).
- **Rate limiting:** in-process token bucket (600/5min, headroom at 500) + single-flight de-dupe keyed by URL. On 429: back off, fail the tool call with a clear message; system prompt instructs the model to stop CH calls that turn (same pattern as the CL 429 rule).
- **Error handling:** 401 → "Companies House API key invalid/missing" surfaced as tool error and as key-status on the account page; 404 → "no company with number X"; 5xx → one retry then tool error. Never leak the key in errors (`safeError.ts` conventions).
- **Caching:** in-memory LRU, TTL 15 min for profile/officers/PSC, 5 min for search, 60 min for filing history pages. No DB cache in v1 (avoids migration surface); revisit if eval latency demands it.

### 3.3 Frontend surface

- SSE events `companies_house_search`, `companies_house_get_company`, `companies_house_get_filing_history` (start/result pairs) rendered as compact tool chips in `AssistantMessage` — same pattern as MCP tool events (reuse, don't clone, the event-chip component).
- Side panel: a `CompanyPanel` (replacing the deleted `CaseLawPanel` slot in `AssistantSidePanel`) showing profile/officers/PSCs with a link out to `https://find-and-update.company-information.service.gov.uk/company/{n}`.
- Account → api-keys: "Companies House API key" entry (same list as model providers).
- Workflow: "Companies House due-diligence snapshot" template (WS4) — assistant-type workflow whose prompt calls the CH tools and produces a structured snapshot (profile, officers, PSCs, last accounts, outstanding filings, red flags such as overdue accounts or active insolvency category).

### 3.4 Consumed by

- Chat (tools), the due-diligence workflow, deterministic evals (`evals/cases/ch-*.yaml`: known company numbers → expected officers/incorporation dates).

---

## 4. legislation.gov.uk integration design

**Powers:** statute/SI lookup in chat, "check clause against current law" workflows, and the **citation-resolution hard gate** in the eval harness (the harness resolves citations against the live API directly — already scaffolded in `evals/src/citations.ts`).

### 4.1 API facts

- Fully open, **no API key**. Open Government Licence permits computational reuse.
- Canonical URIs: `https://www.legislation.gov.uk/{type}/{year}/{number}` — types incl. `ukpga` (UK Public General Acts), `uksi` (Statutory Instruments), `asp`, `anaw`, `nisr`…
- Content negotiation by suffix: `/data.xml` (CLML), `/data.akn` (Akoma Ntoso), `/data.htm`, `/data.rdf`.
- Fragments: `/section/{n}` (Acts), `/regulation/{n}` / `/article/{n}` (SIs), `/schedule/{n}`.
- Versions: default is the **latest revised** version; `/{yyyy-mm-dd}` for point-in-time; `/enacted` (or `/made` for SIs) for the original.
- Title search: Atom feeds, e.g. `GET /ukpga?title=Companies+Act+2006` (used by the eval citation resolver to map "Companies Act 2006" → `ukpga/2006/46`).
- **Revision-lag flags:** CLML metadata carries unapplied-effects data (`ukm:UnappliedEffects` / "Changes to Legislation" annotations) indicating outstanding amendments not yet incorporated, and prospective provisions. **CLAUDE.md requires these to be surfaced, never hidden** — exact element names to be verified against live responses in WS2.

### 4.2 Backend design

- `backend/src/lib/legislation.ts` — client: `resolveByTitle(title, year)` (Atom feed → canonical URI, cached aggressively — titles are stable), `getProvision(uri, fragment, version?)` (fetch CLML, extract provision text + heading + extent + unapplied-effects flags), `search(title)`.
- `backend/src/lib/legalSourcesTools/legislationTools.ts` — LLM tools:
  - `legislation_lookup {citation}` — accepts natural citations ("s.994 Companies Act 2006", "reg 3 TUPE Regulations 2006", "SI 2006/246"); parses, resolves, returns provision text + canonical URL + **outstanding-effects warning if present**.
  - `legislation_search {title_query}`
  - `legislation_verify_citations {citations[]}` — batch resolution used by prompts before final answers (mirrors the old CL verify pattern; feeds the same `<CITATIONS>` annotation mechanism, with `legislation_uri` in place of `cluster_id`).
  System-prompt block: UK citation style (`s.994 Companies Act 2006`; neutral citations for cases must **not** be invented — case-law retrieval is deferred pending the TNA Find Case Law licence, so the model is told it has no case-law source and must not cite unverifiable authority).
- **Rate limiting/politeness:** no published hard limit; self-impose ~1 req/s burst 5, identify with a UA string `JessicaOS/<version> (+repo URL)`. Retry once on 5xx.
- **Error handling:** unresolvable citation → structured tool failure `{resolved: false, reason}` — the model must then correct or drop the citation; parser failures surface the raw citation for human-readable errors.
- **Caching:** in-memory LRU — title→URI (24h), provision content for the *current* version (6h; revised content changes as effects are applied), point-in-time versions (immutable, 7d).

### 4.3 Frontend surface

- SSE events `legislation_lookup` / `legislation_verify_citations` chips; provision text viewable in the side panel (`LegislationPanel`) with the canonical legislation.gov.uk link and a prominent **"outstanding amendments not yet applied"** banner when flagged.
- Citations in assistant output rendered via the existing `[N]`/`<CITATIONS>` annotation path (`extractAnnotations` in chatTools.ts) — extend the annotation type with `legislation_uri`.

### 4.4 Consumed by

- Chat, "check clause against current law" workflow templates (WS4: SPA review, lease/LTA 1954, TUPE, employment vs statutory minima all cite statute), and the eval harness citation gate (every statutory reference in workflow output must resolve; any failure blocks merge).

---

## 5. Local model support design

**Goal:** any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM) as a first-class provider. Positioning is **data sovereignty**, not cost; docs must carry honest quality caveats backed by the eval table.

### 5.1 Key constraint discovered in Phase 0

`backend/src/lib/llm/openai.ts` uses the **OpenAI Responses API** (`/v1/responses`). Ollama/LM Studio/vLLM reliably implement **`/v1/chat/completions`**, not the Responses API. So local support is **not** just an env-var override on the existing OpenAI client — it needs a chat-completions streaming path.

### 5.2 Backend design

- New provider `"local"` in `llm/types.ts` and `models.ts`:
  - Model ids are dynamic, prefixed: `local:<model-name>` (e.g. `local:qwen2.5:14b-instruct`). `providerForModel` maps the `local:` prefix; `resolveModel` accepts any `local:*` id when local mode is configured (registry check bypassed for the prefix).
- New `llm/localOpenAI.ts`: streaming client for `POST {base}/v1/chat/completions` with `stream: true`, OpenAI tool-calling format (`tools`, `tool_calls` deltas), normalised to the existing `StreamChatParams`/callback contract. Honest capability handling: many local models emit malformed tool JSON — parse defensively, convert failures to tool errors rather than crashes.
- Config (server-level, env):
  - `OPENAI_BASE_URL` — **decision needed (§6):** upstream convention would make this override the real OpenAI client; clearer is a dedicated pair so cloud-OpenAI and local can coexist:
    - `LOCAL_LLM_BASE_URL` (e.g. `http://localhost:11434/v1`)
    - `LOCAL_LLM_MODELS` (comma-separated ids to offer, e.g. `qwen2.5:14b-instruct,mistral-small`)
    - `LOCAL_LLM_API_KEY` (optional; most local servers ignore it — send `Bearer ollama` default)
  - Spec recommends the dedicated pair *plus* honouring `OPENAI_BASE_URL` as a documented alias when set and `LOCAL_LLM_BASE_URL` is not (satisfies the BUILD_PLAN's "OPENAI_BASE_URL-style" requirement without hijacking the cloud OpenAI provider).
- Key/availability plumbing: `getUserApiKeyStatus` gains `local: {configured, source: "env"}` (no per-user secret; a per-user base URL is a security question — not in v1, see §6).

### 5.3 Provider-selection UX

- `ModelToggle` gains a **"Local (on-premises)"** group listing `LOCAL_LLM_MODELS`, shown only when the backend reports local mode configured (`GET /user/api-keys/status` extension or a small `GET /models/available` endpoint — prefer extending the existing status payload, smaller diff).
- Each local model row carries a "runs on your own hardware — see quality guidance" hint linking to the docs page.
- `modelAvailability.ts` + `ApiKeyMissingModal`: local models are "available" when the server reports the base URL configured; otherwise hidden entirely (not greyed) to keep the picker clean for cloud-only installs.
- Account → models page: local models selectable for title/tabular roles too, with the same caveat copy.
- Docs page (`docs/local-models.md` + README section, WS3/WS5): setup for Ollama and LM Studio, one tested Apache-2.0 model (Qwen or Mistral family per BUILD_PLAN), and the eval comparison table as the honest quality statement.

### 5.4 Eval tie-in

Day-3 model-comparison run: full eval suite with provider = Claude, Gemini, local Qwen/Mistral via Ollama; results published in the README table. The eval runner accepts `--model` override to support this (scaffolded).

---

## 6. Open questions — human decisions recorded 6 July 2026

1. **"E-Discovery Review" template** — **DECIDED: rename to "Disclosure Review"** (CPR Part 31 / PD 57AD framing); rework columns to English practice (privilege column split into legal advice privilege / litigation privilege / without prejudice). WS4 implements.
2. **`OPENAI_BASE_URL` semantics** (§5.2) — **DECIDED: dedicated `LOCAL_LLM_*` vars**, with `OPENAI_BASE_URL` honoured as a documented alias when `LOCAL_LLM_BASE_URL` is unset. Cloud OpenAI and local providers coexist. WS3 implements.
3. **Companies House gating** — **DECIDED: available whenever a key is configured** (server env or user key). No feature toggle, no new `user_profiles` column.
4. **Migrations** — ~~needs instruction~~ **AUTHORISED (6 July 2026)**: `20260706_remove_courtlistener.sql` and `20260706_add_companies_house_user_api_key_provider.sql`, recorded in the human-maintained allowlist `.claude/hooks/authorized-migrations.json` which the PreToolUse guard enforces. Proposed SQL is in §2 step 6; the files land in the excision and WS1 PRs respectively.
5. **Per-user local base URLs** are excluded from v1 (SSRF surface — a user-supplied URL fetched by the backend). Confirm.
6. **Persisted US-event history** (§2 step 7) — **DECIDED: silently skip unknown event types in the UI**; no data migration. Excision PR must verify the renderer's unknown-event fallback.
7. **Terminology sweep judgment calls** will be reported by the terminology-auditor agent as a diff-less report for your sign-off before WS4 applies legal-term changes.
