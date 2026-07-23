# Mike Word Add-in

An Office.js task pane add-in that brings the Mike legal AI platform directly into Microsoft Word. From the task pane you can chat with an AI about the open document (with optional full-document context), apply AI suggestions as tracked-change redlines, run one-click actions (improve writing, proofread, anonymise, draft clause), execute saved Mike workflows against the document, and browse or upload to Mike projects — all without leaving Word.

The add-in talks to the **same API and Supabase project as the web app**: sign-in goes directly to Supabase (`/auth/v1/token`), while chat, actions, workflows, projects, and uploads call the Mike API (`http://localhost:3001` in local development).

---

## Prerequisites

- Node.js 22+
- Microsoft Word desktop (macOS or Windows) **or** Word on the web — sideloading steps differ; see below
- The Mike API running locally (`npm run dev` from `backend/`) and Supabase configured per the root [README](../README.md) (`backend/.env` + `frontend/.env.local`)

---

## Quick start (one command)

If the API is already running and `frontend/.env.local` is filled in, this script does everything below for you — reads the Supabase URL + publishable key, writes `.env.development`, installs dependencies, installs the trusted dev certificate, and launches the add-in into Word:

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

   The webpack build reads these from `process.env` at compile time. Create a file called `.env.development` in `word-addin/`:

   ```bash
   # word-addin/.env.development
   REACT_APP_SUPABASE_URL=https://your-project.supabase.co
   REACT_APP_SUPABASE_ANON_KEY=<your Supabase anon / publishable key>
   REACT_APP_API_BASE_URL=http://localhost:3001
   ```

   - `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` — the same values as `frontend/.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (from the Supabase dashboard).
   - `REACT_APP_API_BASE_URL` — the Mike backend; default is `http://localhost:3001`.

   > **Mixed content / HTTPS:** Word serves the task pane over HTTPS (`https://localhost:3000`), and its WebView blocks plain-HTTP requests to the local backend. The `dev.sh` script avoids this by pointing the bundle at the dev server's same-origin HTTPS proxy (it sets the URLs to `https://localhost:3000` and proxies `/api` → `http://localhost:3001` and `/auth` etc. → Supabase). If you set the raw URLs above by hand, use `dev.sh` or replicate that proxy when testing in desktop Word.

   Because this is a custom webpack build (not Create React App), `.env.development` is **not** read automatically. Source it before running npm commands:

   ```bash
   set -a && source .env.development && set +a
   ```

3. **Trust the dev SSL certificate (one time only)**

   The dev server runs on `https://localhost:3000` with a self-signed certificate. Word refuses to load add-ins over untrusted HTTPS. Install the trusted cert once:

   ```bash
   npx office-addin-dev-certs install
   ```

   Restart Word after installing.

4. **Start the Mike backend**

   From the repo root:

   ```bash
   (cd ../backend && npm run dev)
   ```

5. **Start the add-in and sideload into Word**

   ```bash
   npm start
   ```

   This runs `office-addin-debugging start manifest.xml`, which starts the webpack dev server on `https://localhost:3000` **and** automatically opens Word with the add-in sideloaded. The task pane appears under **Home → Mike Legal AI → Open Mike**.

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

The manifest requires `WordApi 1.4`, which includes the change-tracking APIs. Word will not activate the add-in on a host that does not satisfy that requirement set.

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

---

## Features

### Chat tab

Ask any question about the open document. Toggle **Use document as context** to send the full document text to the AI with each message (posted to the backend as `documentContext`, which `POST /chat` nonce-fences into the system prompt as reference data). Responses stream in real time. On any AI response you can:

- **Insert below cursor** — inserts one or more real paragraphs after the paragraph containing the current selection; selected text is never overwritten
- **Insert below (tracked)** — performs the same paragraph-aware insertion with change tracking enabled, then restores the user's prior tracking mode

### Actions tab

One-click AI operations, each streaming their result into a result box:

| Action | What it does |
|---|---|
| **Improve Writing** | Captures the exact selected range and rewrites it for clarity and professionalism. The result can replace that captured range with or without tracking. It never searches for and replaces a different duplicate elsewhere, and it refuses to apply if the selected range changed while the model was responding. |
| **Proofread** | Reviews the **entire document** for grammar, typos, punctuation, and stylistic issues. Lists each problem with the original text and a suggested correction. Result is read-only (review and copy manually). |
| **Anonymise** | Scans the **entire document** for PII (names, addresses, phone numbers, dates of birth, IDs, etc.) and produces a numbered list of occurrences with proposed anonymised replacements. Result is read-only. |
| **Draft Clause** | Enter a description of the clause you need, then click **Draft clause**. The result is normalised from model Markdown into Word paragraphs and can be inserted below the cursor with or without tracking. |

### Workflows tab

Select a saved Mike workflow from the dropdown and click **Run workflow on document**. The workflow instruction and document context are sent to the API. Results stream in and can be inserted as paragraphs below the cursor.

### Projects tab

Browse Mike projects you have access to. Selecting a project shows all documents currently in it. Click **Upload current document to project** to export the open Word document as a `.docx` file and upload it to the selected project via the Mike backend.

---

## Signing in

Enter the same email and password you use for the Mike web app. The add-in authenticates directly against Supabase (`/auth/v1/token`) and stores the access token in `OfficeRuntime.storage` (persists across task pane reloads). Click **Sign out** in the header to clear the token.

---

## Tests

The add-in ships a strict TypeScript check and a hermetic Playwright e2e suite that runs entirely against a mocked Office.js host and a stubbed backend — no Word, Supabase, or live backend required:

```bash
cd word-addin
npm run typecheck
npm run build:e2e
npm run test:e2e
```

It builds the bundle with test env vars, serves it over plain HTTP, injects an Office.js mock (`e2e/support/office-mock.ts`), and drives every task-pane flow (auth, chat, actions, workflows, projects).

---

## Troubleshooting

**"Certificate not trusted" / blank white pane on load**
Run `npx office-addin-dev-certs install` from `word-addin/`, then fully quit and restart Word.

**Add-in shows blank after the cert is trusted**
Right-click the task pane → **Inspect** and check the console for errors. A common cause is a missing or wrong `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` — the bundle compiles with empty strings if the env vars were not exported before `npm start`.

**Login fails with "Login failed" or a 401**
Confirm the `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` in `.env.development` match `frontend/.env.local`, and that the URL has no trailing slash.

**Tracked insertion is unavailable**
The add-in requires WordApi 1.4. Confirm the Word host and build support that requirement set; otherwise use a supported Microsoft 365 Word client.

**Document upload fails**
- Confirm the Mike API is running (`npm run dev` in `backend/`) and reachable at `http://localhost:3001`
- Confirm the API's configured object-storage bucket exists
- Check the backend logs for the specific error

**Workflows tab shows "No workflows found"**
Workflows are fetched from `GET /workflows` on the Mike backend. Confirm the backend is running and that at least one workflow exists in the database.
