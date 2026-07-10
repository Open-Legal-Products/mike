# Dependency Risk Register

> Last updated: Sprint 2 (MIKE-02-QUALITY-CI)

## Backend (2 residual vulnerabilities)

| Package | Severity | Advisory | Installed | Fixed | Path | Exposure | Decision | Owner | Prazo |
|---------|----------|----------|-----------|-------|------|----------|----------|-------|-------|
| esbuild | moderate | GHSA-g7r4-m6w7-qqqr (arbitrary file read on Windows dev server) | 0.27-0.28 | latest | devDependency (via vitest/tsx) | Dev server only, Windows-specific, not in production images | Accept — dev-only, not exploitable in Linux containers | Mimosa | Sprint 5 |
| @anthropic-ai/sdk | moderate | GHSA-p7fg-763f-g4gf (insecure file permissions in filesystem memory tool) | 0.90.0 | 0.110.0 | direct dependency | Backend uses SDK for LLM calls; memory tool not used by Mike | Accept — breaking change (0.91→0.110), no exposed attack surface | Mimosa | Sprint 10 |

## Frontend (6 residual vulnerabilities)

| Package | Severity | Advisory | Installed | Fixed | Path | Exposure | Decision | Owner | Prazo |
|---------|----------|----------|-----------|-------|------|----------|----------|-------|-------|
| postcss | moderate | GHSA-qx2v-qp2m-jg93 (XSS via unescaped </style>) | <8.5.10 | 8.5.10+ | next.js → postcss | Build-time only, not runtime | Accept — fix requires next.js downgrade (breaking) | Mimosa | Sprint 5 |
| uuid | moderate | GHSA-w5hq-g745-h8pq (missing buffer bounds check) | <11.1.1 | 11.1.1+ | exceljs, @fortune-sheet/core → uuid | Excel parsing in frontend, low attack surface | Accept — fix requires exceljs downgrade (breaking) | Mimosa | Sprint 11 |

## Fixed in Sprint 2

| Package | Severity | Fix Applied |
|---------|----------|-------------|
| undici | high | npm audit fix (frontend) |
| ws | high | npm audit fix (backend + frontend) |
| tmp | high | npm audit fix (backend + frontend) |
| form-data | high | npm audit fix (frontend) |
| linkify-it | high | npm audit fix (frontend) |
| @xmldom/xmldom | high | npm audit fix (backend + frontend) |
| fast-xml-builder | high | npm audit fix (backend) |
| protobufjs | high | npm audit fix (backend) |
| dompurify | moderate | npm audit fix (frontend) |
| qs | moderate | npm audit fix (backend + frontend) |
| @babel/core | moderate | npm audit fix (frontend) |
| brace-expansion | moderate | npm audit fix (frontend) |
| esbuild | moderate | npm audit fix (frontend) |
| fast-xml-parser | moderate | npm audit fix (backend) |
| js-yaml | moderate | npm audit fix (frontend) |
| markdown-it | moderate | npm audit fix (frontend) |

## Policy

- No `npm audit fix --force` without individual evaluation
- No major version upgrades without compatibility testing
- All residual vulnerabilities must be documented here
- Critical vulnerabilities must be fixed immediately
- High vulnerabilities with safe fixes must be fixed in the current sprint
