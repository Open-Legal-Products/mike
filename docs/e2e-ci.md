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
2. boots **MinIO** (S3-compatible object storage — several specs upload documents);
3. boots **local Supabase** (Auth + Postgres) via the Supabase CLI, loads
   `backend/schema.sql`, then applies every dated migration in `backend/migrations/`
   on top. `schema.sql` is meant to be the latest shape but in practice lags the
   migrations (e.g. it is missing `workflow_open_source_submissions`, which
   `GET /workflows/:id` queries — a 500 without the migrations). It also grants
   `service_role` full access to the `public` tables afterward, because
   `schema.sql` revokes client grants assuming a hosted Supabase where
   `service_role` is already privileged;
4. writes `backend/.env` and `frontend/.env.local` from the live Supabase values;
5. **builds** the web app (`next build`) and serves it with `next start` — a
   production build, not `next dev`, so there is no on-demand compilation (which
   makes first-hit page loads slow enough to time out specs) and no dev
   hydration-error overlay (whose injected DOM pollutes text locators). Starts the
   backend API (`:3001`) and the web server (`:3000`) and waits for both healthy;
6. runs `npx playwright test` and uploads the HTML report + traces as an artifact
   (`playwright-report`) on pass, fail, or timeout.

`e2e/auth.setup.ts` bootstraps the shared test user (`e2e@mike.local`) against
the local Supabase admin API, so no login secret is needed — the credentials
baked into that file are the single source of truth.

A keyless run is expected to end **23 passed / 4 skipped / 0 failed** — the
suite has 27 specs, 4 of them LLM-gated (see "Confirm the specs ran" below).

## Optional secret (fuller coverage)

| Secret | What it unlocks | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | The 4 LLM-dependent specs (chat rename/delete/submit, critical-path "ask a question") send a message and assert a **streamed** answer. With the key set they run and are enforced. | Those 4 specs **skip** (see `e2e/llm.ts`) instead of hanging, so the run is still green on the other 23 specs. |

The suite is green **without** any secret — the LLM specs skip themselves via
`test.skip(!process.env.ANTHROPIC_API_KEY, …)`, which keeps keyless runs (local,
and fork PRs with no secret access) green and fast. The gate is a blanket one on
purpose: the app ships **no keyless model** — every model in the picker
(`frontend/src/app/components/assistant/ModelToggle.tsx`) needs an
Anthropic/Google/OpenAI key before `ChatInput` will send at all — so without a
key the 4 specs cannot even submit a message. (The auto title-generation call is
*not* the reason for the gate; keyless it returns a 500 the specs already
tolerate.) Setup steps below.

## Enable the LLM specs

### 1. Add the repository secret

UI path:

1. Open the repository on GitHub → **Settings**.
2. In the left sidebar: **Secrets and variables → Actions**.
3. On the **Secrets** tab, click **New repository secret**.
4. **Name:** `ANTHROPIC_API_KEY` — exactly this name; both the workflow env and
   `e2e/llm.ts` read it. **Secret:** an Anthropic API key (`sk-ant-…`) from
   <https://console.anthropic.com/settings/keys>.
5. Click **Add secret**.

CLI equivalent (repo admin):

```bash
gh secret set ANTHROPIC_API_KEY --repo Open-Legal-Products/mike
# paste the key at the prompt (or pipe it: --body "$ANTHROPIC_API_KEY")
```

### 2. The fork-PR caveat

On `pull_request` events from **forks**, GitHub withholds repository secrets, so
fork PRs — most external contributions — still run keyless and skip the 4 specs.
That is by design and keeps those runs green. Runs that actually receive the
secret and exercise the specs are:

- PRs from branches pushed to this repository (maintainer branches), and
- manual runs: **Actions → e2e → Run workflow** (`workflow_dispatch`) on any
  branch.

So after adding the secret, the quickest way to see the specs run is a
`workflow_dispatch` run from the Actions tab.

### 3. Expected cost per run

A handful of short completions: one streamed chat answer per LLM spec plus a few
small title generations (`claude-haiku-4-5`, 64-token cap). On the order of a
few cents per run — negligible next to the CI minutes.

### 4. Confirm the specs ran (not skipped)

Open the **Run Playwright** step in the Actions log:

- **Keyless run:** the summary ends with `4 skipped` / `23 passed`, and each
  skipped spec carries the reason
  `requires a model key — set the ANTHROPIC_API_KEY secret to run LLM-dependent specs`.
- **With the secret:** the summary shows `27 passed` and **no `skipped` line**;
  searching the log for `requires a model key` finds nothing.

The uploaded `playwright-report` artifact shows the same per-spec statuses.

### Model selection (gap fixed in this branch)

Earlier revisions of the four specs drove the model picker to a keyless
**"Demo (no key needed)"** entry that exists in the amal66 fork but **not in
this repository** (no `mike-demo` model id, no demo provider), so setting the
secret unskipped them and they then failed at model selection. This branch
carries the fix (commit `test(e2e): select a real Claude model in LLM-gated
specs`): the specs' `selectClaudeModel` helper picks **Claude Sonnet 4.6** in
the ModelToggle whenever the key is set, and the critical-path response
assertion checks for a nonempty streamed assistant answer instead of the
fork's canned demo reply. The **23 passed / 4 skipped** keyless and
**27 passed / 0 skipped** with-key figures come from that commit's own
verification against a full local stack (backend, prod-build frontend, local
Supabase + MinIO — see its commit message); they have not been re-measured
since this branch was rebased onto current `main`. The secret setup above is
all that is needed.

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
