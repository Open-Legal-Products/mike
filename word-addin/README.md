# Mike Word Add-in

An Office.js task pane add-in that brings the Mike legal AI platform directly into Microsoft Word. From the task pane you can chat with an AI about the open document, attach additional documents and workflows, choose a model, receive suggestions that are applied immediately as tracked-change redlines, accept or reject them individually or as a group, launch configurable quick actions, and execute saved Mike workflows against the document — all without leaving Word.

The add-in talks to the **same API and Supabase project as the web app**: sign-in goes directly to Supabase (`/auth/v1/token`), while Word chat, workflows, document uploads, profiles, and model discovery call the Mike API (`http://localhost:3001` in local development). Word conversations use dedicated `word_*` tables and never appear in the web assistant's ordinary chat history.

---

## Prerequisites

- Node.js 22+
- Microsoft Word desktop (macOS or Windows) **or** Word on the web — sideloading steps differ; see below (desktop is the smoother path for local development)
- The Mike API running locally (`npm run dev` from `backend/`) and Supabase configured per the root [README](../README.md) (`backend/.env` + `frontend/.env.local`)
- A Mike user account — the pane signs in with the same credentials as the web app. Sign up through the web app once, or create a user in Supabase Auth (Dashboard → Authentication → Add user).
- For real model responses, a funded LLM API key in `backend/.env` — or use the keyless stand-in described in [Testing without an LLM key](#testing-without-an-llm-key).

---

## Quick start (one command)

If the API is already running and `frontend/.env.local` is filled in, this script does everything below for you — reads the Supabase URL + publishable key, writes `.env`, installs dependencies, installs the trusted dev certificate, and launches the add-in into Word:

```bash
bash word-addin/scripts/dev.sh
```

It is idempotent (safe to re-run) and only prompts you when it genuinely needs input — namely the **keychain/admin password** when installing the dev HTTPS certificate the first time. After the cert installs, **fully quit Word (Cmd-Q)** and re-run the script so Word reloads the trust.

The script verifies the backend before launching:

- **Mike backend** — `GET <api>/health`
- **Supabase** — `GET <supabase>/auth/v1/health`

If either is down it prints how to start them and **refuses to launch** (the task pane would just fail to sign in). Start the backend first:

```bash
# from backend/
npm run dev                  # the Mike API on :3001
```

Flags:

- `--setup-only` — do everything except the final `npm start` (prep deps/env/cert; report backend status without launching).
- `FORCE=1 bash word-addin/scripts/dev.sh` — launch even if the backend check fails (sign-in won't work until Mike is up).

The sections below explain each step the script automates, and the manual / web sideloading paths.

---

## Setup (manual)

1. **Install dependencies**

   ```bash
   cd word-addin && npm install
   ```

2. **Set environment variables**

   Webpack loads `word-addin/.env` automatically for local development. Copy the example file or create it directly:

   ```bash
   cp .env.example .env
   # then edit word-addin/.env
   REACT_APP_SUPABASE_URL=https://localhost:3200
   REACT_APP_SUPABASE_ANON_KEY=<your Supabase anon / publishable key>
   REACT_APP_API_BASE_URL=https://localhost:3200/api
   REACT_APP_WEB_APP_URL=https://app.mikeoss.com
   SUPABASE_PROXY_TARGET=https://your-project.supabase.co
   API_PROXY_TARGET=http://localhost:3001
   ```

   - `REACT_APP_SUPABASE_ANON_KEY` — the same publishable key as `frontend/.env.local`.
   - The API and Supabase `REACT_APP_*_URL` values point the HTTPS task pane at its same-origin proxy. `SUPABASE_PROXY_TARGET` and `API_PROXY_TARGET` identify the real upstream services.
   - `REACT_APP_WEB_APP_URL` is used only for account links such as **Set up API keys**. It defaults to the deployed Mike app; override it if you want account links to open a local frontend.

   > **Mixed content / HTTPS:** Word serves the task pane over HTTPS and blocks plain-HTTP browser requests. Keep the compiled URLs on `https://localhost:3200`; webpack proxies `/api` to the Mike API and `/auth` to Supabase. The recommended `scripts/dev.sh` configures this automatically.

   Existing shell variables take precedence over `.env`, which keeps CI and deployed builds configurable without modifying the file. Production builds continue to require their values from the deployment environment.

   `scripts/dev.sh` regenerates `.env` from the frontend configuration while preserving explicit add-in overrides. If you edit `.env` while webpack is running, restart the add-in dev server because the file is loaded only at startup.

3. **Trust the dev SSL certificate (one time only)**

   The dev server runs on `https://localhost:3200` with a self-signed certificate. Word refuses to load add-ins over untrusted HTTPS. Install the trusted cert once:

   ```bash
   npx office-addin-dev-certs install
   ```

   Restart Word after installing.

4. **Start the Mike backend**

   From the `word-addin` directory:

   ```bash
   (cd ../backend && npm run dev)
   ```

5. **Start the add-in and sideload into Word**

   ```bash
   npm start
   # or
   bun dev
   ```

   Both commands run `office-addin-debugging start manifest.xml`, which starts the webpack dev server on `https://localhost:3200` **and** automatically opens Word with the add-in sideloaded. The task pane appears under **Home → Mike Legal AI → Mike**. Use `bun run dev:server` only when you intentionally want the raw webpack server without sideloading Word.

---

## Sideloading manually (if `npm start` does not auto-load)

### Word desktop — macOS

```bash
mkdir -p ~/Library/Containers/com.microsoft.Word/Data/Documents/wef
cp manifest.xml ~/Library/Containers/com.microsoft.Word/Data/Documents/wef/
```

Restart Word, then: **Insert → Add-ins → My Add-ins → Mike**

### Word on the web

**Insert → Add-ins → Upload My Add-in** → select `manifest.xml`

> **Caveat — the pane will silently fail to load in a normal browser.** Word on the web is a _public_ origin (`word-edit.officeapps.live.com`) and the dev pane is `https://localhost:3200`; Chrome's Local Network Access checks block a public page from embedding a localhost iframe, with no visible error — the pane simply never appears. This affects dev sideloads only (a deployed add-in on a public HTTPS host is unaffected). To test against real Word on the web locally, use the ready-made launcher, which starts a browser with those checks disabled, sideloads the manifest, opens the pane, and hands you the window:
>
> ```bash
> node e2e-live/word-web-session.mjs --login   # one-time Microsoft sign-in (persistent profile)
> node e2e-live/manual-session.mjs             # opens Word online with the pane ready
> ```

The manifest requires `WordApi 1.6`, which includes the tracked-change inspection, accept, and reject APIs used by assistant edit cards. Word will not activate the add-in on a host that does not satisfy that requirement set.

## Production build

Production builds fail fast unless every service endpoint and the deployed add-in URL are explicit. This prevents publishing a bundle that silently calls localhost or has no Supabase key.

```bash
cd word-addin
REACT_APP_API_BASE_URL=https://api.example.com \
REACT_APP_SUPABASE_URL=https://example.supabase.co \
REACT_APP_SUPABASE_ANON_KEY=... \
REACT_APP_WEB_APP_URL=https://app.example.com \
WORD_ADDIN_PUBLIC_URL=https://word.example.com \
npm run build
```

The build writes the task-pane assets and a deployable, URL-rewritten manifest to `dist/`. The checked-in `manifest.xml` remains the localhost sideloading manifest.

Add the deployed task-pane origin to the API deployment as
`WORD_ADDIN_URL=https://word.example.com` (or include it in the comma-separated
`ALLOWED_ORIGINS` value). Without that allowlist entry, browsers will block the
add-in's direct production API requests at CORS preflight.

---

## Features

### Chat

Ask any question about the open document. The add-in sends Word conversations to the dedicated `POST /word-chat` route with the active document in `document_context`. That route adds the Word-specific system prompt server-side, while persisted user messages contain only the text the user typed. Responses stream in real time.

Chat storage defaults to **Cloud**. Open **Settings** from the hamburger menu to switch to **This device only**, which bypasses server chat persistence and stores document-scoped conversations in IndexedDB. The preference is stored separately for each signed-in account. Local chats are not encrypted by the add-in and remain in the current operating-system profile after sign-out; Settings includes a permanent **Delete** action for that account's device-only chats. Switching locations does not copy or delete existing conversations; Chat History displays the currently selected location. Cloud storage requires the `20260809_01_word_addin_chats.sql` backend migration on existing databases (fresh databases receive the same tables from `backend/schema.sql`).

The add-in links cloud chat history to an identifier saved in the Word
document's Office settings. That metadata travels with a copied or externally
shared `.docx`, although the server still scopes every history lookup to the
signed-in Mike account. A same-account **Save As** copy therefore initially
shares the source document's chat history. Remove the Mike document setting or
treat the copy as a new document before external distribution when that stable
metadata is undesirable.

The composer mirrors the web assistant controls:

- **Add documents** opens the same library-style selector used by the web assistant. Search and select files, templates, or project documents, or upload new files from inside the modal; confirmed documents appear as removable chips and are attached to the next message.
- **Add workflows** opens the assistant workflow picker. The selected workflow appears as a removable chip and is attached to the next message.
- **Model** opens the same grouped Anthropic, Google, OpenAI, and dynamically discovered Ollama choices used by the web app.

The chat header and composer float over the message surface. Use **New chat** to clear the current conversation, **Chat history** to reopen a saved conversation, and the hamburger menu to access Quick Actions, Workflows, or Sign out.

When an answer proposes document edits, it streams each change using `<original>`, `<replacement>`, and `<reason>` tags. The task pane hides those transport tags, renders edit cards immediately, applies sealed edits to Word as tracked changes, and provides **Accept** and **Reject** controls for review.

### Quick Actions

Quick Actions are shortcuts that prepare the Assistant rather than running a separate execution screen. Selecting one attaches its linked workflow and fills the composer with a complete starting prompt; the user can review or edit that prompt before sending it.

The built-in actions are **Proofread**, **Compare documents**, **Extract key terms**, and **Draft from template**. Open **Quick Actions** from the hamburger menu to inspect each action's prompt and linked workflow or hide it from the Assistant's initial view.

### Workflows

Open **Workflows** from the hamburger menu to browse assistant workflows. Editable workflows use the same Tiptap Markdown editor as the web app, with rich-text formatting, tables, raw Markdown mode, and automatic saving. Use the header **+** button to create an assistant workflow, optionally importing its instructions from a `.md` or `.markdown` file. The **Use** action returns to Assistant and attaches the selected workflow to the next message.

---

## Signing in

Enter the same email and password you use for the Mike web app. The add-in authenticates directly against Supabase (`/auth/v1/token`) and stores the access token in `OfficeRuntime.storage` (persists across task pane reloads). Open the hamburger menu and click **Sign out** to clear the token.

---

## Tests

The add-in ships a strict TypeScript check and a hermetic Playwright e2e suite that runs entirely against a mocked Office.js host and a stubbed backend — no Word, Supabase, or live backend required:

```bash
cd word-addin
npm run typecheck
npm run build:e2e
npm run test:e2e
```

It builds the bundle with test env vars, serves it over plain HTTP, injects an Office.js mock (`e2e/support/office-mock.ts`), and drives the exposed task-pane flows (auth, chat, quick actions, workflows, chat history, storage, and tracked-edit persistence).

The Office.js mock enforces the task-pane flows in CI, but cannot prove every
desktop Word host behavior. Before release, manually verify one multi-paragraph
tracked replacement and its Accept/Reject actions in supported Word desktop,
then repeat after closing and reopening the task pane.

### Shared UI sync checklist

The task pane is independently bundled, so a small set of web UI files remains
vendored temporarily. When the web design system changes, compare and update:

- `src/shared/styles/tokens.css` against `frontend/src/app/globals.css`;
- `src/taskpane/lib/modelCatalog.ts` against the web `ModelToggle` catalog;
- `src/shared/chat/ChatInput.tsx` and `src/shared/ui/button.tsx` against their
  web counterparts, preserving only narrow-pane adaptations.

Workflow selection is currently button-based in the task pane. The web
assistant's slash-command workflow picker remains an intentional scope cut.

---

## Testing without an LLM key

No funded API key? `e2e-live/anthropic-stub.mjs` is a tiny local server that speaks the Anthropic Messages streaming protocol and returns scripted answers keyed to the add-in's prompts (chat redlines, proofread, anonymise, improve, draft). Everything else stays real — Supabase auth, the Mike backend, SSE streaming, and the Word JS API tracked changes:

```bash
node e2e-live/anthropic-stub.mjs &                          # listens on :4141
# then start the backend pointed at it:
(cd ../backend && ANTHROPIC_BASE_URL=http://127.0.0.1:4141 npm run dev)
```

The stub's answers are static, so exercise it with the document flaws it scripts against (see the constants at the top of `anthropic-stub.mjs`). For manual Word-on-the-web testing, capture a Microsoft session with `node e2e-live/word-web-session.mjs --login`, then run `node e2e-live/manual-session.mjs` to sideload the current add-in.

---

## Troubleshooting

**Word shows "The content is blocked because it isn't signed by a valid security certificate" — including when it worked before**
This is _certificate trust drift_, and it will eventually happen to every returning developer: the dev certificate expires after ~30 days, and the tooling then silently regenerates it **with a new signing CA** (the webpack dev server does this on startup). Your OS keychain still trusts only the _old_ CA, so Word rejects the pane — while `npx office-addin-dev-certs verify` misleadingly reports "trusted", because it only checks that a CA _by that name_ exists, not that it signed the current certificate. `npx office-addin-dev-certs install` then refuses to reinstall for the same reason.

`bash scripts/dev.sh` now detects and repairs this automatically (it verifies the real chain against the OS trust store). To fix it by hand on macOS:

```bash
# 1. Ground truth — does the OS trust the cert actually being served?
security verify-cert -c ~/.office-addin-dev-certs/localhost.crt -p ssl -s localhost

# 2. If that fails: force a real reinstall (approve the keychain prompt)
npx office-addin-dev-certs uninstall
npx office-addin-dev-certs install

# 3. Verify step 1 again; if still untrusted, trust the current CA directly:
security add-trusted-cert -r trustRoot \
  -k ~/Library/Keychains/login.keychain-db ~/.office-addin-dev-certs/ca.crt
```

Then **fully quit Word (Cmd-Q)** — its webview caches trust decisions — and relaunch with `npm start`.

**`npm start` fails with `EEXIST: file already exists, link 'manifest.xml' -> …/wef/….manifest.xml`**
A previous run exited without deregistering (crash, Ctrl-C) and left the sideload hard-link behind. `npm start` now clears this automatically via its `prestart` hook; if you hit it anyway, run `npm run stop` and retry.

**`npm start` fails with `Cannot find module 'semver'` from `office-addin-dev-settings`**
Run `npm install` in `word-addin/`. `semver` is intentionally a direct development dependency because the Office sideloading tool loads it at runtime without reliably declaring it in every affected dependency graph; do not remove it as “unused.”

**`npm start` / `dev.sh` complains port 3200 is in use**
The add-in dev server and manifest use `https://localhost:3200`. Find the holder with `lsof -nP -iTCP:3200 -sTCP:LISTEN` and stop it before restarting the add-in.

**The pane never appears in Word on the web**
See the caveat under [Word on the web](#word-on-the-web) — Chrome's Local Network Access checks silently block the localhost iframe; use `e2e-live/manual-session.mjs`.

**Add-in shows blank after the cert is trusted**
Right-click the task pane → **Inspect** and check the console for errors. A common cause is a missing or wrong `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` in `.env`.

**Login fails with "Login failed" or a 401**
Confirm the `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` in `.env` match `frontend/.env.local`, and that the URL has no trailing slash.

**Tracked edit review is unavailable**
The add-in requires WordApi 1.6. Confirm the Word host and build support that requirement set; otherwise use a supported Microsoft 365 Word client.

**Document upload fails**

- Confirm the Mike API is running (`npm run dev` in `backend/`) and reachable at `http://localhost:3001`
- Confirm the API's configured object-storage bucket exists
- Check the backend logs for the specific error

**Workflows page shows "No workflows found"**
Workflows are fetched from `GET /workflows` on the Mike backend. Confirm the backend is running and that at least one workflow exists in the database.
