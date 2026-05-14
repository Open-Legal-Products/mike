# Contributing

Thanks for helping improve Mike. The project moves quickly, so small,
focused pull requests are easiest to review and merge.

## Before You Start

- Open an issue or comment on an existing issue for larger changes.
- Keep one pull request to one concern: docs, one bug fix, one UI improvement,
  or one backend behaviour change.
- Avoid mixing formatting-only edits with functional changes.
- Test with disposable infrastructure and synthetic documents. See
  [`docs/safe-local-testing.md`](docs/safe-local-testing.md).

## Local Setup

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Create environment files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Run the backend and frontend in separate terminals:

```bash
npm run dev --prefix backend
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## Checks

Before opening a pull request, run the checks that match your change:

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

For documentation-only changes, at minimum check the Markdown diff for broken
links, stale commands, or copied secrets.

## Pull Request Style

Use a clear title:

```text
docs: clarify local setup
fix: handle missing provider key
chore: add root check script
```

In the PR body, include:

- what changed
- why it changed
- how you tested it
- any limitations or follow-up work

If your change affects setup, security posture, storage, auth, or model
provider behaviour, call that out explicitly.

## Security and Sensitive Data

Do not include real legal documents, client data, API keys, Supabase service
role keys, R2 credentials, screenshots with sensitive filenames, or logs that
identify users or matters.

For security-sensitive issues, avoid posting exploit details publicly until a
maintainer has had time to assess the report.

## Legal Content

Mike is legal AI software, not legal advice. Contributions that add workflows,
prompts, or legal-domain behaviour should make the jurisdiction, assumptions,
and review expectations clear.
