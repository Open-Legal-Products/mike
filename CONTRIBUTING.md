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

## System Workflows

System workflows live in the sibling
[`Open-Legal-Products/mike-workflows`](https://github.com/Open-Legal-Products/mike-workflows)
repository under `assistant-workflows/` and `tabular-review-workflows/`. Put
structured metadata in the YAML frontmatter at the top of `SKILL.md`, set
`metadata.mike-availability` to `system`, put workflow instructions in the body
of `SKILL.md`, and use `table-columns.yaml` for tabular review columns.

After changing system workflows, regenerate the app files:

```bash
node scripts/build-workflows.js
```

## Security

Do not open a public issue for security vulnerabilities. Use [GitHub's private vulnerability reporting](https://github.com/Open-Legal-Products/mike/security/advisories/new) instead.

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

## Frontend UI

Before writing a new component from scratch, check
`frontend/src/app/components/ui/` for a primitive that already covers it — most
new UI should be composed from that shared layer rather than hand-rolled. If
there's no primitive but the pattern is a standard one (dialog, tooltip,
popover, select, tabs), take it from the [shadcn/ui](https://ui.shadcn.com)
registry so we inherit Radix's keyboard and ARIA behaviour instead of
reimplementing it. Hand-write a one-off only when it's used on a single screen
and has no interaction semantics worth sharing, and keep it in the feature
folder. When you find yourself copying the same markup into a third place —
especially a `shadow-[...]` glass recipe — promote it to `components/ui/` with a
test and migrate every call site in that PR. Tokens, the de facto spacing and
type scales, and the accessibility rules for primitives are documented in
[`docs/design-system.md`](docs/design-system.md).

## Testing

```bash
npm test --prefix backend            # backend unit + route integration tests (vitest)
npm test --prefix frontend           # frontend component/hook tests (vitest + jsdom)
npm run test:e2e                     # Playwright end-to-end suite — see docs/e2e-ci.md
node evals/run.mjs --threshold 1.0   # offline eval harness (no network, no API keys)
npm run test:stack --prefix backend  # gated: real-Supabase auth/access tests (run `supabase start` first)
```

- New features and bug fixes should come with a test at the lowest layer that
  can catch the regression: unit first, then route-level integration, then
  end-to-end only for flows a browser is genuinely needed to prove.
- CI runs the build, unit/integration tests, and the eval harness on every PR
  (`.github/workflows/ci.yml`), and the Playwright suite in a full local stack
  (`.github/workflows/e2e.yml`).
- Tests that need a live Supabase or an LLM key are env-gated and skip cleanly
  when the environment is absent — a plain `npm test` should always be green.
