# Plan: Turnkey Air‑Gapped Self‑Hosting

Status: **proposal / scoping** (2026‑07‑01). No implementation yet — this document
is for approval before any code lands. Owner: @amal66.

## 1. Goal

Let an operator stand up the **entire** Mike product on a host with **no internet
access at build or run time**, in one command, with **no external dependencies** —
including the LLM. "Turnkey" = a single installer brings everything up from
pre‑vendored artifacts; "air‑gapped" = nothing the running system needs is fetched
from the network.

This is an **additive deployment profile** (`docker-compose.airgapped.yml` + an
installer), **not** a replacement for the current cloud / Supabase‑CLI dev flow.

## 2. What "air‑gapped" forces (beyond "embed Supabase")

Air‑gapping is the hard constraint; embedding Supabase is only one consequence.

| Constraint | Consequence |
|---|---|
| No cloud LLM reachable | Must use a **local model** — Ollama (already gated behind `ENABLE_OLLAMA`, `957762b`). Bundle Ollama + pre‑pulled model weights. |
| No `docker pull` at deploy | **Vendor every image** by digest; ship via `docker save`/`docker load` or a bundled offline registry. |
| No external egress | Sentry off; external **legal research (CourtListener)** and **external MCP connectors** are unreachable → must degrade with loud, attributed errors, not hangs. Email → local catcher or an internal relay. |
| No managed Supabase / no CLI | **Embed** the Supabase services the app actually needs into the stack. |

## 3. Current state (verified against the code)

- **Storage:** MinIO already in `docker-compose.yml` (S3‑compatible; app uses its own S3 adapter `lib/storage/r2.ts`). ✅
- **Local LLM:** Ollama adapter shipped, behind `ENABLE_OLLAMA` (`957762b`). ✅ (needs a bundled Ollama service + preloaded models for air‑gap)
- **Auth/RLS:** deny‑all RLS on all 23 public tables + service‑role data path; proven by the stack‑E2E harness (`stack.supabase.test.ts`, `6179fbe`). ✅
- **Gap:** Supabase itself runs via the **CLI** (`supabase start`) in dev — there is no embedded, air‑gappable Supabase. This plan closes that.

## 4. Key decision — a **minimal** embedded Supabase (4 services, not ~13)

Supabase's official self‑hosted compose ships ~13 services (Postgres, Auth/GoTrue,
PostgREST, Kong, Realtime, Storage, imgproxy, postgres‑meta, Studio, Edge Runtime,
Logflare, Vector, Supavisor). **We do not need most of them.** Verified by grep
against `apps/api` + `apps/web`:

| Supabase service | App usage (verified) | Decision |
|---|---|---|
| Postgres | all data + RPCs | **Embed** |
| Auth (GoTrue) | `admin.auth.getUser(token)` in `middleware/auth.ts` | **Embed** |
| PostgREST | `supabase-js` `.from()` / `.rpc()` | **Embed** |
| Kong (gateway) | routes `/auth`, `/rest` under `SUPABASE_URL` | **Embed** |
| Realtime | none (only `vi.useRealTimers()` in tests) | **Drop** |
| Storage + imgproxy | none — app uses MinIO via `r2.ts` (0 `supabase.storage` refs) | **Drop** (keep MinIO) |
| Edge Runtime | none (0 `functions.invoke` refs) | **Drop** |
| Studio + postgres‑meta | none at runtime (admin UI only) | **Optional** ops add‑on, off by default |
| Logflare + Vector | analytics — Supabase says not production‑grade | **Drop** |
| Supavisor (pooler) | app talks REST via PostgREST, not direct PG | **Drop** |

**This is the core of the plan and the direct answer to the maintenance‑burden
concern:** the air‑gapped stack owns **4 Supabase services**, not 13 — cutting the
CVE surface, version matrix, and config glue by ~70%.

## 5. Target topology (`docker-compose.airgapped.yml`)

All images **pinned by `@sha256` digest** (see §6).

- `postgres` — pin **Postgres 15** to match `supabase/config.toml major_version = 15`.
  ⚠️ Supabase's default is now **PG17**; do **not** start a PG17 image on a PG15 data
  directory. A PG15→17 upgrade is a **separate, out‑of‑scope project**.
- `auth` (supabase/gotrue), `rest` (postgrest/postgrest), `kong` (API gateway).
- `minio` + `minio-init` — existing.
- `ollama` — with a model‑preload init step; `ENABLE_OLLAMA=true` in this profile.
- `mailpit` — local SMTP catcher for GoTrue auth email (or an internal relay).
- `mike-api`, `mike-web` — our built images.
- `proxy` — bundled reverse proxy (Caddy/nginx) terminating **internal TLS**.

