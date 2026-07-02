# Mike vs. Harvey vs. Legora — Competitive Analysis & Product Strategy

*Written from the perspective of a senior law-firm partner evaluating legal-AI technology, in
collaboration with an expert on the `mike` codebase. Purpose: tell the authors of `mike` exactly
where it already beats Harvey and Legora, where it loses deals today, and what to build to become the
best option for a serious law firm. Current as of mid-2026.*

> **Confidence & sourcing.** The `mike` findings come from a direct read of this repository. Harvey
> and Legora findings are from official pages plus tier-1 press, with confidence flags carried through
> (pricing figures are third-party estimates; some security specifics are self-asserted by the
> vendors). Model version names in all three products are fast-moving — treat them as configuration.

---

## 0. The partner's lens (how I actually decide)

When I sign off on legal-AI technology for the firm, four things gate the decision, in order:

1. **Can I trust it with privileged client data?** (Security, data residency, "do you train on my
   data," who is your sub-processor, can we get a single-tenant/on-prem story past our GC and our
   most paranoid banking clients.)
2. **Does it fit how my lawyers already work?** (Word and Outlook first, DMS integration with
   iManage/NetDocuments/SharePoint, no "yet another portal.")
3. **Does it do the high-value work well and *verifiably*?** (Due-diligence review across thousands
   of documents, drafting, redlining, research with citations I can click and trust.)
4. **What does it cost, and what's the lock-in?** (Per-seat economics, seat minimums, and whether I'm
   renting someone else's margin forever.)

`mike` wins decisively on #1 and has a real answer on #2 and #3 — but it is missing several table-stakes
capabilities that Harvey and Legora use to clear procurement at large firms. The rest of this document
is about closing that gap without giving up the thing that makes `mike` special.

---

## 1. One-paragraph verdict

**Harvey** is the best-funded incumbent (~$11B valuation, ~$190M ARR, ~50% of the Am Law 100) with the
broadest feature set and the strongest enterprise security/compliance story — but it is closed SaaS, has
no on-prem option, is expensive with seat minimums, and asks you to trust self-published benchmarks.
**Legora** is the fast-rising, Europe-first, multilingual challenger (~$5.6B valuation, $100M+ ARR)
whose signature Tabular Review and Word-native workflow are excellent — but it too is cloud-only,
multi-tenant, and is fundamentally an orchestration layer on other people's models. **`mike`** is the
only one of the three that is **open-source, bring-your-own-key, self-hostable, and genuinely
air-gap-capable, with no vendor backend in the data path.** That is a category-defining wedge for
security-sensitive buyers. Its problem is not its core — chat, tabular review, drafting, and real Word
tracked-changes are production-quality — it is that it lacks **RAG/retrieval at scale, named DMS
integrations, multi-tenant org management, and verified grounding**, which are exactly the things that
win enterprise deals. Close those four and `mike` becomes the obvious choice for any firm that cares
about data sovereignty.

---

## 2. Feature comparison matrix

Legend: ✅ production / strong · 🟡 partial / beta / indirect · ❌ absent

