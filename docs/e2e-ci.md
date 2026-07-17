# End-to-end tests in CI

The Playwright suite (`e2e/`) runs on every pull request through
`.github/workflows/e2e.yml`. This document covers the one repository secret it
needs and the **branch-protection step that turns a red run into a blocked
merge** — the workflow reports pass/fail on its own, but only branch protection
makes that check *required*.

## What the workflow does

On every `pull_request` targeting `main` (or `upstream-main`, the fork mirror),
and on manual `workflow_dispatch`, the `e2e / playwright` job:

1. installs the root (Playwright), `backend/`, and `frontend/` dependencies;
2. boots **MinIO** (S3-compatible object storage — three specs upload documents);
3. boots **local Supabase** (Auth + Postgres) via the Supabase CLI and loads
   `backend/schema.sql` — the same fresh-database schema the README tells a human
   to run;
4. writes `backend/.env` and `frontend/.env.local` from the live Supabase values;
5. starts the backend API (`:3001`) and the Next.js web app (`:3000`), waits for
   both to be healthy;
6. runs `npx playwright test` and uploads the HTML report + traces as an artifact
   (`playwright-report`) on both pass and fail.

`e2e/auth.setup.ts` bootstraps the shared test user (`e2e@mike.local`) against
the local Supabase admin API, so no login secret is needed — the credentials
baked into that file are the single source of truth.

## Required secret

| Secret | Why | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | The critical-path / chat specs send a message and assert a **streamed** answer, which needs a live model key. | Those chat specs fail; every other spec still runs. |

Add it under **Settings → Secrets and variables → Actions → New repository
secret**. For pull requests opened from a **fork**, GitHub withholds secrets by
default — a maintainer approves the run (or re-runs from the branch) so the key
is available. Treat that approval as the point where the chat specs become
enforceable for external contributions.

## Make it merge-blocking

The workflow failing is not enough on its own — GitHub will still allow the merge
unless the check is **required**. Enable branch protection once you have seen the
suite go green a few times (it is environment-sensitive by nature):

1. **Settings → Branches → Add branch protection rule** (or edit the rule for
   `main`).
2. Enable **Require status checks to pass before merging**.
3. Enable **Require branches to be up to date before merging**.
4. In the checks search box add **`e2e / playwright`** (the job appears in the
   list after it has run at least once on a PR).
5. Recommended alongside it: the unit/build check `backend` and the `license/cla`
   check.
6. Save. From now on a red e2e run blocks the **Merge** button.

Equivalent via the GitHub CLI (repo admin token required):

```bash
gh api -X PUT repos/OWNER/REPO/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=e2e / playwright' \
  -f 'enforce_admins=true' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -f 'restrictions='
```

## Running the suite locally

Locally, `playwright.config.ts` starts the backend and web dev servers for you
(`webServer` is only disabled when `CI=true`), so a full local stack plus:

```bash
npm ci
npx playwright install --with-deps chromium
npm run test:e2e            # or test:e2e:ui / test:e2e:headed
```

`e2e/auth.setup.ts` reads `SUPABASE_URL` / `SUPABASE_SECRET_KEY` from the
environment or `backend/.env`, so a running local Supabase + a populated
`backend/.env` is all the setup needs.
