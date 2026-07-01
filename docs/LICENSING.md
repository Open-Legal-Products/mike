# Licensing Strategy

_Last updated: 2026-06-30_

This document records **intent**. It explains which parts of the repository are
licensed copyleft (AGPL-3.0) versus permissive (MIT), and why. It does **not**
change any license identifier — the authoritative license for each component is
whatever its own `LICENSE` / manifest declares. If this document and a component's
manifest ever disagree, the manifest wins and this document should be corrected.

## Summary

Mike splits into two categories:

- **The application** (server, web app, and shared internal packages) is
  **AGPL-3.0-only**. AGPL is deliberate: Mike is a hosted-style service, and the
  AGPL's network-use clause ensures that anyone who runs a modified Mike as a
  service must offer their modifications back to their users. This keeps the
  self-hostable product open even when deployed over a network.

- **Client SDKs** — code an integrator imports into *their own* application to
  talk to a Mike instance — are intended to be **permissive (MIT)**. Copylefting a
  client library would force the copyleft terms onto every downstream integrator's
  codebase, which defeats the purpose of shipping an SDK. Permissive client SDKs
  are the common industry pattern (e.g. cloud-provider and API-vendor SDKs) and
  maximize adoption.

## Component matrix

| Component | Path | License | Rationale |
|---|---|---|---|
| Monorepo root | `package.json` | AGPL-3.0-only | Umbrella license for the application as a whole; network-use copyleft protects the self-hosted service. |
| Backend API | `apps/api` | AGPL-3.0 (via root) | Core server logic; the primary thing AGPL is meant to keep open. |
| Web frontend | `apps/web` | AGPL-3.0 (via root) | Part of the deployed application; shares the server's copyleft posture. |
| Internal shared packages | `packages/*` (e.g. `core`, `shared`, `api-client`, `chat-ui`) | AGPL-3.0 (via root) | Internal building blocks of the app, not standalone integrator libraries; stay copyleft with the application. |
| Word add-in | `word-addin` | AGPL-3.0 (via root) | A first-party client of the Mike app, distributed as part of this project; kept aligned with the application license. |
| Python SDK | `sdks/python` | **MIT** (`sdks/python/pyproject.toml`) | Client library integrators embed in their own code; permissive so consuming Mike's API does not impose copyleft on the integrator. |
| Client SDKs (general policy) | `sdks/*` | **MIT (intended)** | Any current or future client SDK should ship permissive for the same reason as the Python SDK. |

## Notes and caveats

- **Verify before relying on this table.** The current source of truth is:
  root `package.json` → `"license": "AGPL-3.0-only"`; `sdks/python/pyproject.toml`
  → `license = { text = "MIT" }`. Other components inherit the root license unless
  they declare their own.
- **`packages/sdk-js`** exists in the tree. If and when it is published as an
  external client SDK, it should adopt MIT to match the client-SDK policy above;
  until its manifest declares a license explicitly, treat its status as
  **undecided** rather than assuming either license.
- **Upstream attribution.** Mike is a hardened fork of `willchen96/mike`, also
  AGPL-3.0. Upstream copyright remains with the original authors; see `NOTICE`,
  `LICENSE`, and the README's "Relationship to upstream" section.
- Nothing in this document grants or removes any license. To actually change a
  component's license, edit that component's manifest/`LICENSE` and update this
  table to match.
