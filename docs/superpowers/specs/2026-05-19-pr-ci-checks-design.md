# PR CI Checks — Design

## Goal

Extend the existing `ci.yml` GitHub Actions workflow so every PR to `main` runs explicit type-check, lint, and format checks on both the frontend and backend packages. Tests are out of scope (no test files exist yet).

The first run of this workflow is expected to surface real lint/type/format violations in the current codebase; those will be fixed in the same PR so the workflow lands green.

## Scope

In scope:
- New scripts on `frontend` and `backend` packages
- New ESLint config + Prettier config for `backend`
- New Prettier devDep + config for `frontend`
- Extending `.github/workflows/ci.yml` with the new steps
- Fixing all errors the new checks surface in this repo's current source so CI passes

Out of scope:
- Adding a test runner or test files
- New build steps beyond what already exists
- Touching the `build-and-publish.yml` workflow
- Branch protection / required-checks configuration on GitHub (UI-side; user can wire up after merge)

## Frontend (`frontend/`)

**New devDep**: `prettier` (pinned to the same major as backend, `^3`).

**New scripts in `package.json`**:
- `typecheck`: `tsc --noEmit`
- `format:check`: `prettier --check .`

**New file**: `.prettierrc.json` with a small, explicit config (`semi: true`, `singleQuote: false`, `printWidth: 100`, `trailingComma: "all"`) so check results are deterministic. A `.prettierignore` excludes `.next/`, `out/`, `build/`, `next-env.d.ts`, and `public/`.

Lint config and `lint` / `build` scripts are unchanged.

## Backend (`backend/`)

**New devDeps**: `eslint` (`^9`), `typescript-eslint` (`^8`), `@eslint/js` (`^9`).

**New file**: `eslint.config.mjs` — flat config that applies `@eslint/js` recommended + `typescript-eslint` recommended to `src/**/*.ts` and `drizzle.config.ts`, ignoring `dist/` and `drizzle/migrations/`.

**New file**: `.prettierrc.json` matching frontend's config exactly (so we have one style across the repo). A `.prettierignore` excludes `dist/` and `drizzle/`.

**New scripts**:
- `lint`: `eslint .`
- `typecheck`: `tsc --noEmit`
- `format:check`: `prettier --check .`

Existing `build`, `db:generate`, `db:migrate` scripts are unchanged.

## Workflow (`.github/workflows/ci.yml`)

Each existing job gets explicit, named steps so each check shows up as its own line in the Actions UI.

**Frontend job** — steps after `npm ci`:
1. `npm run typecheck`
2. `npm run lint`
3. `npm run format:check`
4. `npm run build` (existing, unchanged env)

**Backend job** — steps after `npm ci`:
1. `npm run typecheck`
2. `npm run lint`
3. `npm run format:check`
4. `npm run build`
5. `npm run db:migrate` (existing, with postgres service)

Triggers (`pull_request: [main]`, `push: [main]`) are unchanged.

## Fixing existing violations

After scripts and configs are in place, run each check locally in this branch:
1. `npm run format:check` — if it fails, run `npx prettier --write .` and commit the formatting change as its own commit so reviewers can ignore the noise.
2. `npm run lint` — fix errors. For rules that are too noisy to fix mechanically, downgrade to `warn` in the config with a one-line comment explaining why, rather than disabling case-by-case.
3. `npm run typecheck` — fix errors. If a fix is non-trivial or touches behavior, stop and ask before continuing.

Order matters: formatting first (so subsequent diffs are stable), then lint, then typecheck.

## Risks

- **Backend lint may surface many issues.** Mitigated by starting from `typescript-eslint/recommended` (not `recommended-type-checked`, which requires type info and is significantly stricter/slower). If the recommended set still surfaces hundreds of violations, we'll re-scope: keep critical rules at `error`, drop noisy stylistic rules to `warn`.
- **Prettier on a previously-unformatted codebase generates a large diff.** Mitigated by isolating the formatting pass to its own commit.
- **`tsc --noEmit` may catch real bugs.** Good outcome, but could enlarge the PR. If a typecheck fix changes runtime behavior, surface it before applying.
