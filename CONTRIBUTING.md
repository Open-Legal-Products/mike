# Contributing

Thanks for helping improve JessicaOS. Please keep contributions small, focused, and easy to review.

## Guidelines

- Prefer targeted edits over broad refactors.
- Keep each PR focused on one bug, feature, or cleanup.
- Update docs or env examples when changing setup, config, or user-facing behaviour.
- Keep diffs against upstream [Mike](https://github.com/willchen96/mike) minimal where possible, so upstream rebases stay cheap.
- Do not commit secrets, API keys, private documents, or local `.env` files.
- All user-facing copy uses UK English and UK legal terminology (see the table in `CLAUDE.md`).

## Before Opening a PR

- Run the relevant build or test command for the area you changed.
- Check `git diff` and remove unrelated changes.
- Write a concise Markdown PR description with:
    - summary
    - changes
    - why
    - testing

## Security

Do not open a public issue for security vulnerabilities. Use [GitHub's private vulnerability reporting](https://github.com/Sloth-ninja/JessicaOSS/security/advisories/new) instead. If the issue also affects upstream Mike, please report it there as well via [their private reporting](https://github.com/willchen96/mike/security/advisories/new).

We will aim to respond promptly and coordinate a disclosure timeline with you.

## Local Development

Backend:

```bash
npm run build --prefix backend
```

Frontend:

```bash
npm run build --prefix frontend
```
