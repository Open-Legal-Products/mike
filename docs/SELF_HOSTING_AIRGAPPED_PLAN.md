# Plan: Turnkey Air-Gapped Self-Hosting (v2, adversarially reviewed)

Status: **proposal / scoping** (v2, 2026-07-01). Revised after three adversarial
red-team reviews (security/egress, 4-service correctness, ops/turnkey). No
implementation is claimed as done here except where a commit is cited. Owner: @amal66.

## 1. Goal

Stand up the **entire** Mike product on a host with **no internet at build or run
time**, from pre-vendored artifacts, with **no external dependency** — including the
LLM. Additive deployment profile (`docker-compose.airgapped.yml` + installer), not a
replacement for the cloud / Supabase-CLI dev flow.

## 2. What the red-teams changed (v1 → v2)

1. **Air-gap must be enforced in CODE, not just by network isolation.** v1 asserted
   "cloud LLMs degrade loudly / zero egress" — but the code registers cloud LLM
   providers unconditionally and would still `fetch()` CourtListener. v2 adds a real
   `AIRGAPPED` mode (§8).
2. **Scope was ~2× optimistic.** v1 said ~2–3 weeks; realistic is **~5–6 weeks**, and
   Phase 1 alone (migration runner + Supabase DB bootstrap + Kong config + harness
   rewrite) is ~1.5–2 weeks. Estimates corrected in §11.
3. **Missing services**: migration runner (none exists), Redis + BullMQ worker,
   LibreOffice/`soffice` for DOCX→PDF. Added in §5.
4. **Postgres identity**: must be `supabase/postgres:15.x` (not stock `postgres:15`) —
   the `anon`/`authenticated`/`service_role` roles + `auth` bootstrap ship there.
5. **Acceptance criteria** hardened (empty volume, browser egress, cloud-model
   refusal, DOCX→PDF, persistence) — §12.

## 3. The 4-service decision (verified — survived adversarial attack)

The app uses only **Postgres, Auth (GoTrue), PostgREST, Kong**. Drop Realtime
(0 refs), Supabase Storage + imgproxy (uses MinIO via `r2.ts`, 0 `supabase.storage`
refs), Edge Runtime (0 `functions.invoke`), postgres-meta, Studio, Logflare, Vector,
Supavisor. Owning **4 services, not 13** is the core answer to the maintenance-burden
concern (~70% less CVE/version/config surface). **Two hard preconditions:**

- **Postgres image = `supabase/postgres:15.x`.** No migration creates the Supabase
  roles or `auth` schema (`baseline.sql:352` revokes from `anon`/`authenticated`;
  `service_role_grants.sql:15` grants to `service_role`; `baseline.sql:19,49` FKs +
  triggers on `auth.users`). Stock `postgres:15` → first migration dies with
  `role "anon" does not exist`.
- **Boot ordering:** Postgres up → GoTrue runs its migrations (creates `auth.*`) →
  **then** app migrations. Reversed → FK/trigger failures on a fresh volume.

## 4. Current state (verified)

- MinIO storage in compose ✓; app uses its own S3 adapter for **all** file I/O.
- Ollama adapter behind `ENABLE_OLLAMA` (`957762b`) ✓ — but cloud providers are still
  registered unconditionally (must fix, §8).
- Deny-all RLS on 23 tables + service-role path, proven by the stack-E2E harness
  (`stack.supabase.test.ts`, `6179fbe`) ✓ — but the harness is CLI-coupled (§9).
- **Gaps** (net-new work): no migration runner; no DB-bootstrap seed; Redis/worker/
  LibreOffice not in any air-gap topology; no code-level air-gap enforcement.

## 5. Target topology (`docker-compose.airgapped.yml`)

All images pinned by `@sha256` digest (single-source lockfile, §7).