| Capability | `mike` | Harvey | Legora |
|---|---|---|---|
| Document chat / Q&A with citations | ✅ streaming, tool-use, reasoning traces | ✅ | ✅ |
| Multi-document / project-wide chat | ✅ agent pulls docs via tools | ✅ Vault (up to 100k docs) | ✅ |
| **Tabular / spreadsheet review** (rows=docs, cols=fields) | ✅ per-cell citations, R/A/G flags, Excel export, review-scoped chat | ✅ Review Tables (up to 10k Vault files) | ✅ signature feature; collaborative (lock cells, review mode, comments) |
| Drafting → DOCX | ✅ `generate_docx` (headings/tables/landscape) | ✅ agentic "docx" agent, self-reviewing | ✅ Editor + Word |
| **Redlining / tracked changes** | ✅ real Word `<w:ins>/<w:del>`, accept/reject | ✅ | ✅ tracked changes w/ citations |
| Document vault / versioning / viewers | ✅ folders, versions, PDF+DOCX viewers, quote highlight | ✅ | ✅ |
| Workflows / templates | ✅ assistant + tabular; import/export/share | ✅ Workflow Builder + 500+ prebuilt agents | ✅ agentic workflows, no-code |
| Autonomous multi-step agents | 🟡 bounded tool loop (max 10 iters) | ✅ Harvey Agents; 25k+ custom agents | ✅ aOS (overnight autonomous runs) |
| Legal research (case law) | 🟡 US only via CourtListener (BYO token) | ✅ 100+ knowledge sources; LexisNexis alliance | ✅ 12+ jurisdiction DBs; Qura acquisition |
| **RAG / vector search / embeddings** | ❌ full-document-in-context only | ✅ | ✅ + Qura "beyond-RAG" DBs |
| **Enterprise DMS** (iManage/NetDocuments/SharePoint) | ❌ generic MCP only | ✅ iManage OAuth, NetDocuments, SharePoint | ✅ iManage, NetDocuments, SharePoint |
| Word add-in | 🟡 real tracked-changes, but dev-URL manifest | ✅ mature | ✅ mature (Actions, Edits, Translate) |
| Outlook add-in | ❌ | ✅ | ✅ |
| Document comparison / diff surface | ❌ (redline render only) | ✅ | ✅ (e.g., term sheet vs SPA) |
| Translation | ❌ | 🟡 multilingual analysis | ✅ DeepL-powered |
| Global semantic search | ❌ in-doc/in-list only | ✅ | ✅ firm-wide |
| Multi-language | 🟡 model-dependent, no UI feature | ✅ | ✅ Europe-first, multilingual |
| Model-agnostic backend | ✅ Claude/Gemini/OpenAI/Vertex/Ollama registry | ✅ OpenAI/Anthropic/Google/Mistral | ✅ OpenAI/Google/Azure (Claude via cloud) |
| MCP / extensibility | ✅ per-user remote MCP, OAuth/PKCE, SSRF-hardened | 🟡 API/MCP framework | 🟡 |
| Multi-tenant org / team model | ❌ per-user + email sharing | ✅ RBAC, SCIM, ethical walls | ✅ logical isolation, SSO, ethical walls |
| Billing / subscription | ❌ credits stubbed to unlimited | ✅ enterprise | ✅ enterprise |
| Client-facing portal | ❌ | 🟡 | ✅ Legora Portal |

**Reading the matrix:** `mike`'s *core lawyer-facing work product* (chat, tabular, drafting, redlining,
workflows) is genuinely competitive and in some areas — real Word tracked-changes, per-cell tabular
citations — is as good as the incumbents. The red ❌ cells cluster in two places: **retrieval at scale**
and **enterprise fit** (DMS, tenancy, portal, Outlook). Those are the deal-losers, not the core.

---

## 3. Hosting & security comparison — where `mike` wins

This is the section that matters most to a partner, and it is `mike`'s strongest ground.

