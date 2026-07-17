# ROSS public website

This directory contains the separate public website for ROSS. It is deliberately
isolated from the authenticated application in `../frontend` and the API in
`../backend`.

## Current mode

The site is a governed public-content build for an invitation-only beta using
synthetic or non-confidential materials only. It does not authenticate visitors,
load application or client data, collect form submissions, or run product
analytics.

An owner-only checkpoint is deployed through Sites. The production operator,
public access decision, final domains, hosting/vendor disclosures, effective
legal notices, contact channels, and independent reviews remain explicit
blockers.

## Commands

From this directory:

```bash
npm ci
npm run dev
npm run lint
npm test
```

`npm test` builds and validates the deployable artifact before testing the
landing page, required public routes, and custom not-found response.

## Structure

- `app/page.tsx` — original ROSS landing page
- `app/[...slug]/page.tsx` — governed public pages, generated coverage, demo,
  workflows, and updates
- `app/page-content.ts` — version-controlled copy and review metadata
- `app/generated-public-coverage.ts` — generated sanitized provider coverage
- `app/site-config.ts` — typed public-site configuration
- `app/site-shell.tsx` — shared header and footer
- `app/globals.css` — responsive design and accessibility foundations
- `tests/*.test.mjs` — built-artifact route, content, link, semantic
  accessibility, and performance-budget tests
- `.openai/hosting.json` — isolated public-site hosting identity

## Boundaries

- Do not copy Mike’s marketing site, copy, screenshots, media logos, demos, or
  distinctive visual assets.
- Do not connect this public site to Supabase, client documents, prompts, or
  application telemetry.
- Keep every source, privacy, security, residency, and readiness claim aligned
  with the approved architecture decisions and current coverage registry.
- Keep previews and search indexing disabled until production domains and
  content approval are complete.
