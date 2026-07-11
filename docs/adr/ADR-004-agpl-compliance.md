# ADR-004 — AGPL-3.0 Compliance for Mike Atlas

## Status

Proposed — **requires legal validation** before production launch.

## Context

Mike is licensed under `AGPL-3.0-only`. The AGPL was designed for network-accessed software and requires offering the corresponding source code to users of the service.

## Decision

1. Preserve all copyright, license, notices, and attribution in the Atlas fork.
2. Do not remove any existing license headers or `LICENSE` file.
3. Add a visible "Código-fonte e licença" link in the Atlas-branded UI.
4. Prepare a process to publish the fork source upon request, in compliance with AGPL Section 13.
5. Submit this ADR and the upstream `LICENSE` to Atlas legal for interpretation before any external users access the system.

## Open questions for legal

- Does internal Atlas use alone trigger AGPL distribution obligations?
- If the system is later offered to clients, what is the exact source-offer mechanism and timeframe?
- Are Atlas proprietary customizations (branding, Terraform, internal policies) considered "Corresponding Source"?
- How should we handle AGPL notices in a SaaS context under Brazilian law and LGPD?

## Consequences

- Legal approval is a **blocking** requirement for production go-live.
- No license removal or proprietary re-licensing will occur without legal sign-off.

## Related

- `docs/legal/AGPL-VALIDATION-REQUEST.md`
- Upstream `LICENSE`
