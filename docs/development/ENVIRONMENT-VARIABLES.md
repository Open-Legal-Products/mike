# Environment Variables Catalog

## Backend (`backend/.env`)

| Variable | Required | Secret | Local Value | Production | Browser | Purpose | Risk |
|----------|----------|--------|-------------|------------|---------|---------|------|
| NODE_ENV | Yes | No | development | production | No | Runtime mode | Wrong env = weak security |
| PORT | Yes | No | 3001 | 3001 | No | Listen port | — |
| FRONTEND_URL | Yes | No | http://localhost:3000 | https://mike.atlas... | No | CORS origin | Misconfigured CORS |
| DOWNLOAD_SIGNING_SECRET | Yes | Yes | [generated] | [secret] | No | HMAC for download tokens | Leak = forged downloads |
| SUPABASE_URL | Yes | No | http://localhost:54321 | [managed URL] | No | Supabase API | — |
| SUPABASE_SECRET_KEY | Yes | Yes | [from supabase status] | [service-role key] | **NEVER** | Service-role bypass RLS | Leak = full DB access |
| S3_ENDPOINT_URL | Yes | No | http://localhost:9000 | [S3 endpoint] | No | Storage endpoint | — |
| S3_ACCESS_KEY_ID | Yes | Yes | minioadmin | [IAM role] | **NEVER** | Storage auth | Leak = document access |
| S3_SECRET_ACCESS_KEY | Yes | Yes | minioadmin | [IAM role] | **NEVER** | Storage auth | Leak = document access |
| S3_BUCKET_NAME | Yes | No | mike-documents | [bucket] | No | Bucket name | — |
| S3_REGION | No | No | us-east-1 | sa-east-1 | No | AWS region | — |
| USER_API_KEYS_ENCRYPTION_SECRET | Yes | Yes | [generated] | [secret] | **NEVER** | AES-256-GCM key encryption | Leak = all user keys exposed |
| ANTHROPIC_API_KEY | No | Yes | (optional) | [corporate key] | **NEVER** | LLM provider | Cost + data exposure |
| CLAUDE_API_KEY | No | Yes | (optional) | — | **NEVER** | LLM provider | Cost + data exposure |
| GEMINI_API_KEY | No | Yes | (optional) | — | **NEVER** | LLM provider | Cost + data exposure |
| OPENAI_API_KEY | No | Yes | (optional) | — | **NEVER** | LLM provider | Cost + data exposure |
| OPENROUTER_API_KEY | No | Yes | (optional) | — | **NEVER** | LLM provider | Cost + data exposure |
| RESEND_API_KEY | No | Yes | (optional) | — | **NEVER** | Email provider | Email spoofing |
| COURTLISTENER_API_TOKEN | No | Yes | (empty) | — | **NEVER** | US case-law API | Disabled in Atlas |
| LOG_RAW_LLM_STREAM | No | No | false | **false** | No | Raw LLM log toggle | Leaks prompts/documents |
| RAW_LLM_STREAM_LOG_DIR | No | No | (empty) | **empty** | No | Log directory | Leaks prompts/documents |
| SOFFICE_BINARY_PATH | No | No | (auto) | (auto) | No | LibreOffice path | — |

## Frontend (`frontend/.env.local`)

| Variable | Required | Secret | Local Value | Production | Browser | Purpose |
|----------|----------|--------|-------------|------------|---------|---------|
| NEXT_PUBLIC_SUPABASE_URL | Yes | No | http://localhost:54321 | [managed URL] | Yes | Supabase client URL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY | Yes | No | [anon key] | [anon key] | Yes | Supabase anon/public key |
| NEXT_PUBLIC_API_BASE_URL | Yes | No | http://localhost:3001 | https://api... | Yes | Backend API URL |

## Prohibited in frontend

The following must NEVER appear in frontend environment or bundle:
- SUPABASE_SECRET_KEY (service-role)
- DOWNLOAD_SIGNING_SECRET
- USER_API_KEYS_ENCRYPTION_SECRET
- Any LLM provider API key
- S3/R2 secret access key
- RESEND_API_KEY
- COURTLISTENER_API_TOKEN
