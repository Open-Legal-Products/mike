# Mike — Feature Walkthrough

A hands-on walkthrough of Mike's web app, driven end-to-end in a real Chrome
browser against the local dev stack. Every screenshot below was captured live
while clicking through the product.

| | |
|---|---|
| **Date** | 2026-07-05 |
| **Environment** | Local dev — web `http://localhost:3000`, API `http://localhost:3001`, Supabase `:54321` |
| **Build** | Next.js 16.2.6 (Turbopack), guest session (Free tier) |
| **Model used for real analysis** | Claude Opus 4.8 (Anthropic BYOK key) |
| **How it was tested** | Chrome DevTools automation — real clicks, typing, uploads, and streamed LLM responses |

> Screenshots live in [`.walkthrough-shots/`](.walkthrough-shots/). Paths are relative, so they render on GitHub and in local Markdown preview.

---

## 1. Sign in

The app opens on a clean login screen. In local development a **Continue as
guest** shortcut is offered (labelled "Local development only") so you can try
the product without creating an account.

![Login screen](.walkthrough-shots/01-login.png)

✅ Guest sign-in works; it lands on the Assistant with a fresh, empty workspace.

---

## 2. First run — demo mode

With no AI provider key configured, Mike runs in **demo mode**. A persistent
amber banner explains this and links straight to the key setup, and the model
selector defaults to a "Demo (no key needed)" option. Your documents stay in
your workspace until you add a key.

![Assistant home in demo mode](.walkthrough-shots/02-assistant-home-demo.png)

✅ The first-run state is clear and self-explanatory — a good onboarding nudge
rather than a dead end.

---

## 3. Model picker

The composer's model menu lists every supported model across Anthropic, Google,
and OpenAI. Models without a configured key are clearly marked **"API key
missing"**, and the always-available **Demo** option sits at the bottom.

![Model picker in demo mode](.walkthrough-shots/03-model-picker.png)

✅ Provider-agnostic model selection with honest, per-model key status.

---

## 4. Demo-mode answer

Asking a question in demo mode returns a helpful placeholder that (a) restates
your question, (b) describes what a real answer would contain, and (c) tells you
exactly how to enable real analysis. It never silently pretends to analyse.

![Demo-mode reply](.walkthrough-shots/04-demo-reply.png)

✅ Demo answers are transparent about being placeholders.

---

## 5. Add an API key (bring-your-own-key)

**Settings → API Keys** lets you paste keys for Anthropic, Google, OpenAI,
OpenRouter, and CourtListener. Keys are encrypted at rest (AES-256-GCM with a
per-row HKDF-derived key). Fields that are already set from the server `.env`
are shown as read-only ("Server .env key configured").

![API Keys settings](.walkthrough-shots/05-api-keys-page.png)

Once a key is entered and saved, the field collapses to "Saved key hidden" with
a **Remove** action.

![Key saved](.walkthrough-shots/06-api-key-saved.png)

✅ BYOK save/remove works; keys are masked and never echoed back.

---

## 6. Model picker after adding a key

Back in the composer, the demo banner is gone and the Claude models are now
selectable (no "API key missing"), while Gemini/GPT remain marked because those
keys aren't set. Model availability tracks your configured keys in real time.

![Model picker with Claude key active](.walkthrough-shots/07-model-picker-key-active.png)

✅ Configured providers immediately become usable.

---

## 7. Real document analysis with citations ⭐

Attaching a PDF (a sample Master Services Agreement) and asking Mike to summarise
it produces a **real, streamed Claude analysis**. Mike ran a tool step to read
the document, then returned parties, a governing-law finding, and the
termination terms — each backed by an **inline citation that links to the exact
source text on the page**, plus a Citations panel at the bottom.

![Real analysis with inline citations](.walkthrough-shots/09-real-analysis-citations.png)

Highlights from this run:
- **Parties** — Acme Corp (Provider) and Blackstone Legal LLP (Client) [cited]
- **Governing law** — correctly flagged as *not specified*, and proactively
  suggested adding a clause
- **Termination** — 60 days' notice; immediate on uncured 15-day material breach
- 7 grounded citations, each hoverable back to the source quote

✅ This is the core value proposition and it works well — grounded, cited,
non-hallucinated answers over your own documents.

### Error handling

Mike also degrades gracefully when a provider rejects a request: it shows a
precise, categorised error with a **Retry** button and a pre-filled
"Report to support" email. (Captured here by deliberately feeding a corrupted
key during testing.)

![Provider auth error handling](.walkthrough-shots/08-auth-error-invalid-key.png)

✅ Provider errors are surfaced clearly instead of failing silently.

---

## 8. Projects

**Projects** group documents so you can run chats and tabular reviews across a
set. The empty state explains the concept and offers a clear CTA.

![Projects empty state](.walkthrough-shots/10-projects-empty.png)

Creating a project lets you name it, add a CM number, invite members, and select
from documents already uploaded to your workspace.

![New project dialog](.walkthrough-shots/11-new-project-dialog.png)

