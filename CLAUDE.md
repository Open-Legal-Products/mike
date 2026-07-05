# CLAUDE.md — JessicaOS

> Project constitution. Read fully before any work. Rules here override task instructions.

## What this project is

**JessicaOS** is the UK localisation of [Mike](https://github.com/willchen96/mike) (MikeOS), the open-source AI legal platform. Fork lineage and AGPL-3.0 licence are preserved and celebrated, not hidden.

Mission: the first *substantive* UK version — real UK data integrations, UK legal workflows, verified citations, and an optional fully on-premises open-weights model mode. Built by the COO of Aria Grace Law and piloted with real solicitors.

**Naming rationale:** Mike worked for Harvey. They both worked for Jessica.

## Architecture (verify against code — Fable: update this section after full repo read)

- Frontend: Next.js (TypeScript)
- Backend: Express (TypeScript)
- DB: Supabase (Postgres) — migrations in `backend/` (confirm path)
- File storage: Cloudflare R2 / S3-compatible
- Model providers: Anthropic / Gemini / OpenAI keys, BYO-key
- US-specific integration to excise: **CourtListener** (env-gated)

<!-- TODO(Fable, Phase 0): replace with accurate module map, request flow, and env var registry -->

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

<!-- TODO(Fable, Phase 0): fill with actual dev/test/lint/eval commands after repo read -->
```
npm run dev          # (confirm)
npm test             # (confirm)
npm run evals        # to be created — golden set runner
npm run evals:smoke  # to be created — fast subset for Stop hook
```

## Current sprint

See `docs/BUILD_PLAN.md`. Deadline pressure is real (free Fable window ends 7 July); bias to shipping the five v1 workstreams over any refactor not on the critical path.
