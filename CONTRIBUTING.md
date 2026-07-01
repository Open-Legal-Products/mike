# Contributing

Thanks for helping improve Mike. Please keep contributions small, focused, and easy to review.

## Guidelines

- Prefer targeted edits over broad refactors.
- Keep each PR focused on one bug, feature, or cleanup.
- Update docs or env examples when changing setup, config, or user-facing behavior.
- Please do not propose local-hosting refactors for the main app, such as local LLMs, local databases, or local filesystem storage. Those ideas are better suited to a future fully local version of the project.
- Do not commit secrets, API keys, private documents, or local `.env` files.

## Before Opening a PR

- Run the relevant build or test command for the area you changed.
- Check `git diff` and remove unrelated changes.
- Write a concise Markdown PR description with:
    - summary
    - changes
    - why
    - testing

## Commit messages

Commits follow a simple, consistent convention. Browse `git log --oneline` for
many worked examples.

- **Subject: `type(scope): description`.** Use an imperative, present-tense
  description ("add", "fix", "extract" — not "added" or "fixes"). Keep it under
  ~72 characters and don't end it with a period.
- **`type`** is the kind of change: `feat`, `fix`, `refactor`, `perf`, `test`,
  `docs`, `chore`, `ci`, `build`, `a11y`, and `security` for hardening work.
- **`scope`** is the area touched: `api`, `web`, `db`, `word-addin`, `e2e`,
  `merge`, etc. Omit it only when the change is genuinely repo-wide.
- **Body explains the _why_.** Describe the motivation, the tradeoffs you
  weighed, and how you verified the change — not a restatement of the diff
  (the diff already shows what changed). Wrap the body at ~72 columns.

Example:

```
fix(security): make prompt-injection spotlighting unforgeable

The old fence used a static tag an attacker could reproduce inside
document text. Bind the open/close tags to a per-request nonce so
injected content can't spoof the boundary. Verified with the new
route test that feeds a crafted document.
```

## Security

Do not open a public issue for security vulnerabilities. Use [GitHub's private vulnerability reporting](https://github.com/willchen96/mike/security/advisories/new) instead.

We will aim to respond promptly and coordinate a disclosure timeline with you.

## Local Development

Backend:

```bash
npm run build --prefix apps/api
```

Frontend:

```bash
npm run build --prefix apps/web
```
