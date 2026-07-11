# MIKE-01-LOCAL-DEVELOPMENT — Checkpoint de Higiene

> Data: 2026-07-10T14:34:29.779693+00:00Z

## Comandos executados

```bash
git switch main
git fetch origin --prune
git pull --ff-only origin main
git switch -c sprint/MIKE-01-LOCAL-DEVELOPMENT
```

## Estado do repositório

| Item | Valor |
|------|-------|
| Branch atual | `sprint/MIKE-01-LOCAL-DEVELOPMENT` |
| HEAD SHA | `18dc17e` |
| Divergência `origin/main...HEAD` | 0 ahead / 0 behind |
| Divergência `upstream/main...HEAD` | 1 ahead / 0 behind (Sprint 0 docs) |
| Working tree | limpa |
| Tags | nenhuma |
| PRs abertos no fork | nenhum |
| Actions da main | nenhuma execução |

## Ambiente local

| Ferramenta | Versão / Status |
|------------|-----------------|
| Node.js | v26.0.0 |
| npm | 11.12.1 |
| Docker | 29.5.3 |
| Docker Compose | 5.1.4 (standalone `docker-compose`) |
| `docker compose` plugin | indisponível → usar `docker-compose` fallback |
| Supabase CLI | não instalado → bootstrap instala via npx |
| LibreOffice (`soffice`) | /opt/homebrew/bin/soffice |
| Bun | não instalado → escolher npm |

## Lockfiles e package managers

- `backend/package-lock.json` ✓
- `backend/bun.lock` ✗ (será removido — Bun indisponível)
- `frontend/package-lock.json` ✓
- `frontend/bun.lock` ✗ (será removido)

## Arquivos `.env` versionados

- Nenhum `.env` rastreado no Git.

## Migrations existentes

- Diretório: `backend/migrations/`
- Schema completo: `backend/schema.sql`

## Vulnerabilidades conhecidas da Sprint 0

- `tmp` path traversal
- `protobufjs` code injection / DoS
- `ws` memory exhaustion
- `undici` TLS bypass / header injection
- RLS ausente em tabelas principais
- Endpoint `/case-law/case-opinions` sem autenticação
- `RAW_LLM_STREAM_LOG_DIR` pode logar prompts

## Condições para continuar

- [x] Working tree limpa
- [x] Branch criada a partir da `main` atualizada
- [x] PR #1 mergeado
- [x] Sem trabalho concorrente em bootstrap/Docker/config local
- [x] Nenhum `.env` com segredo versionado

## Decisões iniciais

1. **Package manager**: npm (Bun indisponível no ambiente e no CI previsto).
2. **Node version**: pinar `.nvmrc` para `22.14.0` (LTS) e declarar `engines` nos `package.json`.
3. **Supabase local**: via Supabase CLI (`npx supabase@latest start/stop`), que usa Docker por baixo.
4. **Storage local**: MinIO via Docker Compose.
5. **LibreOffice**: incluir na imagem do backend para reprodução idêntica; fallback para soffice do host durante desenvolvimento nativo.
6. **Docker Compose plugin**: usar `docker-compose` (v1 standalone) como fallback porque `docker compose` não está configurado neste Mac.

## Próximos passos

1. Padronizar Node.js e remover lockfiles do Bun.
2. Criar validação de env com Zod.
3. Criar Dockerfiles e `compose.yaml`.
4. Implementar `/health` e `/ready`.
5. Criar scripts de bootstrap/dev/stop/reset/smoke.
6. Criar fixtures sintéticas.