## 6. Air‑gap supply chain

- **Pin by digest** — every image `image@sha256:…`, recorded in a lockfile.
- `scripts/airgap/bundle.sh` (run once on a connected host): `docker pull` all pinned
  digests → `docker save` → single tarball; include prebuilt `mike-api`/`mike-web`
  images and pre‑pulled Ollama weights. No build step required on the target.
- `scripts/airgap/install.sh` (on the disconnected host): `docker load` → `compose up`.
  Zero network calls.
- **Falsifiable check:** run `install.sh` inside a network‑isolated namespace; assert
  zero outbound connections and zero image pulls.

## 7. Secrets & hardening (Supabase's own "never use defaults")

- `scripts/airgap/gen-secrets.sh` — generate the **JWT secret** and derive the
  **anon/service‑role keys** from it, plus DB password, MinIO creds, dashboard
  password (if Studio enabled). Supabase docs: *"never start with these defaults."*
- **Boot guard** — the API refuses to start if any secret is a known placeholder/
  default (extends the existing `env.ts` `.min(32)` checks).
- **Internal TLS** — bundled proxy with an internal CA / self‑signed cert; HTTPS even
  offline (OAuth/auth flows need it).
- **Network isolation** — Postgres bound only to the compose network, never host‑exposed.

## 8. External‑egress removal (loud, attributed degradation)

- `SENTRY_DSN` unset → Sentry is already a no‑op. ✅
- **CourtListener legal research** and **external MCP connectors** are unreachable
  air‑gapped → gate them behind an availability check and surface a **loud,
  attributed** "unavailable in air‑gapped mode" error (the pattern we agreed on),
  never a silent hang. (Internal MCP connectors still work; the SSRF guard already
  allow‑lists correctly.)
- Email → Mailpit (catch) or a configured internal SMTP relay; GoTrue points at it.

## 9. Safety net — pinning gated by the stack‑E2E harness

This is what makes "pin a fixed image set and bump deliberately" **safe** (the
strategy we agreed): extend `stack.supabase.test.ts` to run against the **embedded
compose** (not just the CLI), and add a CI job (on a normal, networked runner) that
stands the embedded stack up and runs `npm run test:stack` on **every image‑bump
PR**. A bump that breaks the auth contract, RLS deny‑all, tenant isolation, or the
leak sweep fails the PR. Mirror Supabase's official pinned tags for the 4 services;
bump in lockstep.

## 10. Phased delivery

| Phase | Deliverable | Rough effort |
|---|---|---|
| **0. Decisions** | This doc approved; 4‑service set (done), PG15 pin, storage=MinIO confirmed | — |
| **1. Embedded compose** | `docker-compose.airgapped.yml` (4 Supabase svcs + MinIO + app), migrations auto‑applied on first boot, `SUPABASE_URL`→Kong; extend + run stack‑E2E against it | ~3–4 d |
| **2. Local LLM + email + egress‑off** | Ollama service + model preload + `ENABLE_OLLAMA` on; Mailpit; Sentry off; graceful external degradation | ~1–2 d |
| **3. Air‑gap supply chain** | digest pins + `bundle.sh`/`install.sh` + offline verification | ~2–3 d |
| **4. Hardening** | `gen-secrets.sh` + boot guard + internal TLS + network isolation | ~2–3 d |
| **5. Turnkey + acceptance** | one‑command installer, docs, disconnected‑host acceptance test | ~2 d |

Total: **~2–3 weeks** focused, plus recurring per‑bump maintenance.

## 11. Acceptance criteria (falsifiable, on a host with networking disabled)

1. `install.sh` brings the full stack up **from vendored images** — no `docker pull`.
2. `npm run test:stack` passes (auth contract + RLS deny‑all + tenant isolation +
   leak sweep) against the **embedded** stack.
3. A chat request completes **end‑to‑end using a local Ollama model**.
4. An egress monitor records **zero outbound connections** during a full workflow
   (upload → chat → tabular review → export).
5. Boot **refuses to start** with any default/placeholder secret.

## 12. Risks & non‑goals

- **Risk — PG15→17:** Supabase now defaults to Postgres 17; we pin 15 to match
  migrations. Upgrading is a separate project; never cross data directories.
- **Risk — follower lag:** we track Supabase's security patches for the 4 embedded
  services and re‑harden defaults on each bump (mechanized by `gen-secrets.sh` + the
  boot guard). Accepted, and far smaller at 4 services than 13.
- **Non‑goal:** replacing the cloud / Supabase‑CLI dev flow — this is an additive
  profile.
- **Non‑goal:** cloud LLMs, external legal research, external MCP connectors in
  air‑gapped mode — unavailable by definition; they degrade loudly.
