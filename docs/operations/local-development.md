# Mike Atlas — Local Development Guide

This document describes how to run Mike locally for development, QA, and sprint work at Atlas. It is **not** production deployment documentation.

## Quick start

```bash
# 1. Clone the fork (Atlas internal)
git clone git@github.com:Edu-Carone-SA/mike.git
cd mike

# 2. One-time bootstrap
make bootstrap

# 3. Start services
make dev

# 4. Verify
make smoke

# 5. Stop without losing data
make stop
```

## Architecture local

```
Browser → http://localhost:3000
  Frontend Next.js (Docker)
       ↓ http://localhost:3001
  Backend Express (Docker) — inclui LibreOffice
       ↓
  Supabase local (Docker, via Supabase CLI)
       ↓
  MinIO local (Docker Compose) — S3-compatible storage
```

## Requirements

- Node.js 20+ (`.nvmrc` pins 22.14.0)
- npm 10+
- Docker + Docker Compose
- openssl (para gerar segredos locais)
- python3 (para parsing do status do Supabase)
- 8 GB+ RAM recomendados (LibreOffice + Supabase + MinIO)

## Package manager

O projeto usa **npm** exclusivamente. Os lockfiles `bun.lock` foram removidos para eliminar ambiguidade. Sempre use `npm ci` em CI e bootstrap local.

## Bootstrap

`make bootstrap` executa:

1. Valida a versão do Node.js.
2. Roda `npm ci` em `backend/` e `frontend/`.
3. Cria `.env` e `frontend/.env.local` a partir dos exemplos seguros.
4. Gera segredos locais (`DOWNLOAD_SIGNING_SECRET`, `USER_API_KEYS_ENCRYPTION_SECRET`).
5. Inicializa o projeto Supabase local (`supabase/config.toml` com `project_id = "mike"`).
6. Sincroniza `backend/schema.sql` e `backend/migrations/*.sql` para `supabase/migrations/`.
7. Inicia o Supabase local e extrai URL, anon key e service-role key.
8. Atualiza `.env` com os valores do Supabase local.
9. Inicia o MinIO e cria o bucket `mike`.

## Comandos disponíveis

| Comando | Ação |
|---------|-------|
| `make bootstrap` | Setup único do ambiente |
| `make dev` | Sobe MinIO, Supabase local, backend e frontend |
| `make stop` | Para serviços sem remover dados |
| `make reset` | Para e remove todos os dados locais |
| `make smoke` | Executa smoke test básico (health/ready/frontend/MinIO) |
| `make health` | Mostra `/health` e `/ready` do backend |
| `make logs` | Tail dos logs |
| `make typecheck` | `tsc --noEmit` em backend e frontend |
| `make lint` | Linters (frontend ESLint; backend quando configurado) |

## Variáveis de ambiente

Arquivos de exemplo:

- `backend/.env.example`
- `frontend/.env.local.example`

O `make bootstrap` gera os arquivos reais. **Nunca commite `.env` ou `frontend/.env.local`**: ambos estão no `.gitignore`.

### Segredos obrigatórios

- `DOWNLOAD_SIGNING_SECRET` — HMAC para URLs de download.
- `SUPABASE_SECRET_KEY` — service-role key (apenas no backend).
- `USER_API_KEYS_ENCRYPTION_SECRET` — criptografia AES-256-GCM das chaves de API.

### Validação

O backend valida todas as variáveis via Zod em `backend/src/lib/env.ts` e falha imediatamente se:

- segredos obrigatórios estiverem ausentes;
- placeholders como `CHANGE_ME_...` ou `your-...` não foram substituídos;
- `LOG_RAW_LLM_STREAM=true` estiver ativo (emite warning explícito).

## Supabase local

O Supabase é gerenciado pelo CLI (`npx supabase@latest`). O bootstrap inicia-o automaticamente. A rede Docker gerada pelo CLI é `supabase_network_mike`, e o backend se conecta a ela para acessar o Kong interno em `http://supabase_kong_mike:8000`.

Para acessar o Studio local: http://localhost:54323

Para reiniciar o banco do zero:

```bash
npx supabase@latest db reset
```

## Storage local (MinIO)

- API S3: http://localhost:9000
- Console: http://localhost:9001
- Credenciais: `minioadmin` / `minioadmin`
- Bucket: `mike`
- Acesso público: bloqueado (`mc anonymous set private`)

## LibreOffice

A imagem Docker do backend instala `libreoffice-writer`, `libreoffice-calc` e `libreoffice-impress`. O caminho do binário é exposto como `SOFFICE_BINARY_PATH=/usr/lib/libreoffice/program/soffice`.

## Fixtures sintéticas

Local: `fixtures/synthetic/`

- `sample.pdf` — PDF mínimo válido
- `sample.docx` — DOCX mínimo válido
- `sample.xlsx` — XLSX mínimo válido
- `nda.docx` — NDA sintético
- `contract.docx` — contrato de serviço sintético
- `invalid.pdf` — arquivo de texto com extensão PDF para testes negativos

Nenhuma fixture contém dados reais. Para gerar um arquivo acima do limite:

```bash
dd if=/dev/zero of=fixtures/synthetic/oversized.bin bs=1M count=105
```

## Smoke test

`make smoke` verifica:

- `GET /health` retorna 200.
- `GET /ready` retorna `status: ready` (Supabase + MinIO conectados).
- Frontend responde em http://localhost:3000.
- MinIO health endpoint responde em http://localhost:9000/minio/health/live.

## Segurança no ambiente local

- O modo `development` exibe warnings sobre dados reais e logging bruto de LLM.
- `LOG_RAW_LLM_STREAM` é `false` por padrão.
- O bucket MinIO é privado.
- `COURTLISTENER_API_TOKEN` fica vazio por padrão (desabilita CourtListener).
- Chaves de LLM são opcionais no bootstrap; o app sobe sem elas, mas chat não funciona até que uma seja configurada.
- O `.env` nunca é versionado.

## Troubleshooting

### `docker compose` não encontrado

O Makefile detecta automaticamente `docker-compose` (standalone) ou `docker compose` (plugin). Se nenhum funcionar, instale Docker Compose.

### Supabase CLI não instalado

O bootstrap usa `npx supabase@latest`, que baixa o CLI automaticamente. Se falhar por rede, instale globalmente:

```bash
npm install -g supabase
```

### Portas já em uso

As portas padrão são 3000 (frontend), 3001 (backend), 9000/9001 (MinIO), 54321/54322/54323/54324/54325/54326/54327/54328 (Supabase). Pare outros serviços ou ajuste as portas no `compose.yaml` e em `.env`.

### Backend não conecta ao Supabase no Docker

Verifique se a rede `supabase_network_mike` existe:

```bash
docker network ls | grep supabase
```

Se não existir, rode `npx supabase@latest start` manualmente.

## Limitações conhecidas

- A correção estrutural de RLS, endpoint sem autenticação e logging bruto de LLM será tratada nas sprints de segurança. Nesta sprint, o ambiente local não agrava esses riscos e alerta contra configurações inseguras.
- O smoke test atual cobre conectividade básica. Testes de jornada completa (signup, upload, chat, etc.) serão adicionados na Sprint 2.
