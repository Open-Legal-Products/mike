# Mike Word Add-in

An Office.js task pane add-in that brings the Mike legal AI platform directly into Microsoft Word. From the task pane you can chat with an AI about the open document (with optional full-document context), apply AI suggestions as tracked-change redlines, run one-click actions (improve writing, proofread, anonymise, draft clause), execute saved Mike workflows against the document, and browse or upload to Mike projects — all without leaving Word.

The add-in talks to the **same backend and Supabase project as the web app**: sign-in goes directly to Supabase (`/auth/v1/token`), uploads use Supabase storage, and chat/actions/workflows/projects call the Mike backend (`http://localhost:3001` in local dev).

---

## Prerequisites

- Node.js 18+
- Microsoft Word desktop (macOS or Windows) **or** Word on the web — sideloading steps differ; see below
- The Mike backend running locally (`cd backend && npm run dev`) and a Supabase project configured per the repo root [README](../README.md) (`backend/.env` + `frontend/.env.local`)

---

## Quick start (one command)

If the backend is already running (`cd backend && npm run dev`) and `frontend/.env.local` is filled in, this script does everything below for you — reads the Supabase URL + anon key from `frontend/.env.local`, writes `.env.development`, installs dependencies, installs the trusted dev certificate, and launches the add-in into Word:

```bash
bash word-addin/scripts/dev.sh
```

It is idempotent (safe to re-run) and only prompts you when it genuinely needs input — namely the **keychain/admin password** when installing the dev HTTPS certificate the first time. After the cert installs, **fully quit Word (Cmd-Q)** and re-run the script so Word reloads the trust.

The script verifies the backend before launching:

- **Mike backend** — `GET <api>/health`
- **Supabase** — `GET <supabase>/auth/v1/health`

If either is down it prints how to start them and **refuses to launch** (the task pane would just fail to sign in). Start the backend first:

```bash
# repo root
cd backend && npm run dev    # the Mike backend on :3001
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
   cd backend && npm run dev
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

> Note: Word on the web does not support tracked changes via the Word JavaScript API (`WordApi 1.4`). The "Apply as tracked change" buttons require Word desktop.

---

## Features

### Chat tab

Ask any question about the open document. Toggle **Use document as context** to send the full document text to the AI with each message (posted to the backend as `documentContext`, which the chat routes fence into the system prompt). Responses stream in real time. On any AI response you can:

- **Insert at cursor** — pastes the response text at the current cursor position
- **Apply as tracked change** — inserts the response as a tracked-change revision (Word desktop only; requires WordApi 1.4)

### Actions tab

One-click AI operations, each streaming their result into a result box:

| Action | What it does |
|---|---|
| **Improve Writing** | Rewrites the currently **selected text** for clarity and professionalism. Result can be applied as a tracked change (replaces the original selection) or inserted at cursor. Select some text first — the button does nothing if the selection is empty. |
| **Proofread** | Reviews the **entire document** for grammar, typos, punctuation, and stylistic issues. Lists each problem with the original text and a suggested correction. Result is read-only (review and copy manually). |
| **Anonymise** | Scans the **entire document** for PII (names, addresses, phone numbers, dates of birth, IDs, etc.) and produces a numbered list of occurrences with proposed anonymised replacements. Result is read-only. |
| **Draft Clause** | Enter a description of the clause you need (e.g. "limitation of liability for SaaS product"), then click **Draft clause**. The result can be inserted at cursor or applied as a tracked change. |

### Workflows tab

Select a saved Mike workflow from the dropdown and click **Run workflow on document**. The workflow's instruction is sent as a system prompt with the full document text as the user message. Results stream in and can be inserted at cursor.

### Projects tab

Browse Mike projects you have access to. Selecting a project shows all documents currently in it. Click **Upload current document to project** to export the open Word document as a `.docx` file and upload it to the selected project via the Mike backend.

---

## Signing in

Enter the same email and password you use for the Mike web app. The add-in authenticates directly against Supabase (`/auth/v1/token`) and stores the access token in `OfficeRuntime.storage` (persists across task pane reloads). Click **Sign out** in the header to clear the token.

---

## Tests

The add-in ships a hermetic Playwright e2e suite that runs entirely against a mocked Office.js host and a stubbed backend — no Word, Supabase, or live backend required:

```bash
cd word-addin && npm run test:e2e
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

**"Apply as tracked change" does nothing**
Tracked changes require WordApi 1.4, available in Word 2019 and Microsoft 365. Word on the web does not support this API. Upgrade to Word desktop or use "Insert at cursor" instead.

**Document upload fails**
- Confirm the Mike backend is running (`cd backend && npm run dev`) and reachable at `http://localhost:3001`
- Confirm the storage bucket exists in your Supabase project
- Check the backend logs for the specific error

**Workflows tab shows "No workflows found"**
Workflows are fetched from `GET /workflows` on the Mike backend. Confirm the backend is running and that at least one workflow exists in the database.
