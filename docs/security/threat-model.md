# Mike Atlas — Threat Model (Sprint 0)

> Initial STRIDE-based threat model for the Atlas Mike deployment.
> Status: **pre-remediation**. Items marked ❌ are unmitigated in the upstream baseline; ✅ are partially or fully mitigated.

## 1. Threat actors

| Actor | Motivation | Capability |
|-------|------------|------------|
| External attacker | Data theft, account takeover, crypto-mining | Internet access, crafted payloads |
| Malicious internal user | Access documents/chats of another Atlas user | Valid credentials, knowledge of IDs |
| Curious internal user | Accidental cross-tenant access | Valid credentials |
| Compromised AI provider key | Exfiltration via LLM calls | Stolen or leaked key |
| Compromised dependency | Supply-chain attack | npm package takeover |
| Atlas admin (rogue) | Data deletion, unauthorized access | High privilege |

## 2. Spoofing / Identity threats

| ID | Threat | Current state | Risk | Sprint |
|----|--------|---------------|------|--------|
| S1 | Supabase JWT not validated locally; every request opens a new admin client | ❌ creates dependency and latency | Medium | 3 |
| S2 | No session binding to IP/device; token replay possible | ❌ | Low | 9 |
| S3 | `/case-law/case-opinions` has no auth | ❌ unauthenticated data egress | High | 3 |
| S4 | Download tokens are non-expiring; leak = permanent access | ❌ | High | 4 |

## 3. Tampering threats

| ID | Threat | Current state | Risk | Sprint |
|----|--------|---------------|------|--------|
| T1 | Object keys contain userId/docId but no integrity tag; a tampered object in S3 would be served | ❌ no checksum stored | Medium | 4 |
| T2 | `document_versions` soft-delete columns exist but delete routes hard-delete; no retention policy enforcement | ❌ inconsistent | Medium | 4 |
| T3 | User `shared_with` email list can be modified by project owner only; no audit log | ❌ | Medium | 3 |

## 4. Repudiation threats

| ID | Threat | Current state | Risk | Sprint |
|----|--------|---------------|------|--------|
| R1 | No centralized audit table for login, upload, download, delete, admin actions | ❌ only console errors | High | 3 |
| R2 | `console.log`/`console.error` used in production paths; format-string injection possible | ❌ semgrep INFO findings | Medium | 12 |

## 5. Information disclosure threats

| ID | Threat | Current state | Risk | Sprint |
|----|--------|---------------|------|--------|
| I1 | `LOG_RAW_LLM_STREAM` / `RAW_LLM_STREAM_LOG_DIR` can write prompts and completions to disk/console | ❌ default off but no guardrails | **P0** | 10 |
| I2 | Error messages return raw DB / SDK errors to client (`error.message`) | ❌ in several routes | High | 3 |
| I3 | Backend logs may include filenames, storage paths, or error details | ❌ | Medium | 12 |
| I4 | Frontend uses `dangerouslySetInnerHTML` for CourtListener HTML after DOMPurify sanitize | ✅ sanitized but config must be reviewed | Medium | 11 |
| I5 | `rehype-raw` present in dependencies; verify it is not used on untrusted markdown | ❌ need usage audit | Medium | 11 |
| I6 | Signed URLs default to 1-hour expiry | ❌ too long for sensitive docs | Medium | 4 |
| I7 | Service-role key present in backend env; if leaked, RLS is bypassed | ✅ restricted to backend but no rotation automation | High | 3 |

## 6. Denial of service threats

| ID | Threat | Current state | Risk | Sprint |
|----|--------|---------------|------|--------|
| D1 | 100 MB uploads stored in memory via Multer; multiple concurrent uploads can OOM | ❌ | High | 5 |
| D2 | LibreOffice conversion has no timeout or resource limits | ❌ | High | 5 |
| D3 | `jsonLimitForPath` returns constant `50mb`; chat payloads can be huge | ❌ | Medium | 3 |
| D4 | Rate limits are configurable but not validated against abuse patterns | ✅ present but need tuning | Medium | 8 |
| D5 | Vulnerable dependencies (`tmp`, `ws`, `protobufjs`, `undici`) | ❌ 36 total vulnerabilities | High | 2 |