| Dimension | `mike` | Harvey | Legora |
|---|---|---|---|
| Deployment | **Self-host / on-prem first; Docker Compose** | Enterprise SaaS only (no on-prem) | Cloud-only SaaS |
| **Air-gapped / zero-egress** | **✅ dedicated `airgapped/` profile + Ollama local models** | ❌ | ❌ |
| Vendor data path | **None — BYOK; data goes only to the model provider the firm chooses** | Harvey's Azure environment | Legora's Azure environment |
| Tenancy | Per-user (❌ no multi-org yet) | Multi-tenant, logical isolation | Multi-tenant, logical isolation |
| Cloud | Operator's choice (R2/S3/GCS/MinIO) | Azure (+ AWS/GCP subprocessors) | Azure (+ AWS) |
| Data residency | **By deployment topology — total operator control** | US default; EU/CH/AU regions | EU (Sweden) available; opt-in |
| Trains on customer data? | **No backend exists to do so** | Contractually no | No |
| Secrets encryption | AES-256-GCM, per-row HKDF keys | AES-256, BYOK | AES-256, BYOK |
| Auth / MFA | Supabase GoTrue, TOTP MFA, aal2 enforcement | SSO/SCIM/RBAC | SSO (SAML), MFA, RBAC |
| Certifications | ❌ none (it's software, not a hosted service) | SOC2 Type II, ISO 27001/27701/42001, IRAP | ISO 27001/42001, SOC2 Type 2, GDPR |
| Prompt-injection defense | ✅ nonce-fenced spotlighting of all untrusted content | not disclosed | not disclosed |
| Open source / inspectable | **✅ AGPL-3.0** | ❌ | ❌ |
| Cost model | Infra + your own API keys (no per-seat rent) | ~$1,200/seat/mo est., ~20-seat min (unverified) | ~$3,000/user/yr est. (unverified) |

**The pitch a partner can actually use:** With Harvey or Legora, I am sending privileged client
documents into a vendor's multi-tenant cloud and trusting contracts, certifications, and logical
isolation. With `mike`, I can run the entire thing inside my own tenancy — or fully air-gapped with
local models — so the documents *never leave my control*, and I can have my own security team read the
source. For a firm with sovereign-data clients (governments, banks, defense, healthcare), that is not a
nice-to-have; it is the whole ballgame. **Neither incumbent can match it, by architecture.**

The honest caveats `mike` must not hide: it ships no SOC2/ISO certification (because it's software you
host, the *operator* would certify their deployment); it has no multi-org tenancy yet; and the
air-gap install/backup/restore scripts are authored but not yet validated on real disconnected
hardware.

---

## 4. The gaps that lose deals today (ranked)

These are the specific reasons a partner would pick Harvey/Legora over `mike` **right now**, in order
of how often they'd be decisive.

1. **No RAG / retrieval at scale.** `mike` loads whole documents into the context window and does
   literal substring search. A real M&A data room is 5,000–50,000 documents; you cannot fit that in
   context. Harvey's Vault (100k docs) and Legora's Tabular Review over "tens of thousands of parallel
   calls" both assume retrieval. **This is the single biggest architectural gap** and it caps `mike`'s
   addressable matter size. *(Files: no `pgvector`/embeddings anywhere; `find_in_document` is substring.)*

2. **No named DMS integrations.** Large firms live in iManage/NetDocuments/SharePoint. Both incumbents
   ship native, OAuth-based connectors that preserve matter metadata, versioning, and ethical walls.
   `mike` offers only the generic MCP connector — technically capable, but not a checkbox procurement
   can tick.

3. **No multi-tenant org/team model.** `mike`'s isolation unit is the individual user, with
   email-based sharing. A firm needs organizations, teams, roles (RBAC), SSO/SCIM provisioning, and
   ethical walls. Without this, `mike` is a power-user tool, not a firm-wide platform.

4. **Grounding is prompt-trust, not verified.** `mike` *instructs* the model to quote verbatim and
   parses a `<CITATIONS>` block, but does not verify the quote against the source text server-side.
   (Case-law citations *are* verified via CourtListener — good — but document quotes are not.) For a
   profession where a fabricated citation is a sanctionable event, server-side quote verification is
   both a risk fix and a marketing weapon.

5. **Word add-in ships a dev-URL manifest** (`https://localhost:3000/taskpane.html`) and offers only
   canned Actions with assistant-only workflows. The tracked-changes engine underneath is excellent;
   the packaging is not shippable.

6. **No Outlook add-in, no document comparison, no translation, no global semantic search, no
   billing.** Each is individually a "why can't it do X" in a bake-off against the incumbents.

---

## 5. Recommendations — how `mike` becomes the best option

The strategy is not "copy Harvey." It is: **keep the sovereignty wedge, and remove every reason a
security-conscious firm would still be forced to choose a cloud incumbent.** Prioritized.

### Tier 1 — Close the deal-losers (do these first)

- **R1. Add retrieval (RAG) as a first-class, self-hostable layer.** Introduce embeddings + vector
  search using `pgvector` (you already run Postgres — no new infra, preserves air-gap via a local
  embedding model through the existing Ollama path). Make retrieval a tool alongside the existing
  `read_document`/`find_in_document` so the agent can scale from "read the whole doc" to "retrieve the
  relevant passages across 10,000 docs." *This unlocks large data rooms and is the highest-leverage
  single change.*

- **R2. Ship a real multi-tenant model.** Add `organizations`/`teams` tables, RBAC, SSO (SAML) + SCIM
  provisioning, and ethical walls. Keep per-user as the degenerate single-member org so existing data
  migrates cleanly. This is what turns `mike` from a tool into a platform a firm can standardize on.

- **R3. Native DMS connectors.** Build first-class iManage and NetDocuments connectors (SharePoint/
  OneDrive next), preserving metadata, versioning, and matter structure — not via generic MCP. Even
  one polished iManage integration removes a top procurement objection.

- **R4. Server-side citation verification.** Verify every model-emitted document quote against the
  source bytes before rendering it as a citation; flag/repair mismatches. Turn "we don't hallucinate
  citations" into a *provable, architectural* claim — something neither incumbent markets because
  neither can guarantee it the way an open, self-hosted verifier can.

### Tier 2 — Reach feature parity where it's cheap

- **R5. Fix and ship the Word add-in.** Production manifest, hosted taskpane, expose tabular workflows
  (not just assistant), and make Anonymise actually redact rather than advise. The hard part (real
  tracked changes) is already done.
- **R6. Outlook add-in.** Draft/summarize email — a well-trodden path once the Word add-in is properly
  packaged.
- **R7. Document comparison surface.** You already have a tracked-changes/diff engine; expose a
  first-class "compare A vs B" view (term sheet vs SPA is the canonical M&A ask).
- **R8. Translation** via a pluggable provider (respecting air-gap — local model fallback).
- **R9. Global semantic search** — falls out of R1 for free once embeddings exist.

### Tier 3 — Lean into the wedge (differentiate, don't imitate)

- **R10. Validate and certify the air-gap story.** Actually run the bundle/install/backup/restore on
  disconnected hardware and document a reproducible zero-egress bring-up. This is `mike`'s crown jewel —
  make it bulletproof and loud.
- **R11. Publish a security whitepaper + threat model** aimed at law-firm GCs and CISOs: BYOK, no
  vendor data path, spotlighting, encryption design, RLS-as-firewall. Give procurement the document
  they need to say yes.
- **R12. Provide a certification-enablement kit** (control mappings for SOC2/ISO/GDPR) so an operator
  can certify *their* deployment quickly — turning "no certifications" into "you certify what you
  control."
- **R13. Independent, reproducible legal evals.** Both incumbents lean on self-published benchmarks
  (Harvey's BigLaw Bench, Legora's internal evals). An *open, reproducible* eval suite (grow the
  8-case `evals/` starter) is a credibility weapon uniquely available to an open-source project.
- **R14. Pluggable legal research beyond US.** CourtListener is a good start; add EU/UK/Nordic sources
  via the connector pattern to neutralize Legora's jurisdictional breadth without owning content.

### What NOT to do

- Don't build a proprietary hosted backend or telemetry — it would forfeit the one thing the
  incumbents can't copy.
- Don't chase Harvey's "500+ prebuilt agents" count; depth + verifiability + sovereignty beats breadth
  of shallow templates for the target buyer.
- Don't add per-seat billing lock-in as the primary model; the BYOK/self-host economics *are* the
  pitch.

---

## 6. Positioning statement `mike` can take to market

> *"Harvey and Legora ask you to send privileged client data into their cloud and trust their
> contracts. `mike` runs inside your firm — self-hosted or fully air-gapped, with your own model keys,
> open source you can audit, and citations verified against the source. You get tabular due-diligence
> review, drafting, and real Word tracked-changes, without ever letting the documents leave your
> control."*

Execute Tier 1 (RAG, multi-tenancy, DMS, verified citations) and that statement becomes not just
differentiated but *strictly better* than the incumbents for every firm that takes data sovereignty
seriously — which, increasingly, is all of them.

---

## Appendix — sourcing notes

- **`mike`**: direct repository analysis (README, `docs/architecture.md`, `docs/SECURITY-MODEL.md`,
  `apps/api/src/lib/llm/*`, `modules/tabular/*`, `lib/docxTrackedChanges.ts`, `airgapped/`,
  `schema.sql`). No `MANUAL_FOLLOW_UP.md` exists in the repo despite an open editor tab.
- **Harvey**: harvey.ai (platform, security, blog), trust.harvey.ai, plus TechCrunch/CNBC/Fortune/
  Bloomberg Law/Stanford HAI. Pricing figures are third-party estimates (eesel, Bind). The "1-in-6
  hallucinations" stat and the "Gordon Rees" sanction are **misattributed to Harvey** and were
  fact-checked out.
- **Legora**: legora.com (product, legal, newsroom), Microsoft/Anthropic/Elastic case studies, plus
  Sifted/TechCrunch/Artificial Lawyer. Pricing is a third-party estimate; SOC2 "Type 2" vs "meets
  requirements" wording and HIPAA are self-asserted; Anthropic path is inferred via cloud
  sub-processors.
