# Mike

Open-source release containing the Mike frontend and backend.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, Supabase access, document processing, and migrations
- `backend/migrations/000_one_shot_schema.sql` - one-shot Supabase schema for fresh databases

## Prerequisites

You'll need accounts and/or tools for the following before you start:

- **[Node.js](https://nodejs.org/)** 20+ - verify with `node -v`
- **[git](https://git-scm.com/downloads)** - verify with `git --version`
- A **[Supabase](https://supabase.com/)** project - free tier is fine
- A **[Cloudflare R2](https://developers.cloudflare.com/r2/)** bucket - or any S3-compatible object store
- At least one model provider API key:
  - **[Anthropic](https://console.anthropic.com/settings/keys)** (Claude)
  - **[Google Gemini](https://aistudio.google.com/apikey)**
  - **[OpenRouter](https://openrouter.ai/keys)**
- *(optional)* **[LibreOffice](https://www.libreoffice.org/download/download/)** - only required if you want to upload `.doc` / `.docx` files; not needed for first run

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/<owner>/mike-oss.git
cd mike-oss
```

### 2. Install dependencies

```bash
npm install --prefix backend
npm install --prefix frontend
```

### 3. Create env files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Then fill in the values. See the [Environment variables](#environment-variables) section below for what each one is and where to get it.

### 4. Run the database schema

In your Supabase project dashboard, go to **SQL Editor** and run the contents of `backend/migrations/000_one_shot_schema.sql`.

### 5. Start the backend

```bash
npm run dev --prefix backend
```

Backend runs on `http://localhost:3001`.

### 6. Start the frontend

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

### 7. Sign up and add your model API key

Sign up in the app. Confirmation emails are sent by Supabase Auth.

Once logged in, go to **Account → Models** and paste your Anthropic / Gemini API key into the per-user field. Models are gated on per-user keys - the values in `backend/.env` are server-side fallbacks, not a substitute for the per-user setup.

## Environment variables

> Supabase has moved the API settings around recently. The Project URL now lives under **Settings → Data API**, and the keys live under **Settings → API Keys → Legacy** tab. The "Legacy" `anon` and `service_role` keys are the ones the env vars expect - not the new `sb_publishable_*` / `sb_secret_*` format. The easiest way to grab the URL is to click the **Connect** button at the top of your project dashboard.

### Backend (`backend/.env`)

| Variable | Where to get it |
| --- | --- |
| `PORT` | Defaults to `3001` |
| `FRONTEND_URL` | `http://localhost:3000` for local dev |
| `SUPABASE_URL` | Supabase → Settings → Data API → Project URL |
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API Keys → **Legacy** tab → `service_role` key |
| `R2_ENDPOINT_URL` | Cloudflare → R2 → Manage R2 API tokens (account-scoped endpoint URL) |
| `R2_ACCESS_KEY_ID` | Cloudflare → R2 → API token (Object Read & Write) |
| `R2_SECRET_ACCESS_KEY` | Same as above |
| `R2_BUCKET_NAME` | The bucket name you created in R2 |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys |

### Frontend (`frontend/.env.local`)

| Variable | Where to get it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase → Settings → API Keys → **Legacy** tab → `anon` key |
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API Keys → **Legacy** tab → `service_role` key |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001` for local dev |

## Troubleshooting

**`npm install` warns about peer dependencies.** npm warnings during install are usually fine - only stop if you see `npm error code ERESOLVE`. If you do hit a hard `ERESOLVE` failure, check that your `next` version in `frontend/package.json` is recent enough for the `@opennextjs/cloudflare` peer range - bumping `next` is safer than `--legacy-peer-deps`.

**Sign-up confirmation email never arrives.** Confirmation emails are sent by Supabase Auth (not by Mike). For local development, the simplest fix is to disable email confirmation in **Supabase → Authentication → Providers → Email**. For production you'll want a custom SMTP configured in Supabase - the built-in mailer is heavily rate-limited and often restricted to team-member email addresses only on newer projects.

**The model picker won't let me select Claude/Gemini even though my API key is in `.env`.** Models are gated on a *per-user* API key stored in the Supabase `user_profiles` table, not on the env var. After signing up, go to **Account → Models** in the running app and paste your key into the per-user field. The `.env` keys are server-side fallbacks only.

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only. See `LICENSE`.