| Service | Image | Notes |
|---|---|---|
| `postgres` | **`supabase/postgres:15.x`** | roles + `auth` bootstrap; PG17 upgrade out of scope, never cross data dirs |
| `auth` | `supabase/gotrue` | runs its migrations first; SMTP → internal relay/Mailpit |
| `rest` | `postgrest/postgrest` | |
| `kong` | Kong (DB-less) | **trimmed `kong.yml`**: expose only `/auth/v1` (non-admin) + `/rest/v1`; never publish admin `8001` |
| `migrate` | init container | **NEW** — applies ordered app migrations idempotently after GoTrue; ledger table |
| `minio` + `minio-init` | existing | console **not** host-published |
| `redis` | redis | **NEW to plan** — BullMQ; `requirepass`; not host-published |
| `worker` or in-proc | mike-api | DOCX→PDF; decide dedicated vs `ASYNC_DOCUMENT_CONVERSION=false` |
| `ollama` + preload | ollama/ollama | **NEW** — default model + weights bundled; not host-published |
| `mailpit` | axllent/mailpit | **catch only**; behind proxy+auth; email-change needs a real relay |
| `mike-api`, `mike-web` | built (multi-arch) | LibreOffice+fonts baked into api image |
| `proxy` | caddy/nginx | internal TLS; the only host-published ingress |

**Only the proxy publishes host ports.** Everything else is compose-network-internal.

## 6. LibreOffice / DOCX→PDF (was missing)

`lib/convert.ts` shells to `soffice`; the current `node:22-alpine` image has none, so
conversion silently no-ops (`conversionWorker.ts` finalizes without a PDF) — a real
loss for a legal product. Bake LibreOffice + fonts into the api/worker image
(~0.5–1 GB) and add a DOCX→PDF acceptance test.

## 7. Air-gap supply chain

