# Contributing to Mike

Thanks for your interest in contributing. Mike is an open-source legal document assistant — contributions of all kinds are welcome, from bug reports and documentation improvements to new features.

---

## Ways to contribute

- **Bug reports** — open a GitHub issue with steps to reproduce, expected vs. actual behavior, and your environment (OS, Node version, browser)
- **Feature requests** — open a GitHub issue describing the use case and why the current behavior falls short
- **Code** — pick up any open issue or propose something new; see below for the workflow
- **Documentation** — typos, clarifications, and missing setup steps are all fair game

---

## Security issues

**Do not open a public issue for security vulnerabilities.** Use [GitHub's private security advisory](https://github.com/willchen96/mike/security/advisories/new) instead. We'll respond within 72 hours and coordinate a disclosure timeline with you.

Mike handles sensitive legal documents. Security reports are taken seriously and credited unless you prefer otherwise.

---

## Local development setup

**Prerequisites:** Node.js 20+, npm, git, a Supabase project, an S3-compatible bucket (Cloudflare R2 or MinIO), and at least one model provider API key (Anthropic, Gemini, or OpenAI).

```bash
git clone https://github.com/willchen96/mike.git
cd mike
npm install --prefix backend
npm install --prefix frontend
```

Fill in your environment variables (see [README.md](README.md) for the full variable reference):

```bash
# backend/.env
PORT=3001
FRONTEND_URL=http://localhost:3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-supabase-service-role-key
DOWNLOAD_SIGNING_SECRET=<openssl rand -hex 32>
USER_API_KEYS_ENCRYPTION_SECRET=<openssl rand -hex 32>
R2_ENDPOINT_URL=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=mike
ANTHROPIC_API_KEY=your-key   # at least one provider key required
```

Apply the database schema to a fresh Supabase project:

```sql
-- Run backend/schema.sql in the Supabase SQL editor
```

Start both servers:

```bash
npm run dev --prefix backend   # http://localhost:3001
npm run dev --prefix frontend  # http://localhost:3000
```

For an existing database, apply incremental files from `backend/migrations/` rather than re-running `schema.sql`.

---

## Making a change

1. **Find or open an issue** — all code changes should be linked to a GitHub issue so the motivation is clear
2. **Branch from `main`**

   ```bash
   git checkout main && git pull origin main
   git checkout -b fix/<issue-number>-<short-slug>
   # or: feat/<issue-number>-<short-slug>
   ```

3. **Write tests first** — this project requires tests before implementation. PRs without tests will be asked to add them before merge.

   ```bash
   npm test --prefix backend   # vitest unit tests
   ```

4. **Implement the change** — keep the diff minimal and focused on the issue. If you discover adjacent work, open a follow-up issue rather than expanding the scope.

5. **Verify locally**

   ```bash
   npm run build --prefix backend
   npm run build --prefix frontend
   npm run lint --prefix frontend
   ```

6. **Commit with a conventional message**

   ```
   fix: <description>
   feat: <description>
   chore: <description>
   docs: <description>
   ```

7. **Open a PR against `main`** — include a summary of what changed and why, and a `Closes #<issue>` line so the linked issue auto-closes on merge.

---

## What gets a PR approved

- Tests are present and pass
- Build and type-check pass
- The change does what the linked issue asks — no unrelated modifications
- No secrets, credentials, or `.env` files are committed
- Security implications have been considered (this project handles legal documents)

---

## Database migrations

If your change requires a schema update:

- Add a new file to `backend/migrations/` named `YYYYMMDD_short_description.sql`
- Wrap it in `BEGIN` / `COMMIT`
- Include a matching `.rollback.sql` file
- Document pre-flight checks in comments inside the migration file

---

## Code of conduct

This project follows the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating you agree to abide by its terms.