## 7. Elevation of privilege / Authorization threats

| ID | Threat | Current state | Risk | Sprint |
|----|--------|---------------|------|--------|
| A1 | No organization entity; a user with a shared project has no role distinction | ❌ | High | 3 |
| A2 | Core tables lack RLS; a leaked service key or SSRF to Supabase exposes all data | ❌ | **P0** | 3 |
| A3 | IDOR: need to verify every resource-scoped route checks ownership/org before acting | ❌ under review | High | 3 |
| A4 | `filterAccessibleDocumentIds` exists but must be called everywhere document IDs are accepted from body | ❌ audit needed | High | 3 |

## 8. Supply-chain / Dependency threats

| ID | Threat | Current state | Risk | Sprint |
|----|--------|---------------|------|--------|
| SC1 | `xlsx` installed from `https://cdn.sheetjs.com` tarball (not npm registry) | ❌ | Medium | 2 |
| SC2 | 1,635 total dependency components; large blast radius | ❌ | Medium | 2 |
| SC3 | No lockfile integrity checks in CI; no provenance verification | ❌ | Medium | 2 |

## 9. Prompt injection / AI-specific threats

| ID | Threat | Current state | Risk | Sprint |
|----|--------|---------------|------|--------|
| P1 | Document content is passed to LLM context; malicious instructions in documents could influence tool calls | ❌ no prompt-injection guardrails | High | 11 |
| P2 | Tool dispatcher can call document ops, CourtListener, MCP connectors; document content may trigger tools | ❌ needs confirmation audit | High | 11 |
| P3 | No output citation verification; hallucination risk | ✅ existing citations, but not validated | Medium | 2D |

## 10. Risk register (P0–P3)

| ID | Severity | Description | Owner |
|----|----------|-------------|-------|
| P0-1 | P0 | Raw prompts/completions can be logged to disk (`RAW_LLM_STREAM_LOG_DIR`) | Mimosa |
| P0-2 | P0 | Core tenant tables lack RLS; service-key leak = total data exposure | Mimosa |
| P0-3 | P0 | Unauthenticated `/case-law/case-opinions` endpoint | Mimosa |
| P1-1 | P1 | No organization/role model; sharing is email-only | Mimosa |
| P1-2 | P1 | Download tokens never expire | Mimosa |
| P1-3 | P1 | No audit trail for sensitive operations | Mimosa |
| P1-4 | P1 | 100 MB in-memory uploads + unbounded LibreOffice conversion | Mimosa |
| P1-5 | P1 | Vulnerable high-severity dependencies (`tmp`, `protobufjs`, `ws`, `undici`) | Mimosa |
| P2-1 | P2 | No MIME/magic-byte validation on uploads | Mimosa |
| P2-2 | P2 | Macro-enabled Office formats accepted | Mimosa |
| P2-3 | P2 | `LOG_RAW_LLM_STREAM` console output risk | Mimosa |
| P2-4 | P2 | Signed URLs default 1-hour expiry | Mimosa |
| P3-1 | P3 | New admin Supabase client per request | Mimosa |
| P3-2 | P3 | `console.log` used in dev mode only, but error logs may leak paths | Mimosa |
| P3-3 | P3 | `package-lock.json` + `bun.lock` ambiguity | Mimosa |

## 11. Stop conditions for production data

Production must remain **NO-GO** until:
- [ ] P0-1, P0-2, P0-3 are remediated and tested.
- [ ] Organization/role model exists and is enforced.
- [ ] All resource-scoped routes pass IDOR tests (cross-user, cross-org).
- [ ] Download tokens expire and can be revoked.
- [ ] Audit trail covers login, upload, download, delete, admin actions.
- [ ] Document pipeline has validation + quarantine.
- [ ] High-severity dependencies are patched or accepted with written exception.
- [ ] Legal approves AGPL-3.0 obligations for Atlas users.