The new project appears in the list with file/chat/review counts and in the
sidebar under Recent Projects.

![Projects list](.walkthrough-shots/12-projects-list.png)

Opening a project shows its document tree with tabs for Documents, Assistant
Chats, and Tabular Reviews, plus New Chat / New Review actions.

![Project detail](.walkthrough-shots/13-project-detail.png)

✅ Full project lifecycle (create → populate → open) works.

---

## 9. Tabular reviews

A **tabular review** extracts a chosen set of fields ("columns") across every
document in the set, giving you a spreadsheet-style answer grid. You name the
review, optionally start from a workflow template, and pick documents.

![New tabular review](.walkthrough-shots/14-new-tabular-review.png)

Each column has a name, an output format (Free Text, Bulleted list, Yes/No, …),
and an analysis prompt, with presets and an "Auto-Generate Prompt" helper.

Running the review streams a result into each cell. Here the **Governing Law**
column correctly returns **"Not specified"** — consistent with the assistant's
finding in §7.

![Tabular review result](.walkthrough-shots/17-tabular-review-result.png)

✅ Tabular reviews run end-to-end and agree with the assistant's analysis.

> ⚠️ **Note:** tabular reviews use a *separate* default model from the
> assistant. See [Item 2 in the report](#items-that-need-your-attention).

---

## 10. Model preferences

**Settings → Model Preferences** controls two secondary models: the
**title-generation** model (used to auto-name chats — Claude Haiku by default)
and the **tabular-review** model (Gemini 3 Flash by default, chosen for cost).

![Model preferences](.walkthrough-shots/16-model-preferences.png)

✅ Sensible split of cheap vs. capable models. (The Gemini default is also the
source of the tabular-review key warning — see the report.)

---

## 11. Workflows

**Workflows** are a library of pre-built, practice-area-specific templates —
both Assistant prompts and Tabular review column-sets — spanning Corporate,
Finance, Litigation, Real Estate, Private Equity, Employment, and more.

![Workflows library](.walkthrough-shots/18-workflows-library.png)

Opening a workflow (e.g. **NDA Review**) previews its ready-made columns —
Definition of Confidential Information, Obligations, Standard Carveouts (Yes/No),
Term, Remedies, Governing Law, etc. — that you can apply to a review in one click.

![NDA Review workflow detail](.walkthrough-shots/19-workflow-nda-detail.png)

✅ A strong out-of-the-box template library; "Use" applies it to a review.

---

## Regression testing — common flows

Both **manual UI flows** (driven live in Chrome during this walkthrough) and the
**automated test suites** were exercised. All green.

### Manual flows (verified in-browser)

| # | Flow | Steps exercised | Result |
|---|------|-----------------|--------|
| 1 | Guest authentication | Clear session → `/login` → Continue as guest → lands on Assistant | ✅ Pass |
| 2 | Demo-mode chat | Select Demo model → send question → placeholder reply | ✅ Pass |
| 3 | Model switching | Open picker → switch Demo ↔ Claude Opus 4.8 | ✅ Pass |
| 4 | BYOK key save | Settings → paste Anthropic key → Save → "Saved key hidden" | ✅ Pass |
| 5 | BYOK key remove | Remove → field resets to placeholder | ✅ Pass |
| 6 | Document upload | Add documents → Upload files → PDF attaches to composer | ✅ Pass |
| 7 | Real analysis + citations | Ask over PDF with Claude → streamed, cited answer | ✅ Pass |
| 8 | Provider error handling | Rejected key → clear error + Retry + support link | ✅ Pass |
| 9 | Project create | New project → name + select doc → appears in list & sidebar | ✅ Pass |
| 10 | Project open | Open project → document tree + tabs render | ✅ Pass |
| 11 | Tabular review create | New Review → name + template + doc → grid created | ✅ Pass |
| 12 | Tabular column add | Add "Governing Law" column with prompt | ✅ Pass |
| 13 | Tabular review run | Run → cell returns "Not specified" (correct) | ✅ Pass* |
| 14 | Model preferences | Change tabular-review model to Claude Sonnet 4.6 | ✅ Pass |
| 15 | Workflows browse | Open library → open NDA Review → preview columns | ✅ Pass |
| 16 | Chat auto-title | Chat auto-named "Master Service Agreement Summary" | ✅ Pass |

\* Pass **after** switching the tabular-review model off the keyless Gemini
default — see report Item 2.

### Automated suites

| Suite | Command | Result |
|-------|---------|--------|
| Web unit/integration | `npm test --workspace apps/web` | ✅ **68 passed** / 18 files |
| API unit/integration | `npm test --workspace apps/api` | ✅ **502 passed**, 6 skipped / 62 files |
| Word add-in build | `npm run build` (word-addin) | ✅ Compiles (3 bundle-size warnings, non-blocking) |

---

## Items that need your attention

Ranked by priority. Items 1–2 are the ones you'll actually want to act on.

### 🔴 1. The Word add-in can't be exercised here — it needs your machine

The Office.js task pane add-in **cannot be driven through Chrome DevTools** — it
runs *inside* Microsoft Word against the Office runtime. To actually test it you
need to sideload it, which requires steps only you can do locally:

- **Install the dev HTTPS certificate** — `bash word-addin/scripts/dev.sh`
  prompts for your **keychain/admin password** the first time (Claude can't
  enter that).
- **Fully quit Word (Cmd-Q) and re-run** so Word reloads the cert trust.
- **Sideload `word-addin/manifest.xml`** into Word desktop (or Word on the web).
- The backend must be running on `:3001` and `word-addin/.env.development` must
  hold your Supabase URL + anon key (the script generates this).

**Status:** The add-in **builds cleanly** (`npm run build` → exit 0), so the code
is healthy; it just needs a human-in-the-loop sideload to test behaviour. This is
almost certainly the "word extension flag" you were expecting to handle.
→ **Action: run `bash word-addin/scripts/dev.sh` and sideload into Word.**

### ✅ 2. Tabular reviews default to a Gemini model you have no key for — **FIXED**

The tabular-review default model is **Gemini 3 Flash**, independent of the
assistant's model. With only an Anthropic key configured, the first review run
used to fail with an **"API key required"** toast rather than falling back to a
model you *can* use.

![Tabular review Gemini key warning](.walkthrough-shots/15-tabular-gemini-key-warning.png)

**Fix applied.** Tabular reviews now fall back to whatever model *is* configured:
- **Backend** (`apps/api/src/lib/userSettings.ts`) — `resolveTabularModel()`
  honours the user's stored choice, but if that model's provider has no key it
  swaps to a mid-tier model of a provider that does (`claude-sonnet-4-6`,
  `gpt-5.4`, …). Truly keyless users are left on the default so the existing
  demo/missing-key prompt still fires.
- **Frontend** (`modelAvailability.ts`, `TabularReviewView.tsx`,
  `TRChatPanel.tsx`) — the pre-run gate now checks the *effective* model, so it
  no longer blocks a run the server can service. The visible model selector still
  shows the user's saved preference.
- Covered by new unit tests in `apps/api/src/lib/__tests__/userSettings.test.ts`.

**Verified live:** with the tabular model left on the keyless Gemini default, the
review ran and returned "Not specified" with **no "API key required" toast** —
it silently used the configured Claude key.

### ✅ 3. React hydration mismatch on the full-screen loader (dev overlay "1 Issue") — **FIXED**

Next.js flagged one console error on load: a **hydration mismatch** on the
full-screen loading spinner. The same loader markup was duplicated with two
different styles:

- Server rendered `apps/web/src/app/(pages)/layout.tsx:80` →
  `flex h-screen … border-gray-300`
- Client rendered `apps/web/src/app/components/shared/MfaLoginGate.tsx:125` and
  `apps/web/src/components/providers.tsx:27` →
  `flex min-h-dvh … bg-gray-50/80 … border-gray-200`

Same DOM position, different attributes → React couldn't reconcile it.

![Hydration error overlay](.walkthrough-shots/20-hydration-error.png)

**Fix applied.** Extracted a single shared
`apps/web/src/app/components/shared/FullScreenLoader.tsx` and used it in all
three spots (`(pages)/layout.tsx`, `MfaLoginGate.tsx`, `providers.tsx`), so every
gate now renders byte-identical markup. **Verified live:** reloading the app no
longer logs the hydration error (the only remaining console "issue" is a
separate, pre-existing form-field-`id`/`name` accessibility warning).

### 🟡 4. Rotate the Anthropic API key you shared

The key you pasted in chat works (verified against Anthropic directly), but it's
now in this conversation's history. **Please rotate it** in the Anthropic console
once you're done, and prefer adding it via the app's Settings → API Keys (or the
server `.env`) rather than in chat next time.

### ⚪ 5. Minor / low-priority observations

- **Demo banner can briefly reappear after navigation.** On one page load of
  `/workflows` the "no key" banner flashed despite a configured key; a reload
  cleared it. Root cause: `UserProfileContext` falls back to an *empty-keys,
  unlimited-credits* profile if the profile fetch throws — so a transient fetch
  failure silently downgrades the UI. Worth hardening the fetch/retry so a blip
  doesn't resurface demo mode.
- **Bundle size (Word add-in).** The build warns the task pane bundle is 522 KiB
  (> 244 KiB recommended). Non-blocking; consider code-splitting later.
- **Dev data hygiene.** The pre-existing session was full of leftover "E2E Test"
  projects/chats. Not a product bug, but the local DB could use a reset before a
  clean demo.
- **Screenshot cleanup.** `.walkthrough-shots/` still contains 5 older captures
  from a prior run (`01-login-guest-button.png`, `02-first-run-banner.png`,
  `03-model-picker-demo.png`, `04-demo-mode-reply.png`, `05-upload-toast.png`).
  This walkthrough uses the newer, consistently-numbered set; the old ones can be
  deleted.

---

*Generated by walking through the running app in Chrome on 2026-07-05.*
