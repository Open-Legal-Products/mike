# JessicaOS — Build Plan (3-day sprint)

> Lives at `docs/BUILD_PLAN.md`. The kickoff prompt in §1 starts the project. Everything else is the spec Fable executes against.

---

## 0. Pre-flight (human, ~30 min, before any Claude session)

- [ ] Fork `willchen96/mike` → your org/repo (from **latest main** — recent security fixes must be in the baseline: key-encryption rework, download-token TTL, upload validation, CSP)
- [ ] Register Companies House API key (instant, free)
- [ ] Register domain + GitHub org name for JessicaOS
- [ ] Create fresh Supabase project + R2 bucket (or reuse dev creds)
- [ ] Clone locally; drop `CLAUDE.md` in repo root and this file at `docs/BUILD_PLAN.md`
- [ ] Start licence application to The National Archives (Find Case Law computational use) — weeks-long lead time, so start now even though it's post-launch scope
- [ ] Message Will Chen

---

## 1. Kickoff prompt (paste into Fable via Claude Code, in repo root)

```
Read CLAUDE.md and docs/BUILD_PLAN.md fully, then read the entire codebase.

Then, before writing any feature code, complete Phase 0:

1. Update the TODO sections of CLAUDE.md: accurate architecture map,
   module boundaries, request flow, complete env var registry, real
   dev/test/lint commands.
2. Write docs/MIGRATION_SPEC.md covering:
   a. Full inventory of every US-specific touchpoint (CourtListener code
      paths, env vars, prompts, UI strings, citation formats, seed data).
   b. Excision plan for CourtListener behind clean removal, not just
      env-gating.
   c. Integration designs for Companies House and legislation.gov.uk
      (endpoints, auth, rate limits, error handling, caching, where they
      surface in the UI, which workflows consume them).
   d. Design for OPENAI_BASE_URL-style local model support (Ollama /
      LM Studio compatible) with provider-selection UX.
3. Scaffold the eval harness per BUILD_PLAN §4: runner, fixtures
   directory, citation-resolution hard gate, Opus judge wiring,
   `npm run evals` and `npm run evals:smoke`.
4. Materialise the agents and hooks from BUILD_PLAN §5 and §6 into
   .claude/agents/ and .claude/settings.json.
5. Open a PR containing only Phase 0 (docs + harness + scaffolding).
   Stop and wait for my review before feature work.

Constraints: minimal diffs against upstream, hard rules in CLAUDE.md
are absolute, ask rather than guess on any UK legal terminology.
```

---

## 2. Sequencing against the Fable window (ends 7 July, 50% weekly-limit cap)

| Day | Fable (lead, interactive) | Sonnet worktrees (parallel) | Human (you) |
|---|---|---|---|
| **1** | Phase 0; CourtListener excision; schema/migration work | — | Pre-flight; review Phase 0 PR; draft golden-set cases |
| **2** | Integration wiring + citation-verification pipeline; hairy streaming/UI code | WS1 Companies House · WS2 legislation.gov.uk · WS3 local-model provider · WS4 terminology sweep + UK workflows · WS5 landing page/README | Golden set finalised with 1 AGL associate; review PRs |
| **3** | Eval hardening; model-comparison table run; fixes from Opus review | Remaining WS finishes; test backfill | Opus review pass on everything; record demo; AGL pilot ask; launch draft |

If the 50% Fable cap bites early: demote comprehension and bulk edits to Sonnet; protect Fable for migration-critical and citation-pipeline code. After 7 July, Sonnet/Opus continue in-plan — launch quality beats launch date.

---

## 3. Workstreams (each = one Sonnet session in its own git worktree, one PR)

**WS1 — Companies House integration.** Company search, profile, officers, PSCs, filing history. Powers the "corporate due-diligence snapshot" workflow (demo centrepiece). Handle rate limits (600 req/5min) and the API's quirks (auth = key as basic-auth username).

**WS2 — legislation.gov.uk integration.** Statute/SI lookup by citation and search; fetch revised text; surface outstanding-effects flags. Powers "check clause against current law" workflows and the citation hard gate.

**WS3 — Local model support.** Configurable OpenAI-compatible base URL + model name; provider picker UX; docs page with honest quality guidance pointing at the eval table. Test against Ollama with one Apache-2.0 model (Qwen or Mistral family).

