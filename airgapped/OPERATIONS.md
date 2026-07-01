# Air-gapped operations

End-to-end runbook for [the plan](../docs/SELF_HOSTING_AIRGAPPED_PLAN.md). Honest
about what is one-command vs. a manual pre-step.

## What's verified in-repo vs. operator-validated

| Piece | Status |
|---|---|
| Air-gap code enforcement (no cloud LLM egress) | ✅ verified (tests) |
| Migration runner | ✅ verified live (fresh DB, idempotent, drift) |
| Embedded stack (3 Supabase svcs + nginx), boot ordering | ✅ verified live (stack-E2E 4/4) |
| gen-secrets.sh (derived JWTs) + boot guard | ✅ verified |
| LibreOffice for DOCX→PDF | ✅ verified (soffice runs on the alpine base) |
| Web CDN egress removed (fonts, pdf.js, telemetry) | ✅ verified (no external URLs) |
| bundle.sh / install.sh / backup / restore / Caddy / acceptance | ⚠️ authored — validate on a real disconnected host |
| Multi-arch bundle, GPU model quality, true zero-egress run | ⚠️ operator-side |

## One-time, on a CONNECTED build host

```bash
ARCH=amd64 airgapped/scripts/bundle.sh      # → dist/mike-airgap-amd64.tar.gz (+ .sha256)
```
Pre-pull the Ollama model into the bundle (or an internal mirror). Choose the
model for your hardware — an 8B model (~5 GB) runs on CPU but is weak for legal
reasoning; a 70B-class model (~40 GB) needs a GPU / lots of RAM. **State the model
+ its hardware floor to your users; "a chat completes" is not "good enough for
legal work."**

## On the AIR-GAPPED host

```bash
# 1. Transfer mike-airgap-<arch>.tar.gz + .sha256, then:
airgapped/scripts/install.sh mike-airgap-<arch>.tar.gz   # verify → load → gen-secrets → up
# 2. Keep airgapped/.env.generated safe — restores REQUIRE it.
# 3. Front the stack with TLS and distribute the internal CA to clients:
docker run ... caddy  (see Caddyfile)   # then import data/caddy/.../root.crt into browsers + Word add-in
# 4. Verify:
RUN_STACK_E2E=1 airgapped/scripts/acceptance.sh
```

## Manual pre-steps (the honest "not one-command" list)

1. Build + transfer a **20–40 GB** bundle (sneakernet); verify its checksum.
2. Confirm **target arch** matches (install.sh asserts it).
3. **Pre-bake the model** weights into the bundle/volume.
4. Run **gen-secrets.sh** (install.sh does this on first run) and escrow the output.
5. Generate + **distribute the internal CA** to every client (browsers, Word add-in).

## Lifecycle

- **Backup:** `backup.sh` — dumps Postgres + MinIO **and** the secrets. The DB dump
  alone cannot decrypt user keys/sessions.
- **Restore:** `restore.sh <dir>` — reuses the **original** secrets (never re-run
  gen-secrets on a restore).
- **Patch:** re-bundle on a connected host with updated pinned digests → transfer →
  `install.sh` (data volumes persist). Scan the digest manifest offline (sideloaded
  Trivy DB). Pins rot; schedule a re-bundle cadence.
- **Version bumps:** change a pinned image → run the stack-E2E harness against the
  embedded compose in CI before shipping (auth contract + RLS still hold).

## Known follow-ups

- Air-gap default LLM model: tabular/title generation still reference cloud default
  model IDs (no egress — the registry has no cloud adapter — but they error instead
  of using a local model). Make the defaults air-gap-aware.
- Email-*change* needs a real internal SMTP relay (Mailpit only catches).