- Pin every image by `@sha256`; a lockfile is the single source of truth (CI drift
  check vs. Supabase's official tags).
- **Multi-arch:** build `mike-api`/`mike-web` with `buildx --platform` for the target;
  produce per-arch bundles; `install.sh` asserts host arch.
- `bundle.sh` (connected): pull pinned digests + built app images + pre-pulled Ollama
  weights → `docker save` → checksummed tarball. **State the size (est. 20–40 GB)** and
  transfer medium.
- `install.sh` (disconnected): verify checksum + arch → `docker load` → `compose up`.
- **CVE/patch delivery (was missing):** ship a digest manifest for offline vuln
  scanning (sideloaded Trivy DB); define a signed re-bundle → verify → `docker load`
  patch cycle and a supported-window/EOL policy. Pins rot; deployments live for years.

## 8. Air-gap enforcement — in CODE (`AIRGAPPED=true`), not just network

Red-team B1/B2/B3: isolation alone is insufficient and unverifiable. Add an
`AIRGAPPED` env mode that:

- **LLM:** does **not** register `claude`/`gemini`/`openai` providers; strips their
  models from the picker; **rejects any non-local model at the API boundary** (not a
  404 — an explicit local-only error). Requires `OPENAI_BASE_URL` = internal (Ollama)
  and refuses the external default; `NODE_ENV=production` so base-URL SSRF checks apply.
- **External tools:** CourtListener + external MCP + MCP OAuth return an **attributed
  "unavailable in air-gapped mode" error before any `fetch()`** and are removed from
  the model toolset. (Note: the SSRF guard has **no** internal allow-list today — it
  blocks localhost/private IPs/HTTP — so *internal* MCP is currently **rejected**;
  supporting it is a separate, explicitly-scoped allow-list change, or out of scope.)
- **Telemetry/phone-home:** `SENTRY_DSN` unset (already no-op); `NEXT_TELEMETRY_DISABLED=1`;
  disable container callhome (e.g. `MINIO_UPDATE=off`).
- **Web assets (browser egress):** self-host Inter/EB-Garamond (remove the Google
  Fonts `@import` in `global-error.tsx`); vendor pdf.js `standard_fonts/` into the web
  image (remove the `unpkg.com` `STANDARD_FONT_DATA_URL`).

## 9. Safety net — pinning gated by the stack-E2E harness (needs a rewrite)

`scripts/test-stack.sh` is CLI-coupled (`supabase status`). Decouple it to source keys
from any stack via env, extend `stack.supabase.test.ts` to run against the **embedded
compose**, and add a networked-CI job that stands the compose up and runs `test:stack`
on every image-bump PR (auth contract + RLS deny-all + tenant isolation + leak sweep).
Mirror Supabase's official pinned tags; bump in lockstep, gated by this.

## 10. Secrets, hardening, backup (expanded)

- **`gen-secrets.sh`:** CSPRNG ≥256-bit `JWT_SECRET`; derive + verify anon/service-role
  JWTs; DB/MinIO/Redis/dashboard creds. Kong `kong.yml` templated with the derived keys.
- **Boot guard:** reject known Supabase **demo** keys by value; enforce length/format on
  `SUPABASE_SECRET_KEY`/`JWT_SECRET`/signing/encryption secrets (today `SUPABASE_SECRET_KEY`
  is only `.min(1)`); verify derived keys validate against the secret.
- **Ports:** only the proxy is host-published; Redis `requirepass`; Mailpit behind
  proxy+auth; Ollama/MinIO-console/Postgres compose-internal only.
- **Internal TLS:** bundled CA; **distribute the CA to browser + Word add-in clients**
  or they fail cert validation offline.
- **Backup/restore + rotation (was missing):** encrypted data (`user_api_keys`, MCP
  secrets, download tokens, sessions) is only recoverable if the **secrets are escrowed
  with** the Postgres+MinIO backup. Restore runbook must reuse the same secrets;
  document rotation (`JWT_SECRET` rotation invalidates sessions; API-key secret needs a
  dual-key re-encrypt migration).

## 11. Phased delivery (corrected estimates)

| Phase | Deliverable | Est. |
|---|---|---|
| **0. Plan** | This v2 doc approved | — |
| **1. Code air-gap mode** | `AIRGAPPED` enforcement (§8) + boot guard, all unit-tested | ~2–3 d |
| **2. Migration runner** | idempotent runner + ledger; DB-bootstrap ordering (GoTrue→app) | ~3–4 d |
| **3. Embedded compose** | 4 Supabase svcs + MinIO + Redis + worker + app, healthchecks, trimmed `kong.yml`, port binding; decoupled stack-E2E run against it | ~1.5–2 wk |
| **4. Image + supply chain** | LibreOffice image, multi-arch build, `bundle.sh`/`install.sh`, digest lockfile, offline verify | ~3–5 d |
| **5. Hardening + lifecycle** | `gen-secrets.sh` + boot guard wiring, internal TLS + CA distribution, backup/restore + patch-delivery runbooks | ~1 wk |
| **6. Turnkey + acceptance** | installer, docs, disconnected-host acceptance suite | ~3 d |

**Total ~5–6 weeks focused**, plus recurring per-bump maintenance. "Turnkey" =
one command to bring up an **already-provisioned** bundle; manual pre-steps
(`gen-secrets.sh`, CA distribution, transfer + checksum a 20–40 GB bundle, confirm
arch, pre-bake model) are enumerated honestly.

**Verifiable in this repo now:** Phases 1, 2, 3 (with Docker), the web-asset removal in
§8, the harness decouple, LibreOffice image. **Operator-side / not fully verifiable
here:** the 20–40 GB multi-arch bundle, GPU model quality, true disconnected-host
acceptance, CVE-scan delivery.

## 12. Acceptance criteria (falsifiable; hardened)

On a **fresh/empty data volume** on a host with outbound networking disabled:
1. `install.sh` brings the stack up **from vendored images** — no `docker pull`,
   asserted for **every** container incl. Ollama (zero registry calls, cold caches).
2. First-boot migrations apply in order (GoTrue → app) on the empty volume.
3. `npm run test:stack` passes (auth + RLS deny-all + tenant isolation + leak sweep)
   against the **embedded** stack.
4. A **DOCX uploads and produces a PDF** rendition.
5. A chat completes end-to-end on a **local** model; **selecting a cloud model is
   refused locally** (not merely unreachable).
6. A **browser** egress monitor (not just the API container) records **zero** outbound
   during upload → chat → **PDF view** → tabular review → export → error page.
7. Data **survives `compose down/up` and host reboot** (Postgres + MinIO + Redis volumes).
8. Boot **refuses to start** with any default/demo/placeholder secret.
9. Target **arch** matches (no amd64/arm64 mismatch).

## 13. Risks & non-goals

- **Risks:** PG15 EOL ~2027 (PG15→17 upgrade is a separate, data-preserving project);
  follower-lag on Supabase security patches (mitigated: 4 services, digest lockfile,
  offline scan); model quality on CPU-only hosts; bundle size/logistics.
- **Non-goals:** replacing the CLI dev flow; cloud LLMs / external legal research /
  external MCP in air-gapped mode (unavailable by definition; refused in code, not
  merely blocked by the network).