**WS4 — UK terminology sweep + workflow templates.** Apply CLAUDE.md table across prompts/UI/seed data. New workflow templates: English-law SPA review; commercial lease review (LTA 1954 security of tenure flags); TUPE analysis; employment contract vs statutory minima; Companies House due-diligence snapshot. Each template ships with 3+ golden-set cases.

**WS5 — Landing page + README.** README: what/why, fork lineage + AGPL attribution up top, eval table placeholder, transparent roadmap (Find Case Law pending TNA licence; HMLR Business Gateway), self-hosting guide, AGL pilot note.

---

## 4. Eval harness (built in Phase 0, before features)

**Golden set: 25–30 cases in `evals/cases/*.yaml`**, three types:

1. **Deterministic** — Companies House lookups with known answers (real company numbers → expected officers/dates); legislation fetches that must match API text exactly.
2. **Citation resolution (HARD GATE)** — run each workflow on fixture documents; extract every statutory reference and citation from output; each must resolve via live API. Any unresolvable citation → suite fails → merge blocked. No exceptions.
3. **Judged** — workflow outputs on fixture documents (use public/dummy docs only) scored 1–5 by an Opus judge against per-workflow rubrics (issue-spotting completeness, correct law, UK terminology, no invented facts). Regression threshold: mean score may not drop vs `main`.

**Runners:** `npm run evals` (full, CI merge gate) and `npm run evals:smoke` (≤5 cases, used by Stop hook).

**Model comparison table (day 3):** run full suite with provider = Claude, Gemini, and local Qwen/Mistral via Ollama. Publish results in README. This is the honest local-model guidance and a launch asset.

---

## 5. Agents (`.claude/agents/`)

- **test-writer** (Sonnet) — writes unit tests for changed modules; never modifies source to make tests pass.
- **code-reviewer** (Opus) — reviews PRs for: security (secrets, injection, upload handling — mirror upstream's recent fixes), AGPL/attribution preservation, CLAUDE.md hard rules, minimal-diff discipline, UK terminology.
- **eval-judge** (Opus) — scores judged eval cases against rubrics; outputs structured JSON only.
- **terminology-auditor** (Sonnet) — greps user-facing strings/prompts against the CLAUDE.md table; reports, never auto-fixes legal terms of art.

## 6. Hooks (`.claude/settings.json`) — three, no more

1. **PostToolUse (Edit/Write)** — `tsc --noEmit` + ESLint + Prettier on changed files; non-zero exit blocks and feeds errors back.
2. **PreToolUse (Edit/Write) guard** — refuse edits to `**/migrations/**`, `.env*`, `LICENSE*`, licence headers. Deny with reason.
3. **Stop hook** — run unit tests + `evals:smoke`; on failure, agent continues working instead of stopping.

## 7. CI/CD (GitHub Actions)

- **Merge gates on every PR:** lint → typecheck → unit tests → full eval suite (citation hard gate included). Vercel/preview deploy per PR.
- **Claude Code GitHub Action:** automated PR review comments; `@claude` on issues → draft PR (post-launch, for community issues).
- **Human merge only.** Agents propose; you dispose. This is also part of the JessicaOS story told to firms.
- **Nightly upstream tracker (the one routine worth building):** scheduled job diffs `willchen96/mike@main` vs fork; drafts a rebase PR; writes plain-English summary flagging security-relevant changes.

## 8. Explicitly out of scope this sprint

Find Case Law integration (licence pending) · HMLR Business Gateway · auto-deploy to production · agents authoring their own evals unsupervised · multi-agent orchestration frameworks · any refactor not on the critical path · DonnaOS.

## 9. Launch checklist (day 3 evening / day 4)

- [ ] Demo video (2–3 min): Companies House due-diligence workflow + citation verification + local-model mode on Mac mini
- [ ] 2–3 named AGL partner/associate quotes (non-client documents only)
- [ ] README eval table populated; roadmap transparent
- [ ] Will Chen pinged pre-launch
- [ ] LinkedIn post → Show HN → direct emails: Artificial Lawyer, Legal IT Insider, Legal Futures, Law Society Gazette (frame as follow-up to their May Mike coverage)
